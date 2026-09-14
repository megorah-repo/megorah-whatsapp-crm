import { createClient } from "@/lib/supabase/client";

export const MEDIA_MAX_BYTES = 16 * 1024 * 1024;
export const MEDIA_MAX_BYTES_BY_KIND = {
  image: 5 * 1024 * 1024,
  video: 16 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
  document: 16 * 1024 * 1024,
} as const;

const ALLOWED_MIME = new Set([
  "image/jpeg", "image/png", "image/webp", "image/gif",
  "video/mp4", "video/webm", "audio/mpeg", "audio/mp4", "audio/ogg", "audio/wav",
  "application/pdf", "text/plain", "text/csv",
]);

function safeExtension(name: string) {
  const ext = name.includes(".") ? name.split(".").pop()?.toLowerCase() : "bin";
  return ext && /^[a-z0-9]{1,10}$/.test(ext) ? ext : "bin";
}

function safeBase(name: string) {
  return name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 40) || "file";
}

export function buildMediaPath(accountId: string, fileName: string, now: number | null = Date.now(), subfolder?: string) {
  const dir = subfolder ? `account-${accountId}/${subfolder.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40)}` : `account-${accountId}`;
  const stamp = now === null ? "" : `${now}-`;
  return `${dir}/${stamp}${safeBase(fileName)}.${safeExtension(fileName)}`;
}

function signatureMatches(bytes: Uint8Array, mime: string) {
  const starts = (...values: number[]) => values.every((value, index) => bytes[index] === value);
  if (mime === "image/jpeg") return starts(0xff, 0xd8, 0xff);
  if (mime === "image/png") return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  if (mime === "image/gif") return new TextDecoder().decode(bytes.slice(0, 6)) === "GIF87a" || new TextDecoder().decode(bytes.slice(0, 6)) === "GIF89a";
  if (mime === "application/pdf") return new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-";
  if (mime === "video/mp4" || mime === "audio/mp4") return bytes.length >= 12 && new TextDecoder().decode(bytes.slice(4, 8)) === "ftyp";
  if (mime === "audio/mpeg") return starts(0xff, 0xfb) || starts(0xff, 0xf3) || starts(0xff, 0xf2) || new TextDecoder().decode(bytes.slice(0, 3)) === "ID3";
  if (mime === "audio/ogg") return starts(0x4f, 0x67, 0x67, 0x53);
  if (mime === "video/webm") return starts(0x1a, 0x45, 0xdf, 0xa3);
  if (mime === "image/webp") return new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP";
  if (mime === "text/plain" || mime === "text/csv") return true;
  return false;
}

async function validateUpload(file: File) {
  if (!file || file.size <= 0 || file.size > MEDIA_MAX_BYTES) throw new Error("File is too large or empty.");
  if (!ALLOWED_MIME.has(file.type)) throw new Error("This file type is not allowed.");
  const bytes = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  if (!signatureMatches(bytes, file.type)) throw new Error("The uploaded file content does not match its declared type.");
}

export interface UploadAccountMediaResult { publicUrl: string; path: string; }

export async function uploadAccountMedia(bucket: string, file: File): Promise<UploadAccountMediaResult> {
  await validateUpload(file);
  const supabase = createClient();
  const { data: { user }, error: userErr } = await supabase.auth.getUser();
  if (userErr || !user) throw new Error("Not signed in.");
  const { data: profile, error: profileErr } = await supabase.from("profiles").select("account_id").eq("user_id", user.id).maybeSingle();
  if (profileErr || !profile?.account_id) throw new Error("Could not resolve your account.");
  const path = buildMediaPath(profile.account_id as string, file.name);
  const { error: upErr } = await supabase.storage.from(bucket).upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type });
  if (upErr) throw new Error("Upload could not be completed.");
  const { data: { publicUrl } } = supabase.storage.from(bucket).getPublicUrl(path);
  return { publicUrl, path };
}

export async function deleteAccountMedia(bucket: string, path: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.storage.from(bucket).remove([path]);
  if (error) throw new Error("Media cleanup failed.");
}
