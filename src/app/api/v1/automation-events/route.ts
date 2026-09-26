import { createHash } from 'node:crypto'
import { requireApiKey } from '@/lib/auth/api-context'
import { fail, ok, toApiErrorResponse } from '@/lib/api/v1/respond'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import {
  ensureCommerceContactConversation,
  isCommerceEvent,
  resolveCommerceOwner,
  type CommerceContextVars,
  COMMERCE_EVENTS,
} from '@/lib/automations/commerce-events'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { normalizePhone } from '@/lib/whatsapp/phone-utils'
import { reopenClosedConversation } from '@/lib/conversations/reopen'

function text(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return undefined
}

function nested(body: Record<string, unknown>, key: string, field: string): unknown {
  const obj = body[key]
  if (!obj || typeof obj !== 'object') return undefined
  return (obj as Record<string, unknown>)[field]
}

function itemsText(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined
  const parts = value.slice(0, 20).map((item) => {
    if (!item || typeof item !== 'object') return null
    const row = item as Record<string, unknown>
    const title = text(row.title ?? row.name ?? row.product_name) ?? 'Item'
    const quantity = text(row.quantity)
    return quantity ? title + ' × ' + quantity : title
  }).filter(Boolean)
  return parts.length ? parts.join(', ') : undefined
}

