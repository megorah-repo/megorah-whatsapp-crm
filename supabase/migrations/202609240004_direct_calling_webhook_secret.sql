ALTER TABLE public.ai_calling_direct_api_configs
  ADD COLUMN IF NOT EXISTS webhook_secret text;

UPDATE public.ai_calling_direct_api_configs
SET webhook_secret = NULL
WHERE webhook_secret IS NOT NULL AND webhook_secret = '';

