import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

/**
 * Platform-level admin gate for the Megorah SaaS control panel.
 *
 * This is intentionally separate from the CRM's account roles. A customer
 * being an `owner` of their CRM account must never grant them access to the
 * platform-wide admin panel.
 *
 * Configure the email that owns the platform admin panel with the
 * `ADMIN_EMAIL` environment variable in Vercel. Comparison is
 * case-insensitive and whitespace-tolerant.
 */
export async function requirePlatformAdmin() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const currentEmail = user.email?.trim().toLowerCase();
  const configuredEmails = [
    process.env.ADMIN_EMAIL ?? "",
    process.env.MEGORAH_ADMIN_EMAILS ?? "",
  ]
    .flatMap((value) => value.split(","))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  if (!currentEmail || !configuredEmails.includes(currentEmail)) {
    redirect("/dashboard");
  }

  return user;
}
