import { NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

import { createClient as createServerClient } from "@/lib/supabase/server";
import { SUPABASE_URL } from "@/lib/supabase/config";

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

function getServiceRoleKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || null;
}

function isMissingBucketError(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("bucket not found") ||
    normalized.includes("not found") && normalized.includes("bucket") ||
    normalized.includes("the resource was not found")
  );
}

async function buildAvatarDataUrl(file: File) {
  const bytes = Buffer.from(await file.arrayBuffer());
  return `data:${file.type};base64,${bytes.toString("base64")}`;
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
      const serviceRoleKey = getServiceRoleKey();

      let uploadSucceeded = false;

      if (serviceRoleKey) {
        const admin = createAdminClient(SUPABASE_URL, serviceRoleKey, {
          auth: {
            autoRefreshToken: false,
            persistSession: false,
          },
        });

        // The avatars migration may not have been applied to the hosted
        // project yet. Make the bucket available at runtime when the service
        // role can manage Storage; otherwise the data-URL fallback below
        // still lets the profile save successfully.
        const { data: buckets } = await admin.storage.listBuckets();
        const hasAvatarsBucket = buckets?.some((bucket) => bucket.id === "avatars");

        if (!hasAvatarsBucket) {
          await admin.storage.createBucket("avatars", {
            public: true,
            fileSizeLimit: MAX_AVATAR_BYTES,
            allowedMimeTypes: Array.from(ALLOWED_MIME),
          });
        }

        const { error: uploadError } = await admin.storage
          .from("avatars")
          .upload(storagePath, buffer, {
            cacheControl: "3600",
            upsert: false,
            contentType: avatar.type,
          });

        if (!uploadError) {
          const {
            data: { publicUrl },
          } = admin.storage.from("avatars").getPublicUrl(storagePath);
          nextAvatarUrl = `${publicUrl}?v=${Date.now()}`;
          uploadSucceeded = true;
        } else if (!isMissingBucketError(uploadError.message)) {
          return jsonError(
            `Profile photo upload failed: ${uploadError.message}`,
            500,
          );
        }
      }

      if (!uploadSucceeded) {
        try {
          // Last-resort fallback for projects where Storage is unavailable
          // or the hosted `avatars` bucket has not been created. The profile
          // row remains fully self-contained, so saving the name + photo does
          // not fail just because Storage is misconfigured.
          nextAvatarUrl = await buildAvatarDataUrl(avatar);
        } catch (error) {
          return jsonError(
            `Profile photo processing failed: ${error instanceof Error ? error.message : "Unable to read image."}`,
            500,
          );
        }
      }
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
