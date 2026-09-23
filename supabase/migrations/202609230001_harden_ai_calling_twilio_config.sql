-- The Twilio Auth Token is accessed only through the server-side API routes.
-- Remove direct table privileges from browser-authenticated roles so encrypted
-- credential material is not queryable by client-side Supabase sessions.
revoke all on table public.ai_calling_twilio_configs from public, anon, authenticated;

grant select, insert, update, delete on table public.ai_calling_twilio_configs to service_role;

-- Keep the service-role-only access model explicit.
drop policy if exists "ai calling twilio config account members"
  on public.ai_calling_twilio_configs;
