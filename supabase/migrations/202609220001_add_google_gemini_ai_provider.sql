-- Add Google Gemini as a first-class BYO AI provider.
-- Handles both text/check-constrained and enum-backed provider columns.

DO $$
DECLARE
  provider_type text;
  constraint_name text;
BEGIN
  SELECT c.udt_name
    INTO provider_type
    FROM information_schema.columns c
   WHERE c.table_schema = 'public'
     AND c.table_name = 'ai_configs'
     AND c.column_name = 'provider';

  IF provider_type IS NOT NULL
     AND EXISTS (
       SELECT 1
         FROM pg_type t
        WHERE t.typname = provider_type
          AND t.typtype = 'e'
     )
  THEN
    EXECUTE format(
      'ALTER TYPE %I ADD VALUE IF NOT EXISTS ''google-gemini''',
      provider_type
    );
  ELSE
    FOR constraint_name IN
      SELECT con.conname
        FROM pg_constraint con
        JOIN pg_attribute att
          ON att.attrelid = con.conrelid
         AND att.attnum = ANY(con.conkey)
       WHERE con.conrelid = 'public.ai_configs'::regclass
         AND con.contype = 'c'
         AND con.consrc IS NOT NULL
         AND con.consrc::text ILIKE '%provider%'
    LOOP
      EXECUTE format(
        'ALTER TABLE public.ai_configs DROP CONSTRAINT %I',
        constraint_name
      );
    END LOOP;

    ALTER TABLE public.ai_configs
      ADD CONSTRAINT ai_configs_provider_check
      CHECK (provider IN ('openai', 'anthropic', 'google-gemini'));
  END IF;
END
$$;
