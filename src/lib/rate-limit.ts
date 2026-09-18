import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
}

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  reset: number;
  limit: number;
  retryAfterMs?: number;
}

interface Entry {
  count: number;
  resetAt: number;
  failures: number;
  blockedUntil: number;
}

const buckets = new Map<string, Entry>();
let callsSinceSweep = 0;
const LIGHT_SWEEP_EVERY = 1000;

function envInt(name: string, fallback: number, min = 1): number {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value >= min ? value : fallback;
}

export function securityRateLimitConfig() {
  return {
    authIp: {
      limit: envInt("RATE_LIMIT_AUTH_IP_MAX", 20),
      windowMs: envInt("RATE_LIMIT_AUTH_IP_WINDOW_MS", 15 * 60_000),
    },
    authAccount: {
      limit: envInt("RATE_LIMIT_AUTH_ACCOUNT_MAX", 8),
      windowMs: envInt("RATE_LIMIT_AUTH_ACCOUNT_WINDOW_MS", 15 * 60_000),
    },
    authBackoff: {
      baseMs: envInt("RATE_LIMIT_AUTH_BACKOFF_BASE_MS", 1_000),
      maxMs: envInt("RATE_LIMIT_AUTH_BACKOFF_MAX_MS", 15 * 60_000),
    },
    public: {
      limit: envInt("RATE_LIMIT_PUBLIC_MAX", 120),
      windowMs: envInt("RATE_LIMIT_PUBLIC_WINDOW_MS", 60_000),
    },
    authenticated: {
      limit: envInt("RATE_LIMIT_AUTHENTICATED_MAX", 600),
      windowMs: envInt("RATE_LIMIT_AUTHENTICATED_WINDOW_MS", 60_000),
    },
  };
}

function sweepExpired(now: number) {
  for (const [key, value] of buckets) {
    if (value.resetAt <= now && value.blockedUntil <= now) buckets.delete(key);
  }
}

function backoffMs(failures: number, baseMs: number, maxMs: number) {
  return Math.min(maxMs, baseMs * 2 ** Math.max(0, failures - 1));
}

export function checkRateLimit(
  key: string,
  { limit, windowMs, backoffBaseMs, backoffMaxMs }: RateLimitOptions,
): RateLimitResult {
  const now = Date.now();
  callsSinceSweep += 1;
  if (callsSinceSweep >= LIGHT_SWEEP_EVERY) {
    callsSinceSweep = 0;
    sweepExpired(now);
  }

  const entry = buckets.get(key);
  if (!entry || entry.resetAt <= now) {
    buckets.set(key, {
      count: 1,
      resetAt: now + windowMs,
      failures: 0,
      blockedUntil: 0,
    });
    return { success: true, remaining: Math.max(0, limit - 1), reset: now + windowMs, limit };
  }

  if (entry.blockedUntil > now) {
    return {
      success: false,
      remaining: 0,
      reset: Math.max(entry.resetAt, entry.blockedUntil),
      limit,
      retryAfterMs: entry.blockedUntil - now,
    };
  }

  if (entry.count >= limit) {
    return { success: false, remaining: 0, reset: entry.resetAt, limit };
  }

  entry.count += 1;
  return {
    success: true,
    remaining: Math.max(0, limit - entry.count),
    reset: entry.resetAt,
    limit,
  };
}

/** Record a failed authentication attempt and apply exponential backoff. */
export function registerAuthFailure(
  key: string,
  { limit, windowMs, backoffBaseMs = 1_000, backoffMaxMs = 15 * 60_000 }: RateLimitOptions,
): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(key);
  const entry: Entry = existing && existing.resetAt > now
    ? existing
    : { count: 0, resetAt: now + windowMs, failures: 0, blockedUntil: 0 };

  entry.count += 1;
  entry.failures += 1;
  entry.blockedUntil = now + backoffMs(entry.failures, backoffBaseMs, backoffMaxMs);
  buckets.set(key, entry);

  return {
    success: entry.count < limit,
    remaining: Math.max(0, limit - entry.count),
    reset: Math.max(entry.resetAt, entry.blockedUntil),
    limit,
    retryAfterMs: entry.blockedUntil - now,
  };
}

/**
 * Horizontally-scaled limiter backed by the Supabase/Postgres bucket table.
 * Falls back to the local limiter only when the distributed backend is
 * unavailable, so a database outage does not turn every API request into
 * an automatic 500. Callers that require a hard distributed guarantee
 * should keep the migration 040 prerequisite enforced at deploy time.
 */
export async function checkDistributedRateLimit(
  db: SupabaseClient,
  key: string,
  { limit, windowMs }: RateLimitOptions,
): Promise<RateLimitResult> {
  const { data, error } = await db.rpc("consume_rate_limit", {
    p_bucket_key: key,
    p_limit: limit,
    p_window_seconds: Math.max(1, Math.ceil(windowMs / 1000)),
  });

  if (error || !data || data.length === 0) {
    console.error("[rate-limit] distributed limiter unavailable; using local fallback:", error);
    return checkRateLimit(key, { limit, windowMs });
  }

  const row = data[0] as {
    allowed: boolean;
    remaining: number;
    reset_at: string;
  };
  const reset = new Date(row.reset_at).getTime();
  if (!Number.isFinite(reset)) {
    console.error("[rate-limit] distributed limiter returned an invalid reset_at; using local fallback");
    return checkRateLimit(key, { limit, windowMs });
  }

  return {
    success: Boolean(row.allowed),
    remaining: Math.max(0, Number(row.remaining) || 0),
    reset,
    limit,
    retryAfterMs: row.allowed ? undefined : Math.max(0, reset - Date.now()),
  };
}

export function rateLimitResponse(result: RateLimitResult): NextResponse {
  const retryAfterSec = Math.max(
    1,
    Math.ceil((result.retryAfterMs ?? result.reset - Date.now()) / 1000),
  );
  return NextResponse.json(
    { error: "Rate limit exceeded. Please try again later." },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfterSec),
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": String(result.remaining),
        "X-RateLimit-Reset": String(Math.ceil(result.reset / 1000)),
      },
    },
  );
}

export const RATE_LIMITS = {
  send: { limit: 60, windowMs: 60_000 },
  broadcast: { limit: 60, windowMs: 60_000 },
  react: { limit: 120, windowMs: 60_000 },
  invitationPeek: { limit: 30, windowMs: 60_000 },
  invitationRedeem: { limit: 10, windowMs: 60_000 },
  adminAction: { limit: 30, windowMs: 60_000 },
  publicApi: { limit: 120, windowMs: 60_000 },
  aiDraft: { limit: 20, windowMs: 60_000 },
  aiDraftAccount: { limit: 60, windowMs: 60_000 },
  aiAutoReplyAccount: { limit: 30, windowMs: 60_000 },
} as const;

export function __resetRateLimitForTests() {
  buckets.clear();
  callsSinceSweep = 0;
}
