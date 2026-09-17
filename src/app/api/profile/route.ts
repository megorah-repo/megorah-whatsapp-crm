import { NextResponse } from "next/server";

import { createClient as createServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);
const ALLOWED_EXTENSIONS = new Map<string, string>([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
]);

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, message }, { status });
}

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return jsonError("You are not signed in.", 401);
    }

    const formData = await request.formData();
    const fullNameValue = formData.get("full_name");
    const removeAvatar = formData.get("remove_avatar") === "true";
    const avatar = formData.get("avatar");

    const fullName =
      typeof fullNameValue === "string" ? fullNameValue.trim() : "";
    if (!fullName) {
      return jsonError("Name is required.", 400);
    }
    if (fullName.length > 120) {
      return jsonError("Name must be 120 characters or fewer.", 400);
    }

    const { data: currentProfile, error: profileReadError } = await supabase
      .from("profiles")
      .select(
        "id, full_name, email, avatar_url, role, beta_features, account_id, account_role",
      )
      .eq("user_id", user.id)
      .maybeSingle();

    if (profileReadError) {
      return jsonError(
        `Unable to load profile: ${profileReadError.message}`,
        500,
      );
    }

    if (!currentProfile) {
      return jsonError("Your profile row could not be found.", 404);
    }

    let nextAvatarUrl = currentProfile.avatar_url ?? null;

    if (avatar instanceof File && avatar.size > 0) {
      if (!ALLOWED_MIME.has(avatar.type)) {
        return jsonError(
          "Unsupported image format. Use PNG, JPG, WEBP, or GIF.",
          400,
        );
      }
      if (avatar.size > MAX_AVATAR_BYTES) {
        return jsonError("Profile photo must be 2 MB or smaller.", 400);
      }

      const extension =
        ALLOWED_EXTENSIONS.get(avatar.type) ??
        avatar.name.split(".").pop()?.toLowerCase() ??
        "png";
      const storagePath = `${user.id}/avatar-${crypto.randomUUID()}.${extension}`;
      const buffer = Buffer.from(await avatar.arrayBuffer());

      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(storagePath, buffer, {
          cacheControl: "3600",
          upsert: false,
          contentType: avatar.type,
        });

      if (uploadError) {
        return jsonError(
          `Profile photo upload failed: ${uploadError.message}`,
          500,
        );
      }

      const {
        data: { publicUrl },
      } = supabase.storage.from("avatars").getPublicUrl(storagePath);
      nextAvatarUrl = `${publicUrl}?v=${Date.now()}`;
    } else if (removeAvatar) {
      nextAvatarUrl = null;
    }

    const { data: updatedProfile, error: updateError } = await supabase
      .from("profiles")
      .update({
        full_name: fullName,
        avatar_url: nextAvatarUrl,
      })
      .eq("user_id", user.id)
      .select(
        "id, full_name, email, avatar_url, role, beta_features, account_id, account_role",
      )
      .single();

    if (updateError) {
      return jsonError(`Profile save failed: ${updateError.message}`, 500);
    }

    return NextResponse.json({ ok: true, profile: updatedProfile });
  } catch (error) {
    console.error("[POST /api/profile]", error);
    return jsonError(
      error instanceof Error ? error.message : "Unable to save profile.",
      500,
    );
  }
}
