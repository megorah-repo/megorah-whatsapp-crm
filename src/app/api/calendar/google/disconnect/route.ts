import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/flows/admin-client";

export async function POST() {
  try {
    const ctx = await requireRole("admin");
    const { error } = await supabaseAdmin()
      .from("google_calendar_connections")
      .update({ status: "revoked" })
      .eq("account_id", ctx.accountId);

    if (error) throw new Error(error.message);
    return NextResponse.json({ success: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
