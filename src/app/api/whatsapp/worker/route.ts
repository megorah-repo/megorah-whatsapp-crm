import { randomUUID, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/flows/admin-client";
import { processWebhook } from "@/app/api/whatsapp/webhook/route";

export const maxDuration = 60;

function authorized(request: Request): boolean {
  const expected =
    process.env.WHATSAPP_WORKER_SECRET ||
    process.env.CRON_SECRET ||
    process.env.AUTOMATION_CRON_SECRET ||
    "";
  if (!expected) return false;

  const suppliedHeader =
    request.headers.get("x-cron-secret")?.trim() ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ||
    "";
  const supplied = Buffer.from(suppliedHeader);
  const expectedBuffer = Buffer.from(expected);
  return (
    supplied.length === expectedBuffer.length &&
    timingSafeEqual(supplied, expectedBuffer)
  );
}

/**
 * Drain durable Meta webhook jobs.
 *
 * The webhook endpoint only verifies + persists. This worker owns the
 * long-running processing and retries transient failures with exponential
 * backoff. The database RPC uses SKIP LOCKED so multiple cron invocations
 * may run safely without processing the same job concurrently.
 */
export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = supabaseAdmin();
  const workerId = randomUUID();

  const { data: jobs, error: claimError } = await admin.rpc(
    "claim_whatsapp_webhook_jobs",
    { p_worker_id: workerId, p_limit: 25 },
  );

  if (claimError) {
    console.error("[whatsapp-worker] claim failed:", claimError);
    return NextResponse.json(
      { error: "Worker claim failed" },
      { status: 500 },
    );
  }

  let processed = 0;
  let retried = 0;
  let failed = 0;

  for (const job of (jobs ?? []) as Array<{
    job_id: string;
    payload: unknown;
    attempts: number;
  }>) {
    try {
      await processWebhook(
        job.payload as Parameters<typeof processWebhook>[0],
      );
      const { data: completed, error: completeError } = await admin.rpc(
        "complete_whatsapp_webhook_job",
        { p_job_id: job.job_id, p_worker_id: workerId },
      );
      if (completeError || completed !== true) {
        throw new Error(
          completeError?.message || "Job completion was not acknowledged",
        );
      }
      processed += 1;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      const shouldRetry = job.attempts < 10;
      const delaySeconds = Math.min(
        15 * 60,
        5 * Math.pow(2, Math.max(0, job.attempts - 1)),
      );
      const runAt = new Date(
        Date.now() + delaySeconds * 1000,
      ).toISOString();

      const { error: failError } = await admin.rpc(
        "fail_whatsapp_webhook_job",
        {
          p_job_id: job.job_id,
          p_worker_id: workerId,
          p_error: message,
          p_retry: shouldRetry,
          p_run_at: runAt,
        },
      );

      if (failError) {
        console.error(
          "[whatsapp-worker] failed to record job failure:",
          failError,
        );
      }

      if (shouldRetry) retried += 1;
      else failed += 1;

      console.error("[whatsapp-worker] processing failed:", {
        jobId: job.job_id,
        attempt: job.attempts,
        retry: shouldRetry,
        error: message,
      });
    }
  }

  return NextResponse.json({
    processed,
    retried,
    failed,
    claimed: jobs?.length ?? 0,
  });
}

export async function POST(request: Request) {
  return GET(request);
}
