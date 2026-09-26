import type { SupabaseClient } from '@supabase/supabase-js'
import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe'
import { normalizePhone } from '@/lib/whatsapp/phone-utils'

export const COMMERCE_EVENTS = [
  'order.created',
  'order.paid',
  'order.shipped',
  'order.out_for_delivery',
  'order.delivered',
  'order.cancelled',
  'checkout.abandoned',
  'payment.failed',
  'refund.created',
] as const

export type CommerceEventType = (typeof COMMERCE_EVENTS)[number]

export function isCommerceEvent(value: unknown): value is CommerceEventType {
  return typeof value === 'string' && (COMMERCE_EVENTS as readonly string[]).includes(value)
}

export interface CommerceContextVars {
  event_type: CommerceEventType
  event_id: string
  phone: string
  customer_name?: string
  customer_email?: string
  order_id?: string
  order_number?: string
  checkout_id?: string
  payment_status?: string
  fulfillment_status?: string
  total?: string
  currency?: string
  tracking_number?: string
  courier?: string
  tracking_url?: string
  delivery_date?: string
  checkout_url?: string
  discount_code?: string
  failure_reason?: string
  items_text?: string
}

export async function resolveCommerceOwner(
  db: SupabaseClient,
  accountId: string,
  createdBy: string | null,
): Promise<string | null> {
  if (createdBy) {
    const { data } = await db
      .from('profiles')
      .select('user_id')
      .eq('user_id', createdBy)
      .eq('account_id', accountId)
      .maybeSingle()
    if (data?.user_id) return data.user_id as string
  }

  const { data } = await db
    .from('accounts')
    .select('owner_user_id')
    .eq('id', accountId)
    .maybeSingle()
  return (data?.owner_user_id as string | null | undefined) ?? null
}

export async function ensureCommerceContactConversation(args: {
  db: SupabaseClient
  accountId: string
  ownerUserId: string
  phone: string
  name?: string
  email?: string
}): Promise<{ contactId: string; conversationId: string; createdConversation: boolean }> {
  const phone = normalizePhone(args.phone)
  if (!phone) throw new Error('customer phone is invalid')

  let contact = await findExistingContact(args.db, args.accountId, phone)
  if (contact) {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (args.name && args.name !== contact.name) patch.name = args.name
    if (args.email && args.email !== contact.email) patch.email = args.email
    if (Object.keys(patch).length > 1) {
      await args.db
        .from('contacts')
        .update(patch)
        .eq('id', contact.id)
        .eq('account_id', args.accountId)
    }
  } else {
    const { data, error } = await args.db
      .from('contacts')
      .insert({
        account_id: args.accountId,
        user_id: args.ownerUserId,
        phone,
        name: args.name || phone,
        email: args.email || null,
      })
      .select('id, phone, name, email')
      .single()
    if (error || !data) {
      if (error && isUniqueViolation(error)) {
        contact = await findExistingContact(args.db, args.accountId, phone)
      }
      if (!contact && (error || !data)) {
        throw new Error('unable to create contact: ' + (error?.message ?? 'unknown error'))
      }
    } else {
      contact = data
    }
  }

  if (!contact?.id) throw new Error('unable to resolve contact')

  const { data: existingRows, error: findConversationError } = await args.db
    .from('conversations')
    .select('id')
    .eq('account_id', args.accountId)
    .eq('contact_id', contact.id)
    .order('created_at', { ascending: true })
    .limit(1)
  if (findConversationError) throw new Error('conversation lookup failed: ' + findConversationError.message)

  if (existingRows?.[0]?.id) {
    return { contactId: contact.id, conversationId: existingRows[0].id as string, createdConversation: false }
  }

  const { data: conversation, error: conversationError } = await args.db
    .from('conversations')
    .insert({
      account_id: args.accountId,
      user_id: args.ownerUserId,
      contact_id: contact.id,
    })
    .select('id')
    .single()
  if (conversationError || !conversation) {
    const { data: raced } = await args.db
      .from('conversations')
      .select('id')
      .eq('account_id', args.accountId)
      .eq('contact_id', contact.id)
      .order('created_at', { ascending: true })
      .limit(1)
    if (raced?.[0]?.id) {
      return { contactId: contact.id, conversationId: raced[0].id as string, createdConversation: false }
    }
    throw new Error('unable to create conversation: ' + (conversationError?.message ?? 'unknown error'))
  }

  return { contactId: contact.id, conversationId: conversation.id as string, createdConversation: true }
}

/** Cancel a pending abandoned-cart wait when the same checkout converts. */
export async function cancelPendingAbandonedCart(
  db: SupabaseClient,
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
    console.error('[automations] failed to cancel abandoned-cart wait:', error.message)
    return 0
  }
  return data?.length ?? 0
}
