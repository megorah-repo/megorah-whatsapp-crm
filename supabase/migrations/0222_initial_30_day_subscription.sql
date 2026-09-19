-- 0222: activate the first 30-day SaaS subscription for every account.
-- Payment processing remains intentionally separate; this migration only
-- establishes the subscription period used by the countdown UI.

insert into public.subscriptions (
  account_id,
  plan_id,
  status,
  started_at,
  current_period_end
)
select
  a.id,
  'starter',
  'active',
  now(),
  now() + interval '30 days'
from public.accounts a
where not exists (
  select 1
  from public.subscriptions s
  where s.account_id = a.id
    and s.status in ('trialing', 'active', 'past_due')
    and coalesce(s.current_period_end, now()) > now()
);

-- New signups also receive an initial 30-day subscription.
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_full_name text;
  v_account_id uuid;
begin
  v_full_name := coalesce(new.raw_user_meta_data->>'full_name', '');

  insert into public.accounts (name, owner_user_id)
  values (coalesce(nullif(v_full_name, ''), new.email, 'My account'), new.id)
  returning id into v_account_id;

  insert into public.profiles (user_id, full_name, email, account_id, account_role)
  values (new.id, v_full_name, new.email, v_account_id, 'owner');

  insert into public.subscriptions (
    account_id,
    plan_id,
    status,
    started_at,
    current_period_end
  )
  values (
    v_account_id,
    'starter',
    'active',
    now(),
    now() + interval '30 days'
  );

  return new;
exception when others then
  raise warning 'Failed to bootstrap account/profile/subscription for user %: %', new.id, sqlerrm;
  return new;
end;
$$;

alter function public.handle_new_user() owner to postgres;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();
