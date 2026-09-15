import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createPlatformAdminClient } from "@/lib/admin/platform-admin-client";
import { readLimitedJson, sameOrigin, isSafeName } from "@/lib/security/input";

export const dynamic = "force-dynamic";

const MAX_PHONE = 40;
const MAX_EMAIL = 320;
const MAX_COMPANY = 160;

function errorResponse(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return errorResponse(403, "Invalid request origin");

  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return errorResponse(401, "Not authenticated");

  let body: Record<string, unknown>;
  try {
    const parsed = await readLimitedJson(request);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return errorResponse(400, "Invalid request body");
    }
    body = parsed;
  } catch {
    return errorResponse(400, "Invalid request body");
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const company = typeof body.company === "string" ? body.company.trim() : "";

  if (!phone || phone.length > MAX_PHONE) return errorResponse(400, "A valid phone number is required");
  if (name && (!isSafeName(name) || Buffer.byteLength(name, "utf8") > 120)) return errorResponse(400, "Invalid name");
  if (email.length > MAX_EMAIL || company.length > MAX_COMPANY) return errorResponse(400, "Contact field is too long");

  let admin;
  try {
    admin = createPlatformAdminClient();
  } catch (error) {
    console.error("[contacts] admin client unavailable", error instanceof Error ? error.message : error);
    return errorResponse(500, "Contact database is not configured");
  }

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("account_id, account_role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (profileError) {
    console.error("[contacts] profile lookup failed", profileError.message);
    return errorResponse(500, "Unable to resolve account");
  }
  if (!profile?.account_id || !profile.account_role) {
    return errorResponse(409, "Your account setup is incomplete. Refresh and try again.");
  }
  if (!["owner", "admin", "agent"].includes(profile.account_role)) {
    return errorResponse(403, "You do not have permission to create contacts");
  }

  const { data: existing, error: existingError } = await admin
    .from("contacts")
    .select("id, name, phone")
    .eq("account_id", profile.account_id)
    .eq("phone", phone)
    .maybeSingle();

  if (existingError) {
    console.error("[contacts] duplicate lookup failed", existingError.message);
    return errorResponse(500, "Unable to check contact");
  }
  if (existing) {
    return NextResponse.json(
      { error: "A contact with this phone number already exists.", existingContact: existing },
      { status: 409 },
    );
  }

  const { data: contact, error: insertError } = await admin
    .from("contacts")
    .insert({
      user_id: user.id,
      account_id: profile.account_id,
      name: name || null,
      phone,
      email: email || null,
      company: company || null,
    })
    .select("id, user_id, account_id, name, phone, email, company, created_at, updated_at")
    .single();

  if (insertError) {
    if (insertError.code === "23505") return errorResponse(409, "A contact with this phone number already exists.");
    console.error("[contacts] insert failed", {
      code: insertError.code,
      message: insertError.message,
      details: insertError.details,
      hint: insertError.hint,
    });
    return errorResponse(500, "Unable to save contact");
  }

  return NextResponse.json({ contact }, { status: 201 });
}
