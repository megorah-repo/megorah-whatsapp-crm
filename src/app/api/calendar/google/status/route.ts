import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { getGoogleCalendarConnection } from "@/lib/calendar/google-connection";

export async function GET() {
  try {
    const ctx = await requireRole("viewer");
    const configured = Boolean(
      process.env.GOOGLE_CALENDAR_CLIENT_ID?.trim() &&
        process.env.GOOGLE_CALENDAR_CLIENT_SECRET?.trim(),
    );

    if (!configured) {
      return NextResponse.json({
        configured: false,
        connected: false,
        email: null,
        calendarId: null,
      });
    }

    const connection = await getGoogleCalendarConnection(ctx.accountId);
    return NextResponse.json({
      connected: Boolean(connection),
      email: connection?.google_email ?? null,
      calendarId: connection?.calendar_id ?? null,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
