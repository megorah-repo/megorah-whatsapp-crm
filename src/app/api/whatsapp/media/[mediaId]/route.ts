import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getMediaUrl, downloadMedia } from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ mediaId: string }> }
) {
  try {
    const { mediaId } = await params

    if (!mediaId || mediaId.length > 256 || !/^[A-Za-z0-9._:-]+$/.test(mediaId)) {
      return NextResponse.json({ error: 'Invalid media ID' }, { status: 400 })
    }

    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle()
    const accountId = profile?.account_id as string | undefined
    if (profileError || !accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      )
    }

    // The media endpoint is intentionally account-scoped. A media ID by
    // itself is not an authorization grant: verify that the caller has a
    // readable message in this account carrying this Meta media ID before
    // asking Meta for the binary.
    const { data: message, error: messageError } = await supabase
      .from('messages')
      .select('id, conversation_id, conversations!inner(account_id)')
      .eq('media_id', mediaId)
      .eq('conversations.account_id', accountId)
      .limit(1)
      .maybeSingle()

    if (messageError || !message) {
      return NextResponse.json({ error: 'Media not found' }, { status: 404 })
    }

    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select('access_token')
      .eq('account_id', accountId)
      .single()

    if (configError || !config?.access_token) {
      return NextResponse.json({ error: 'WhatsApp not configured' }, { status: 400 })
    }

    const accessToken = decrypt(config.access_token)
    const mediaInfo = await getMediaUrl({ mediaId, accessToken })
    const { buffer, contentType } = await downloadMedia({
      downloadUrl: mediaInfo.url,
      accessToken,
    })

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': contentType || mediaInfo.mimeType || 'application/octet-stream',
        // CRM/customer media is sensitive. Never make it publicly cacheable.
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': 'inline',
      },
    })
  } catch (error) {
    console.error('Error in WhatsApp media GET:', error)
    return NextResponse.json({ error: 'Failed to fetch media' }, { status: 500 })
  }
}
