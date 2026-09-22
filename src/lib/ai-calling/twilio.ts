import { createHmac } from 'node:crypto'

export function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

export function twimlResponse(body: string): Response {
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`,
    {
      status: 200,
      headers: { 'Content-Type': 'text/xml; charset=utf-8' },
    },
  )
}

export function twilioConfig() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken = process.env.TWILIO_AUTH_TOKEN
  const phoneNumber = process.env.TWILIO_PHONE_NUMBER

  if (!accountSid || !authToken || !phoneNumber) {
    throw new Error(
      'Twilio is not configured. Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_PHONE_NUMBER.',
    )
  }

  return { accountSid, authToken, phoneNumber }
}

export function isValidE164(value: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(value.trim())
}

export function twilioSignatureBaseUrl(request: Request): string {
  return request.url
}

export async function verifyTwilioSignature(
  request: Request,
  params: URLSearchParams,
  authToken?: string,
): Promise<boolean> {
  const token = authToken || process.env.TWILIO_AUTH_TOKEN
  if (!token) return false

  const signature = request.headers.get('x-twilio-signature')
  if (!signature) return false

  const url = twilioSignatureBaseUrl(request)
  const data = Array.from(params.keys())
    .sort()
    .map((key) => [key, params.get(key) ?? ''] as const)

  const payload =
    url + data.map(([key, value]) => `${key}${value}`).join('')

  const expected = createHmac('sha1', token)
    .update(payload)
    .digest('base64')

  return expected === signature
}

export async function createTwilioCall(args: {
  to: string
  from: string
  voiceUrl: string
  statusCallbackUrl: string
  timeLimitSeconds?: number
  accountSid: string
  authToken: string
}): Promise<{ sid: string; status: string }> {
  const accountSid = args.accountSid
  const authToken = args.authToken
  if (!accountSid || !authToken) {
    throw new Error('Twilio account credentials are missing.')
  }
  const body = new URLSearchParams({
    To: args.to,
    From: args.from,
    Url: args.voiceUrl,
    Method: 'POST',
    StatusCallback: args.statusCallbackUrl,
    StatusCallbackMethod: 'POST',
    StatusCallbackEvent: 'initiated ringing answered completed',
    TimeLimit: String(Math.min(Math.max(args.timeLimitSeconds ?? 720, 60), 14400)),
  })

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`,
    {
      method: 'POST',
      headers: {
        Authorization:
          'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      cache: 'no-store',
    },
  )

  const payload = (await response.json().catch(() => null)) as
    | { sid?: string; status?: string; message?: string; code?: number }
    | null

  if (!response.ok || !payload?.sid) {
    const message =
      payload?.message || `Twilio call creation failed (HTTP ${response.status}).`
    throw new Error(message)
  }

  return {
    sid: payload.sid,
    status: payload.status ?? 'queued',
  }
}

export function baseUrl(request: Request): string {
  const url = new URL(request.url)
  return `${url.protocol}//${url.host}`
}
