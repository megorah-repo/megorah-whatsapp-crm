create table if not exists public.ai_call_sessions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  provider text not null default 'twilio',
  provider_call_sid text unique,
  from_number text not null,
  to_number text not null,
  status text not null default 'queued',
  settings jsonb not null default '{}'::jsonb,
  history jsonb not null default '[]'::jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ended_at timestamptz
);

create index if not exists ai_call_sessions_account_created_idx
  on public.ai_call_sessions(account_id, created_at desc);

create index if not exists ai_call_sessions_call_sid_idx
  on public.ai_call_sessions(provider_call_sid);

alter table public.ai_call_sessions enable row level security;

drop policy if exists "ai call sessions account members" on public.ai_call_sessions;

create or replace function public.set_ai_call_session_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists ai_call_sessions_updated_at on public.ai_call_sessions;
create trigger ai_call_sessions_updated_at
before update on public.ai_call_sessions
for each row execute function public.set_ai_call_session_updated_at();

grant select, insert, update, delete on public.ai_call_sessions to service_role;

create policy "ai call sessions account members"
on public.ai_call_sessions
for all
to authenticated
using (
  account_id in (
    select p.account_id
    from public.profiles p
    where p.user_id = auth.uid()
  )
)
with check (
  account_id in (
    select p.account_id
    from public.profiles p
    where p.user_id = auth.uid()
  )
);
