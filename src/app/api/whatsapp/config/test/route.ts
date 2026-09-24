import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyPhoneNumber } from '@/lib/whatsapp/meta-api'

/**
 * POST /api/whatsapp/config/test
 *
 * Verify credentials supplied by the user without saving them.
 * This lets a new workspace test its Phone Number ID + Access Token
 * before committing configuration to the database.
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

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const payload = body as {
      phone_number_id?: unknown
      access_token?: unknown
    }

    const phoneNumberId =
      typeof payload.phone_number_id === 'string'
        ? payload.phone_number_id.trim()
        : ''
    const accessToken =
      typeof payload.access_token === 'string'
        ? payload.access_token.trim()
        : ''

    if (!phoneNumberId || !accessToken) {
      return NextResponse.json(
        { error: 'Phone Number ID and Access Token are required.' },
        { status: 400 }
      )
    }

    try {
      const phoneInfo = await verifyPhoneNumber({
        phoneNumberId,
        accessToken,
      })

      return NextResponse.json({
        success: true,
        connected: true,
        phone_info: phoneInfo,
      })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown Meta API error'

      console.error(
        '[whatsapp/config/test] Meta API verification failed:',
        message
      )

      return NextResponse.json(
        {
          success: false,
          connected: false,
          reason: 'meta_api_error',
          error: `Meta API rejected the credentials: ${message}`,
        },
        { status: 400 }
      )
    }
  } catch (error) {
    console.error('[whatsapp/config/test] Unexpected error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
