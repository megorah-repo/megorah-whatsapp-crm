import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { loadTwilioCallingConfig } from '@/lib/ai-calling/twilio-config'

const TWILIO_BASE = 'https://api.twilio.com/2010-04-01'

function basicAuth(accountSid: string, authToken: string): string {
  return 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64')
}

function clean(value: string | null): string {
  return (value ?? '').trim()
}

function istDateString(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)

  const year = parts.find((part) => part.type === 'year')?.value ?? '1970'
  const month = parts.find((part) => part.type === 'month')?.value ?? '01'
  const day = parts.find((part) => part.type === 'day')?.value ?? '01'
  return `${year}-${month}-${day}`
}

function utcAfterForIstDate(date: string): string {
  return new Date(`${date}T00:00:00+05:30`).toISOString()
}

function utcBeforeForIstDate(date: string): string {
  return new Date(`${date}T23:59:59.999+05:30`).toISOString()
}

async function twilioGet(accountSid: string, authToken: string, path: string) {
  const response = await fetch(`${TWILIO_BASE}/Accounts/${accountSid}${path}`, {
    headers: { Authorization: basicAuth(accountSid, authToken) },
    cache: 'no-store',
  })

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(payload?.message || `Twilio request failed (HTTP ${response.status}).`)
  }

  return payload
}

type TwilioCall = {
  sid?: string
  direction?: string
  status?: string
  from?: string
  to?: string
  start_time?: string | null
  end_time?: string | null
  duration?: string | null
  price?: string | null
  price_unit?: string | null
  answered_by?: string | null
  date_created?: string | null
}

export async function GET(request: Request) {
  try {
    const { accountId } = await requireRole('admin')
    const config = await loadTwilioCallingConfig(accountId)

    if (!config) {
      return NextResponse.json({ configured: false, calls: [] })
    }

    const searchParams = new URL(request.url).searchParams
    const startDate = clean(searchParams.get('start_date')) || istDateString()
    const endDate = clean(searchParams.get('end_date')) || startDate
    const status = clean(searchParams.get('status'))
    const scope = clean(searchParams.get('scope')) || 'crm'
    const limit = Math.min(500, Math.max(1, Number.parseInt(searchParams.get('limit') || '100', 10) || 100))

    const query = new URLSearchParams()
    query.set('PageSize', String(Math.min(limit, 100)))
    query.set('StartTimeAfter', utcAfterForIstDate(startDate))
    query.set('StartTimeBefore', utcBeforeForIstDate(endDate))

    if (scope !== 'account' && config.callerNumber) {
      query.set('From', config.callerNumber)
    }

    if (status) query.set('Status', status)

    const first = (await twilioGet(
      config.accountSid,
      config.authToken,
      `/Calls.json?${query.toString()}`,
    )) as {
      calls?: TwilioCall[]
      next_page_uri?: string | null
    }

    const calls: TwilioCall[] = [...(first.calls ?? [])]
    let nextPageUri = first.next_page_uri ?? null

    while (nextPageUri && calls.length < limit) {
      const nextUrl = new URL(nextPageUri, 'https://api.twilio.com')
      const response = await fetch(nextUrl.toString(), {
        headers: { Authorization: basicAuth(config.accountSid, config.authToken) },
        cache: 'no-store',
      })

      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(payload?.message || `Twilio pagination request failed (HTTP ${response.status}).`)
      }

      const page = payload as { calls?: TwilioCall[]; next_page_uri?: string | null }
      calls.push(...(page.calls ?? []))
      nextPageUri = page.next_page_uri ?? null

      if (!page.calls?.length) break
    }

    const trimmed = calls.slice(0, limit)
    const sids = trimmed.map((call) => call.sid).filter((value): value is string => Boolean(value))

    const db = createServiceRoleClient()
    const sessionsBySid = new Map<string, { id: string; recording_status: string | null; recording_duration_seconds: number }>()
    if (sids.length) {
      const { data, error } = await db
        .from('ai_call_sessions')
        .select('id, provider_call_sid, recording_status, recording_duration_seconds')
        .eq('account_id', accountId)
        .in('provider_call_sid', sids)

      if (error) {
        console.error('[ai-calling/twilio/calls] CRM session lookup failed:', error)
      } else {
        for (const row of data ?? []) {
          if (row.provider_call_sid) {
            sessionsBySid.set(row.provider_call_sid, {
              id: row.id,
              recording_status: row.recording_status ?? null,
              recording_duration_seconds: row.recording_duration_seconds ?? 0,
            })
          }
        }
      }
    }

    return NextResponse.json({
      configured: true,
      scope,
      caller_number: config.callerNumber,
      period: { start_date: startDate, end_date: endDate },
      count: trimmed.length,
      calls: trimmed.map((call) => ({
        sid: call.sid ?? '',
        crm_session_id: call.sid ? sessionsBySid.get(call.sid)?.id ?? null : null,
        recording_status: call.sid ? sessionsBySid.get(call.sid)?.recording_status ?? null : null,
        recording_duration_seconds: call.sid ? sessionsBySid.get(call.sid)?.recording_duration_seconds ?? 0 : 0,
        direction: call.direction ?? null,
        status: call.status ?? null,
        from: call.from ?? null,
        to: call.to ?? null,
        start_time: call.start_time ?? null,
        end_time: call.end_time ?? null,
        duration_seconds: Number(call.duration || 0) || 0,
        price: call.price ?? null,
        price_unit: call.price_unit ?? null,
        answered_by: call.answered_by ?? null,
        date_created: call.date_created ?? null,
      })),
      fetched_at: new Date().toISOString(),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
