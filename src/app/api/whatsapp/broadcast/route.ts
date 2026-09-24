import { NextResponse, after } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit'
import {
  BroadcastError,
  createBroadcast,
  deliverBroadcast,
  finalizeBroadcastStatus,
} from '@/lib/whatsapp/broadcast-core'
import { supabaseAdmin } from '@/lib/flows/admin-client'

export const maxDuration = 300

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')

    const limit = checkRateLimit(`broadcast:${userId}`, RATE_LIMITS.broadcast)
    if (!limit.success) return rateLimitResponse(limit)

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Request body must be a JSON object.' }, { status: 400 })
    }

    const recipients = Array.isArray(body.recipients) ? body.recipients : []
    const templateName = typeof body.template_name === 'string' ? body.template_name.trim() : ''
    const templateLanguage = typeof body.template_language === 'string' ? body.template_language.trim() : null
    const name = typeof body.name === 'string' ? body.name.trim() : null
    const headerMediaUrl =
      typeof body.header_media_url === 'string' ? body.header_media_url.trim() : null

    if (!templateName || recipients.length === 0) {
      return NextResponse.json(
        { error: 'template_name and a non-empty recipients array are required.' },
        { status: 400 },
      )
    }

    const plan = await createBroadcast(supabase, accountId, userId, {
      name,
      templateName,
      templateLanguage,
      recipients: recipients.map((recipient) => {
        const row = recipient && typeof recipient === 'object'
          ? recipient as Record<string, unknown>
          : {}
        return {
          to: typeof row.phone === 'string'
            ? row.phone
            : typeof row.to === 'string'
              ? row.to
              : '',
          params: Array.isArray(row.params)
            ? row.params.filter((value): value is string => typeof value === 'string')
            : undefined,
        }
      }),
      headerMediaUrl: headerMediaUrl || null,
    })

    const admin = supabaseAdmin()
    after(async () => {
      try {
        await deliverBroadcast(admin, plan)
      } catch (error) {
        console.error(
          '[whatsapp/broadcast] server delivery failed:',
          error instanceof Error ? error.message : error,
        )
        await finalizeBroadcastStatus(admin, plan.broadcastId).catch(() => {})
      }
    })

    return NextResponse.json(
      {
        success: true,
        broadcast_id: plan.broadcastId,
        status: 'sending',
        total: plan.planned.length,
        rejected: plan.rejected,
      },
      { status: 202 },
    )
  } catch (error) {
    if (error instanceof BroadcastError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      )
    }
    console.error('[whatsapp/broadcast] error:', error)
    return toErrorResponse(error)
  }
}
