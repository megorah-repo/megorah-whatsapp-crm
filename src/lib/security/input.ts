const MAX_BODY_BYTES = 16 * 1024;
export const MAX_PASSWORD_BYTES = 1024;
export const MAX_EMAIL_BYTES = 320;
export const MAX_NAME_BYTES = 120;
export const MAX_INVITE_TOKEN_BYTES = 512;

function utf8Bytes(value: string) {
  return new TextEncoder().encode(value).length;
}

export function isAllowedEmail(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_EMAIL_BYTES &&
    utf8Bytes(value) <= MAX_EMAIL_BYTES &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  );
}

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function isPassword(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    utf8Bytes(value) <= MAX_PASSWORD_BYTES
  );
}

export function isSafeName(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return trimmed.length > 0 && utf8Bytes(trimmed) <= MAX_NAME_BYTES;
}

export function isSafeInviteToken(value: unknown): value is string {
  return (
    value === undefined ||
    (typeof value === "string" &&
      value.length > 0 &&
      value.length <= MAX_INVITE_TOKEN_BYTES &&
      /^[A-Za-z0-9._~-]+$/.test(value))
  );
}

export function authErrorBody() {
  return { error: "Unable to complete that request. Please check your details and try again." };
}

export function tooManyRequestsBody() {
  return { error: "Too many requests. Please try again later." };
}

export async function readLimitedJson(request: Request): Promise<Record<string, unknown> | null> {
  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const declared = Number.parseInt(contentLength, 10);
    if (!Number.isFinite(declared) || declared < 0 || declared > MAX_BODY_BYTES) return null;
  }

  const reader = request.body?.getReader();
  if (!reader) return null;

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) return null;
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  let length = 0;
  for (const chunk of chunks) length += chunk.byteLength;
  const merged = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(merged));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;

  try {
    const originUrl = new URL(origin);
    const host = request.headers.get("host");
    if (!host) return false;
    return originUrl.protocol === "https:" && originUrl.host === host;
  } catch {
    return false;
  }
}
