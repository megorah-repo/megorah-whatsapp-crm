import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { buildGoogleCalendarAuthUrl } from "@/lib/calendar/google";

export async function GET(request: Request) {
  try {
    await requireRole("admin");
    const state = randomUUID();
    const cookieStore = await cookies();
    cookieStore.set("google_calendar_oauth_state", state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 600,
      path: "/api/calendar/google/callback",
    });
    return NextResponse.redirect(\n      buildGoogleCalendarAuthUrl(state, new URL(request.url).origin),\n    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
