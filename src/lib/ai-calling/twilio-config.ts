import { decrypt, encrypt } from '@/lib/whatsapp/encryption'
import { createServiceRoleClient } from '@/lib/supabase/service-role'

export interface TwilioCallingConfig {
  accountId: string
  accountSid: string
  authToken: string
  callerNumber: string | null
  isActive: boolean
  lastVerifiedAt: string | null
  lastError: string | null
}

export function getTwilioAuthHeader(accountSid: string, authToken: string): string {
  return (
    'Basic ' +
    Buffer.from(`${accountSid}:${authToken}`).toString('base64')
  )
}

export async function loadTwilioCallingConfig(
  accountId: string,
): Promise<TwilioCallingConfig | null> {
  const db = createServiceRoleClient()
  const { data, error } = await db
    .from('ai_calling_twilio_configs')
    .select(
      'account_id, account_sid, auth_token, caller_number, is_active, last_verified_at, last_error',
    )
    .eq('account_id', accountId)
    .maybeSingle()

  if (error) throw error
  if (!data || !data.is_active || !data.auth_token) return null

  return {
    accountId: data.account_id,
    accountSid: data.account_sid,
    authToken: decrypt(data.auth_token),
    callerNumber: data.caller_number,
    isActive: data.is_active,
    lastVerifiedAt: data.last_verified_at,
    lastError: data.last_error,
  }
}

export async function saveTwilioCallingConfig(args: {
  accountId: string
  accountSid: string
  authToken: string
  callerNumber?: string | null
  lastError?: string | null
}) {
  const db = createServiceRoleClient()
  const { error } = await db.from('ai_calling_twilio_configs').upsert(
    {
      account_id: args.accountId,
      account_sid: args.accountSid,
      auth_token: encrypt(args.authToken),
      caller_number: args.callerNumber ?? null,
      is_active: true,
      last_verified_at: args.lastError ? null : new Date().toISOString(),
      last_error: args.lastError ?? null,
    },
    { onConflict: 'account_id' },
  )
  if (error) throw error
}
