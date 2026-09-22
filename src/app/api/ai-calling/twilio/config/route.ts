import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { saveTwilioCallingConfig } from '@/lib/ai-calling/twilio-config'
import { isValidE164 } from '@/lib/ai-calling/twilio'

interface TwilioNumber {
  phone_number: string
  friendly_name?: string | null
  capabilities?: {
    voice?: boolean
    sms?: boolean
    mms?: boolean
  }
}

function auth(accountSid: string, authToken: string): string {
  return (
    'Basic ' +
    Buffer.from(`${accountSid}:${authToken}`).toString('base64')
  )
}

async function twilioGet(
  accountSid: string,
  authToken: string,
  path: string,
) {
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}${path}`,
    {
      headers: {
        Authorization: auth(accountSid, authToken),
      },
      cache: 'no-store',
    },
  )

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const message =
      payload?.message || `Twilio request failed (HTTP ${response.status}).`
    throw new Error(message)
  }

  return payload
}

export async function GET() {
  try {
    const { accountId } = await requireRole('admin')
    const db = createServiceRoleClient()
    const { data, error } = await db
      .from('ai_calling_twilio_configs')
      .select(
        'account_sid, caller_number, is_active, last_verified_at, last_error, auth_token',
      )
      .eq('account_id', accountId)
      .maybeSingle()

    if (error) throw error

    if (!data) {
      return NextResponse.json({
        configured: false,
        has_auth_token: false,
        account_sid: '',
        caller_number: '',
        last_verified_at: null,
        last_error: null,
      })
    }

    return NextResponse.json({
      configured: Boolean(data.is_active),
      has_auth_token: Boolean(data.auth_token),
      account_sid: data.account_sid,
      caller_number: data.caller_number ?? '',
      last_verified_at: data.last_verified_at,
      last_error: data.last_error,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const { accountId } = await requireRole('admin')
    const body = await request.json().catch(() => null)

    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
    }

    const accountSid = typeof body.account_sid === 'string' ? body.account_sid.trim() : ''
    const authToken = typeof body.auth_token === 'string' ? body.auth_token.trim() : ''
    const selectedNumber =
      typeof body.caller_number === 'string' ? body.caller_number.trim() : ''

    if (!/^AC[0-9a-fA-F]{32}$/.test(accountSid)) {
      return NextResponse.json({ error: 'Enter a valid Twilio Account SID.' }, { status: 400 })
    }

    if (!authToken) {
      return NextResponse.json({ error: 'Enter your Twilio Auth Token.' }, { status: 400 })
    }

    const payload = await twilioGet(accountSid, authToken, '.json')
    if (!payload?.sid) {
      throw new Error('Twilio credentials were not accepted.')
    }

    const numbersPayload = await twilioGet(
      accountSid,
      authToken,
      '/IncomingPhoneNumbers.json?PageSize=50',
    )
    const numbers = (numbersPayload?.incoming_phone_numbers ?? []) as TwilioNumber[]
    const voiceNumbers = numbers.filter((item) => item.capabilities?.voice !== false)

    const callerNumber =
      selectedNumber && voiceNumbers.some((item) => item.phone_number === selectedNumber)
        ? selectedNumber
        : voiceNumbers[0]?.phone_number ?? null

    if (selectedNumber && !isValidE164(selectedNumber)) {
      return NextResponse.json(
        { error: 'Caller number must be in E.164 format, e.g. +1XXXXXXXXXX.' },
        { status: 400 },
      )
    }

    await saveTwilioCallingConfig({
      accountId,
      accountSid,
      authToken,
      callerNumber,
    })

    return NextResponse.json({
      ok: true,
      account_sid: accountSid,
      caller_number: callerNumber,
      numbers: voiceNumbers,
      verified_at: new Date().toISOString(),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not connect Twilio.'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

