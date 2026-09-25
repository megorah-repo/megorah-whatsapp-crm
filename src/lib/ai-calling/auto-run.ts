import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { loadAiConfig } from '@/lib/ai/config'
import { loadDirectCallingApiConfig, type DirectCallingApiConfig } from '@/lib/ai-calling/direct-api-config'
import { loadTwilioCallingConfig } from '@/lib/ai-calling/twilio-config'
import { createTwilioCall, isValidE164, baseUrl } from '@/lib/ai-calling/twilio'

type Db = ReturnType<typeof createServiceRoleClient>

type Campaign = {
  id: string
  account_id: string
  name: string
  status: string
  max_concurrent: number
  calls_per_run: number
  max_attempts: number
  retry_delay_minutes: number
  business_hours_only: boolean
  business_hours_start: string
  business_hours_end: string
  timezone: string
  settings: Record<string, unknown>
}

type QueueItem = {
  id: string
  account_id: string
  campaign_id: string
  to_number: string
  display_name: string | null
  attempt_count: number
  max_attempts: number
  status: string
}

type CallSettings = {
  callerName: string
  greeting: string
  instructions: string
  language: string
  transferNumber: string
  transferOnHandoff: boolean
  maxCallMinutes: number
}

function cleanNumber(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, '') : ''
}

function asSettings(value: unknown): CallSettings {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return {
    callerName: typeof raw.callerName === 'string' && raw.callerName.trim() ? raw.callerName.trim() : 'Megorah AI',
    greeting: typeof raw.greeting === 'string' && raw.greeting.trim() ? raw.greeting.trim() : 'Hi, this is Megorah AI. How can I help you today?',
    instructions: typeof raw.instructions === 'string' && raw.instructions.trim()
      ? raw.instructions.trim()
      : 'Be concise, helpful and natural. Escalate to a human when needed.',
    language: typeof raw.language === 'string' && raw.language.trim() ? raw.language.trim() : 'en-IN',
    transferNumber: cleanNumber(raw.transferNumber),
    transferOnHandoff: raw.transferOnHandoff !== false,
    maxCallMinutes: Math.min(20, Math.max(1, Number(raw.maxCallMinutes) || 12)),
  }
}

function headersForDirect(config: DirectCallingApiConfig): Headers {
  const headers = new Headers({ 'Content-Type': 'application/json', Accept: 'application/json' })
  if (config.authType === 'x-api-key') headers.set('X-API-Key', config.apiKey)
  else headers.set('Authorization', config.authType === 'authorization' ? config.apiKey : 'Bearer ' + config.apiKey)
  return headers
}

function providerResult(payload: unknown): { id: string | null; status: string } {
  const root = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
  const data = root.data && typeof root.data === 'object' ? root.data as Record<string, unknown> : root
  const id = data.call_id ?? data.callId ?? data.id ?? data.sid ?? data.call_sid ?? data.request_id
  const status = data.status ?? data.call_status ?? data.state
  return {
    id: typeof id === 'string' && id.trim() ? id.trim() : null,
    status: typeof status === 'string' && status.trim() ? status.trim() : 'queued',
  }
}

function withinHours(campaign: Campaign): boolean {
  if (!campaign.business_hours_only) return true
  const now = new Date()
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: campaign.timezone || 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const hour = Number(parts.find((p) => p.type === 'hour')?.value || 0)
  const minute = Number(parts.find((p) => p.type === 'minute')?.value || 0)
  const current = hour * 60 + minute
  const startParts = campaign.business_hours_start.split(':').map(Number)
  const endParts = campaign.business_hours_end.split(':').map(Number)
  const start = (startParts[0] || 0) * 60 + (startParts[1] || 0)
  const end = (endParts[0] || 0) * 60 + (endParts[1] || 0)
  if (start <= end) return current >= start && current < end
  return current >= start || current < end
}

