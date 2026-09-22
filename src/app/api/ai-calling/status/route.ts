import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { twilioResponseBody, verifyTwilioSignature } from '@/lib/ai-calling/twilio'

function formDataToParams(form: FormData): URLSearchParams {
  const params = new URLSearchParams()
  form.forEach((value, key) => params.append(key, String(value)))
  return params
}

export async function POST(request: Request) {
  const params = formDataToParams(await request.formData())

  try {
    const valid = await verifyTwilioSignature(request, params)
    if (!valid) return new NextResponse('Forbidden', { status: 403 })

    const sessionId = new URL(request.url).searchParams.get('session_id')?.trim()
    if (!sessionId) return NextResponse.json({ error: 'Missing session_id' }, { status: 400 })

    const status = params.get('CallStatus') || 'unknown'
    const callSid = params.get('CallSid')
    const db = createServiceRoleClient()

    const terminal = new Set(['completed', 'busy', 'failed', 'no-answer', 'canceled'])
    const patch: Record<string, unknown> = {
      status,
      provider_call_sid: callSid || undefined,
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
