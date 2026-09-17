-- ============================================================
-- 018_repair_automations_account_id.sql
--
-- Repairs production databases where the account-sharing migration
-- (017) was applied incompletely or where `automations.account_id`
-- was missing from the live PostgREST schema cache.
--
-- Safe to run more than once.
-- ============================================================

DO $$
BEGIN
  IF to_regclass('public.accounts') IS NULL THEN
    RAISE EXCEPTION 'Migration 017 must be applied first: public.accounts is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'account_id'
  ) THEN
    RAISE EXCEPTION 'Migration 017 must be applied first: profiles.account_id is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'automations'
      AND column_name = 'account_id'
  ) THEN
    ALTER TABLE public.automations
      ADD COLUMN account_id UUID REFERENCES public.accounts(id) ON DELETE CASCADE;
  END IF;

  -- Backfill existing automation rows from the caller profile.
  UPDATE public.automations a
  SET account_id = p.account_id
  FROM public.profiles p
  WHERE a.user_id = p.user_id
    AND a.account_id IS NULL
    AND p.account_id IS NOT NULL;

  IF EXISTS (
    SELECT 1
    FROM public.automations
    WHERE account_id IS NULL
  ) THEN
    RAISE EXCEPTION 'automations.account_id backfill incomplete — one or more rows have no linked account';
  END IF;

  ALTER TABLE public.automations
    ALTER COLUMN account_id SET NOT NULL;

  CREATE INDEX IF NOT EXISTS idx_automations_account
    ON public.automations(account_id);

  -- Force PostgREST to reload its schema cache immediately.
  PERFORM pg_notify('pgrst', 'reload schema');
END $$;
