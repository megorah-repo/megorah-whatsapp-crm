import { decrypt, encrypt } from "@/lib/whatsapp/encryption";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const CALENDAR_LIST_SCOPE =
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly";

function env(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

export function googleCalendarRedirectUri(fallbackOrigin?: string) {
  const explicit = process.env.GOOGLE_CALENDAR_REDIRECT_URI?.trim();
  if (explicit) return explicit;

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "");
  const origin = siteUrl || fallbackOrigin?.trim().replace(/\/$/, "");
  if (!origin) {
    throw new Error(
      "Set GOOGLE_CALENDAR_REDIRECT_URI or NEXT_PUBLIC_SITE_URL before connecting Google Calendar.",
    );
  }
  return origin + "/api/calendar/google/callback";
}

export function buildGoogleCalendarAuthUrl(
  state: string,
  fallbackOrigin?: string,
) {
  const params = new URLSearchParams({
    client_id: env("GOOGLE_CALENDAR_CLIENT_ID"),
    redirect_uri: googleCalendarRedirectUri(fallbackOrigin),
    response_type: "code",
    access_type: "offline",
    // Google only asks for consent when it is actually needed.
    // login_hint below can also prefill the configured business account.
    include_granted_scopes: "true",
    state,
    scope: ["openid", "email", CALENDAR_SCOPE, CALENDAR_LIST_SCOPE].join(" "),
    ...(process.env.GOOGLE_CALENDAR_LOGIN_HINT?.trim()
      ? { login_hint: process.env.GOOGLE_CALENDAR_LOGIN_HINT.trim() }
      : {}),
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export async function exchangeGoogleCode(\n  code: string,\n  fallbackOrigin?: string,\n) {
  const body = new URLSearchParams({
    code,
    client_id: env("GOOGLE_CALENDAR_CLIENT_ID"),
    client_secret: env("GOOGLE_CALENDAR_CLIENT_SECRET"),
    redirect_uri: googleCalendarRedirectUri(fallbackOrigin),
    grant_type: "authorization_code",
  });

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });

  const data = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    scope?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !data.access_token) {
    throw new Error(
      data.error_description || data.error || "Google OAuth token exchange failed",
    );
  }

  return data;
}

export async function refreshGoogleAccessToken(refreshToken: string) {
  const body = new URLSearchParams({
    client_id: env("GOOGLE_CALENDAR_CLIENT_ID"),
    client_secret: env("GOOGLE_CALENDAR_CLIENT_SECRET"),
    refresh_token: decrypt(refreshToken),
    grant_type: "refresh_token",
  });

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });

  const data = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !data.access_token) {
    throw new Error(
      data.error_description || data.error || "Google Calendar token refresh failed",
    );
  }

  return data.access_token;
}

export async function googleUserEmail(accessToken: string) {
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!response.ok) return null;
  const data = (await response.json()) as { email?: string };
  return data.email ?? null;
}

export function encryptGoogleRefreshToken(refreshToken: string) {
  return encrypt(refreshToken);
}

export async function googleCalendarRequest<T>(
  accessToken: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${CALENDAR_API}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  const data = (await response.json().catch(() => null)) as
    | T
    | { error?: { message?: string } }
    | null;

  if (!response.ok) {
    const message =
      typeof data === "object" &&
      data &&
      "error" in data &&
      data.error &&
      typeof data.error === "object"
        ? data.error.message
        : undefined;
    throw new Error(message || `Google Calendar request failed (${response.status})`);
  }

  return data as T;
}
