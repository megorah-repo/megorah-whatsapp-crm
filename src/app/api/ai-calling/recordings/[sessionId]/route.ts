import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { loadTwilioCallingConfig } from '@/lib/ai-calling/twilio-config'

export async function GET(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  try {
    const { accountId } = await requireRole('admin')
    const { sessionId } = await context.params
    const db = createServiceRoleClient()

    const { data: session, error } = await db
      .from('ai_call_sessions')
      .select('id, account_id, provider, recording_url, recording_status')
      .eq('id', sessionId)
      .eq('account_id', accountId)
      .maybeSingle()

    if (error) throw error
    if (!session) return NextResponse.json({ error: 'Call session not found.' }, { status: 404 })
    if (session.provider !== 'twilio') {
      return NextResponse.json({ error: 'Recording playback is only available for Twilio calls.' }, { status: 400 })
    }
    if (session.recording_status !== 'completed' || !session.recording_url) {
      return NextResponse.json({ error: 'Recording is not ready yet.' }, { status: 404 })
    }

    const twilio = await loadTwilioCallingConfig(accountId)
    if (!twilio) return NextResponse.json({ error: 'Twilio configuration unavailable.' }, { status: 500 })

    const recordingUrl = session.recording_url.endsWith('.mp3')
      ? session.recording_url
      : session.recording_url + '.mp3'

    const response = await fetch(recordingUrl, {
      headers: {
        Authorization:
          'Basic ' + Buffer.from(twilio.accountSid + ':' + twilio.authToken).toString('base64'),
      },
      cache: 'no-store',
    })

    if (!response.ok) {
      return NextResponse.json({ error: 'Could not retrieve the call recording from Twilio.' }, { status: 502 })
    }

    const contentType = response.headers.get('content-type') || 'audio/mpeg'
    const body = await response.arrayBuffer()

    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(body.byteLength),
        'Cache-Control': 'private, no-store',
        'Content-Disposition': 'inline',
      },
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
