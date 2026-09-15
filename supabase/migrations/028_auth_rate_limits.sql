-- Shared, database-backed rate limiting for unauthenticated authentication endpoints.
-- The table is intentionally inaccessible to clients; only the narrowly-scoped
-- SECURITY DEFINER function is executable by anon/authenticated callers.

CREATE TABLE IF NOT EXISTS public.auth_rate_limit_buckets (
  bucket_key TEXT PRIMARY KEY CHECK (char_length(bucket_key) BETWEEN 1 AND 256),
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  blocked_until TIMESTAMPTZ
);

ALTER TABLE public.auth_rate_limit_buckets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.auth_rate_limit_buckets FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.consume_auth_rate_limit(
  p_bucket_key TEXT,
  p_limit INTEGER,
  p_window_seconds INTEGER
)
RETURNS TABLE (
  allowed BOOLEAN,
  remaining INTEGER,
  retry_after_seconds INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_window_start TIMESTAMPTZ;
  v_count INTEGER;
  v_blocked_until TIMESTAMPTZ;
  v_remaining INTEGER;
  v_retry INTEGER;
BEGIN
  IF p_bucket_key IS NULL
     OR char_length(p_bucket_key) = 0
     OR char_length(p_bucket_key) > 256
     OR p_limit < 1
     OR p_limit > 1000
     OR p_window_seconds < 1
     OR p_window_seconds > 86400 THEN
    RETURN QUERY SELECT FALSE, 0, 60;
    RETURN;
  END IF;

  INSERT INTO public.auth_rate_limit_buckets (bucket_key)
  VALUES (p_bucket_key)
  ON CONFLICT (bucket_key) DO NOTHING;

  SELECT window_started_at, request_count, blocked_until
    INTO v_window_start, v_count, v_blocked_until
  FROM public.auth_rate_limit_buckets
  WHERE bucket_key = p_bucket_key
  FOR UPDATE;

  IF v_window_start + make_interval(secs => p_window_seconds) <= v_now THEN
    v_window_start := v_now;
    v_count := 0;
    v_blocked_until := NULL;
  END IF;

  IF v_blocked_until IS NOT NULL AND v_blocked_until > v_now THEN
    v_retry := GREATEST(1, CEIL(EXTRACT(EPOCH FROM (v_blocked_until - v_now)))::INTEGER);
    RETURN QUERY SELECT FALSE, 0, v_retry;
    RETURN;
  END IF;

  IF v_count >= p_limit THEN
    v_retry := GREATEST(1, CEIL(EXTRACT(EPOCH FROM ((v_window_start + make_interval(secs => p_window_seconds)) - v_now)))::INTEGER);
    UPDATE public.auth_rate_limit_buckets
      SET window_started_at = v_window_start,
          request_count = v_count,
          blocked_until = NULL
    WHERE bucket_key = p_bucket_key;
    RETURN QUERY SELECT FALSE, 0, v_retry;
    RETURN;
  END IF;

  v_count := v_count + 1;
  v_remaining := GREATEST(0, p_limit - v_count);

  UPDATE public.auth_rate_limit_buckets
    SET window_started_at = v_window_start,
        request_count = v_count,
        blocked_until = NULL
  WHERE bucket_key = p_bucket_key;

  RETURN QUERY SELECT TRUE, v_remaining, 0;
END;
$$;

ALTER FUNCTION public.consume_auth_rate_limit(TEXT, INTEGER, INTEGER) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.consume_auth_rate_limit(TEXT, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_auth_rate_limit(TEXT, INTEGER, INTEGER) TO anon, authenticated;

CREATE INDEX IF NOT EXISTS auth_rate_limit_buckets_window_idx
  ON public.auth_rate_limit_buckets (window_started_at);
