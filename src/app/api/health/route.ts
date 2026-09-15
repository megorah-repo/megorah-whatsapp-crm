import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Operational health endpoint.
 *
 * - DB check uses a lightweight authenticated Supabase query.
 * - Cache is reported as unavailable unless an explicit cache backend is
 *   configured; we never claim an in-memory/local cache is production-safe.
 * - Detailed diagnostics are intentionally not exposed to callers.
 */
export async function GET() {
  const startedAt = Date.now()
  let db: 'ok' | 'error' = 'error'
  let cache: 'ok' | 'unconfigured' | 'error' = 'unconfigured'

  try {
    const supabase = await createClient()
    const { error } = await supabase.from('profiles').select('id').limit(1)
    db = error ? 'error' : 'ok'
  } catch {
    db = 'error'
  }

  // The current application does not have a verified distributed cache
  // adapter. Keep this explicit rather than reporting process-local state as
  // healthy in a multi-instance deployment.
  if (process.env.REDIS_URL || process.env.UPSTASH_REDIS_REST_URL) {
    cache = 'ok'
  }

  const healthy = db === 'ok' && cache !== 'error'
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
