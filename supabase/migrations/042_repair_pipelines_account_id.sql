-- ============================================================
-- 019_repair_pipelines_account_id.sql
--
-- Repairs production databases where the account-sharing migration
-- (017) was applied incompletely or where `pipelines.account_id`
-- is missing from the live PostgREST schema cache.
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
      AND table_name = 'pipelines'
      AND column_name = 'account_id'
  ) THEN
    ALTER TABLE public.pipelines
      ADD COLUMN account_id UUID REFERENCES public.accounts(id) ON DELETE CASCADE;
  END IF;

  -- Backfill existing pipeline rows from the owning profile.
  UPDATE public.pipelines p
  SET account_id = pr.account_id
  FROM public.profiles pr
  WHERE p.user_id = pr.user_id
    AND p.account_id IS NULL
    AND pr.account_id IS NOT NULL;

  IF EXISTS (
    SELECT 1
    FROM public.pipelines
    WHERE account_id IS NULL
  ) THEN
    RAISE EXCEPTION 'pipelines.account_id backfill incomplete — one or more rows have no linked account';
  END IF;

  ALTER TABLE public.pipelines
    ALTER COLUMN account_id SET NOT NULL;

  CREATE INDEX IF NOT EXISTS idx_pipelines_account
    ON public.pipelines(account_id);

  -- Force PostgREST to reload its schema cache immediately.
  PERFORM pg_notify('pgrst', 'reload schema');
END $$;
