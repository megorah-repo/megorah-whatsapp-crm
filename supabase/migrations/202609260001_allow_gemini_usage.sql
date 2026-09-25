-- Allow Google Gemini usage rows in the token-spend log.
-- This keeps usage accounting aligned with the first-class Gemini provider.
alter table public.ai_usage_log
  drop constraint if exists ai_usage_log_provider_check;

alter table public.ai_usage_log
  add constraint ai_usage_log_provider_check
  check (provider in ('openai', 'anthropic', 'google-gemini'));
