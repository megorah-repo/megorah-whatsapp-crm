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
    if (!sessionId) return new NextResponse('Missing session_id', { status: 400 })

    const db = createServiceRoleClient()
    const { data: session } = await db
      .from('ai_call_sessions')
      .select('id, account_id, provider_call_sid')
      .eq('id', sessionId)
      .maybeSingle()

    if (!session) return new NextResponse('Call session not found', { status: 404 })

    const twilio = await loadTwilioCallingConfig(session.account_id)
    if (!twilio) return new NextResponse('Twilio configuration unavailable', { status: 500 })

    const valid = await verifyTwilioSignature(request, params, twilio.authToken)
    if (!valid) return new NextResponse('Forbidden', { status: 403 })

    const callSid = params.get('CallSid')
    if (session.provider_call_sid && callSid && session.provider_call_sid !== callSid) {
      return new NextResponse('Call SID mismatch', { status: 403 })
    }

    const recordingStatus = params.get('RecordingStatus') || 'unknown'
    const recordingSid = params.get('RecordingSid')
    const recordingUrl = params.get('RecordingUrl')
    const durationRaw = Number(params.get('RecordingDuration') || 0)
    const recordingDuration = Number.isFinite(durationRaw) ? Math.max(0, Math.round(durationRaw)) : 0

    const patch: Record<string, unknown> = {
      recording_sid: recordingSid || null,
      recording_url: recordingUrl || null,
      recording_status: recordingStatus,
      recording_duration_seconds: recordingDuration,
    }

    const { error } = await db
      .from('ai_call_sessions')
      .update(patch)
      .eq('id', sessionId)

    if (error) {
      console.error('[ai-calling/recording] update failed:', error)
      return NextResponse.json({ error: 'Could not save recording metadata.' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[ai-calling/recording] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
