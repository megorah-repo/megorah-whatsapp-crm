import { supabaseAdmin } from "@/lib/flows/admin-client";
import { refreshGoogleAccessToken } from "@/lib/calendar/google";

export async function getGoogleCalendarConnection(accountId: string) {
  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from("google_calendar_connections")
    .select("id, account_id, google_email, calendar_id, refresh_token, status, scope")
    .eq("account_id", accountId)
    .eq("status", "connected")
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
}

export async function getGoogleCalendarAccessToken(accountId: string) {
  const connection = await getGoogleCalendarConnection(accountId);
  if (!connection) throw new Error("Google Calendar is not connected.");

  const accessToken = await refreshGoogleAccessToken(connection.refresh_token);
  return { connection, accessToken };
}

