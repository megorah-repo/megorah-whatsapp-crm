import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { consumeAuthRateLimit } from "@/lib/security/auth-rate-limit";
import { authErrorBody, isAllowedEmail, isPassword, isSafeInviteToken, isSafeName, normalizeEmail, readLimitedJson, sameOrigin } from "@/lib/security/input";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json(authErrorBody(), { status: 403 });
  const body = await readLimitedJson(request);
  const email = typeof body?.email === "string" ? normalizeEmail(body.email) : "";
  const password = body?.password;
  const fullName = typeof body?.fullName === "string" ? body.fullName.trim() : "";
  const inviteToken = body?.inviteToken;
  if (!isAllowedEmail(email) || !isPassword(password) || password.length < 8 || !isSafeName(fullName) || !isSafeInviteToken(inviteToken)) {
    return NextResponse.json(authErrorBody(), { status: 400 });
  }

  const ipLimit = await consumeAuthRateLimit(request, "signup-ip");
  if (!ipLimit.allowed) {
    return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429, headers: { "Retry-After": String(ipLimit.retryAfterSeconds) } });
  }
  const accountLimit = await consumeAuthRateLimit(request, "signup-account", email);
  if (!accountLimit.allowed) {
    return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429, headers: { "Retry-After": String(accountLimit.retryAfterSeconds) } });
  }

  const supabase = await createClient();
  const emailRedirectTo = typeof inviteToken === "string" && inviteToken
    ? `${new URL(request.url).origin}/join/${encodeURIComponent(inviteToken.slice(0, 256))}`
    : undefined;
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName }, ...(emailRedirectTo ? { emailRedirectTo } : {}) },
  });
  if (error) return NextResponse.json(authErrorBody(), { status: 400 });
  return NextResponse.json({ ok: true });
}
