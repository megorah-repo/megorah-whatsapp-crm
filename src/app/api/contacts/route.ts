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

function isSchemaDriftError(error: { code?: string; message?: string } | null | undefined) {
  const code = error?.code ?? "";
  const message = error?.message ?? "";
  return (
    code === "42703" ||
    code === "PGRST204" ||
    code === "PGRST205" ||
    /column .* does not exist/i.test(message) ||
    /could not find the .* column/i.test(message) ||
    /schema cache/i.test(message)
  );
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return errorResponse(403, "Invalid request origin");

  const authClient = await createClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();
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

  if (!phone || phone.length > MAX_PHONE) {
    return errorResponse(400, "A valid phone number is required");
  }
  if (name && (!isSafeName(name) || Buffer.byteLength(name, "utf8") > 120)) {
    return errorResponse(400, "Invalid name");
  }
  if (email.length > MAX_EMAIL || company.length > MAX_COMPANY) {
    return errorResponse(400, "Contact field is too long");
  }

  let admin;
  try {
    admin = createPlatformAdminClient();
  } catch (error) {
    console.error(
      "[contacts] admin client unavailable",
      error instanceof Error ? error.message : error,
    );
    return errorResponse(500, "Contact database is not configured");
  }

  // Prefer the account-sharing schema. If production is still on the legacy
  // profile schema, fall back to the authenticated user's own profile row.
  let profileAccountId: string | null = null;
  let profileRole: string | null = null;

  const accountProfile = await admin
    .from("profiles")
    .select("account_id, account_role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!accountProfile.error) {
    profileAccountId = accountProfile.data?.account_id ?? null;
    profileRole = accountProfile.data?.account_role ?? null;
  } else if (isSchemaDriftError(accountProfile.error)) {
    const legacyProfile = await admin
      .from("profiles")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (legacyProfile.error) {
      console.error("[contacts] legacy profile lookup failed", legacyProfile.error.message);
      return errorResponse(500, "Unable to resolve account");
    }
    if (!legacyProfile.data?.user_id) {
      return errorResponse(409, "Your account setup is incomplete. Refresh and try again.");
    }
    profileRole = "owner";
  } else {
    console.error("[contacts] profile lookup failed", accountProfile.error.message);
    return errorResponse(500, "Unable to resolve account");
  }

  if (profileRole && !["owner", "admin", "agent"].includes(profileRole)) {
    return errorResponse(403, "You do not have permission to create contacts");
  }

  const canonicalSelect =
    "id, user_id, name, phone, email, company, created_at, updated_at";

  // The old pre-account schema is still valid for a single-user account. In
  // the account-sharing schema we keep account_id to preserve tenant isolation.
  let insertPayload: Record<string, unknown> = {
    user_id: user.id,
    name: name || null,
    phone,
    email: email || null,
    company: company || null,
  };

  if (profileAccountId) {
    insertPayload = {
      ...insertPayload,
      account_id: profileAccountId,
    };

    const accountScopedExisting = await admin
      .from("contacts")
      .select("id, name, phone")
      .eq("account_id", profileAccountId)
      .eq("phone", phone)
      .limit(1);

    if (!accountScopedExisting.error) {
      const existing = accountScopedExisting.data?.[0];
      if (existing) {
        return NextResponse.json(
          {
            error: "A contact with this phone number already exists.",
            existingContact: existing,
          },
          { status: 409 },
        );
      }
    } else if (!isSchemaDriftError(accountScopedExisting.error)) {
      console.error("[contacts] account contact lookup failed", {
        code: accountScopedExisting.error.code,
        message: accountScopedExisting.error.message,
        details: accountScopedExisting.error.details,
        hint: accountScopedExisting.error.hint,
      });
      return errorResponse(500, "Unable to check contact");
    }
  } else {
    const legacyExisting = await admin
      .from("contacts")
      .select("id, name, phone")
      .eq("user_id", user.id)
      .eq("phone", phone)
      .limit(1);

    if (legacyExisting.error) {
      console.error("[contacts] legacy contact lookup failed", legacyExisting.error.message);
      return errorResponse(500, "Unable to check contact");
    }

    const existing = legacyExisting.data?.[0];
    if (existing) {
      return NextResponse.json(
        {
          error: "A contact with this phone number already exists.",
          existingContact: existing,
        },
        { status: 409 },
      );
    }
  }

  let insertResult = await admin
    .from("contacts")
    .insert(insertPayload)
    .select(canonicalSelect)
    .single();

  // If production has not applied the account_id column yet, retry once using
  // the legacy single-user shape. This keeps contact saving functional while
  // the database migration catches up, without weakening tenant isolation in
  // an already-migrated account.
  if (insertResult.error && profileAccountId && isSchemaDriftError(insertResult.error)) {
    const legacyPayload = {
      user_id: user.id,
      name: name || null,
      phone,
      email: email || null,
      company: company || null,
    };
    insertResult = await admin
      .from("contacts")
      .insert(legacyPayload)
      .select(canonicalSelect)
      .single();
  }

  const { data: contact, error: insertError } = insertResult;

  if (insertError) {
    if (insertError.code === "23505") {
      return errorResponse(409, "A contact with this phone number already exists.");
    }
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
