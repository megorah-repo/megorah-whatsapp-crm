import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { getGoogleCalendarAccessToken } from "@/lib/calendar/google-connection";
import { googleCalendarRequest } from "@/lib/calendar/google";

export async function GET(request: Request) {
  try {
    const ctx = await requireRole("viewer");
    const url = new URL(request.url);
    const from = url.searchParams.get("from") || new Date().toISOString();
    const to =
      url.searchParams.get("to") ||
      new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    const { connection, accessToken } = await getGoogleCalendarAccessToken(
      ctx.accountId,
    );

    const params = new URLSearchParams({
      timeMin: from,
      timeMax: to,
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "100",
    });

    const data = await googleCalendarRequest<{
      items?: Array<{
        id?: string;
        summary?: string;
        description?: string;
        start?: { dateTime?: string; date?: string };
        end?: { dateTime?: string; date?: string };
        htmlLink?: string;
        attendees?: Array<{
          email?: string;
          displayName?: string;
          responseStatus?: string;
        }>;
        conferenceData?: {
          entryPoints?: Array<{ entryPointType?: string; uri?: string }>;
        };
      }>;
    }>(
      accessToken,
      `/calendars/${encodeURIComponent(connection.calendar_id)}/events?${params.toString()}`,
    );

    const events = (data.items ?? []).map((event) => ({
      id: event.id ?? "",
      title: event.summary ?? "Meeting",
      description: event.description ?? "",
      start: event.start?.dateTime ?? event.start?.date ?? null,
      end: event.end?.dateTime ?? event.end?.date ?? null,
      htmlLink: event.htmlLink ?? null,
      meetLink:
        event.conferenceData?.entryPoints?.find(
          (point) => point.entryPointType === "video",
        )?.uri ?? null,
      attendees: event.attendees ?? [],
    }));

    return NextResponse.json({ events });
  } catch (error) {
    return toErrorResponse(error);
  }
}
