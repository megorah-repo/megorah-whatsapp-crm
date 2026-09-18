-- 045 calendar-to-pipeline + scheduled WhatsApp reminders
ALTER TABLE public.calendar_bookings
  ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pipeline_deal_id UUID REFERENCES public.deals(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_calendar_bookings_account_contact
  ON public.calendar_bookings(account_id, contact_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_bookings_pipeline_deal
  ON public.calendar_bookings(account_id, pipeline_deal_id)
  WHERE pipeline_deal_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.calendar_reminders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  booking_id UUID NOT NULL REFERENCES public.calendar_bookings(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  channel TEXT NOT NULL DEFAULT 'whatsapp'
    CHECK (channel IN ('whatsapp')),
  offset_minutes INTEGER NOT NULL
    CHECK (offset_minutes > 0),
  remind_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','sent','failed','cancelled')),
  locked_at TIMESTAMPTZ,
  locked_by UUID,
  attempts INTEGER NOT NULL DEFAULT 0
    CHECK (attempts >= 0),
  sent_at TIMESTAMPTZ,
  whatsapp_message_id TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (booking_id, channel, offset_minutes)
);

CREATE INDEX IF NOT EXISTS idx_calendar_reminders_due
  ON public.calendar_reminders(status, remind_at, created_at);

CREATE INDEX IF NOT EXISTS idx_calendar_reminders_account
  ON public.calendar_reminders(account_id, remind_at);

ALTER TABLE public.calendar_reminders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS calendar_reminders_select ON public.calendar_reminders;
DROP POLICY IF EXISTS calendar_reminders_modify ON public.calendar_reminders;

CREATE POLICY calendar_reminders_select
ON public.calendar_reminders
FOR SELECT
USING (public.is_account_member(account_id, 'viewer'));

CREATE POLICY calendar_reminders_modify
ON public.calendar_reminders
FOR ALL
USING (public.is_account_member(account_id, 'agent'))
WITH CHECK (public.is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON public.calendar_reminders;
CREATE TRIGGER set_updated_at
BEFORE UPDATE ON public.calendar_reminders
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.claim_calendar_reminders(
  p_worker_id UUID,
  p_limit INTEGER DEFAULT 25
)
RETURNS TABLE(
  reminder_id UUID,
  booking_id UUID,
  contact_id UUID,
  account_id UUID,
  attempts INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'invalid calendar reminder worker batch size';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT r.id
    FROM public.calendar_reminders r
    WHERE
      (r.status = 'pending' AND r.remind_at <= clock_timestamp())
      OR
      (r.status = 'processing'
       AND r.locked_at IS NOT NULL
       AND r.locked_at <= clock_timestamp() - INTERVAL '10 minutes')
    ORDER BY r.remind_at ASC, r.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  ),
  claimed AS (
    UPDATE public.calendar_reminders r
    SET
      status = 'processing',
      attempts = r.attempts + 1,
      locked_at = clock_timestamp(),
      locked_by = p_worker_id,
      error_message = NULL,
      updated_at = clock_timestamp()
    FROM candidates c
    WHERE r.id = c.id
    RETURNING r.id, r.booking_id, r.contact_id, r.account_id, r.attempts
  )
  SELECT * FROM claimed;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_calendar_reminders(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_calendar_reminders(UUID, INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.complete_calendar_reminder(
  p_reminder_id UUID,
  p_worker_id UUID,
  p_whatsapp_message_id TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.calendar_reminders
  SET status='sent',
      sent_at=clock_timestamp(),
      whatsapp_message_id=p_whatsapp_message_id,
      locked_at=NULL,
      locked_by=NULL,
      error_message=NULL,
      updated_at=clock_timestamp()
  WHERE id=p_reminder_id AND status='processing' AND locked_by=p_worker_id
  RETURNING TRUE;
$$;

REVOKE ALL ON FUNCTION public.complete_calendar_reminder(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_calendar_reminder(UUID, UUID, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.fail_calendar_reminder(
  p_reminder_id UUID,
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
  UPDATE public.calendar_reminders
  SET status = CASE WHEN p_retry THEN 'pending' ELSE 'failed' END,
      remind_at = CASE WHEN p_retry THEN p_run_at ELSE remind_at END,
      locked_at=NULL,
      locked_by=NULL,
      error_message=left(COALESCE(p_error,'unknown reminder failure'),2000),
      updated_at=clock_timestamp()
  WHERE id=p_reminder_id AND status='processing' AND locked_by=p_worker_id
  RETURNING TRUE;
$$;

REVOKE ALL ON FUNCTION public.fail_calendar_reminder(UUID, UUID, TEXT, BOOLEAN, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_calendar_reminder(UUID, UUID, TEXT, BOOLEAN, TIMESTAMPTZ) TO service_role;

NOTIFY pgrst, 'reload schema';
