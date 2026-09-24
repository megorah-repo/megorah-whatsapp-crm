import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { loadAiConfig } from '@/lib/ai/config'
import { loadTwilioCallingConfig } from '@/lib/ai-calling/twilio-config'
import { loadDirectCallingApiConfig, type DirectCallingApiConfig } from '@/lib/ai-calling/direct-api-config'
import { createTwilioCall, isValidE164, baseUrl } from '@/lib/ai-calling/twilio'

function cleanNumber(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, '') : ''
}

function directHeaders(config: DirectCallingApiConfig): Headers {
  const headers = new Headers({ 'Content-Type': 'application/json', Accept: 'application/json' })
  if (config.authType === 'x-api-key') headers.set('X-API-Key', config.apiKey)
  else headers.set('Authorization', config.authType === 'authorization' ? config.apiKey : 'Bearer ' + config.apiKey)
  return headers
}

function extractProviderResult(payload: unknown): { id: string | null; status: string } {
  const root = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
  const data = root.data && typeof root.data === 'object' ? root.data as Record<string, unknown> : root
  const idValue = data.call_id ?? data.callId ?? data.id ?? data.sid ?? data.call_sid ?? data.request_id
  const statusValue = data.status ?? data.call_status ?? data.state
  return {
    id: typeof idValue === 'string' && idValue.trim() ? idValue.trim() : null,
    status: typeof statusValue === 'string' && statusValue.trim() ? statusValue.trim() : 'queued',
  }
}

export async function POST(request: Request) {
  try {
    const { accountId } = await requireRole('admin')
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
    }

    const to = cleanNumber(body.to_number)
    const callerName = typeof body.caller_name === 'string' ? body.caller_name.trim() : 'Megorah AI'
    const greeting = typeof body.greeting === 'string' ? body.greeting.trim() : ''
    const instructions = typeof body.instructions === 'string' ? body.instructions.trim() : ''
    const language = typeof body.language === 'string' ? body.language.trim() : 'en-IN'
    const transferNumber = cleanNumber(body.transfer_number)
    const transferOnHandoff = body.transfer_on_handoff === true
    const maxCallMinutes = Math.min(20, Math.max(1, Number.parseInt(String(body.max_call_minutes || '12'), 10) || 12))

    if (!isValidE164(to)) {
      return NextResponse.json({ error: 'Customer test number must be in E.164 format, e.g. +9198XXXXXXXX.' }, { status: 400 })
    }
    if (!greeting || !instructions) {
      return NextResponse.json({ error: 'Greeting and agent instructions are required for a test call.' }, { status: 400 })
    }

    const db = createServiceRoleClient()
    const direct = await loadDirectCallingApiConfig(accountId)

    const aiConfig = direct ? null : await loadAiConfig(db, accountId)
    if (!direct && !aiConfig) {
      return NextResponse.json({ error: 'AI is not configured or is disabled for this account. Or connect a Direct Calls API provider.' }, { status: 400 })
    }

    const twilio = direct ? null : await loadTwilioCallingConfig(accountId)
    if (!direct && !twilio) {
      return NextResponse.json({ error: 'Connect a Twilio account or a Direct Calls API provider in the AI Calling panel first.' }, { status: 400 })
    }

    const actualFrom = cleanNumber(direct?.callerNumber || twilio?.callerNumber || body.from_number)
    if (!actualFrom || !isValidE164(actualFrom)) {
      return NextResponse.json({ error: 'No valid caller number is connected. Add the provider caller number first.' }, { status: 400 })
    }

    const settings = {
      callerName,
      greeting,
      instructions,
      language,
      transferNumber,
      transferOnHandoff,
      maxCallMinutes,
      aiProvider: aiConfig?.provider ?? null,
      aiModel: aiConfig?.model ?? null,
    }

    const provider = direct ? 'direct-api' : 'twilio'
    const { data: session, error: sessionError } = await db
      .from('ai_call_sessions')
      .insert({
        account_id: accountId,
        provider,
        from_number: actualFrom,
        to_number: to,
        status: 'queued',
        settings,
        history: [],
      })
      .select('id')
      .single()

    if (sessionError || !session) {
      console.error('[ai-calling/test] session insert failed:', sessionError)
      return NextResponse.json({ error: 'Could not create the test-call session.' }, { status: 500 })
    }

    try {
      if (direct) {
        const webhookUrl = baseUrl(request) + '/api/ai-calling/direct-api/webhook?session_id=' + encodeURIComponent(session.id)
        const providerPayload = {
          to,
          from: actualFrom,
          to_number: to,
          from_number: actualFrom,
          caller_name: callerName,
          greeting,
          instructions,
          language,
          max_duration_seconds: maxCallMinutes * 60,
          webhook_url: webhookUrl,
        }

        const response = await fetch(direct.apiUrl, {
          method: 'POST',
          headers: directHeaders(direct),
          body: JSON.stringify(providerPayload),
          cache: 'no-store',
        })
        const raw = await response.text()
        let payload: unknown = {}
        try {
          payload = raw ? JSON.parse(raw) : {}
        } catch {
          payload = { message: raw }
        }

        if (!response.ok) {
          const root = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
          const message = typeof root.message === 'string'
            ? root.message
            : typeof root.error === 'string'
              ? root.error
              : 'Calling provider rejected the call request (HTTP ' + response.status + ').'
          throw new Error(message)
        }

        const result = extractProviderResult(payload)
        const providerId = result.id || 'direct-' + session.id
        await db.from('ai_call_sessions').update({
          provider_call_sid: providerId,
          status: result.status,
        }).eq('id', session.id)

        return NextResponse.json({
          ok: true,
          session_id: session.id,
          call_sid: providerId,
          status: result.status,
          provider: direct.providerName,
        })
      }

      const root = baseUrl(request)
      const voiceUrl = root + '/api/ai-calling/voice?session_id=' + encodeURIComponent(session.id)
      const statusCallbackUrl = root + '/api/ai-calling/status?session_id=' + encodeURIComponent(session.id)
      const call = await createTwilioCall({
        to,
        from: actualFrom,
        voiceUrl,
        accountSid: twilio!.accountSid,
        authToken: twilio!.authToken,
        statusCallbackUrl,
        timeLimitSeconds: maxCallMinutes * 60,
      })

      await db.from('ai_call_sessions').update({
        provider_call_sid: call.sid,
        status: call.status,
      }).eq('id', session.id)

      return NextResponse.json({
        ok: true,
        session_id: session.id,
        call_sid: call.sid,
        status: call.status,
        provider: 'Twilio',
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Calling provider could not start the call.'
      await db.from('ai_call_sessions').update({
        status: 'failed',
        last_error: message.slice(0, 1000),
        ended_at: new Date().toISOString(),
      }).eq('id', session.id)
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
    if (!sessionId) return NextResponse.json({ error: 'session_id is required.' }, { status: 400 })

    const { data, error } = await supabase
      .from('ai_call_sessions')
      .select('id, provider, from_number, to_number, status, last_error, provider_call_sid, created_at, updated_at, ended_at, duration_seconds, cost, cost_currency')
      .eq('account_id', accountId)
      .eq('id', sessionId)
      .maybeSingle()

    if (error) {
      console.error('[ai-calling/test GET] status read failed:', error)
      return NextResponse.json({ error: 'Could not read test-call status.' }, { status: 500 })
    }
    if (!data) return NextResponse.json({ error: 'Test call not found.' }, { status: 404 })
    return NextResponse.json(data)
  } catch (err) {
    return toErrorResponse(err)
  }
}