async function placeItem(db: Db, item: QueueItem, campaign: Campaign, origin: string) {
  const direct = await loadDirectCallingApiConfig(item.account_id)
  const twilio = direct ? null : await loadTwilioCallingConfig(item.account_id)

  if (!direct && !twilio) throw new Error('No calling provider is connected for this account.')

  const aiConfig = direct ? null : await loadAiConfig(db, item.account_id)
  if (!direct && !aiConfig) throw new Error('AI provider/API key is not configured or is disabled.')

  const actualFrom = cleanNumber(direct?.callerNumber || twilio?.callerNumber)
  if (!isValidE164(actualFrom)) throw new Error('No valid caller number is connected. Add a verified E.164 caller number first.')

  const settings = asSettings(campaign.settings)
  const provider = direct ? 'direct-api' : 'twilio'
  const sessionSettings = {
    ...settings,
    queueId: item.id,
    campaignId: campaign.id,
    contactName: item.display_name,
    aiProvider: aiConfig?.provider ?? null,
    aiModel: aiConfig?.model ?? null,
  }

  const { data: session, error: sessionError } = await db
    .from('ai_call_sessions')
    .insert({
      account_id: item.account_id,
      provider,
      from_number: actualFrom,
      to_number: item.to_number,
      status: 'queued',
      settings: sessionSettings,
      history: [],
    })
    .select('id')
    .single()

  if (sessionError || !session) throw new Error('Could not create the CRM call session.')

  try {
    if (direct) {
      if (!direct.webhookSecret) throw new Error('Direct calling webhook protection is not configured. Reconnect the provider.')
      const webhookUrl = origin + '/api/ai-calling/direct-api/webhook?session_id=' +
        encodeURIComponent(session.id) + '&token=' + encodeURIComponent(direct.webhookSecret)
      const response = await fetch(direct.apiUrl, {
        method: 'POST',
        headers: headersForDirect(direct),
        body: JSON.stringify({
          to: item.to_number,
          from: actualFrom,
          to_number: item.to_number,
          from_number: actualFrom,
          caller_name: settings.callerName,
          greeting: settings.greeting,
          instructions: settings.instructions,
          language: settings.language,
          max_duration_seconds: settings.maxCallMinutes * 60,
          webhook_url: webhookUrl,
          metadata: { campaign_id: campaign.id, queue_id: item.id, contact_name: item.display_name },
        }),
        cache: 'no-store',
      })
      const raw = await response.text()
      let payload: unknown = {}
      try { payload = raw ? JSON.parse(raw) : {} } catch { payload = { message: raw } }
      if (!response.ok) {
        const root = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
        const message = typeof root.message === 'string' ? root.message
          : typeof root.error === 'string' ? root.error
            : 'Calling provider rejected the call request (HTTP ' + response.status + ').'
        throw new Error(message)
      }
      const result = providerResult(payload)
      const providerId = result.id || 'direct-' + session.id
      await db.from('ai_call_sessions').update({ provider_call_sid: providerId, status: result.status }).eq('id', session.id)
      await db.from('ai_call_queue').update({ session_id: session.id, status: result.status === 'queued' ? 'placing' : (result.status || 'in-progress'), last_error: null }).eq('id', item.id)
      return { sessionId: session.id, provider: direct.providerName, providerCallId: providerId, status: result.status }
    }

    const voiceUrl = origin + '/api/ai-calling/voice?session_id=' + encodeURIComponent(session.id)
    const statusUrl = origin + '/api/ai-calling/status?session_id=' + encodeURIComponent(session.id)
    const call = await createTwilioCall({
      to: item.to_number,
      from: actualFrom,
      voiceUrl,
      accountSid: twilio!.accountSid,
      authToken: twilio!.authToken,
      statusCallbackUrl: statusUrl,
      timeLimitSeconds: settings.maxCallMinutes * 60,
    })
    await db.from('ai_call_sessions').update({ provider_call_sid: call.sid, status: call.status }).eq('id', session.id)
    await db.from('ai_call_queue').update({ session_id: session.id, status: call.status === 'queued' ? 'placing' : (call.status || 'placing'), last_error: null }).eq('id', item.id)
    return { sessionId: session.id, provider: 'Twilio', providerCallId: call.sid, status: call.status }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Calling provider could not start the call.'
    await db.from('ai_call_sessions').update({ status: 'failed', last_error: message.slice(0, 1000), ended_at: new Date().toISOString() }).eq('id', session.id)
    throw error
  }
}

