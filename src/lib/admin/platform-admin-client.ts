import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let adminClient: SupabaseClient | null = null;

/**
 * Platform-admin-only database client.
 *
 * This module is server-only and must only be reached after
 * requirePlatformAdmin(). The service role bypasses tenant RLS, which is
 * intentional here because the platform operator needs cross-account data.
 */
export function createPlatformAdminClient(): SupabaseClient {
  if (!adminClient) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !serviceRoleKey) {
      throw new Error("Platform admin database configuration is missing");
    }

    adminClient = createClient(url, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  return adminClient;
}
