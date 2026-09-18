-- 044 reliability: durable outbound idempotency + durable inbound webhook jobs.

CREATE TABLE IF NOT EXISTS public.outbound_message_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  message_id UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  whatsapp_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'sending'
    CHECK (status IN ('sending', 'sent', 'failed')),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, idempotency_key),
  CONSTRAINT outbound_message_key_len CHECK (char_length(idempotency_key) BETWEEN 1 AND 200),
  CONSTRAINT outbound_message_fingerprint_len CHECK (char_length(request_fingerprint) = 64)
);

CREATE INDEX IF NOT EXISTS idx_outbound_message_keys_status
  ON public.outbound_message_keys (account_id, status, updated_at DESC);

ALTER TABLE public.outbound_message_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.outbound_message_keys FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.outbound_message_keys TO service_role;

DROP TRIGGER IF EXISTS set_updated_at ON public.outbound_message_keys;
CREATE TRIGGER set_updated_at
BEFORE UPDATE ON public.outbound_message_keys
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.whatsapp_webhook_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  dedupe_key TEXT NOT NULL UNIQUE,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  locked_by UUID,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT whatsapp_webhook_job_dedupe_len CHECK (char_length(dedupe_key) BETWEEN 16 AND 200)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_webhook_jobs_due
  ON public.whatsapp_webhook_jobs (status, run_at, created_at);

CREATE INDEX IF NOT EXISTS idx_whatsapp_webhook_jobs_lock
  ON public.whatsapp_webhook_jobs (status, locked_at);

ALTER TABLE public.whatsapp_webhook_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.whatsapp_webhook_jobs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.whatsapp_webhook_jobs TO service_role;

DROP TRIGGER IF EXISTS set_updated_at ON public.whatsapp_webhook_jobs;
CREATE TRIGGER set_updated_at
BEFORE UPDATE ON public.whatsapp_webhook_jobs
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS inbound_persisted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS inbound_effects_processed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS inbound_is_first BOOLEAN;

CREATE INDEX IF NOT EXISTS idx_messages_inbound_processing
  ON public.messages (conversation_id, inbound_effects_processed_at)
  WHERE sender_type = 'customer';

CREATE OR REPLACE FUNCTION public.claim_whatsapp_webhook_jobs(
  p_worker_id UUID,
  p_limit INTEGER DEFAULT 20
)
RETURNS TABLE(job_id UUID, payload JSONB, attempts INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'invalid webhook worker batch size';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT j.id
    FROM public.whatsapp_webhook_jobs AS j
    WHERE
      (j.status = 'pending' AND j.run_at <= clock_timestamp())
      OR
      (j.status = 'processing'
       AND j.locked_at IS NOT NULL
       AND j.locked_at <= clock_timestamp() - INTERVAL '10 minutes')
    ORDER BY j.run_at ASC, j.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  ),
  claimed AS (
    UPDATE public.whatsapp_webhook_jobs AS j
    SET
      status = 'processing',
      attempts = j.attempts + 1,
      locked_at = clock_timestamp(),
      locked_by = p_worker_id,
      last_error = NULL,
      updated_at = clock_timestamp()
    FROM candidates
    WHERE j.id = candidates.id
    RETURNING j.id, j.payload, j.attempts
  )
  SELECT claimed.id, claimed.payload, claimed.attempts
  FROM claimed;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_whatsapp_webhook_jobs(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_whatsapp_webhook_jobs(UUID, INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.complete_whatsapp_webhook_job(
  p_job_id UUID,
  p_worker_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.whatsapp_webhook_jobs
  SET status = 'completed', locked_at = NULL, locked_by = NULL,
      last_error = NULL, updated_at = clock_timestamp()
  WHERE id = p_job_id AND status = 'processing' AND locked_by = p_worker_id
  RETURNING TRUE;
$$;

REVOKE ALL ON FUNCTION public.complete_whatsapp_webhook_job(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_whatsapp_webhook_job(UUID, UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.fail_whatsapp_webhook_job(
  p_job_id UUID,
  p_worker_id UUID,
  p_error TEXT,
  p_retry BOOLEAN,
  p_run_at TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.whatsapp_webhook_jobs
  SET
    status = CASE WHEN p_retry THEN 'pending' ELSE 'failed' END,
    run_at = CASE WHEN p_retry THEN p_run_at ELSE run_at END,
    locked_at = NULL,
    locked_by = NULL,
    last_error = left(COALESCE(p_error, 'unknown webhook processing failure'), 2000),
    updated_at = clock_timestamp()
  WHERE id = p_job_id AND status = 'processing' AND locked_by = p_worker_id
  RETURNING TRUE;
$$;

REVOKE ALL ON FUNCTION public.fail_whatsapp_webhook_job(UUID, UUID, TEXT, BOOLEAN, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_whatsapp_webhook_job(UUID, UUID, TEXT, BOOLEAN, TIMESTAMPTZ) TO service_role;
