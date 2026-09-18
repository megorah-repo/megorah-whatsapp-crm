-- Platform admin data layer.
-- Customer-facing sessions never receive access to these tables.
-- The app reads them only through the server-side service-role client after
-- requirePlatformAdmin() has authenticated the platform operator.

create table if not exists public.platform_subscriptions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null unique references public.accounts(id) on delete cascade,
  plan_name text not null default 'Starter',
  monthly_charge numeric(12,2) not null default 0 check (monthly_charge >= 0),
  currency text not null default 'INR' check (char_length(currency) between 3 and 4),
  status text not null default 'trial' check (status in ('trial','active','past_due','paused','cancelled')),
  billing_cycle text not null default 'monthly' check (billing_cycle in ('monthly','yearly')),
  started_at timestamptz default now(),
  next_billing_at timestamptz,
  cancelled_at timestamptz,
  payment_provider text,
  external_customer_id text,
  external_subscription_id text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.platform_onboarding (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null unique references public.accounts(id) on delete cascade,
  status text not null default 'not_started' check (status in ('not_started','in_progress','completed','blocked')),
  owner_assigned text,
  whatsapp_connected boolean not null default false,
  contacts_imported boolean not null default false,
  templates_ready boolean not null default false,
  team_invited boolean not null default false,
  first_message_sent boolean not null default false,
  notes text,
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.platform_tickets (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  ticket_number bigint generated always as identity unique,
  subject text not null,
  description text,
  status text not null default 'open' check (status in ('open','in_progress','waiting_customer','resolved','closed')),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  category text not null default 'general',
  assigned_to text,
  created_by uuid references auth.users(id) on delete set null,
  first_response_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists platform_tickets_account_status_idx
  on public.platform_tickets(account_id, status, created_at desc);

create table if not exists public.platform_feedback (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  rating smallint check (rating between 1 and 5),
  category text,
  message text,
  source text not null default 'in_app',
  sentiment text check (sentiment in ('positive','neutral','negative')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists platform_feedback_account_created_idx
  on public.platform_feedback(account_id, created_at desc);

create index if not exists platform_subscriptions_status_idx
  on public.platform_subscriptions(status, next_billing_at);

alter table public.platform_subscriptions enable row level security;
alter table public.platform_onboarding enable row level security;
alter table public.platform_tickets enable row level security;
alter table public.platform_feedback enable row level security;

revoke all on table public.platform_subscriptions from public, anon, authenticated;
revoke all on table public.platform_onboarding from public, anon, authenticated;
revoke all on table public.platform_tickets from public, anon, authenticated;
revoke all on table public.platform_feedback from public, anon, authenticated;

create or replace function public.platform_admin_touch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = clock_timestamp();
  return new;
end;
$$;

revoke all on function public.platform_admin_touch_updated_at() from public, anon, authenticated;

 drop trigger if exists platform_subscriptions_updated_at on public.platform_subscriptions;
 drop trigger if exists platform_onboarding_updated_at on public.platform_onboarding;
 drop trigger if exists platform_tickets_updated_at on public.platform_tickets;

create trigger platform_subscriptions_updated_at
before update on public.platform_subscriptions
for each row execute function public.platform_admin_touch_updated_at();

create trigger platform_onboarding_updated_at
before update on public.platform_onboarding
for each row execute function public.platform_admin_touch_updated_at();

create trigger platform_tickets_updated_at
before update on public.platform_tickets
for each row execute function public.platform_admin_touch_updated_at();
