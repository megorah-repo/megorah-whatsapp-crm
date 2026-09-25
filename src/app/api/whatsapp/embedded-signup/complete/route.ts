import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { encrypt } from '@/lib/whatsapp/encryption'
import { verifyWhatsAppSetup, subscribeWabaToApp } from '@/lib/whatsapp/meta-api'

interface CompleteSignupBody {
  code?: unknown
  waba_id?: unknown
  phone_number_id?: unknown
  signup_event?: unknown
}

interface MetaTokenResponse {
  access_token?: string
  token_type?: string
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * POST /api/whatsapp/embedded-signup/complete
 *
 * Completes Meta Embedded Signup entirely server-side:
 * 1. Exchange Meta's short-lived authorization code for the customer's
 *    Business Integration System User token.
 * 2. Verify the returned WABA + phone number.
 * 3. Subscribe the WABA to this Meta app so inbound webhooks are delivered.
 * 4. Persist the encrypted token against the signed-in CRM account.
 *
 * The access token and app secret never return to the browser.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const appId = process.env.META_APP_ID?.trim()
    const appSecret = process.env.META_APP_SECRET?.trim()

    if (!appId || !appSecret) {
      return NextResponse.json(
        {
          error:
            'Embedded Signup is not configured on the CRM. META_APP_ID and META_APP_SECRET are required.',
        },
        { status: 503 },
      )
    }

    const webhookVerifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN?.trim()
    if (!webhookVerifyToken) {
      return NextResponse.json(
        {
          error:
            'Meta webhook verification is not configured. Set META_WEBHOOK_VERIFY_TOKEN once on the CRM server before onboarding customers.',
        },
        { status: 503 },
      )
    }

    let body: CompleteSignupBody
    try {
      body = (await request.json()) as CompleteSignupBody
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const code = asString(body.code)
    const wabaId = asString(body.waba_id)
    const phoneNumberId = asString(body.phone_number_id)
    const signupEvent = asString(body.signup_event)

    if (!code || !wabaId) {
      return NextResponse.json(
        {
          error:
            'Meta signup did not return the WABA ID and authorization code.',
        },
        { status: 400 },
      )
    }

    // Embedded Signup codes are short-lived and single-use. Exchange them
    // immediately and never log the code or resulting token.
    const tokenParams = new URLSearchParams({
      client_id: appId,
      client_secret: appSecret,
      code,
    })
    const tokenResponse = await fetch(
      `${process.env.META_GRAPH_API_VERSION ? `https://graph.facebook.com/${process.env.META_GRAPH_API_VERSION}` : 'https://graph.facebook.com/v26.0'}/oauth/access_token?${tokenParams.toString()}`,
      { method: 'GET', cache: 'no-store' },
    )

    if (!tokenResponse.ok) {
      let message = `Meta token exchange failed: ${tokenResponse.status}`
      try {
        const payload = await tokenResponse.json()
        if (payload?.error?.message) message = payload.error.message
      } catch {
        // Keep status-based message.
      }
      return NextResponse.json(
        { error: message, stage: 'token_exchange' },
        { status: 502 },
      )
    }

    const tokenPayload = (await tokenResponse.json()) as MetaTokenResponse
    const accessToken = asString(tokenPayload.access_token)
    if (!accessToken) {
      return NextResponse.json(
        {
          error: 'Meta completed authorization but returned no business access token.',
          stage: 'token_exchange',
        },
        { status: 502 },
      )
    }

    // In the normal FINISH event Meta sends both IDs. In the
    // WhatsApp Business App/Coexistence flow the phone_number_id can be
    // omitted, so discover it from the WABA instead of blocking onboarding.
    let resolvedPhoneNumberId = phoneNumberId
    if (!resolvedPhoneNumberId) {
      const phonesResponse = await fetch(
        `https://graph.facebook.com/${process.env.META_GRAPH_API_VERSION || 'v26.0'}/${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating&limit=100`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: 'no-store',
        },
      )

      if (!phonesResponse.ok) {
        let message = `Meta could not list phone numbers for WABA ${wabaId}: ${phonesResponse.status}`
        try {
          const payload = await phonesResponse.json()
          if (payload?.error?.message) message = payload.error.message
        } catch {
          // Keep the status-based message.
        }
        return NextResponse.json(
          { error: message, stage: 'phone_discovery' },
          { status: 502 },
        )
      }

      const phoneData = (await phonesResponse.json()) as {
        data?: Array<{ id?: string }>
      }
      const ids = (phoneData.data ?? [])
        .map((item) => asString(item.id))
        .filter(Boolean)

      if (ids.length !== 1) {
        return NextResponse.json(
          {
            error:
              ids.length === 0
                ? 'Meta completed onboarding but no WhatsApp phone number was returned for the connected WABA.'
                : 'Meta completed onboarding with multiple phone numbers. Select the intended WhatsApp number and reconnect.',
            stage: 'phone_discovery',
            phone_numbers: ids,
          },
          { status: 409 },
        )
      }

      resolvedPhoneNumberId = ids[0]
    }

