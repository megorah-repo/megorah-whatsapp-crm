import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { consumeAuthRateLimit } from "@/lib/security/auth-rate-limit";
import { isAllowedEmail, normalizeEmail, readLimitedJson, sameOrigin } from "@/lib/security/input";

const GENERIC = { error: "Unable to process the request. If an account exists, you will receive reset instructions." };

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json(GENERIC, { status: 403 });
  const body = await readLimitedJson(request);
  const email = typeof body?.email === "string" ? normalizeEmail(body.email) : "";
  if (!isAllowedEmail(email)) return NextResponse.json(GENERIC, { status: 400 });

  const ipLimit = await consumeAuthRateLimit(request, "reset-ip");
  if (!ipLimit.allowed) return NextResponse.json(GENERIC, { status: 429, headers: { "Retry-After": String(ipLimit.retryAfterSeconds) } });
  const accountLimit = await consumeAuthRateLimit(request, "reset-account", email);
  if (!accountLimit.allowed) return NextResponse.json(GENERIC, { status: 429, headers: { "Retry-After": String(accountLimit.retryAfterSeconds) } });

  const supabase = await createClient();
  const redirectTo = `${new URL(request.url).origin}/auth/callback?next=/reset-password`;
  await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  return NextResponse.json({ ok: true });
}
