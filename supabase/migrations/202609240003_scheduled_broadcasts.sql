-- Durable scheduled broadcasts: the same atomic create function now accepts
-- a scheduled timestamp. NULL keeps the existing immediate-send behaviour.

DROP FUNCTION IF EXISTS public.create_broadcast_with_recipients(
  UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID[], JSONB[], TEXT
);

CREATE OR REPLACE FUNCTION public.create_broadcast_with_recipients(
  p_account_id        UUID,
  p_user_id           UUID,
  p_name              TEXT,
  p_template_name     TEXT,
  p_template_language TEXT,
  p_total_recipients  INTEGER,
  p_contact_ids       UUID[],
  p_template_params   JSONB[],
  p_header_media_url  TEXT,
  p_scheduled_at      TIMESTAMPTZ
)
RETURNS TABLE(broadcast_id UUID, recipient_id UUID, contact_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_broadcast_id UUID;
BEGIN
  INSERT INTO broadcasts (
    account_id,
    user_id,
    name,
    template_name,
    template_language,
    status,
    total_recipients,
    header_media_url,
    scheduled_at
  )
  VALUES (
    p_account_id,
    p_user_id,
    p_name,
    p_template_name,
    p_template_language,
    CASE WHEN p_scheduled_at IS NULL THEN 'sending' ELSE 'scheduled' END,
    p_total_recipients,
    p_header_media_url,
    p_scheduled_at
  )
  RETURNING id INTO v_broadcast_id;

  RETURN QUERY
  WITH ins AS (
    INSERT INTO broadcast_recipients (
      broadcast_id,
      contact_id,
      status,
      template_params
    )
    SELECT v_broadcast_id, t.cid, 'pending', t.prm
    FROM unnest(p_contact_ids, p_template_params) AS t(cid, prm)
    RETURNING id, contact_id
  )
  SELECT v_broadcast_id, ins.id, ins.contact_id
  FROM ins;
END;
$$;

REVOKE ALL ON FUNCTION public.create_broadcast_with_recipients(
  UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID[], JSONB[], TEXT, TIMESTAMPTZ
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_broadcast_with_recipients(
  UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID[], JSONB[], TEXT, TIMESTAMPTZ
) FROM anon;
REVOKE ALL ON FUNCTION public.create_broadcast_with_recipients(
  UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID[], JSONB[], TEXT, TIMESTAMPTZ
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_broadcast_with_recipients(
  UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID[], JSONB[], TEXT, TIMESTAMPTZ
) TO service_role;
