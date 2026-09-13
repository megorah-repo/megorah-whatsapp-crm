-- Megorah SaaS billing foundation
-- Safe to run once. This migration does not delete or alter existing customer data.

create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.is_platform_admin(check_user_id uuid default auth.uid())
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.platform_admins
    where user_id = coalesce(check_user_id, auth.uid())
  );
$$;

create table if not exists public.billing_plans (
  id text primary key,
  name text not null,
  description text not null,
  price_inr_monthly numeric(10,2) not null default 0,
  trial_days integer not null default 14,
  max_users integer,
  max_contacts integer,
  max_automations integer,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  plan_id text not null references public.billing_plans(id),
  status text not null default 'trialing' check (status in ('trialing','active','past_due','cancelled','expired')),
  started_at timestamptz not null default now(),
  current_period_end timestamptz,
  provider text,
  provider_subscription_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_subscriptions_provider_id
  on public.subscriptions(provider, provider_subscription_id)
  where provider is not null and provider_subscription_id is not null;

create index if not exists idx_subscriptions_account_id on public.subscriptions(account_id);
create index if not exists idx_subscriptions_status on public.subscriptions(status);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  amount_inr numeric(12,2) not null,
  status text not null default 'pending' check (status in ('pending','paid','failed','refunded')),
  provider text,
  provider_payment_id text,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_payments_account_id on public.payments(account_id);
create index if not exists idx_payments_status on public.payments(status);

insert into public.billing_plans (
  id, name, description, price_inr_monthly, trial_days, max_users, max_contacts, max_automations
) values
  ('starter', 'Starter', 'Simple WhatsApp CRM for small businesses', 499, 14, 2, 2500, 5),
  ('growth', 'Growth', 'Team inbox, CRM and automation for growing businesses', 999, 14, 5, 10000, 25),
  ('pro', 'Pro', 'Advanced CRM, automation and AI-ready workflows', 1999, 14, 15, 50000, 100),
  ('enterprise', 'Enterprise', 'Custom limits, onboarding and integrations', 4999, 14, null, null, null)
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  price_inr_monthly = excluded.price_inr_monthly,
  trial_days = excluded.trial_days,
  max_users = excluded.max_users,
  max_contacts = excluded.max_contacts,
  max_automations = excluded.max_automations,
  updated_at = now();

alter table public.platform_admins enable row level security;
alter table public.billing_plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.payments enable row level security;

drop policy if exists "platform admins can read own admin row" on public.platform_admins;
create policy "platform admins can read own admin row"
on public.platform_admins
for select to authenticated
using (user_id = auth.uid());

drop policy if exists "authenticated users can read active plans" on public.billing_plans;
create policy "authenticated users can read active plans"
on public.billing_plans
for select to authenticated
using (active = true or public.is_platform_admin());

drop policy if exists "account members can read their subscriptions" on public.subscriptions;
create policy "account members can read their subscriptions"
on public.subscriptions
for select to authenticated
using (public.is_account_member(account_id) or public.is_platform_admin());

drop policy if exists "account members can read their payments" on public.payments;
create policy "account members can read their payments"
on public.payments
for select to authenticated
using (public.is_account_member(account_id) or public.is_platform_admin());

-- Only platform admins may mutate billing records through the authenticated client.
drop policy if exists "platform admins manage billing plans" on public.billing_plans;
create policy "platform admins manage billing plans"
on public.billing_plans
for all to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

drop policy if exists "platform admins manage subscriptions" on public.subscriptions;
create policy "platform admins manage subscriptions"
on public.subscriptions
for all to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

drop policy if exists "platform admins manage payments" on public.payments;
create policy "platform admins manage payments"
on public.payments
for all to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());
