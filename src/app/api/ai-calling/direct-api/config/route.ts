import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import {
  isSafePublicHttpsUrl,
  loadDirectCallingApiConfig,
  saveDirectCallingApiConfig,
  type DirectCallingAuthType,
} from '@/lib/ai-calling/direct-api-config'

const AUTH_TYPES = new Set<DirectCallingAuthType>(['bearer', 'x-api-key', 'authorization'])

export async function GET() {
  try {
    const { accountId } = await requireRole('admin')
    const config = await loadDirectCallingApiConfig(accountId)
    return NextResponse.json({
      configured: Boolean(config),
      provider_name: config?.providerName ?? null,
      api_url: config?.apiUrl ?? null,
      auth_type: config?.authType ?? 'bearer',
      caller_number: config?.callerNumber ?? null,
      last_verified_at: config?.lastVerifiedAt ?? null,
      last_error: config?.lastError ?? null,
      has_api_key: Boolean(config?.apiKey),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const { accountId } = await requireRole('admin')
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })

    const apiUrl = typeof body.api_url === 'string' ? body.api_url.trim() : ''
    const apiKey = typeof body.api_key === 'string' ? body.api_key.trim() : ''
    const callerNumber = typeof body.caller_number === 'string' ? body.caller_number.trim() : ''
    const providerName = typeof body.provider_name === 'string' ? body.provider_name.trim() : 'Direct Calls API'
    const authType = typeof body.auth_type === 'string' ? body.auth_type.trim() as DirectCallingAuthType : 'bearer'

    if (!isSafePublicHttpsUrl(apiUrl)) {
      return NextResponse.json({ error: 'Call API URL must be a public HTTPS URL.' }, { status: 400 })
    }
    if (!apiKey) return NextResponse.json({ error: 'API key is required.' }, { status: 400 })
    if (!AUTH_TYPES.has(authType)) {
      return NextResponse.json({ error: 'Unsupported API authentication type.' }, { status: 400 })
    }
    if (callerNumber && !/^\+[1-9]\d{7,14}$/.test(callerNumber.replace(/\s+/g, ''))) {
      return NextResponse.json({ error: 'Caller number must use E.164 format, e.g. +9198XXXXXXXX.' }, { status: 400 })
    }

    await saveDirectCallingApiConfig({
      accountId,
      providerName,
      apiUrl,
      apiKey,
      authType,
      callerNumber: callerNumber || null,
    })

    return NextResponse.json({
      ok: true,
      configured: true,
      provider_name: providerName || 'Direct Calls API',
      api_url: apiUrl,
      auth_type: authType,
      caller_number: callerNumber || null,
      connected_at: new Date().toISOString(),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
