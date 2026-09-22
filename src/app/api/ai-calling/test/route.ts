import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { loadAiConfig } from '@/lib/ai/config'
import {
  createTwilioCall,
  isValidE164,
  baseUrl,
  twilioConfig,
} from '@/lib/ai-calling/twilio'

function cleanNumber(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\\s+/g, '') : ''
}

export async function POST(request: Request) {
  try {
    const { accountId } = await requireRole('admin')
    const body = await request.json().catch(() => null)

    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
    }

    const to = cleanNumber(body.to_number)
    const from = cleanNumber(body.from_number)
    const callerName =
      typeof body.caller_name === 'string' ? body.caller_name.trim() : 'Megorah AI'
    const greeting =
      typeof body.greeting === 'string' ? body.greeting.trim() : ''
    const instructions =
      typeof body.instructions === 'string' ? body.instructions.trim() : ''
    const language =
      typeof body.language === 'string' ? body.language.trim() : 'en-IN'
    const transferNumber = cleanNumber(body.transfer_number)
    const transferOnHandoff = body.transfer_on_handoff === true
    const maxCallMinutes = Math.min(
      20,
      Math.max(1, Number.parseInt(String(body.max_call_minutes || '12'), 10) || 12),
    )

    if (!isValidE164(to)) {
      return NextResponse.json(
        { error: 'Customer test number must be in E.164 format, e.g. +9198XXXXXXXX.' },
        { status: 400 },
      )
    }

    if (!isValidE164(from)) {
      return NextResponse.json(
        {
          error:
            'Your business/caller number must be in E.164 format, e.g. +9198XXXXXXXX.',
        },
        { status: 400 },
      )
    }

    if (from === to) {
      return NextResponse.json(
        { error: 'Your business number and customer test number cannot be the same.' },
        { status: 400 },
      )
    }

    if (!greeting || !instructions) {
      return NextResponse.json(
        { error: 'Greeting and agent instructions are required for a test call.' },
        { status: 400 },
      )
    }

    const db = createServiceRoleClient()
    const aiConfig = await loadAiConfig(db, accountId)
    if (!aiConfig) {
      return NextResponse.json(
        { error: 'AI is not configured or is disabled for this account.' },
        { status: 400 },
      )
    }

    twilioConfig()

    const settings = {
      callerName,
      greeting,
      instructions,
      language,
      transferNumber,
      transferOnHandoff,
      maxCallMinutes,
      aiProvider: aiConfig.provider,
      aiModel: aiConfig.model,
    }

    const { data: session, error: sessionError } = await db
      .from('ai_call_sessions')
      .insert({
        account_id: accountId,
        provider: 'twilio',
        from_number: from,
        to_number: to,
        status: 'queued',
        settings,
        history: [],
      })
      .select('id')
      .single()

    if (sessionError || !session) {
      console.error('[ai-calling/test] session insert failed:', sessionError)
      return NextResponse.json(
        { error: 'Could not create the test-call session.' },
        { status: 500 },
      )
    }

    const root = baseUrl(request)
    const voiceUrl =
      `${root}/api/ai-calling/voice?session_id=${encodeURIComponent(session.id)}`
    const statusCallbackUrl =
      `${root}/api/ai-calling/status?session_id=${encodeURIComponent(session.id)}`

    try {
      const call = await createTwilioCall({
        to,
        from,
        voiceUrl,
        statusCallbackUrl,
        timeLimitSeconds: maxCallMinutes * 60,
      })

      await db
        .from('ai_call_sessions')
        .update({
          provider_call_sid: call.sid,
          status: call.status,
        })
        .eq('id', session.id)

      return NextResponse.json({
        ok: true,
        session_id: session.id,
        call_sid: call.sid,
        status: call.status,
      })
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Twilio could not start the call.'
      await db
        .from('ai_call_sessions')
        .update({
          status: 'failed',
          last_error: message.slice(0, 1000),
          ended_at: new Date().toISOString(),
        })
        .eq('id', session.id)

      return NextResponse.json({ error: message }, { status: 400 })
    }
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const sessionId = new URL(request.url).searchParams.get('session_id')?.trim()

    if (!sessionId) {
      return NextResponse.json({ error: 'session_id is required.' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('ai_call_sessions')
      .select(
        'id, from_number, to_number, status, last_error, provider_call_sid, created_at, updated_at, ended_at',
      )
      .eq('account_id', accountId)
      .eq('id', sessionId)
      .maybeSingle()

    if (error) {
      console.error('[ai-calling/test GET] status read failed:', error)
      return NextResponse.json({ error: 'Could not read test-call status.' }, { status: 500 })
    }

    if (!data) {
      return NextResponse.json({ error: 'Test call not found.' }, { status: 404 })
    }

    return NextResponse.json(data)
  } catch (err) {
    return toErrorResponse(err)
  }
}