export async function syncQueueFromCallStatus(sessionId: string, providerStatus: string, errorMessage?: string | null) {
  const db = createServiceRoleClient()
  const { data: session } = await db
    .from('ai_call_sessions')
    .select('settings')
    .eq('id', sessionId)
    .maybeSingle()
  const settings = session?.settings && typeof session.settings === 'object' ? session.settings as Record<string, unknown> : {}
  const queueId = typeof settings.queueId === 'string' ? settings.queueId : ''
  if (!queueId) return

  const { data: queue } = await db
    .from('ai_call_queue')
    .select('id, attempt_count, max_attempts, campaign_id')
    .eq('id', queueId)
    .maybeSingle()
  if (!queue) return

  const normalized = providerStatus === 'cancelled' ? 'canceled' : providerStatus
  const queueProviderStatus = normalized === 'queued' ? 'placing' : normalized
  const terminal = new Set(['completed','failed','busy','no-answer','canceled'])
  const retryable = new Set(['failed','busy','no-answer'])

  if (retryable.has(queueProviderStatus) && queue.attempt_count < queue.max_attempts) {
    const { data: campaign } = await db
      .from('ai_call_campaigns')
      .select('retry_delay_minutes,status')
      .eq('id', queue.campaign_id)
      .maybeSingle()
    const delay = Math.max(1, Number(campaign?.retry_delay_minutes) || 30)
    await db.from('ai_call_queue').update({
      status: campaign?.status === 'running' ? 'queued' : normalized,
      next_attempt_at: new Date(Date.now() + delay * 60_000).toISOString(),
      last_error: errorMessage || normalized,
      updated_at: new Date().toISOString(),
    }).eq('id', queueId)
    return
  }

  const nextStatus = terminal.has(queueProviderStatus) ? queueProviderStatus : (queueProviderStatus || 'in-progress')
  await db.from('ai_call_queue').update({
    status: nextStatus,
    last_error: errorMessage || null,
    updated_at: new Date().toISOString(),
  }).eq('id', queueId)
}

export async function runAutoCalls(args: { accountId?: string | null; campaignId?: string | null; origin: string }) {
  const db = createServiceRoleClient()
  let query = db
    .from('ai_call_campaigns')
    .select('id,account_id,name,status,max_concurrent,calls_per_run,max_attempts,retry_delay_minutes,business_hours_only,business_hours_start,business_hours_end,timezone,settings')
    .eq('status','running')
    .order('created_at',{ascending:true})
    .limit(args.campaignId ? 1 : 10)
  if (args.accountId) query = query.eq('account_id', args.accountId)
  if (args.campaignId) query = query.eq('id', args.campaignId)

  const { data: campaigns, error } = await query
  if (error) throw error

  const results: Array<Record<string, unknown>> = []
  for (const campaign of (campaigns || []) as Campaign[]) {
    if (!withinHours(campaign)) {
      results.push({ campaign_id: campaign.id, name: campaign.name, skipped: 'outside_business_hours' })
      continue
    }

    const { count: activeCount } = await db
      .from('ai_call_queue')
      .select('id',{count:'exact',head:true})
      .eq('campaign_id',campaign.id)
      .in('status',['placing','ringing','answered','in-progress'])

    const capacity = Math.max(0, campaign.max_concurrent - (activeCount || 0))
    const batch = Math.min(campaign.calls_per_run, capacity)
    if (batch <= 0) {
      results.push({ campaign_id: campaign.id, name: campaign.name, launched: 0, reason: 'concurrency_limit' })
      continue
    }

    const { data: claimed, error: claimError } = await db.rpc('claim_ai_call_queue', { p_campaign_id: campaign.id, p_limit: batch })
    if (claimError) {
      results.push({ campaign_id: campaign.id, name: campaign.name, launched: 0, error: claimError.message })
      continue
    }

    let launched = 0
    for (const item of (claimed || []) as QueueItem[]) {
      try {
        await placeItem(db, item, campaign, args.origin)
        launched += 1
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Could not place call.'
        const final = item.attempt_count >= item.max_attempts
        await db.from('ai_call_queue').update({
          status: final ? 'failed' : 'queued',
          next_attempt_at: new Date(Date.now() + Math.max(1,campaign.retry_delay_minutes) * 60_000).toISOString(),
          last_error: message.slice(0,1000),
        }).eq('id', item.id)
      }
    }

    const { count: remaining } = await db
      .from('ai_call_queue')
      .select('id',{count:'exact',head:true})
      .eq('campaign_id',campaign.id)
      .in('status',['queued','placing'])
    if (!remaining) {
      await db.from('ai_call_campaigns').update({ status:'completed' }).eq('id',campaign.id).eq('status','running')
    }

    results.push({ campaign_id: campaign.id, name: campaign.name, launched, claimed: (claimed || []).length, remaining: remaining || 0 })
  }

  return { processed: results.length, results }
}
