import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Operational health endpoint.
 *
 * - DB check uses a lightweight Supabase query.
 * - Cache reports configuration state only unless a real cache adapter is
 *   wired in; an environment variable alone is never treated as a ping.
 * - Detailed diagnostics are intentionally not exposed to callers.
 */
export async function GET() {
  const startedAt = Date.now()
  let db: 'ok' | 'error' = 'error'
  const cache: 'configured' | 'unconfigured' =
    process.env.REDIS_URL || process.env.UPSTASH_REDIS_REST_URL
      ? 'configured'
      : 'unconfigured'

  try {
    const supabase = await createClient()
    const { error } = await supabase.from('profiles').select('id').limit(1)
    db = error ? 'error' : 'ok'
  } catch {
    db = 'error'
  }

  // The current application has no verified distributed-cache adapter, so
  // an in-memory cache must not be represented as a production health signal.
  const healthy = db === 'ok'
  const response = NextResponse.json(
    {
      status: healthy ? 'ok' : 'degraded',
      checks: { db, cache },
      latency_ms: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    },
    { status: healthy ? 200 : 503 }
  )

  response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  return response
}
