import { createClient } from "@/lib/supabase/server";

export function getRequestIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for");
  const firstForwarded = forwarded?.split(",")[0]?.trim();
  const realIp = request.headers.get("x-real-ip")?.trim();
  const value = firstForwarded || realIp || "unknown";
  return value.slice(0, 128);
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
    // A missing/failed shared limiter must fail closed in production.
    if (process.env.NODE_ENV === "production") {
      return { allowed: false, unavailable: true, retryAfterSeconds: 60, remaining: 0 };
    }
    return { allowed: true, unavailable: true, retryAfterSeconds: 0, remaining: config.limit };
  }

  const result = data[0] as { allowed?: boolean; remaining?: number; retry_after_seconds?: number };
  return {
    allowed: result.allowed === true,
    unavailable: false,
    retryAfterSeconds: Number(result.retry_after_seconds) || 0,
    remaining: Number(result.remaining) || 0,
  };
}
