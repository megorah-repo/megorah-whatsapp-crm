-- Google Calendar + booking layer
CREATE TABLE IF NOT EXISTS public.google_calendar_connections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  connected_by_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  google_email TEXT,
  calendar_id TEXT NOT NULL DEFAULT 'primary',
  refresh_token TEXT NOT NULL,
  scope TEXT,
  status TEXT NOT NULL DEFAULT 'connected'
    CHECK (status IN ('connected','revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id)
);

CREATE INDEX IF NOT EXISTS idx_google_calendar_connections_account
  ON public.google_calendar_connections(account_id);

ALTER TABLE public.google_calendar_connections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS google_calendar_connections_select ON public.google_calendar_connections;
DROP POLICY IF EXISTS google_calendar_connections_modify ON public.google_calendar_connections;

CREATE POLICY google_calendar_connections_select
ON public.google_calendar_connections
FOR SELECT
USING (public.is_account_member(account_id, 'viewer'));

CREATE POLICY google_calendar_connections_modify
ON public.google_calendar_connections
FOR ALL
USING (public.is_account_member(account_id, 'admin'))
WITH CHECK (public.is_account_member(account_id, 'admin'));

CREATE TABLE IF NOT EXISTS public.calendar_bookings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  google_event_id TEXT NOT NULL,
  google_html_link TEXT,
  google_meet_link TEXT,
  title TEXT NOT NULL,
  client_name TEXT,
  client_email TEXT,
  client_phone TEXT,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  whatsapp_sent BOOLEAN NOT NULL DEFAULT FALSE,
  whatsapp_message_id TEXT,
  whatsapp_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, google_event_id)
);

CREATE INDEX IF NOT EXISTS idx_calendar_bookings_account_start
  ON public.calendar_bookings(account_id, starts_at);

ALTER TABLE public.calendar_bookings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS calendar_bookings_select ON public.calendar_bookings;
DROP POLICY IF EXISTS calendar_bookings_insert ON public.calendar_bookings;
DROP POLICY IF EXISTS calendar_bookings_update ON public.calendar_bookings;
DROP POLICY IF EXISTS calendar_bookings_delete ON public.calendar_bookings;

CREATE POLICY calendar_bookings_select
ON public.calendar_bookings
FOR SELECT
USING (public.is_account_member(account_id, 'viewer'));

CREATE POLICY calendar_bookings_insert
ON public.calendar_bookings
FOR INSERT
WITH CHECK (public.is_account_member(account_id, 'agent'));

CREATE POLICY calendar_bookings_update
ON public.calendar_bookings
FOR UPDATE
USING (public.is_account_member(account_id, 'agent'))
WITH CHECK (public.is_account_member(account_id, 'agent'));

CREATE POLICY calendar_bookings_delete
ON public.calendar_bookings
FOR DELETE
USING (public.is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON public.google_calendar_connections;
CREATE TRIGGER set_updated_at
BEFORE UPDATE ON public.google_calendar_connections
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at ON public.calendar_bookings;
CREATE TRIGGER set_updated_at
BEFORE UPDATE ON public.calendar_bookings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

NOTIFY pgrst, 'reload schema';
