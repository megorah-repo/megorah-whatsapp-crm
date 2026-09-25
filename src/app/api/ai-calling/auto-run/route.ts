import { NextResponse } from 'next/server'
import { runAutoCalls } from '@/lib/ai-calling/auto-run'

export const dynamic = 'force-dynamic'

function authorized(request: Request): boolean {
  const configured = process.env.CRON_SECRET || process.env.AI_CALLING_CRON_SECRET
  if (!configured) return false
  const auth = request.headers.get('authorization') || ''
  const header = request.headers.get('x-cron-secret') || ''
  return auth === 'Bearer ' + configured || header === configured
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error:'Unauthorized.' },{status:401})
  try {
    const result = await runAutoCalls({ origin: new URL(request.url).origin })
    return NextResponse.json({ ok:true, ...result })
  } catch (err) {
    console.error('[ai-calling/auto-run] error:', err)
    return NextResponse.json({ error:'Auto-call worker failed.' },{status:500})
  }
}

export async function GET(request: Request) {
  return POST(request)
}
