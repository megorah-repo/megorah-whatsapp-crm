import { NextResponse, after } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { deliverBroadcast, finalizeBroadcastStatus } from '@/lib/whatsapp/broadcast-core'
import {
  claimBroadcastDelivery,
  markBroadcastSending,
  planBroadcastResume,
  releaseBroadcastDelivery,
} from '@/lib/whatsapp/broadcast-resume'

export const maxDuration = 300

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET || process.env.BROADCAST_CRON_SECRET
  if (!secret) return false
  const auth = request.headers.get('authorization') || ''
  const legacy = request.headers.get('x-cron-secret') || ''
  return auth === 'Bearer ' + secret || legacy === secret
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createServiceRoleClient()
  const { data: due, error } = await db
    .from('broadcasts')
    .select('id, account_id')
    .eq('status', 'scheduled')
    .lte('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(1)

  if (error) {
    console.error('[whatsapp/broadcast/cron] lookup failed:', error)
    return NextResponse.json({ error: 'Could not load scheduled broadcasts.' }, { status: 500 })
  }

  if (!due?.length) return NextResponse.json({ processed: 0 })

  const broadcast = due[0]
  const claimed = await claimBroadcastDelivery(db, broadcast.account_id, broadcast.id)
  if (!claimed) return NextResponse.json({ processed: 0, reason: 'locked' })

  try {
    const { plan } = await planBroadcastResume(
      db,
      broadcast.account_id,
      broadcast.id,
      'pending',
    )
    await markBroadcastSending(db, broadcast.id)

    after(async () => {
      try {
        await deliverBroadcast(db, plan)
      } catch (error) {
        console.error(
          '[whatsapp/broadcast/cron] delivery failed:',
          error instanceof Error ? error.message : error,
        )
        await finalizeBroadcastStatus(db, broadcast.id).catch(() => {})
      } finally {
        await releaseBroadcastDelivery(db, broadcast.id)
      }
    })

    return NextResponse.json({
      processed: 1,
      broadcast_id: broadcast.id,
      status: 'sending',
    })
  } catch (error) {
    await releaseBroadcastDelivery(db, broadcast.id)
    console.error(
      '[whatsapp/broadcast/cron] planning failed:',
      error instanceof Error ? error.message : error,
    )
    return NextResponse.json({ error: 'Scheduled broadcast could not start.' }, { status: 500 })
  }
}
