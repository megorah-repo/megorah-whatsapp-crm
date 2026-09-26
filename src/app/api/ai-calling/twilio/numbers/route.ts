import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { loadTwilioCallingConfig, saveTwilioCallingConfig } from '@/lib/ai-calling/twilio-config'

export async function POST(request: Request) {
  try {
    const { accountId } = await requireRole('admin')
    const body = await request.json().catch(() => ({}))
    const requestedCallerNumber =
      typeof body?.caller_number === 'string' ? body.caller_number.trim() : ''
    const config = await loadTwilioCallingConfig(accountId)

    if (!config) {
      return NextResponse.json({ error: 'Connect Twilio first.' }, { status: 400 })
    }

    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/IncomingPhoneNumbers.json?PageSize=50`,
      {
        headers: {
          Authorization:
            'Basic ' +
            Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64'),
        },
        cache: 'no-store',
      },
    )

    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      throw new Error(payload?.message || 'Could not sync Twilio phone numbers.')
    }

    const numbers = Array.isArray(payload?.incoming_phone_numbers)
      ? payload.incoming_phone_numbers.filter(
          (item: TwilioNumberLike) => item.capabilities?.voice !== false,
        )
      : []

    const callerNumber = requestedCallerNumber
      ? numbers.some((item: TwilioNumberLike) => item.phone_number === requestedCallerNumber)
        ? requestedCallerNumber
        : null
      : config.callerNumber ?? numbers[0]?.phone_number ?? null

    if (requestedCallerNumber && !callerNumber) {
      return NextResponse.json({ error: 'Selected caller number is not a voice-enabled number on this Twilio account.' }, { status: 400 })
    }

    await saveTwilioCallingConfig({
      accountId,
      accountSid: config.accountSid,
      authToken: config.authToken,
      callerNumber,
    })

    return NextResponse.json({
      ok: true,
      caller_number: callerNumber,
      numbers,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

type TwilioNumberLike = {
  phone_number?: string
  friendly_name?: string
  capabilities?: { voice?: boolean }
}
