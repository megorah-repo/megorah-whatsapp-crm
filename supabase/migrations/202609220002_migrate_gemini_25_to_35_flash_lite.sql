-- Normalize previously saved Gemini 2.5 model selections to Gemini 3.5 Flash-Lite.
UPDATE public.ai_configs
SET model = 'gemini-3.5-flash-lite'
WHERE provider = 'google-gemini'
  AND model IN ('gemini-2.5-flash-lite', 'gemini-2.5-flash');