function buildEventId(body: Record<string, unknown>, eventType: string, phone: string): string {
  const explicit = text(body.event_id ?? body.id)
  if (explicit) return explicit
  const seed = JSON.stringify({
    event_type: eventType,
    phone,
    order_id: text(body.order_id ?? nested(body, 'order', 'id')),
    order_number: text(body.order_number ?? body.order_no ?? nested(body, 'order', 'order_number')),
    checkout_id: text(body.checkout_id ?? body.checkout_token ?? nested(body, 'checkout', 'id')),
    total: text(body.total ?? body.amount),
  })
  return 'auto_' + createHash('sha256').update(seed).digest('hex').slice(0, 40)
}

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'messages:send')
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return fail('bad_request', 'Request body must be a JSON object', 400)

    const eventType = text(body.event_type ?? body.type)
    if (!isCommerceEvent(eventType)) {
      return fail(
        'bad_request',
        "'event_type' must be one of: " + COMMERCE_EVENTS.join(', '),
        400,
      )
    }

    const phone = normalizePhone(
      text(
        body.phone ??
        body.customer_phone ??
        body.whatsapp_phone ??
        nested(body, 'customer', 'phone') ??
        nested(body, 'customer', 'whatsapp_phone') ??
        nested(body, 'shipping_address', 'phone'),
      ) ?? '',
    )
    if (!phone) return fail('bad_request', "'phone' is required and must contain a valid customer number", 400)

    const eventId = buildEventId(body, eventType, phone)
    const db = supabaseAdmin()

    const { error: receiptError } = await db
      .from('automation_event_receipts')
      .insert({
        account_id: ctx.accountId,
        event_id: eventId,
        event_type: eventType,
        phone,
        payload: body,
      })
    if (receiptError) {
      if (receiptError.code === '23505') {
        return ok({ accepted: true, duplicate: true, event_id: eventId, event_type: eventType })
      }
      console.error('[api/v1/automation-events] receipt insert failed:', receiptError)
      return fail('internal', 'Failed to record automation event', 500)
    }

    const ownerUserId = await resolveCommerceOwner(db, ctx.accountId, ctx.createdBy)
    if (!ownerUserId) return fail('internal', 'Account owner could not be resolved', 500)

    const customerName = text(body.customer_name ?? body.name ?? nested(body, 'customer', 'name'))
    const customerEmail = text(body.customer_email ?? body.email ?? nested(body, 'customer', 'email'))
    const resolved = await ensureCommerceContactConversation({
      db,
      accountId: ctx.accountId,
      ownerUserId,
      phone,
      name: customerName,
      email: customerEmail,
    })

    await reopenClosedConversation(db, { id: resolved.conversationId, status: 'closed' })

    const vars: CommerceContextVars = {
      event_type: eventType,
      event_id: eventId,
      phone,
      ...(customerName ? { customer_name: customerName } : {}),
      ...(customerEmail ? { customer_email: customerEmail } : {}),
      ...(text(body.order_id ?? nested(body, 'order', 'id')) ? { order_id: text(body.order_id ?? nested(body, 'order', 'id'))! } : {}),
      ...(text(body.order_number ?? body.order_no ?? nested(body, 'order', 'order_number')) ? { order_number: text(body.order_number ?? body.order_no ?? nested(body, 'order', 'order_number'))! } : {}),
      ...(text(body.checkout_id ?? body.checkout_token ?? nested(body, 'checkout', 'id')) ? { checkout_id: text(body.checkout_id ?? body.checkout_token ?? nested(body, 'checkout', 'id'))! } : {}),
      ...(text(body.payment_status) ? { payment_status: text(body.payment_status)! } : {}),
      ...(text(body.fulfillment_status) ? { fulfillment_status: text(body.fulfillment_status)! } : {}),
      ...(text(body.total ?? body.amount ?? nested(body, 'order', 'total')) ? { total: text(body.total ?? body.amount ?? nested(body, 'order', 'total'))! } : {}),
      ...(text(body.currency ?? nested(body, 'order', 'currency')) ? { currency: text(body.currency ?? nested(body, 'order', 'currency'))! } : {}),
      ...(text(body.tracking_number ?? nested(body, 'fulfillment', 'tracking_number')) ? { tracking_number: text(body.tracking_number ?? nested(body, 'fulfillment', 'tracking_number'))! } : {}),
      ...(text(body.courier ?? body.carrier ?? nested(body, 'fulfillment', 'carrier')) ? { courier: text(body.courier ?? body.carrier ?? nested(body, 'fulfillment', 'carrier'))! } : {}),
      ...(text(body.tracking_url ?? nested(body, 'fulfillment', 'tracking_url')) ? { tracking_url: text(body.tracking_url ?? nested(body, 'fulfillment', 'tracking_url'))! } : {}),
      ...(text(body.delivery_date ?? nested(body, 'fulfillment', 'delivery_date')) ? { delivery_date: text(body.delivery_date ?? nested(body, 'fulfillment', 'delivery_date'))! } : {}),
      ...(text(body.checkout_url ?? nested(body, 'checkout', 'url')) ? { checkout_url: text(body.checkout_url ?? nested(body, 'checkout', 'url'))! } : {}),
      ...(text(body.discount_code ?? nested(body, 'discount', 'code')) ? { discount_code: text(body.discount_code ?? nested(body, 'discount', 'code'))! } : {}),
      ...(text(body.failure_reason ?? body.error_message) ? { failure_reason: text(body.failure_reason ?? body.error_message)! } : {}),
      ...(itemsText(body.items ?? nested(body, 'order', 'items') ?? nested(body, 'checkout', 'items')) ? { items_text: itemsText(body.items ?? nested(body, 'order', 'items') ?? nested(body, 'checkout', 'items'))! } : {}),
    }

    let cancelledAbandonWaits = 0
    if (eventType === 'order.created' || eventType === 'order.paid') {
      cancelledAbandonWaits = await cancelPendingAbandonedCartViaDb(
        db,
        ctx.accountId,
        resolved.contactId,
        vars.checkout_id,
      )
    }

    await runAutomationsForTrigger({
      accountId: ctx.accountId,
      triggerType: 'commerce_event',
      contactId: resolved.contactId,
      context: {
        event_type: eventType,
        conversation_id: resolved.conversationId,
        vars,
      },
    })

    return ok({
      accepted: true,
      duplicate: false,
      event_id: eventId,
      event_type: eventType,
      contact_id: resolved.contactId,
      conversation_id: resolved.conversationId,
      cancelled_abandoned_cart_waits: cancelledAbandonWaits,
    }, 202)
  } catch (err) {
    return toApiErrorResponse(err)
  }
}

async function cancelPendingAbandonedCartViaDb(
  db: ReturnType<typeof supabaseAdmin>,
  accountId: string,
  contactId: string,
  checkoutId?: string,
): Promise<number> {
  if (!checkoutId) return 0
  const { data, error } = await db
    .from('automation_pending_executions')
    .update({ status: 'cancelled' })
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .eq('status', 'pending')
    .contains('context', { vars: { checkout_id: checkoutId } })
    .select('id')
  if (error) {
    console.error('[api/v1/automation-events] cancel abandoned wait failed:', error.message)
    return 0
  }
  return data?.length ?? 0
}
