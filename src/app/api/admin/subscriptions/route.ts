import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin-client'
import { requirePlatformAdmin } from '@/lib/auth/platform-admin'

type AdminAction = 'extend' | 'replace' | 'activate' | 'suspend'

type Body = {
  account_id?: string
  action?: AdminAction
  days?: number
  plan_id?: string
}

const MAX_DAYS = 3650

export async function POST(request: Request) {
  const access = await requirePlatformAdmin()

  if (!access.authorized) {
    return NextResponse.json(
      { error: access.status === 401 ? 'Unauthorized' : 'Forbidden' },
      { status: access.status },
    )
  }

  let body: Body

  try {
    body = (await request.json()) as Body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const accountId = body.account_id?.trim()
  const action = body.action
  const days = Number(body.days ?? 30)
  const requestedPlan = body.plan_id?.trim()

  if (!accountId || !action) {
    return NextResponse.json(
      { error: 'account_id and action are required' },
      { status: 400 },
    )
  }

  if (!['extend', 'replace', 'activate', 'suspend'].includes(action)) {
    return NextResponse.json({ error: 'Unsupported admin action' }, { status: 400 })
  }

  if ((action === 'extend' || action === 'replace' || action === 'activate') && (!Number.isInteger(days) || days < 1 || days > MAX_DAYS)) {
    return NextResponse.json(
      { error: `days must be an integer between 1 and ${MAX_DAYS}` },
      { status: 400 },
    )
  }

  try {
    const admin = createAdminClient()

    const [{ data: account, error: accountError }, { data: plans, error: planError }] = await Promise.all([
      admin.from('accounts').select('id').eq('id', accountId).maybeSingle(),
      admin.from('billing_plans').select('id,name,price_inr_monthly').eq('active', true).order('price_inr_monthly', { ascending: true }),
    ])

    if (accountError) throw accountError
    if (planError) throw planError
    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }

    const planId = requestedPlan ?? 'starter'
    if (action !== 'suspend' && !(plans ?? []).some((plan) => plan.id === planId)) {
      return NextResponse.json({ error: 'Invalid or inactive billing plan' }, { status: 400 })
    }

    const { data: existing, error: existingError } = await admin
      .from('subscriptions')
      .select('id,account_id,plan_id,status,started_at,current_period_end')
      .eq('account_id', accountId)
      .in('status', ['active', 'trialing', 'past_due'])
      .order('current_period_end', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existingError) throw existingError

    const now = new Date()

    if (action === 'suspend') {
      if (existing) {
        const { data, error } = await admin
          .from('subscriptions')
          .update({ status: 'cancelled' })
          .eq('id', existing.id)
          .select('id,account_id,plan_id,status,started_at,current_period_end')
          .single()

        if (error) throw error
        return NextResponse.json({ subscription: data })
      }

      const { data, error } = await admin
        .from('subscriptions')
        .insert({
          account_id: accountId,
          plan_id: planId,
          status: 'cancelled',
          started_at: now.toISOString(),
          current_period_end: now.toISOString(),
        })
        .select('id,account_id,plan_id,status,started_at,current_period_end')
        .single()

      if (error) throw error
      return NextResponse.json({ subscription: data })
    }

    const currentEnd =
      existing?.current_period_end && new Date(existing.current_period_end) > now
        ? new Date(existing.current_period_end)
        : now

    const startDate = action === 'extend' && existing?.started_at
      ? existing.started_at
      : now.toISOString()

    const nextEnd = action === 'extend'
      ? new Date(currentEnd.getTime() + days * 86400000)
      : new Date(now.getTime() + days * 86400000)

    if (existing) {
      const { data, error } = await admin
        .from('subscriptions')
        .update({
          plan_id: action === 'extend' ? existing.plan_id : planId,
          status: 'active',
          started_at: startDate,
          current_period_end: nextEnd.toISOString(),
        })
        .eq('id', existing.id)
        .select('id,account_id,plan_id,status,started_at,current_period_end')
        .single()

      if (error) throw error
      return NextResponse.json({ subscription: data })
    }

    const { data, error } = await admin
      .from('subscriptions')
      .insert({
        account_id: accountId,
        plan_id: planId,
        status: 'active',
        started_at: now.toISOString(),
        current_period_end: nextEnd.toISOString(),
      })
      .select('id,account_id,plan_id,status,started_at,current_period_end')
      .single()

    if (error) throw error
    return NextResponse.json({ subscription: data })
  } catch (error) {
    console.error('[admin/subscriptions] failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update subscription' },
      { status: 500 },
    )
  }
}
