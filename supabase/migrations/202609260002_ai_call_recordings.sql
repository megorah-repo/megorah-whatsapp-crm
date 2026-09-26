alter table public.ai_call_sessions
  add column if not exists recording_sid text,
  add column if not exists recording_url text,
  add column if not exists recording_status text,
  add column if not exists recording_duration_seconds integer;

create index if not exists ai_call_sessions_recording_sid_idx
  on public.ai_call_sessions(recording_sid);

create index if not exists ai_call_sessions_account_status_created_idx
  on public.ai_call_sessions(account_id, status, created_at desc);
