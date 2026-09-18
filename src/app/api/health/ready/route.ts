import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/flows/admin-client";

/**
 * Production readiness probe.
 *
 * This intentionally checks a small set of schema objects that the current
 * application cannot boot safely without. It does not expose database errors
 * to callers; operators get the detail in server logs while the probe only
 * reports ready/not-ready.
 */
export async function GET() {
  const db = supabaseAdmin();
  const checks = [
    ["accounts", "id"],
    ["profiles", "user_id, account_id, account_role"],
    ["pipelines", "id, account_id"],
    ["automations", "id, account_id"],
    ["flows", "id, account_id"],
    ["rate_limit_buckets", "bucket_key"],
  ] as const;

  for (const [table, columns] of checks) {
    const { error } = await db.from(table).select(columns, { head: true }).limit(1);
    if (error) {
      console.error("[health/ready] schema check failed:", table, error.message);
      return NextResponse.json(
        { ready: false },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
  }

  return NextResponse.json(
    { ready: true },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}
