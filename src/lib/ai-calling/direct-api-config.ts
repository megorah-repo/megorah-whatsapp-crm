import { decrypt, encrypt } from '@/lib/whatsapp/encryption'
import { createServiceRoleClient } from '@/lib/supabase/service-role'

export type DirectCallingAuthType = 'bearer' | 'x-api-key' | 'authorization'

export interface DirectCallingApiConfig {
  accountId: string
  providerName: string
  apiUrl: string
  apiKey: string
  authType: DirectCallingAuthType
  callerNumber: string | null
  isActive: boolean
  lastVerifiedAt: string | null
  lastError: string | null
}

export function isSafePublicHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') return false
    const hostname = url.hostname.toLowerCase()
    if (
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.local') ||
      hostname === 'metadata.google.internal'
    ) return false
    if (
      hostname.startsWith('127.') ||
      hostname.startsWith('10.') ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('169.254.') ||
      hostname === '0.0.0.0'
    ) return false
    const parts = hostname.split('.').map(Number)
    if (
      parts.length === 4 &&
      parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ) {
      const a = parts[0]
      const b = parts[1]
      if (a === 127 || a === 10 || a === 0 || (a === 169 && b === 254) || (a === 192 && b === 168)) return false
      if (a === 172 && b >= 16 && b <= 31) return false
    }
    return true
  } catch {
    return false
  }
}

export async function loadDirectCallingApiConfig(accountId: string): Promise<DirectCallingApiConfig | null> {
  const db = createServiceRoleClient()
  const { data, error } = await db
    .from('ai_calling_direct_api_configs')
    .select('account_id, provider_name, api_url, api_key, auth_type, caller_number, is_active, last_verified_at, last_error')
    .eq('account_id', accountId)
    .maybeSingle()
  if (error) throw error
  if (!data || !data.is_active || !data.api_key || !data.api_url) return null
  return {
    accountId: data.account_id,
    providerName: data.provider_name,
    apiUrl: data.api_url,
    apiKey: decrypt(data.api_key),
    authType: data.auth_type as DirectCallingAuthType,
    callerNumber: data.caller_number,
    isActive: data.is_active,
    lastVerifiedAt: data.last_verified_at,
    lastError: data.last_error,
  }
}

export async function saveDirectCallingApiConfig(args: {
  accountId: string
  providerName?: string
  apiUrl: string
  apiKey: string
  authType?: DirectCallingAuthType
  callerNumber?: string | null
  lastError?: string | null
}) {
  const db = createServiceRoleClient()
  const { error } = await db.from('ai_calling_direct_api_configs').upsert({
    account_id: args.accountId,
    provider_name: args.providerName?.trim() || 'Direct Calls API',
    api_url: args.apiUrl.trim(),
    api_key: encrypt(args.apiKey),
    auth_type: args.authType ?? 'bearer',
    caller_number: args.callerNumber?.trim() || null,
    is_active: true,
    last_verified_at: args.lastError ? null : new Date().toISOString(),
    last_error: args.lastError ?? null,
  }, { onConflict: 'account_id' })
  if (error) throw error
}
