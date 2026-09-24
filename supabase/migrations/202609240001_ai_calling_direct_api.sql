create table if not exists public.ai_calling_direct_api_configs (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  provider_name text not null default 'Direct Calls API',
  api_url text not null,
  api_key text not null,
  auth_type text not null default 'bearer',
  caller_number text,
  is_active boolean not null default true,
  last_verified_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_calling_direct_api_auth_type_chk
    check (auth_type in ('bearer', 'x-api-key', 'authorization'))
);

alter table public.ai_calling_direct_api_configs enable row level security;
revoke all on table public.ai_calling_direct_api_configs from public, anon, authenticated;
grant select, insert, update, delete on table public.ai_calling_direct_api_configs to service_role;

create or replace function public.set_ai_calling_direct_api_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists ai_calling_direct_api_updated_at
on public.ai_calling_direct_api_configs;

create trigger ai_calling_direct_api_updated_at
before update on public.ai_calling_direct_api_configs
for each row execute function public.set_ai_calling_direct_api_updated_at();

alter table public.ai_call_sessions
  add column if not exists duration_seconds integer not null default 0,
  add column if not exists cost numeric(14,6),
  add column if not exists cost_currency text;
