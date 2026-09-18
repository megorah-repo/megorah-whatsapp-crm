import { NextResponse } from "next/server";
import { randomUUID, timingSafeEqual } from "node:crypto";

import { supabaseAdmin } from "@/lib/flows/admin-client";
import { resolveConversationByPhone } from "@/lib/whatsapp/resolve-conversation";
import { sendMessageToConversation } from "@/lib/whatsapp/send-message";

function authorized(request: Request) {
  const expected =
    process.env.CALENDAR_REMINDER_WORKER_SECRET ||
    process.env.CRON_SECRET ||
    "";
  const supplied =
    request.headers.get("x-cron-secret")?.trim() ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ||
    "";

  if (!expected || !supplied) return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function reminderText(
  clientName: string,
  title: string,
  startsAt: string,
  timezone: string,
  meetLink: string,
  hours: number,
) {
  const when = new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(startsAt));

  return [
    `Hi ${clientName || "there"}, this is a reminder for your Megorah meeting.`,
    "",
    `📌 ${title}`,
    `🕒 ${when} (${timezone})`,
    hours >= 12
      ? "⏰ Your meeting is tomorrow."
      : "⏰ Your meeting starts soon.",
    `🔗 Google Meet: ${meetLink}`,
    "",
    "See you there!",
  ].join("\n");
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = supabaseAdmin();
  const workerId = randomUUID();

  const { data: reminders, error: claimError } = await admin.rpc(
    "claim_calendar_reminders",
    {
      p_worker_id: workerId,
      p_limit: 25,
    },
  );

  if (claimError) {
    console.error("[calendar-reminder-worker] claim failed:", claimError);
    return NextResponse.json(
      { error: "Reminder worker unavailable" },
      { status: 500 },
    );
  }

  let sent = 0;
  let retried = 0;
  let failed = 0;

  for (const row of (reminders ?? []) as Array<{
    reminder_id: string;
    booking_id: string;
    contact_id: string | null;
    account_id: string;
    attempts: number;
  }>) {
    try {
      const { data: booking, error: bookingError } = await admin
        .from("calendar_bookings")
        .select(
          "id, client_name, client_phone, title, starts_at, timezone, google_meet_link",
        )
        .eq("id", row.booking_id)
        .maybeSingle();

      if (bookingError || !booking) {
        throw new Error(
          bookingError?.message || "Calendar booking not found.",
        );
      }

      if (!booking.client_phone) {
        throw new Error("Client has no WhatsApp number for reminder.");
      }

      const conversation = await resolveConversationByPhoneWithAdmin(
        admin,
        row.account_id,
        booking.client_phone,
        booking.client_name,
      );

      const result = await sendMessageToConversation(
        admin,
        row.account_id,
        {
          conversationId: conversation.conversationId,
          messageType: "text",
          contentText: reminderText(
            booking.client_name || "",
            booking.title,
            booking.starts_at,
            booking.timezone,
            booking.google_meet_link,
            Math.max(
              0,
              Math.round(
                (new Date(booking.starts_at).getTime() - Date.now()) / 3600000,
              ),
            ),
          ),
        },
      );

      const { error: completeError } = await admin.rpc(
        "complete_calendar_reminder",
        {
          p_reminder_id: row.reminder_id,
          p_worker_id: workerId,
          p_whatsapp_message_id: result.whatsappMessageId,
        },
      );

      if (completeError) throw new Error(completeError.message);
      sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const shouldRetry = row.attempts < 5;
      const delayMinutes = Math.min(
        60,
        5 * Math.pow(2, Math.max(0, row.attempts - 1)),
      );

      const { error: failError } = await admin.rpc(
        "fail_calendar_reminder",
        {
          p_reminder_id: row.reminder_id,
          p_worker_id: workerId,
          p_error: message,
          p_retry: shouldRetry,
          p_run_at: new Date(
            Date.now() + delayMinutes * 60 * 1000,
          ).toISOString(),
        },
      );

      if (failError) {
        console.error(
          "[calendar-reminder-worker] failed to persist reminder failure:",
          failError,
        );
      }

      if (shouldRetry) retried += 1;
      else failed += 1;

      console.error("[calendar-reminder-worker] reminder failed:", {
        reminderId: row.reminder_id,
        attempts: row.attempts,
        error: message,
      });
    }
  }

  return NextResponse.json({
    claimed: reminders?.length ?? 0,
    sent,
    retried,
    failed,
  });
}

export async function POST(request: Request) {
  return GET(request);
}

async function resolveConversationByPhoneWithAdmin(
  admin: ReturnType<typeof supabaseAdmin>,
  accountId: string,
  phone: string,
  name: string | null,
) {
  // Use the normal resolver through an admin-created Supabase client only
  // to keep the reminder worker server-side and account-scoped.
  return resolveConversationByPhone(
    admin,
    accountId,
    phone,
    name || null,
  );
}
