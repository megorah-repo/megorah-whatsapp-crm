import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { loadTwilioCallingConfig } from '@/lib/ai-calling/twilio-config'
import { verifyTwilioSignature } from '@/lib/ai-calling/twilio'

function formDataToParams(form: FormData): URLSearchParams {
  const params = new URLSearchParams()
  form.forEach((value, key) => params.append(key, String(value)))
  return params
}

export async function POST(request: Request) {
  const params = formDataToParams(await request.formData())

  try {
    const sessionId = new URL(request.url).searchParams.get('session_id')?.trim()
    if (!sessionId) return NextResponse.json({ error: 'Missing session_id' }, { status: 400 })

    const db = createServiceRoleClient()
    const { data: session } = await db
      .from('ai_call_sessions')
      .select('account_id')
      .eq('id', sessionId)
      .maybeSingle()
    if (!session) return new NextResponse('Call session not found', { status: 404 })

    const twilio = await loadTwilioCallingConfig(session.account_id)
    if (!twilio) return new NextResponse('Twilio configuration unavailable', { status: 500 })
    const valid = await verifyTwilioSignature(request, params, twilio.authToken)
    if (!valid) return new NextResponse('Forbidden', { status: 403 })

    const status = params.get('CallStatus') || 'unknown'
    const callSid = params.get('CallSid')
    const durationSeconds = Number(params.get('CallDuration') || 0)
    const priceRaw = params.get('Price')
    const price = priceRaw && Number.isFinite(Number(priceRaw)) ? Number(priceRaw) : null
    const priceUnit = params.get('PriceUnit')

    const terminal = new Set(['completed', 'busy', 'failed', 'no-answer', 'canceled'])
    const patch: Record<string, unknown> = {
      status,
      provider_call_sid: callSid || undefined,
      duration_seconds: Number.isFinite(durationSeconds) ? Math.max(0, Math.round(durationSeconds)) : 0,
      cost: price,
      cost_currency: priceUnit || null,
    }

    if (terminal.has(status)) {
      patch.ended_at = new Date().toISOString()
    }

    const { error } = await db
      .from('ai_call_sessions')
      .update(patch)
      .eq('id', sessionId)

    if (error) {
      console.error('[ai-calling/status] update failed:', error)
      return NextResponse.json({ error: 'Could not update call status.' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[ai-calling/status] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
