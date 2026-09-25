import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { runAutoCalls } from '@/lib/ai-calling/auto-run'

export async function PATCH(
  request: Request,
  context: { params: Promise<{ campaignId: string }> },
) {
  try {
    const { accountId } = await requireRole('admin')
    const { campaignId } = await context.params
    const body = await request.json().catch(() => ({}))
    const action = body.status === 'running' ? 'running' : body.status === 'paused' ? 'paused' : null
    if (!action) return NextResponse.json({ error:'status must be running or paused.' },{status:400})

    const db = createServiceRoleClient()
    const { data: campaign } = await db
      .from('ai_call_campaigns')
      .select('id,status')
      .eq('id',campaignId)
      .eq('account_id',accountId)
      .maybeSingle()
    if (!campaign) return NextResponse.json({ error:'Campaign not found.' },{status:404})
    if (campaign.status === 'completed') return NextResponse.json({ error:'Completed campaigns cannot be restarted.' },{status:400})

    const patch = action === 'running'
      ? { status:'running', started_at:new Date().toISOString(), paused_at:null }
      : { status:'paused', paused_at:new Date().toISOString() }
    const { error } = await db.from('ai_call_campaigns').update(patch).eq('id',campaignId).eq('account_id',accountId)
    if (error) return NextResponse.json({ error:'Could not update campaign.' },{status:500})

    let run = null
    if (action === 'running' && body.run_now === true) {
      run = await runAutoCalls({ accountId, campaignId, origin: new URL(request.url).origin })
    }
    return NextResponse.json({ ok:true, status:action, run })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ campaignId: string }> },
) {
  try {
    const { accountId } = await requireRole('admin')
    const { campaignId } = await context.params
    const db = createServiceRoleClient()
    const { data: campaign } = await db.from('ai_call_campaigns').select('id,status').eq('id',campaignId).eq('account_id',accountId).maybeSingle()
    if (!campaign) return NextResponse.json({ error:'Campaign not found.' },{status:404})
    if (['running','placing','in-progress'].includes(campaign.status)) return NextResponse.json({ error:'Pause the campaign before deleting it.' },{status:400})
    const { error } = await db.from('ai_call_campaigns').delete().eq('id',campaignId).eq('account_id',accountId)
    if (error) return NextResponse.json({ error:'Could not delete campaign.' },{status:500})
    return NextResponse.json({ ok:true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
