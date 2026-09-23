import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { saveTwilioCallingConfig, loadTwilioCallingConfig } from '@/lib/ai-calling/twilio-config'

const TWILIO_BASE = 'https://api.twilio.com/2010-04-01'

function basicAuth(accountSid: string, authToken: string): string {
  return 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64')
}

function countryCode(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2)
}

async function twilioRequest(
  accountSid: string,
  authToken: string,
  path: string,
  init?: RequestInit,
) {
  const response = await fetch(`${TWILIO_BASE}/Accounts/${accountSid}${path}`, {
    ...init,
    headers: {
      Authorization: basicAuth(accountSid, authToken),
      ...(init?.headers || {}),
    },
    cache: 'no-store',
  })

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(payload?.message || `Twilio request failed (HTTP ${response.status}).`)
  }
  return payload
}

type AvailableNumber = {
  phone_number?: string
  friendly_name?: string
  locality?: string
  region?: string
  iso_country?: string
  address_requirements?: string
  capabilities?: { voice?: boolean; sms?: boolean; mms?: boolean }
}

export async function GET(request: Request) {
  try {
    const { accountId } = await requireRole('admin')
    const config = await loadTwilioCallingConfig(accountId)
    if (!config) {
      return NextResponse.json(
        { error: 'Connect Twilio first before searching for a phone number.' },
        { status: 400 },
      )
    }

    const params = new URL(request.url).searchParams
    const country = countryCode(params.get('country') || 'IN')
    const contains = (params.get('contains') || '').trim().slice(0, 64)
    const type = (params.get('type') || 'local').trim().toLowerCase()

    if (country.length !== 2) {
      return NextResponse.json({ error: 'Country must be a 2-letter ISO code, e.g. IN or US.' }, { status: 400 })
    }

    if (type !== 'local') {
      return NextResponse.json(
        { error: 'This CRM purchase flow currently provisions voice-capable local numbers.' },
        { status: 400 },
      )
    }

    const query = new URLSearchParams({
      PageSize: '20',
      VoiceEnabled: 'true',
    })
    if (contains) query.set('Contains', contains)

    const payload = (await twilioRequest(
      config.accountSid,
      config.authToken,
      `/AvailablePhoneNumbers/${country}/Local.json?${query.toString()}`,
    )) as { available_phone_numbers?: AvailableNumber[] }

    return NextResponse.json({
      country,
      numbers: (payload.available_phone_numbers ?? []).map((item) => ({
        phone_number: item.phone_number ?? '',
        friendly_name: item.friendly_name ?? '',
        locality: item.locality ?? '',
        region: item.region ?? '',
        iso_country: item.iso_country ?? country,
        address_requirements: item.address_requirements ?? null,
        capabilities: item.capabilities ?? {},
      })),
      fetched_at: new Date().toISOString(),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const { accountId } = await requireRole('admin')
    const config = await loadTwilioCallingConfig(accountId)
    if (!config) {
      return NextResponse.json({ error: 'Connect Twilio first.' }, { status: 400 })
    }

    const body = await request.json().catch(() => null)
    const phoneNumber = typeof body?.phone_number === 'string' ? body.phone_number.trim() : ''

    if (!/^\+[1-9]\d{7,14}$/.test(phoneNumber)) {
      return NextResponse.json(
        { error: 'Phone number must be in E.164 format.' },
        { status: 400 },
      )
    }

    const payload = (await twilioRequest(
      config.accountSid,
      config.authToken,
      '/IncomingPhoneNumbers.json',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ PhoneNumber: phoneNumber }),
      },
    )) as {
      sid?: string
      phone_number?: string
      friendly_name?: string
    }

    if (!payload.phone_number) {
      throw new Error('Twilio did not return the purchased phone number.')
    }

    await saveTwilioCallingConfig({
      accountId,
      accountSid: config.accountSid,
      authToken: config.authToken,
      callerNumber: payload.phone_number,
    })

    return NextResponse.json({
      ok: true,
      number: {
        sid: payload.sid ?? null,
        phone_number: payload.phone_number,
        friendly_name: payload.friendly_name ?? null,
      },
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
