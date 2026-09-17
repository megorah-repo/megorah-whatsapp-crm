import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import {
  loadStepsTree,
  replaceSteps,
  type BuilderStepInput,
} from '@/lib/automations/steps-tree'
import {
  validateStepsForActivation,
  validateTriggerForActivation,
} from '@/lib/automations/validate'

async function requireUser() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return { user, supabase }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const { user, supabase } = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // The account-scoped RLS policy is the source of truth here. The list
  // endpoint already returns every automation visible to the caller's
  // account; using user_id here would make shared-account automations open
  // in the list but return 404 when a member tried to edit them.
  const { data: automation, error } = await supabase
    .from('automations')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!automation) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  try {
    const steps = await loadStepsTree(id)
    return NextResponse.json({ automation, steps })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unable to load automation steps' },
      { status: 500 },
    )
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  // Editing an automation is a write — the RLS automations_update policy
  // requires `agent`, but this route mutates via the service-role client
  // which bypasses RLS, so enforce the role here.
  try {
    await requireRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }

  const { user, supabase } = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const admin = supabaseAdmin()

  // Authorization is intentionally resolved through the caller's normal
  // Supabase client so account-scoped RLS determines whether this automation
  // belongs to the caller's account. Do not fall back to user_id ownership.
  const { data: existing, error: existingErr } = await supabase
    .from('automations')
    .select('id, user_id, is_active, trigger_type, trigger_config')
    .eq('id', id)
    .maybeSingle()

  if (existingErr) {
    return NextResponse.json({ error: existingErr.message }, { status: 500 })
  }
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const update: Record<string, unknown> = {}
  for (const k of [
    'name',
    'description',
    'trigger_type',
    'trigger_config',
    'is_active',
  ] as const) {
    if (k in body) update[k] = body[k]
  }

  // If this PATCH leaves the automation active (either explicitly
  // activating it OR editing an already-active one), validate the merged
  // configuration first. Activation is the natural gate — drafts are still
  // allowed to be incomplete.
  const willBeActive =
    typeof update.is_active === 'boolean' ? update.is_active : existing.is_active
  if (willBeActive) {
    const mergedTriggerType = (update.trigger_type ?? existing.trigger_type) as string
    const mergedTriggerConfig = update.trigger_config ?? existing.trigger_config
    const mergedSteps = Array.isArray(body.steps)
      ? (body.steps as { step_type: string; step_config: Record<string, unknown> }[])
      : await loadStepsTree(id)
    const issues = [
      ...validateTriggerForActivation(mergedTriggerType, mergedTriggerConfig),
      ...validateStepsForActivation(mergedSteps),
    ]
    if (issues.length > 0) {
      return NextResponse.json(
        {
          error: 'Cannot keep automation active with invalid configuration',
          issues,
        },
        { status: 400 },
      )
    }
  }

  if (Object.keys(update).length > 0) {
    const { error: updErr } = await admin
      .from('automations')
      .update(update)
      .eq('id', id)
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })
  }

  if (Array.isArray(body.steps)) {
    const err = await replaceSteps(id, body.steps as BuilderStepInput[])
    if (err) return NextResponse.json({ error: err }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  // Deleting an automation is a write — enforce `agent` (the service-role
  // client below bypasses the agent-gated automations_delete RLS).
  try {
    await requireRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }

  const { user, supabase } = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Verify account-scoped visibility first, then perform the destructive
  // mutation with the service-role client. This keeps shared-account
  // automations consistent with the list/detail surfaces while still
  // enforcing the required role before bypassing RLS.
  const { data: existing, error: existingErr } = await supabase
    .from('automations')
    .select('id')
    .eq('id', id)
    .maybeSingle()
  if (existingErr) return NextResponse.json({ error: existingErr.message }, { status: 500 })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { error } = await supabaseAdmin().from('automations').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
