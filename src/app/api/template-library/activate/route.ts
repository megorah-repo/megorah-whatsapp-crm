import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse, UnauthorizedError, ForbiddenError } from '@/lib/auth/account'
import { decrypt } from '@/lib/whatsapp/encryption'
import { submitMessageTemplate } from '@/lib/whatsapp/meta-api'
import { buildMetaTemplatePayload } from '@/lib/whatsapp/template-components'
import { ensureImageHeaderHandle } from '@/lib/whatsapp/template-header-handle'
import { normalizeStatus } from '@/lib/whatsapp/template-status-normalize'
import { validateTemplatePayload } from '@/lib/whatsapp/template-validators'
import { buildLibraryMetaPayload, type CatalogActivationInput, type TemplateLibraryItem } from '@/lib/template-library'

function isDryRun() {
  return process.env.WHATSAPP_TEMPLATES_DRY_RUN === 'true' || process.env.WHATSAPP_TEMPLATES_DRY_RUN === '1'
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    let input: {
      catalog_template_id?: string
      brand_config?: CatalogActivationInput['brandConfig']
      header_media_url?: string
    }
    try {
      input = (await request.json()) as typeof input
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
    }

    if (!input.catalog_template_id) {
      return NextResponse.json({ error: 'catalog_template_id is required.' }, { status: 400 })
    }

    const { data: catalog, error: catalogError } = await supabase
      .from('template_catalog')
      .select('*')
      .eq('id', input.catalog_template_id)
      .eq('is_active', true)
      .maybeSingle()

    if (catalogError || !catalog) {
      return NextResponse.json({ error: 'Template library item not found.' }, { status: 404 })
    }

    const brandConfig = input.brand_config ?? { brand_name: '' }
    if (!brandConfig.brand_name?.trim()) {
      return NextResponse.json({ error: 'Brand name is required.' }, { status: 400 })
    }

    const { data: existing } = await supabase
      .from('message_templates')
      .select('id, status, meta_template_id, catalog_version, library_locked, brand_config')
      .eq('account_id', accountId)
      .eq('catalog_template_id', catalog.id)
      .eq('language', catalog.language)
      .maybeSingle()

    if (existing) {
      return NextResponse.json({
        success: true,
        already_active: true,
        connected: Boolean(existing.meta_template_id),
        template: existing,
      })
    }

    const item = catalog as TemplateLibraryItem
    const activationInput: CatalogActivationInput = {
      brandConfig,
      headerMediaUrl: input.header_media_url,
    }

    let built
    try {
      built = buildLibraryMetaPayload(item, activationInput)
      validateTemplatePayload(built.payload)
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Template configuration is invalid.' },
        { status: 400 },
      )
    }

    let status = 'DRAFT'
    let metaTemplateId: string | null = null
    let submissionError: string | null = null

    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', accountId)
      .maybeSingle()

    if (configError) {
      return NextResponse.json({ error: 'Unable to read WhatsApp configuration.' }, { status: 500 })
    }

    if (config?.waba_id && config.access_token) {
      if (isDryRun()) {
        metaTemplateId = `dry-run-${crypto.randomUUID()}`
        status = 'PENDING'
      } else {
        const accessToken = decrypt(config.access_token)
        try {
          await ensureImageHeaderHandle(built.payload, accessToken)
          const metaPayload = buildMetaTemplatePayload(built.payload)
          const meta = await submitMessageTemplate({
            wabaId: config.waba_id,
            accessToken,
            payload: metaPayload,
          })
          metaTemplateId = meta.id
          status = normalizeStatus(meta.status)
        } catch (error) {
          submissionError = error instanceof Error ? error.message : 'Meta submission failed.'
          status = 'DRAFT'
        }
      }
    }

    const { data: row, error: insertError } = await supabase
      .from('message_templates')
      .insert({
        account_id: accountId,
        user_id: userId,
        name: catalog.meta_name,
        category: 'Utility',
        language: catalog.language,
        header_type: built.payload.header_type ?? null,
        header_content: built.payload.header_content ?? null,
        header_media_url: built.payload.header_media_url ?? null,
        header_handle: built.payload.header_handle ?? null,
        body_text: built.payload.body_text,
        footer_text: built.payload.footer_text ?? null,
        buttons: built.payload.buttons ?? null,
        sample_values: built.payload.sample_values ?? null,
        status,
        meta_template_id: metaTemplateId,
        submission_error: submissionError,
        rejection_reason: null,
        catalog_template_id: catalog.id,
        catalog_version: catalog.version,
        library_locked: true,
        brand_config: brandConfig,
        activated_at: new Date().toISOString(),
        last_submitted_at: metaTemplateId ? new Date().toISOString() : null,
      })
      .select()
      .single()

    if (insertError) {
      if (metaTemplateId) {
        return NextResponse.json(
          {
            error: `Submitted to Meta but could not save the library activation locally: ${insertError.message}. Run Sync from Meta to recover.`,
            meta_template_id: metaTemplateId,
          },
          { status: 500 },
        )
      }
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }

    const connected = Boolean(config?.waba_id && config?.access_token)
    return NextResponse.json({
      success: true,
      connected,
      submitted_to_meta: Boolean(metaTemplateId),
      template: row,
      submission_error: submissionError,
      runtime_variables: built.runtimeKeys,
      dry_run: isDryRun(),
    })
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
      return toErrorResponse(error)
    }
    console.error('Template library activation failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Template activation failed.' },
      { status: 500 },
    )
  }
}
