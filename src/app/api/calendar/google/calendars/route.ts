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
