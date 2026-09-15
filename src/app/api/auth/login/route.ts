import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { consumeAuthRateLimit } from "@/lib/security/auth-rate-limit";
import { authErrorBody, isAllowedEmail, isPassword, normalizeEmail, readLimitedJson, sameOrigin } from "@/lib/security/input";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json(authErrorBody(), { status: 403 });
  const body = await readLimitedJson(request);
  const email = typeof body?.email === "string" ? normalizeEmail(body.email) : "";
  const password = body?.password;
  if (!isAllowedEmail(email) || !isPassword(password)) {
    return NextResponse.json(authErrorBody(), { status: 400 });
  }

  const ipLimit = await consumeAuthRateLimit(request, "login-ip");
  if (!ipLimit.allowed) {
    return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 503, headers: { "Retry-After": String(ipLimit.retryAfterSeconds) } });
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    const accountLimit = await consumeAuthRateLimit(request, "login-account", email);
    if (!accountLimit.allowed) {
      return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429, headers: { "Retry-After": String(accountLimit.retryAfterSeconds) } });
    }
    return NextResponse.json(authErrorBody(), { status: 401 });
  }

  return NextResponse.json({ ok: true });
}
