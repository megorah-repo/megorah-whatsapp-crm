import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { createServiceRoleClient } from '@/lib/supabase/service-role'

function parseNumbers(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').join('\n')
    : typeof value === 'string' ? value : ''
  const values = raw.split(/[\n,;]+/).map((v) => v.trim().replace(/\s+/g, '')).filter(Boolean)
  return [...new Set(values)]
}

function isE164(value: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(value)
}

export async function GET() {
  try {
    const { accountId } = await requireRole('admin')
    const db = createServiceRoleClient()
    const { data, error } = await db
      .from('ai_call_campaigns')
      .select('id,name,status,max_concurrent,calls_per_run,max_attempts,retry_delay_minutes,business_hours_only,business_hours_start,business_hours_end,timezone,created_at,started_at,paused_at')
      .eq('account_id', accountId)
      .order('created_at',{ascending:false})
      .limit(50)
    if (error) return NextResponse.json({ error:'Could not load call campaigns.' },{status:500})

    const campaigns = []
    for (const campaign of data || []) {
      const { count: queued } = await db.from('ai_call_queue').select('id',{count:'exact',head:true}).eq('campaign_id',campaign.id).in('status',['queued','placing'])
      const { count: completed } = await db.from('ai_call_queue').select('id',{count:'exact',head:true}).eq('campaign_id',campaign.id).eq('status','completed')
      const { count: failed } = await db.from('ai_call_queue').select('id',{count:'exact',head:true}).eq('campaign_id',campaign.id).in('status',['failed','busy','no-answer'])
      campaigns.push({ ...campaign, queued: queued || 0, completed: completed || 0, failed: failed || 0 })
    }
    return NextResponse.json({ campaigns })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const { accountId, userId } = await requireRole('admin')
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return NextResponse.json({ error:'Invalid request body.' },{status:400})

    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const numbers = parseNumbers(body.recipients)
    if (!name || name.length > 120) return NextResponse.json({ error:'Campaign name is required.' },{status:400})
    if (numbers.length === 0 || numbers.length > 1000) return NextResponse.json({ error:'Add between 1 and 1000 recipient numbers.' },{status:400})

    const invalid = numbers.filter((number) => !isE164(number))
    if (invalid.length) return NextResponse.json({ error:'All recipients must use E.164 format, e.g. +9198XXXXXXXX.', invalid_count:invalid.length },{status:400})

    const maxConcurrent = Math.min(20, Math.max(1, Number(body.max_concurrent) || 2))
    const callsPerRun = Math.min(20, Math.max(1, Number(body.calls_per_run) || maxConcurrent))
    const maxAttempts = Math.min(10, Math.max(1, Number(body.max_attempts) || 2))
    const retryDelay = Math.min(1440, Math.max(1, Number(body.retry_delay_minutes) || 30))
    const startNow = body.start_now === true

    const settings = body.settings && typeof body.settings === 'object' ? body.settings : {}

    const db = createServiceRoleClient()
    const { data: campaign, error: campaignError } = await db
      .from('ai_call_campaigns')
      .insert({
        account_id: accountId,
        created_by: userId,
        name,
        status: startNow ? 'running' : 'draft',
        max_concurrent: maxConcurrent,
        calls_per_run: callsPerRun,
        max_attempts: maxAttempts,
        retry_delay_minutes: retryDelay,
        business_hours_only: body.business_hours_only !== false,
        business_hours_start: typeof body.business_hours_start === 'string' && /^\d{2}:\d{2}$/.test(body.business_hours_start) ? body.business_hours_start : '09:00',
        business_hours_end: typeof body.business_hours_end === 'string' && /^\d{2}:\d{2}$/.test(body.business_hours_end) ? body.business_hours_end : '19:00',
        timezone: typeof body.timezone === 'string' && body.timezone.trim() ? body.timezone.trim() : 'Asia/Kolkata',
        settings,
        started_at: startNow ? new Date().toISOString() : null,
      })
      .select('id')
      .single()

    if (campaignError || !campaign) return NextResponse.json({ error:'Could not create call campaign.' },{status:500})

    const queueRows = numbers.map((to_number) => ({
      account_id: accountId,
      campaign_id: campaign.id,
      to_number,
      max_attempts: maxAttempts,
      status: 'queued',
      next_attempt_at: new Date().toISOString(),
    }))
    const { error: queueError } = await db.from('ai_call_queue').insert(queueRows)
    if (queueError) {
      await db.from('ai_call_campaigns').delete().eq('id', campaign.id)
      return NextResponse.json({ error:'Could not create the call queue.' },{status:500})
    }

    return NextResponse.json({ ok:true, campaign_id:campaign.id, status:startNow ? 'running' : 'draft', recipients:numbers.length })
  } catch (err) {
    return toErrorResponse(err)
  }
}
