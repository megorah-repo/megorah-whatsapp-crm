import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { loadDirectCallingApiConfig } from '@/lib/ai-calling/direct-api-config'
import { syncQueueFromCallStatus } from '@/lib/ai-calling/auto-run'

function toObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}
function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}
function numberValue(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

export async function POST(request: Request) {
  try {
    const requestUrl = new URL(request.url)
    const sessionId = requestUrl.searchParams.get('session_id')?.trim()
    const token = requestUrl.searchParams.get('token')?.trim() || request.headers.get('x-megorah-webhook-secret')?.trim() || ''
    if (!sessionId) return NextResponse.json({ error: 'session_id is required.' }, { status: 400 })

    const contentType = request.headers.get('content-type') || ''
    let body: Record<string, unknown>
    if (contentType.includes('application/json')) {
      body = toObject(await request.json().catch(() => ({})))
    } else {
      const form = await request.formData()
      body = {}
      form.forEach((value, key) => { body[key] = String(value) })
    }

    const nested = toObject(body.data ?? body.call ?? body.result ?? body)
    const status = text(nested.status ?? nested.call_status ?? nested.state) ?? 'unknown'
    const providerCallId = text(nested.call_id ?? nested.callId ?? nested.id ?? nested.sid ?? nested.call_sid)
    const duration = numberValue(nested.duration_seconds ?? nested.duration ?? nested.call_duration) ?? 0
    const cost = numberValue(nested.cost ?? nested.price ?? nested.amount)
    const currency = text(nested.cost_currency ?? nested.currency ?? nested.price_unit)

    const patch = {
      status,
      provider_call_sid: providerCallId || undefined,
      duration_seconds: Math.max(0, Math.round(duration)),
      cost,
      cost_currency: currency,
    }
    if (['completed', 'failed', 'busy', 'no-answer', 'canceled', 'cancelled'].includes(status)) {
      Object.assign(patch, { ended_at: new Date().toISOString() })
    }

    const db = createServiceRoleClient()
    const { data: session, error: sessionError } = await db
      .from('ai_call_sessions')
      .select('account_id')
      .eq('id', sessionId)
      .eq('provider', 'direct-api')
      .maybeSingle()
    if (sessionError || !session) return NextResponse.json({ error: 'Call session not found.' }, { status: 404 })

    const config = await loadDirectCallingApiConfig(session.account_id)
    if (!config?.webhookSecret || !token) return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
    const expected = Buffer.from(config.webhookSecret)
    const presented = Buffer.from(token)
    if (expected.length !== presented.length || !timingSafeEqual(expected, presented)) {
      return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
    }

    const { error } = await db.from('ai_call_sessions')
      .update(patch)
      .eq('id', sessionId)
      .eq('provider', 'direct-api')

    if (error) {
      console.error('[ai-calling/direct-api/webhook] update failed:', error)
      return NextResponse.json({ error: 'Could not update call session.' }, { status: 500 })
    }

    await syncQueueFromCallStatus(sessionId, status, status === 'failed' ? text(nested.error ?? nested.message) : null)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[ai-calling/direct-api/webhook] error:', err)
    return NextResponse.json({ error: 'Invalid provider webhook.' }, { status: 400 })
  }
}
