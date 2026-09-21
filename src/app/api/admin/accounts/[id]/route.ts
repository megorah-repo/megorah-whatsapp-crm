import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin-client'
import { requirePlatformAdmin } from '@/lib/auth/platform-admin'

type Params = { params: Promise<{ id: string }> }

type Body = {
  onboarding?: {
    status?: 'not_started' | 'in_progress' | 'completed' | 'blocked'
    owner_assigned?: string | null
    whatsapp_connected?: boolean
    contacts_imported?: boolean
    templates_ready?: boolean
    team_invited?: boolean
    first_message_sent?: boolean
    notes?: string | null
  }
}

export async function POST(request: Request, { params }: Params) {
  const access = await requirePlatformAdmin()

  if (!access.authorized) {
    return NextResponse.json(
      { error: access.status === 401 ? 'Unauthorized' : 'Forbidden' },
      { status: access.status },
    )
  }

  const { id } = await params
  let body: Body

  try {
    body = (await request.json()) as Body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  try {
    const admin = createAdminClient()

    const { data: account, error: accountError } = await admin
      .from('accounts')
      .select('id,name')
      .eq('id', id)
      .maybeSingle()

    if (accountError) throw accountError
    if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

    if (body.onboarding) {
      const incoming = body.onboarding
      const patch = {
        account_id: id,
        status: incoming.status ?? 'not_started',
        owner_assigned: incoming.owner_assigned ?? null,
        whatsapp_connected: Boolean(incoming.whatsapp_connected),
        contacts_imported: Boolean(incoming.contacts_imported),
        templates_ready: Boolean(incoming.templates_ready),
        team_invited: Boolean(incoming.team_invited),
        first_message_sent: Boolean(incoming.first_message_sent),
        notes: incoming.notes ?? null,
        started_at:
          incoming.status && incoming.status !== 'not_started'
            ? new Date().toISOString()
            : null,
        completed_at:
          incoming.status === 'completed'
            ? new Date().toISOString()
            : null,
      }

      const { data: onboarding, error } = await admin
        .from('platform_onboarding')
        .upsert(patch, { onConflict: 'account_id' })
        .select('account_id,status,owner_assigned,whatsapp_connected,contacts_imported,templates_ready,team_invited,first_message_sent,notes,started_at,completed_at')
        .single()

      if (error) throw error
      return NextResponse.json({ account, onboarding })
    }

    return NextResponse.json({ account })
  } catch (error) {
    console.error('[admin/account] update failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update client settings' },
      { status: 500 },
    )
  }
}
