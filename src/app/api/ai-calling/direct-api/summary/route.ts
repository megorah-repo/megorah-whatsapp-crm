import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { createServiceRoleClient } from '@/lib/supabase/service-role'

function todayIndia(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  return (parts.find((p) => p.type === 'year')?.value || '1970') + '-' +
    (parts.find((p) => p.type === 'month')?.value || '01') + '-' +
    (parts.find((p) => p.type === 'day')?.value || '01')
}
function startInclusive(date: string) {
  return new Date(date + 'T00:00:00+05:30').toISOString()
}
function endExclusive(date: string) {
  const d = new Date(date + 'T00:00:00+05:30')
  d.setDate(d.getDate() + 1)
  return d.toISOString()
}

export async function GET(request: Request) {
  try {
    const { accountId } = await requireRole('admin')
    const url = new URL(request.url)
    const rawDate = url.searchParams.get('date')
    const date = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : todayIndia()
    const db = createServiceRoleClient()
    const { data, error } = await db.from('ai_call_sessions')
      .select('id, provider_call_sid, from_number, to_number, status, duration_seconds, cost, cost_currency, created_at, ended_at')
      .eq('account_id', accountId)
      .eq('provider', 'direct-api')
      .gte('created_at', startInclusive(date))
      .lt('created_at', endExclusive(date))
      .order('created_at', { ascending: false })
      .limit(500)

    if (error) {
      console.error('[ai-calling/direct-api/summary] query failed:', error)
      return NextResponse.json({ error: 'Could not load calling history.' }, { status: 500 })
    }

    const calls = data ?? []
    const answered = calls.filter((call) => ['completed', 'answered', 'in-progress'].includes(call.status)).length
    const totalDuration = calls.reduce((sum, call) => sum + (Number(call.duration_seconds) || 0), 0)
    const totalCost = calls.reduce((sum, call) => sum + (Number(call.cost) || 0), 0)
    const currency = calls.find((call) => call.cost_currency)?.cost_currency || 'USD'

    return NextResponse.json({
      date,
      fetched_at: new Date().toISOString(),
      totals: {
        calls: calls.length,
        answered,
        duration_seconds: totalDuration,
        minutes: Number((totalDuration / 60).toFixed(2)),
        cost: Number(totalCost.toFixed(6)),
        currency,
      },
      calls,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