    // Verify the exact asset pair before writing anything.
    const setup = await verifyWhatsAppSetup({
      phoneNumberId: resolvedPhoneNumberId,
      wabaId,
      accessToken,
    })

    // This is the WABA-level webhook subscription. It is idempotent and is
    // required so inbound messages/statuses reach the CRM.
    await subscribeWabaToApp({
      wabaId,
      accessToken,
    })

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle()

    if (profileError || !profile?.account_id) {
      return NextResponse.json(
        { error: 'Your CRM profile is not linked to an account.' },
        { status: 403 },
      )
    }

    const accountId = profile.account_id as string

    // Never allow one WhatsApp sender to silently attach to two CRM
    // accounts. The unique DB constraint is still the final guard.
    const { data: phoneOwner } = await supabase
      .from('whatsapp_config')
      .select('account_id')
      .eq('phone_number_id', resolvedPhoneNumberId)
      .maybeSingle()

    if (phoneOwner && phoneOwner.account_id !== accountId) {
      return NextResponse.json(
        {
          error:
            'This WhatsApp phone number is already connected to another CRM workspace.',
          stage: 'workspace_conflict',
        },
        { status: 409 },
      )
    }

    const now = new Date().toISOString()
    const { data: existing } = await supabase
      .from('whatsapp_config')
      .select('id')
      .eq('account_id', accountId)
      .maybeSingle()

    const row = {
      phone_number_id: resolvedPhoneNumberId,
      waba_id: wabaId,
      access_token: encrypt(accessToken),
      // Webhook verification is app-level in Meta. Store the same token
      // encrypted on this workspace for backward-compatible diagnostics.
      verify_token: encrypt(webhookVerifyToken),
      status: 'connected',
      connected_at: now,
      // Embedded Signup handles number registration during onboarding.
      // Coexistence returns a dedicated finish event and the number is
      // already registered, so /register must not be called again.
      registered_at: now,
      subscribed_apps_at: now,
      last_registration_error: null,
      updated_at: now,
    }

    let saveError: { message?: string } | null = null

    if (existing?.id) {
      const { error } = await supabase
        .from('whatsapp_config')
        .update(row)
        .eq('account_id', accountId)
      saveError = error
    } else {
      const { error } = await supabase
        .from('whatsapp_config')
        .insert({
          account_id: accountId,
          user_id: user.id,
          ...row,
        })
      saveError = error
    }

    if (saveError) {
      console.error('[whatsapp/embedded-signup] config save failed:', saveError.message)
      return NextResponse.json(
        {
          error: 'Meta connected successfully, but the CRM could not save the connection.',
          stage: 'database',
        },
        { status: 500 },
      )
    }

    return NextResponse.json({
      success: true,
      connected: true,
      waba_id: wabaId,
      phone_number_id: resolvedPhoneNumberId,
      signup_event: signupEvent || 'FINISH',
      phone_info: setup.phone,
      waba_info: setup.waba,
      registered: true,
      subscribed: true,
      message:
        'WhatsApp is connected. Meta webhooks are subscribed and the connection is now stored in this CRM workspace.',
    })
  } catch (error) {
    console.error('[whatsapp/embedded-signup] completion failed:', error)
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to complete Meta Embedded Signup',
        stage: 'meta_setup',
      },
      { status: 502 },
    )
  }
}
