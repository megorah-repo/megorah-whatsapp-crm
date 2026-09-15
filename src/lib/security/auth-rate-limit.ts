import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, type RateLimitOptions } from "@/lib/rate-limit";

export function getRequestIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for");
  const firstForwarded = forwarded?.split(",")[0]?.trim();
  const realIp = request.headers.get("x-real-ip")?.trim();
  const value = firstForwarded || realIp || "unknown";
  return value.slice(0, 128);
}

const FALLBACK_LIMITS: Record<
  "login-ip" | "login-account" | "signup-ip" | "signup-account" | "reset-ip" | "reset-account",
  RateLimitOptions
> = {
  "login-ip": { limit: 20, windowMs: 15 * 60_000 },
  "login-account": { limit: 8, windowMs: 15 * 60_000 },
  "signup-ip": { limit: 10, windowMs: 15 * 60_000 },
  "signup-account": { limit: 5, windowMs: 60 * 60_000 },
  "reset-ip": { limit: 10, windowMs: 15 * 60_000 },
  "reset-account": { limit: 5, windowMs: 60 * 60_000 },
};

function fallbackLimit(
  request: Request,
  kind: keyof typeof FALLBACK_LIMITS,
  accountKey?: string,
) {
  const ip = getRequestIp(request);
  const subject = kind.endsWith("-account")
    ? accountKey?.trim().toLowerCase().slice(0, 320) || "unknown"
    : ip;
  const result = checkRateLimit(`auth-fallback:${kind}:${subject}`, FALLBACK_LIMITS[kind]);

  return {
    allowed: result.success,
    unavailable: true,
    retryAfterSeconds: Math.max(
      1,
      Math.ceil((result.retryAfterMs ?? result.reset - Date.now()) / 1000),
    ),
    remaining: result.remaining,
  };
}

export async function consumeAuthRateLimit(
  request: Request,
  kind: "login-ip" | "login-account" | "signup-ip" | "signup-account" | "reset-ip" | "reset-account",
  accountKey?: string,
) {
  const supabase = await createClient();
  const ip = getRequestIp(request);
  const normalizedAccount = accountKey?.trim().toLowerCase().slice(0, 320);
  const subject = kind.endsWith("-account") ? normalizedAccount || "unknown" : ip;
  const bucketKey = `auth:${kind}:${subject}`;

  const limits = {
    "login-ip": { limit: 20, window: 900 },
    "login-account": { limit: 8, window: 900 },
    "signup-ip": { limit: 10, window: 900 },
    "signup-account": { limit: 5, window: 3600 },
    "reset-ip": { limit: 10, window: 900 },
    "reset-account": { limit: 5, window: 3600 },
  } as const;

  const config = limits[kind];
  const { data, error } = await supabase.rpc("consume_auth_rate_limit", {
    p_bucket_key: bucketKey,
    p_limit: config.limit,
    p_window_seconds: config.window,
  });

  if (error || !Array.isArray(data) || !data[0]) {
    console.warn("[auth-rate-limit] shared limiter unavailable; using local fallback", {
      kind,
      code: error?.code,
      message: error?.message,
    });
    return fallbackLimit(request, kind, accountKey);
  }

  const result = data[0] as {
    allowed?: boolean;
    remaining?: number;
    retry_after_seconds?: number;
  };
  return {
    allowed: result.allowed === true,
    unavailable: false,
    retryAfterSeconds: Number(result.retry_after_seconds) || 0,
    remaining: Number(result.remaining) || 0,
  };
}
