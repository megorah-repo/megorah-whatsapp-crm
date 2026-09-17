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
  const value = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  return value || null;
}

export async function POST(request: Request) {
  const serviceRoleKey = getServiceRoleKey();
  if (!serviceRoleKey) {
    return jsonError(
      "Profile saving is not configured: SUPABASE_SERVICE_ROLE_KEY is missing.",
      500,
    );
  }

  try {
    const serverSupabase = await createServerClient();
    const {
      data: { user },
      error: userError,
    } = await serverSupabase.auth.getUser();

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

    const admin = createAdminClient(SUPABASE_URL, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const { data: currentProfile, error: profileReadError } = await admin
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

      const { data: buckets, error: bucketListError } =
        await admin.storage.listBuckets();

      if (bucketListError) {
        return jsonError(
          `Unable to inspect avatar storage: ${bucketListError.message}`,
          500,
        );
      }

      if (!buckets?.some((bucket) => bucket.id === "avatars")) {
        const { error: createBucketError } = await admin.storage.createBucket(
          "avatars",
          {
            public: true,
            fileSizeLimit: MAX_AVATAR_BYTES,
            allowedMimeTypes: Array.from(ALLOWED_MIME),
          },
        );

        if (createBucketError && createBucketError.message !== "Bucket already exists") {
          return jsonError(
            `Unable to initialize avatar storage: ${createBucketError.message}`,
            500,
          );
        }
      }

      const extension =
        ALLOWED_EXTENSIONS.get(avatar.type) ??
        avatar.name.split(".").pop()?.toLowerCase() ??
        "png";
      const storagePath = `${user.id}/avatar-${crypto.randomUUID()}.${extension}`;
      const buffer = Buffer.from(await avatar.arrayBuffer());

      const { error: uploadError } = await admin.storage
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
      } = admin.storage.from("avatars").getPublicUrl(storagePath);
      nextAvatarUrl = publicUrl;
    } else if (removeAvatar) {
      nextAvatarUrl = null;
    }

    const { data: updatedProfile, error: updateError } = await admin
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
