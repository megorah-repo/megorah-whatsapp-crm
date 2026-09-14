import { NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit, rateLimitResponse, registerAuthFailure, resetRateLimit, securityRateLimitConfig } from "@/lib/rate-limit";

const MAX_PASSWORD_BYTES = 1024;
const MAX_EMAIL_BYTES = 320;
const MAX_NAME_BYTES = 120;

function byteLength(value: string) {
  return new TextEncoder().encode(value).length;
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export const loginSchema = z.object({
  email: z.string().trim().email().max(MAX_EMAIL_BYTES),
  password: z.string().min(1).max(MAX_PASSWORD_BYTES),
});

export const signupSchema = z.object({
  fullName: z.string().trim().min(1).max(MAX_NAME_BYTES),
  email: z.string().trim().email().max(MAX_EMAIL_BYTES),
  password: z.string().min(8).max(MAX_PASSWORD_BYTES),
  confirmPassword: z.string().min(1).max(MAX_PASSWORD_BYTES),
});

export const resetSchema = z.object({
  email: z.string().trim().email().max(MAX_EMAIL_BYTES),
});

export function genericAuthError() {
  return "Unable to complete that request. Please check your details and try again.";
}

export function passwordTooLong(password: string) {
  return byteLength(password) > MAX_PASSWORD_BYTES;
}

export function requestOriginAllowed(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;

  try {
    const originUrl = new URL(origin);
    const host = request.headers.get("host");
    if (!host) return false;
    return originUrl.host === host && originUrl.protocol === "https:";
  } catch {
    return false;
  }
}

function clientIp(request: Request) {
  return (
    request.headers.get("x-real-ip")?.trim() ||
    request.headers.get("cf-connecting-ip")?.trim() ||
    request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

export function enforceAuthRateLimit(request: Request, email: string) {
  const config = securityRateLimitConfig();
  const ip = clientIp(request);
  const account = normalizeEmail(email);

  const ipResult = checkRateLimit(`auth:req:ip:${ip}`, config.authIp);
  if (!ipResult.success) return rateLimitResponse(ipResult);

  const accountResult = checkRateLimit(`auth:req:account:${account}`, config.authAccount);
  if (!accountResult.success) return rateLimitResponse(accountResult);

  return null;
}

export function recordAuthFailure(request: Request, email: string) {
  const config = securityRateLimitConfig();
  const ip = clientIp(request);
  const account = normalizeEmail(email);

  registerAuthFailure(`auth:fail:ip:${ip}`, {
    ...config.authIp,
    ...config.authBackoff,
  });
  registerAuthFailure(`auth:fail:account:${account}`, {
    ...config.authAccount,
    ...config.authBackoff,
  });
}

export function clearAuthFailures(request: Request, email: string) {
  const ip = clientIp(request);
  const account = normalizeEmail(email);
  resetRateLimit(`auth:fail:ip:${ip}`);
  resetRateLimit(`auth:fail:account:${account}`);
}

export function authErrorResponse(status = 400) {
  return NextResponse.json({ error: genericAuthError() }, { status });
}
