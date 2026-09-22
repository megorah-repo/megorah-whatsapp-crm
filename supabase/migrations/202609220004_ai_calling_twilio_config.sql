create table if not exists public.ai_calling_twilio_configs (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  account_sid text not null,
  auth_token text not null,
  caller_number text,
  is_active boolean not null default true,
  last_verified_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.ai_calling_twilio_configs enable row level security;

drop policy if exists "ai calling twilio config account members" on public.ai_calling_twilio_configs;

create policy "ai calling twilio config account members"
on public.ai_calling_twilio_configs
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

grant select, insert, update, delete on public.ai_calling_twilio_configs to service_role;

create or replace function public.set_ai_calling_twilio_config_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists ai_calling_twilio_config_updated_at
on public.ai_calling_twilio_configs;

create trigger ai_calling_twilio_config_updated_at
before update on public.ai_calling_twilio_configs
for each row execute function public.set_ai_calling_twilio_config_updated_at();
