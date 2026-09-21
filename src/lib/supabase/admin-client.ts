import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL } from './config'

let adminClient: ReturnType<typeof createClient> | undefined

export function createAdminClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured')
  }

  if (!adminClient) {
    adminClient = createClient(SUPABASE_URL, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })
  }

  return adminClient
}
