import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { loadTwilioCallingConfig } from '@/lib/ai-calling/twilio-config'

async function usageRequest(
  accountSid: string,
  authToken: string,
  path: string,
) {
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}${path}`,
    {
      headers: {
        Authorization:
          'Basic ' +
          Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
      },
      cache: 'no-store',
    },
  )
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(payload?.message || 'Could not load Twilio usage.')
  }
  return payload
}

export async function GET(request: Request) {
  try {
    const { accountId } = await requireRole('admin')
    const config = await loadTwilioCallingConfig(accountId)
    if (!config) {
      return NextResponse.json({ configured: false })
    }

    const startDate =
      new URL(request.url).searchParams.get('start_date') ||
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

    const [calls, outbound, total] = await Promise.all([
      usageRequest(
        config.accountSid,
        config.authToken,
        `/Usage/Records.json?Category=calls&StartDate=${encodeURIComponent(startDate)}`,
      ),
      usageRequest(
        config.accountSid,
        config.authToken,
        `/Usage/Records.json?Category=calls-outbound&StartDate=${encodeURIComponent(startDate)}`,
      ),
      usageRequest(
        config.accountSid,
        config.authToken,
        `/Usage/Records.json?Category=totalprice&StartDate=${encodeURIComponent(startDate)}`,
      ),
    ])

    const read = (payload: any) => payload?.usage_records?.[0] ?? payload?.usageRecords?.[0] ?? null

    return NextResponse.json({
      configured: true,
      period_start: startDate,
      calls: read(calls),
      outbound_calls: read(outbound),
      total_price: read(total),
      fetched_at: new Date().toISOString(),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
