-- ============================================================
-- 020_repair_flows_account_id.sql
--
-- Repairs production databases where the conversational-flow
-- migration was never applied completely, or where the later
-- account-sharing migration was applied without the flow tables.
--
-- This migration is intentionally self-healing:
--   1. creates the flow tables when they are missing;
--   2. adds account_id to flows / flow_runs when missing;
--   3. backfills account ownership from profiles / parent flows;
--   4. restores account-scoped indexes + RLS;
--   5. refreshes PostgREST's schema cache.
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
END $$;

-- ============================================================
-- 1. FLOWS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.flows (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'archived')),
  trigger_type TEXT NOT NULL
    CHECK (trigger_type IN ('keyword', 'first_inbound_message', 'manual')),
  trigger_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  entry_node_id TEXT,
  fallback_policy JSONB NOT NULL DEFAULT
    '{"on_unknown_reply":"reprompt","max_reprompts":2,"on_timeout_hours":24,"on_exhaust":"handoff"}'::jsonb,
  execution_count INTEGER NOT NULL DEFAULT 0,
  last_executed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Existing deployments may already have flows without account_id.
ALTER TABLE public.flows
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES public.accounts(id) ON DELETE CASCADE;

UPDATE public.flows f
SET account_id = p.account_id
FROM public.profiles p
WHERE f.user_id = p.user_id
  AND f.account_id IS NULL
  AND p.account_id IS NOT NULL;

IF EXISTS (
  SELECT 1 FROM public.flows WHERE account_id IS NULL
) THEN
  RAISE EXCEPTION 'flows.account_id backfill incomplete — one or more rows have no linked account';
END IF;

ALTER TABLE public.flows
  ALTER COLUMN account_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_flows_account
  ON public.flows(account_id);

CREATE INDEX IF NOT EXISTS idx_flows_active_trigger
  ON public.flows(account_id, trigger_type)
  WHERE status = 'active';

DROP POLICY IF EXISTS "Users can manage own flows" ON public.flows;
DROP POLICY IF EXISTS flows_select ON public.flows;
DROP POLICY IF EXISTS flows_insert ON public.flows;
DROP POLICY IF EXISTS flows_update ON public.flows;
DROP POLICY IF EXISTS flows_delete ON public.flows;
ALTER TABLE public.flows ENABLE ROW LEVEL SECURITY;

CREATE POLICY flows_select ON public.flows
  FOR SELECT
  USING (is_account_member(account_id, 'viewer'));

CREATE POLICY flows_insert ON public.flows
  FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

CREATE POLICY flows_update ON public.flows
  FOR UPDATE
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

CREATE POLICY flows_delete ON public.flows
  FOR DELETE
  USING (is_account_member(account_id, 'agent'));

-- Updated-at trigger.
DROP TRIGGER IF EXISTS set_updated_at ON public.flows;
CREATE TRIGGER set_updated_at
BEFORE UPDATE ON public.flows
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 2. FLOW NODES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.flow_nodes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  flow_id UUID NOT NULL REFERENCES public.flows(id) ON DELETE CASCADE,
  node_key TEXT NOT NULL,
  node_type TEXT NOT NULL CHECK (node_type IN (
    'start',
    'send_buttons',
    'send_list',
    'send_message',
    'collect_input',
    'condition',
    'set_tag',
    'handoff',
    'http_fetch',
    'end'
  )),
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  position_x INTEGER NOT NULL DEFAULT 0,
  position_y INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (flow_id, node_key)
);

CREATE INDEX IF NOT EXISTS idx_flow_nodes_flow
  ON public.flow_nodes(flow_id);

DROP POLICY IF EXISTS "Users manage nodes on their flows" ON public.flow_nodes;
DROP POLICY IF EXISTS flow_nodes_select ON public.flow_nodes;
DROP POLICY IF EXISTS flow_nodes_insert ON public.flow_nodes;
DROP POLICY IF EXISTS flow_nodes_update ON public.flow_nodes;
DROP POLICY IF EXISTS flow_nodes_delete ON public.flow_nodes;
ALTER TABLE public.flow_nodes ENABLE ROW LEVEL SECURITY;

