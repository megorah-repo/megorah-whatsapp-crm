-- Distributed application rate limiting for horizontally-scaled Vercel/Supabase deployments.
-- The database is the source of truth; no process-local Map is used for production limits.

create table if not exists public.rate_limit_buckets (
  bucket_key text primary key,
  window_started_at timestamptz not null,
  request_count integer not null default 0,
  constraint rate_limit_bucket_key_len check (char_length(bucket_key) between 16 and 200),
  constraint rate_limit_bucket_count_nonnegative check (request_count >= 0)
);

alter table public.rate_limit_buckets enable row level security;

revoke all on table public.rate_limit_buckets from anon, authenticated, public;

create index if not exists rate_limit_buckets_window_idx
  on public.rate_limit_buckets (window_started_at);

create or replace function public.consume_rate_limit(
  p_bucket_key text,
  p_limit integer,
  p_window_seconds integer
)
returns table (
  allowed boolean,
  remaining integer,
  reset_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  now_ts timestamptz := clock_timestamp();
  current_bucket public.rate_limit_buckets%rowtype;
  next_reset timestamptz;
begin
  if p_bucket_key is null
     or char_length(p_bucket_key) < 16
     or char_length(p_bucket_key) > 200
     or p_limit < 1
     or p_limit > 100000
     or p_window_seconds < 1
     or p_window_seconds > 86400 then
    raise exception using
      errcode = '22023',
      message = 'invalid rate limit parameters';
  end if;

  insert into public.rate_limit_buckets (bucket_key, window_started_at, request_count)
  values (p_bucket_key, now_ts, 1)
  on conflict (bucket_key) do update
  set
    window_started_at = case
      when public.rate_limit_buckets.window_started_at
        <= now_ts - make_interval(secs => p_window_seconds)
      then now_ts
      else public.rate_limit_buckets.window_started_at
    end,
    request_count = case
      when public.rate_limit_buckets.window_started_at
        <= now_ts - make_interval(secs => p_window_seconds)
      then 1
      else public.rate_limit_buckets.request_count + 1
    end;

  select * into current_bucket
  from public.rate_limit_buckets
  where bucket_key = p_bucket_key
  for update;

  next_reset := current_bucket.window_started_at + make_interval(secs => p_window_seconds);

  return query
  select
    current_bucket.request_count <= p_limit,
    greatest(0, p_limit - current_bucket.request_count),
    next_reset;
end;
$$;

revoke all on function public.consume_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer) to anon, authenticated, service_role;

-- Keep the limiter table from growing forever. Run this from pg_cron or a scheduled job.
create or replace function public.prune_rate_limit_buckets(p_older_than_seconds integer default 172800)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  deleted_count bigint;
begin
  if p_older_than_seconds < 3600 or p_older_than_seconds > 2592000 then
    raise exception using errcode = '22023', message = 'invalid prune age';
  end if;

  delete from public.rate_limit_buckets
  where window_started_at < clock_timestamp() - make_interval(secs => p_older_than_seconds);

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.prune_rate_limit_buckets(integer) from public, anon, authenticated;
