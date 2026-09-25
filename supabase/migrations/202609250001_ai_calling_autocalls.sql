create table if not exists public.ai_call_campaigns (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  created_by uuid,
  name text not null,
  status text not null default 'draft',
  max_concurrent integer not null default 2,
  calls_per_run integer not null default 2,
  max_attempts integer not null default 2,
  retry_delay_minutes integer not null default 30,
  business_hours_only boolean not null default true,
  business_hours_start time not null default '09:00',
  business_hours_end time not null default '19:00',
  timezone text not null default 'Asia/Kolkata',
  settings jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  paused_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_call_campaigns_status_chk check (status in ('draft','running','paused','completed','failed')),
  constraint ai_call_campaigns_limits_chk check (
    max_concurrent between 1 and 20
    and calls_per_run between 1 and 20
    and max_attempts between 1 and 10
    and retry_delay_minutes between 1 and 1440
  )
);

create table if not exists public.ai_call_queue (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  campaign_id uuid not null references public.ai_call_campaigns(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  to_number text not null,
  display_name text,
  attempt_count integer not null default 0,
  max_attempts integer not null default 2,
  status text not null default 'queued',
  scheduled_at timestamptz not null default now(),
  next_attempt_at timestamptz not null default now(),
  session_id uuid references public.ai_call_sessions(id) on delete set null,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_call_queue_status_chk check (
    status in ('queued','placing','ringing','answered','in-progress','completed','failed','busy','no-answer','canceled','skipped')
  ),
  constraint ai_call_queue_attempts_chk check (attempt_count >= 0 and max_attempts between 1 and 10)
);

create index if not exists ai_call_campaigns_account_status_idx
  on public.ai_call_campaigns(account_id, status, created_at desc);
create index if not exists ai_call_queue_campaign_ready_idx
  on public.ai_call_queue(campaign_id, status, next_attempt_at);
create index if not exists ai_call_queue_account_status_idx
  on public.ai_call_queue(account_id, status, next_attempt_at);

alter table public.ai_call_campaigns enable row level security;
alter table public.ai_call_queue enable row level security;
revoke all on table public.ai_call_campaigns from public, anon, authenticated;
revoke all on table public.ai_call_queue from public, anon, authenticated;
grant select, insert, update, delete on table public.ai_call_campaigns to service_role;
grant select, insert, update, delete on table public.ai_call_queue to service_role;

create or replace function public.set_ai_call_campaign_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists ai_call_campaigns_updated_at on public.ai_call_campaigns;
create trigger ai_call_campaigns_updated_at
before update on public.ai_call_campaigns
for each row execute function public.set_ai_call_campaign_updated_at();

create or replace function public.set_ai_call_queue_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists ai_call_queue_updated_at on public.ai_call_queue;
create trigger ai_call_queue_updated_at
before update on public.ai_call_queue
for each row execute function public.set_ai_call_queue_updated_at();

create or replace function public.claim_ai_call_queue(
  p_campaign_id uuid,
  p_limit integer
)
returns setof public.ai_call_queue
language sql
security definer
set search_path = public
as $$
  with candidates as (
    select id
    from public.ai_call_queue
    where campaign_id = p_campaign_id
      and status = 'queued'
      and next_attempt_at <= now()
      and attempt_count < max_attempts
    order by next_attempt_at asc, created_at asc
    limit greatest(1, least(coalesce(p_limit, 1), 20))
    for update skip locked
  )
  update public.ai_call_queue q
  set status = 'placing',
      attempt_count = q.attempt_count + 1,
      updated_at = now()
  from candidates c
  where q.id = c.id
  returning q.*;
$$;

revoke all on function public.claim_ai_call_queue(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_ai_call_queue(uuid, integer) to service_role;
