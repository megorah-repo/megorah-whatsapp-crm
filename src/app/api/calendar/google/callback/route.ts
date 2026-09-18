import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { getCurrentAccount } from "@/lib/auth/account";
import {
  encryptGoogleRefreshToken,
  exchangeGoogleCode,
  googleUserEmail,
} from "@/lib/calendar/google";
import { supabaseAdmin } from "@/lib/flows/admin-client";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  const cookieStore = await cookies();
  const expectedState =
    cookieStore.get("google_calendar_oauth_state")?.value ?? "";
  cookieStore.delete("google_calendar_oauth_state");

  if (error) {
    return NextResponse.redirect(
      new URL(
        "/calendar?google=error&reason=" + encodeURIComponent(error),
        url.origin,
      ),
    );
  }

  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(
      new URL("/calendar?google=error&reason=invalid_state", url.origin),
    );
  }

  try {
    const ctx = await getCurrentAccount();
    if (ctx.role !== "owner" && ctx.role !== "admin") {
      return NextResponse.redirect(
        new URL("/calendar?google=error&reason=forbidden", url.origin),
      );
    }

    const tokens = await exchangeGoogleCode(code);
    if (!tokens.refresh_token) {
      throw new Error(
        "Google did not return a refresh token. Reconnect and allow offline access.",
      );
    }

    if (!tokens.access_token) {
      throw new Error("Google did not return an access token.");
    }
    const email = await googleUserEmail(tokens.access_token);
    const admin = supabaseAdmin();

    const { data: existing } = await admin
      .from("google_calendar_connections")
      .select("refresh_token")
      .eq("account_id", ctx.accountId)
      .maybeSingle();

    const refreshToken = tokens.refresh_token
      ? encryptGoogleRefreshToken(tokens.refresh_token)
      : existing?.refresh_token;

    if (!refreshToken) {
      throw new Error("Google refresh token is unavailable.");
    }

    const { error: upsertError } = await admin
      .from("google_calendar_connections")
      .upsert(
        {
          account_id: ctx.accountId,
          connected_by_user_id: ctx.userId,
          google_email: email,
          calendar_id: "primary",
          refresh_token: refreshToken,
          scope: tokens.scope ?? null,
          status: "connected",
        },
        { onConflict: "account_id" },
      );

    if (upsertError) throw new Error(upsertError.message);

    return NextResponse.redirect(
      new URL("/calendar?google=connected", url.origin),
    );
  } catch (err) {
    console.error("[google-calendar/callback]", err);
    return NextResponse.redirect(
      new URL(
        "/calendar?google=error&reason=" +
          encodeURIComponent(
            err instanceof Error ? err.message : "oauth_failed",
          ),
        url.origin,
      ),
    );
  }
}
