import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { getGoogleCalendarAccessToken } from "@/lib/calendar/google-connection";
import { googleCalendarRequest } from "@/lib/calendar/google";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import { resolveConversationByPhone } from "@/lib/whatsapp/resolve-conversation";
import { sendMessageToConversation } from "@/lib/whatsapp/send-message";

function cleanText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function validEmail(value: string) {
  return !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validPhone(value: string) {
  return !value || /^\+?[1-9]\d{7,14}$/.test(value.replace(/[\s()-]/g, ""));
}
function normalizePhone(value: string) {
  return value.replace(/\D/g, "");
}

async function findOrCreateContact(
  admin: ReturnType<typeof supabaseAdmin>,
  accountId: string,
  userId: string,
  clientName: string,
  clientEmail: string,
  clientPhone: string,
) {
  const normalized = normalizePhone(clientPhone);
  let query = admin
    .from("contacts")
    .select("id, name, email, phone, phone_normalized")
    .eq("account_id", accountId)
    .limit(1);

  if (normalized) {
    query = query.eq("phone_normalized", normalized);
  } else if (clientEmail) {
    query = query.eq("email", clientEmail);
  } else {
    return null;
  }

  const { data: existing, error } = await query.maybeSingle();
  if (error && !String(error.message).includes("phone_normalized")) {
    throw new Error(error.message);
  }
  if (existing) return existing;

  const { data: created, error: createError } = await admin
    .from("contacts")
    .insert({
      user_id: userId,
      account_id: accountId,
      phone: clientPhone || clientEmail || "",
      name: clientName || null,
      email: clientEmail || null,
    })
    .select("id, name, email, phone")
    .single();

  if (createError || !created) {
    throw new Error(
      createError?.message || "Could not create the client contact.",
    );
  }
  return created;
}

async function syncBookingToPipeline(
  admin: ReturnType<typeof supabaseAdmin>,
  accountId: string,
  userId: string,
  bookingId: string,
  title: string,
  clientName: string,
  clientEmail: string,
  clientPhone: string,
  startsAt: Date,
  meetLink: string,
) {
  const contact = await findOrCreateContact(
    admin,
    accountId,
    userId,
    clientName,
    clientEmail,
    clientPhone,
  );
  if (!contact) return { contactId: null, dealId: null };

  const { data: existingDealLink } = await admin
    .from("calendar_bookings")
    .select("pipeline_deal_id")
    .eq("id", bookingId)
    .maybeSingle();

  if (existingDealLink?.pipeline_deal_id) {
    return { contactId: contact.id, dealId: existingDealLink.pipeline_deal_id };
  }

  const { data: pipeline, error: pipelineError } = await admin
    .from("pipelines")
    .select("id, name")
    .eq("account_id", accountId)
    .order("created_at")
    .limit(1)
    .maybeSingle();

  if (pipelineError) throw new Error(pipelineError.message);
  if (!pipeline) return { contactId: contact.id, dealId: null };

  const { data: stages, error: stageError } = await admin
    .from("pipeline_stages")
    .select("id, name, position")
    .eq("pipeline_id", pipeline.id)
    .order("position");

  if (stageError) throw new Error(stageError.message);

  let meetingStage =
    stages?.find((stage) =>
      /meeting|appointment|scheduled/i.test(stage.name),
    ) ?? stages?.find((stage) => /new lead|new/i.test(stage.name));

  if (!meetingStage) {
    const nextPosition =
      (stages ?? []).reduce((max, stage) => Math.max(max, stage.position ?? 0), 0) + 1;
    const { data: createdStage, error: createStageError } = await admin
      .from("pipeline_stages")
      .insert({
        pipeline_id: pipeline.id,
        name: "Meeting Booked",
        position: nextPosition,
        color: "#22c55e",
      })
      .select("id, name, position")
      .single();

    if (createStageError || !createdStage) {
      throw new Error(
        createStageError?.message || "Could not create the Meeting Booked stage.",
      );
    }
    meetingStage = createdStage;
  }

  const dealTitle = clientName
    ? `Meeting — ${clientName}`
    : title || "Meeting";

  const notes = [
    "Automatically created from Calendar.",
    clientEmail ? `Email: ${clientEmail}` : "",
    clientPhone ? `WhatsApp: ${clientPhone}` : "",
    `Meeting: ${startsAt.toISOString()}`,
    `Google Meet: ${meetLink}`,
  ]
    .filter(Boolean)
    .join("\n");

  const { data: deal, error: dealError } = await admin
    .from("deals")
    .insert({
      account_id: accountId,
      user_id: userId,
      pipeline_id: pipeline.id,
      stage_id: meetingStage.id,
      contact_id: contact.id,
      title: dealTitle,
      value: 0,
      currency: "INR",
      notes,
      expected_close_date: startsAt.toISOString().slice(0, 10),
      status: "open",
    })
    .select("id")
    .single();

  if (dealError) {
    // A concurrent retry can reach the same booking. In that case we
    // leave the booking without a link rather than manufacturing duplicates.
    console.error("[calendar/book] pipeline deal creation failed:", dealError.message);
    return { contactId: contact.id, dealId: null };
  }

  await admin
    .from("calendar_bookings")
    .update({
      contact_id: contact.id,
      pipeline_deal_id: deal.id,
    })
    .eq("id", bookingId);

  return { contactId: contact.id, dealId: deal.id };
}


function formatReminder(
  name: string,
  startIso: string,
  timezone: string,
  meetLink: string,
) {
  const date = new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(startIso));

  return [
    `Hi ${name || "there"}, your meeting is confirmed.`,
    "",
    `📅 ${date} (${timezone})`,
    `🔗 Google Meet: ${meetLink}`,
    "",
    "Please join a few minutes early. See you soon!",
  ].join("\n");
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("agent");
    const body = (await request.json()) as Record<string, unknown>;

    const title = cleanText(body.title, 160);
    const clientName = cleanText(body.client_name, 120);
    const clientEmail = cleanText(body.client_email, 180);
    const clientPhone = cleanText(body.client_phone, 30);
    const startsAt = cleanText(body.starts_at, 100);
    const endsAt = cleanText(body.ends_at, 100);
    const timezone = cleanText(body.timezone, 80) || "Asia/Kolkata";
    const sendWhatsapp = body.send_whatsapp !== false;
    const reminder24h = body.reminder_24h !== false;
    const reminder1h = body.reminder_1h !== false;

    if (!title || !startsAt || !endsAt) {
      return NextResponse.json(
        { error: "title, starts_at and ends_at are required" },
        { status: 400 },
      );
    }

    if (!validEmail(clientEmail)) {
      return NextResponse.json({ error: "Invalid client email" }, { status: 400 });
    }

    if (!validPhone(clientPhone)) {
      return NextResponse.json({ error: "Invalid client phone" }, { status: 400 });
    }

    const start = new Date(startsAt);
    const end = new Date(endsAt);
    if (
      !Number.isFinite(start.getTime()) ||
      !Number.isFinite(end.getTime()) ||
      end <= start
    ) {
      return NextResponse.json({ error: "Invalid meeting time" }, { status: 400 });
    }

    const { connection, accessToken } = await getGoogleCalendarAccessToken(
      ctx.accountId,
    );

    const attendees = clientEmail
      ? [{ email: clientEmail, displayName: clientName || undefined }]
      : undefined;

    const event = await googleCalendarRequest<{
      id: string;
      htmlLink?: string;
      summary?: string;
      conferenceData?: {
        entryPoints?: Array<{ entryPointType?: string; uri?: string }>;
      };
    }>(
      accessToken,
      `/calendars/${encodeURIComponent(connection.calendar_id)}/events?conferenceDataVersion=1&sendUpdates=all`,
      {
        method: "POST",
        body: JSON.stringify({
          summary: title,
          description: [
            `Client: ${clientName || "—"}`,
            clientEmail ? `Email: ${clientEmail}` : "",
            clientPhone ? `Phone: ${clientPhone}` : "",
            "",
            "Booked from Megorah CRM.",
          ]
            .filter(Boolean)
            .join("\n"),
          start: { dateTime: start.toISOString(), timeZone: timezone },
          end: { dateTime: end.toISOString(), timeZone: timezone },
          attendees,
          reminders: {
            useDefault: false,
            overrides: [
              { method: "email", minutes: 24 * 60 },
              { method: "popup", minutes: 30 },
            ],
          },
          conferenceData: {
            createRequest: {
              requestId: crypto.randomUUID(),
              conferenceSolutionKey: { type: "hangoutsMeet" },
            },
          },
        }),
      },
    );

    let meetLink =
      event.conferenceData?.entryPoints?.find(
        (point) => point.entryPointType === "video",
      )?.uri ?? null;

    // Google may return conferenceData asynchronously with a pending
    // status. Poll the event briefly so a valid booking is not failed
    // simply because Meet generation needs another moment.
    if (!meetLink) {
      for (let attempt = 0; attempt < 5 && !meetLink; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const latest = await googleCalendarRequest<{
          conferenceData?: {
            entryPoints?: Array<{ entryPointType?: string; uri?: string }>;
          };
        }>(
          accessToken,
          `/calendars/${encodeURIComponent(connection.calendar_id)}/events/${encodeURIComponent(event.id)}`,
        );
        meetLink =
          latest.conferenceData?.entryPoints?.find(
            (point) => point.entryPointType === "video",
          )?.uri ?? null;
      }
    }

    if (!meetLink) {
      throw new Error(
        "Google Calendar created the event, but Google Meet generation is still pending. Refresh the Calendar panel in a moment.",
      );
    }

    const admin = supabaseAdmin();
    const { data: booking, error: bookingError } = await admin
      .from("calendar_bookings")
      .insert({
        account_id: ctx.accountId,
        created_by_user_id: ctx.userId,
        google_event_id: event.id,
        google_html_link: event.htmlLink ?? null,
        google_meet_link: meetLink,
        title,
        client_name: clientName || null,
        client_email: clientEmail || null,
        client_phone: clientPhone || null,
        starts_at: start.toISOString(),
        ends_at: end.toISOString(),
        timezone,
      })
      .select(
        "id, google_event_id, google_html_link, google_meet_link, title, client_name, client_email, client_phone, starts_at, ends_at, timezone",
      )
      .single();

    if (bookingError || !booking) {
      throw new Error(
        `Google meeting created but CRM booking could not be saved: ${bookingError?.message ?? "unknown database error"}`,
      );
    }

    let pipelineSync: { contactId: string | null; dealId: string | null } = {
      contactId: null,
      dealId: null,
    };

    try {
      pipelineSync = await syncBookingToPipeline(
        admin,
        ctx.accountId,
        ctx.userId,
        booking.id,
        title,
        clientName,
        clientEmail,
        clientPhone,
        start,
        meetLink,
      );
    } catch (error) {
      console.error("[calendar/book] pipeline sync failed:", error);
    }

    const reminderRows = [24 * 60, 60]
      .filter((offset) => (offset === 24 * 60 ? reminder24h : reminder1h))
      .map((offset) => ({
        account_id: ctx.accountId,
        booking_id: booking.id,
        contact_id: pipelineSync.contactId,
        channel: "whatsapp",
        offset_minutes: offset,
        remind_at: new Date(
          start.getTime() - offset * 60 * 1000,
        ).toISOString(),
        status: "pending",
      }))
      .filter((row) => new Date(row.remind_at).getTime() > Date.now());

    if (reminderRows.length > 0 && sendWhatsapp && clientPhone) {
      const { error: reminderError } = await admin
        .from("calendar_reminders")
        .upsert(reminderRows, {
          onConflict: "booking_id,channel,offset_minutes",
        });

      if (reminderError) {
        console.error("[calendar/book] reminder scheduling failed:", reminderError.message);
      }
    }

    let whatsappSent = false;
    let whatsappError: string | null = null;
    let whatsappMessageId: string | null = null;

    if (sendWhatsapp && clientPhone) {
      try {
        const resolved = await resolveConversationByPhone(
          ctx.supabase,
          ctx.accountId,
          clientPhone,
          clientName || null,
        );

        const result = await sendMessageToConversation(
          ctx.supabase,
          ctx.accountId,
          {
            conversationId: resolved.conversationId,
            messageType: "text",
            contentText: formatReminder(
              clientName,
              start.toISOString(),
              timezone,
              meetLink,
            ),
          },
        );

        whatsappSent = true;
        whatsappMessageId = result.whatsappMessageId;

        await admin
          .from("calendar_bookings")
          .update({
            whatsapp_sent: true,
            whatsapp_message_id: whatsappMessageId,
            whatsapp_error: null,
          })
          .eq("id", booking.id);
      } catch (error) {
        whatsappError =
          error instanceof Error
            ? error.message
            : "WhatsApp reminder could not be sent";

        await admin
          .from("calendar_bookings")
          .update({ whatsapp_error: whatsappError })
          .eq("id", booking.id);
      }
    }

    return NextResponse.json({
      success: true,
      booking: {
        ...booking,
        contact_id: pipelineSync.contactId,
        pipeline_deal_id: pipelineSync.dealId,
        whatsapp_sent: whatsappSent,
        whatsapp_message_id: whatsappMessageId,
        whatsapp_error: whatsappError,
      },
      pipeline: {
        synced: Boolean(pipelineSync.dealId),
        dealId: pipelineSync.dealId,
      },
      clientReminder: formatReminder(
        clientName,
        start.toISOString(),
        timezone,
        meetLink,
      ),
    });
  } catch (error) {
    console.error("[calendar/book]", error);
    return toErrorResponse(error);
  }
}
