import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { getGoogleCalendarAccessToken } from "@/lib/calendar/google-connection";
import { googleCalendarRequest } from "@/lib/calendar/google";

type CalendarListResponse = {
  items?: Array<{
    id: string;
    summary?: string;
    description?: string;
    primary?: boolean;
    selected?: boolean;
    accessRole?: string;
    timeZone?: string;
  }>;
};

export async function GET() {
  try {
    const ctx = await requireRole("viewer");
    const { accessToken } = await getGoogleCalendarAccessToken(ctx.accountId);

    const data = await googleCalendarRequest<CalendarListResponse>(
      accessToken,
      "/users/me/calendarList?maxResults=100&showDeleted=false",
    );

    return NextResponse.json({
      calendars: (data.items ?? [])
        .filter((calendar) => calendar.id && calendar.accessRole !== "freeBusyReader")
        .map((calendar) => ({
          id: calendar.id,
          name: calendar.summary || calendar.id,
          primary: Boolean(calendar.primary),
          selected: Boolean(calendar.selected),
          timeZone: calendar.timeZone || null,
        })),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const ctx = await requireRole("admin");
    const body = (await request.json()) as { calendar_id?: unknown };
    const calendarId =
      typeof body.calendar_id === "string" ? body.calendar_id.trim() : "";

    if (!calendarId || calendarId.length > 300) {
      return NextResponse.json(
        { error: "A valid calendar_id is required." },
        { status: 400 },
      );
    }

    const { accessToken } = await getGoogleCalendarAccessToken(ctx.accountId);

    // Verify the selected calendar belongs to the connected Google account.
    await googleCalendarRequest(
      accessToken,
      `/calendars/${encodeURIComponent(calendarId)}`,
    );

    const { supabaseAdmin } = await import("@/lib/flows/admin-client");
    const { error } = await supabaseAdmin()
      .from("google_calendar_connections")
      .update({ calendar_id: calendarId })
      .eq("account_id", ctx.accountId);

    if (error) throw new Error(error.message);

    return NextResponse.json({ success: true, calendarId });
  } catch (error) {
    return toErrorResponse(error);
  }
}