CREATE POLICY flow_nodes_select ON public.flow_nodes
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.flows f
      WHERE f.id = flow_nodes.flow_id
        AND is_account_member(f.account_id, 'viewer')
    )
  );

CREATE POLICY flow_nodes_insert ON public.flow_nodes
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.flows f
      WHERE f.id = flow_nodes.flow_id
        AND is_account_member(f.account_id, 'agent')
    )
  );

CREATE POLICY flow_nodes_update ON public.flow_nodes
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.flows f
      WHERE f.id = flow_nodes.flow_id
        AND is_account_member(f.account_id, 'agent')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.flows f
      WHERE f.id = flow_nodes.flow_id
        AND is_account_member(f.account_id, 'agent')
    )
  );

CREATE POLICY flow_nodes_delete ON public.flow_nodes
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM public.flows f
      WHERE f.id = flow_nodes.flow_id
        AND is_account_member(f.account_id, 'agent')
    )
  );

-- ============================================================
-- 3. FLOW RUNS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.flow_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  flow_id UUID NOT NULL REFERENCES public.flows(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id UUID REFERENCES public.accounts(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN (
    'active',
    'completed',
    'handed_off',
    'timed_out',
    'paused_by_agent',
    'failed'
  )),
  current_node_key TEXT,
  last_prompt_message_id UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  vars JSONB NOT NULL DEFAULT '{}'::jsonb,
  reprompt_count INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_advanced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  end_reason TEXT
);

ALTER TABLE public.flow_runs
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES public.accounts(id) ON DELETE CASCADE;

UPDATE public.flow_runs r
SET account_id = f.account_id
FROM public.flows f
WHERE r.flow_id = f.id
  AND r.account_id IS NULL
  AND f.account_id IS NOT NULL;

IF EXISTS (
  SELECT 1 FROM public.flow_runs WHERE account_id IS NULL
) THEN
  RAISE EXCEPTION 'flow_runs.account_id backfill incomplete — one or more rows have no linked account';
END IF;

ALTER TABLE public.flow_runs
  ALTER COLUMN account_id SET NOT NULL;

DROP INDEX IF EXISTS idx_one_active_run_per_contact;
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_run_per_contact
  ON public.flow_runs(account_id, contact_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_flow_runs_active_advanced
  ON public.flow_runs(last_advanced_at)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_flow_runs_flow_started
  ON public.flow_runs(flow_id, started_at DESC);

DROP POLICY IF EXISTS "Users see own flow runs" ON public.flow_runs;
DROP POLICY IF EXISTS flow_runs_select ON public.flow_runs;
DROP POLICY IF EXISTS flow_runs_insert ON public.flow_runs;
DROP POLICY IF EXISTS flow_runs_update ON public.flow_runs;
DROP POLICY IF EXISTS flow_runs_delete ON public.flow_runs;
ALTER TABLE public.flow_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY flow_runs_select ON public.flow_runs
  FOR SELECT
  USING (is_account_member(account_id, 'viewer'));

-- Runner writes use service_role; no client write policies are needed.

-- ============================================================
-- 4. FLOW RUN EVENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.flow_run_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  flow_run_id UUID NOT NULL REFERENCES public.flow_runs(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'started',
    'node_entered',
    'message_sent',
    'reply_received',
    'fallback_fired',
    'handoff',
    'timeout',
    'error',
    'completed'
  )),
  node_key TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_flow_run_events_run_type
  ON public.flow_run_events(flow_run_id, event_type);

CREATE INDEX IF NOT EXISTS idx_flow_run_events_run_time
  ON public.flow_run_events(flow_run_id, created_at DESC);

DROP POLICY IF EXISTS "Users see events on their runs" ON public.flow_run_events;
DROP POLICY IF EXISTS flow_run_events_select ON public.flow_run_events;
ALTER TABLE public.flow_run_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY flow_run_events_select ON public.flow_run_events
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.flow_runs r
      WHERE r.id = flow_run_events.flow_run_id
        AND is_account_member(r.account_id, 'viewer')
    )
  );

-- ============================================================
-- 5. REALTIME
-- ============================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND tablename = 'flow_runs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.flow_runs;
  END IF;
END $$;

-- ============================================================
-- 6. PostgREST schema refresh
-- ============================================================
NOTIFY pgrst, 'reload schema';
