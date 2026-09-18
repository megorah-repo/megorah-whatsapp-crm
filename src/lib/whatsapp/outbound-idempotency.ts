import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { supabaseAdmin } from "@/lib/flows/admin-client";

export interface PrepareOutboundMessageInput {
  accountId: string;
  idempotencyKey?: string | null;
  conversationId: string;
  senderType: "agent" | "bot";
  contentType: string;
  contentText?: string | null;
  mediaUrl?: string | null;
  templateName?: string | null;
  interactivePayload?: unknown;
  replyToMessageId?: string | null;
  fingerprintPayload: unknown;
}

export interface PreparedOutboundMessage {
  idempotencyKey: string;
  fingerprint: string;
  messageId: string;
  existingStatus: "sending" | "sent" | "failed" | null;
  whatsappMessageId: string | null;
  errorMessage: string | null;
  shouldSend: boolean;
}

export async function prepareOutboundMessage(
  input: PrepareOutboundMessageInput,
): Promise<PreparedOutboundMessage> {
  const key = normalizeIdempotencyKey(input.idempotencyKey);
  const fingerprint = createHash("sha256")
    .update(stableJson(input.fingerprintPayload))
    .digest("hex");

  const admin = supabaseAdmin();

  const { data: inserted, error: insertError } = await admin
    .from("outbound_message_keys")
    .insert({
      account_id: input.accountId,
      idempotency_key: key,
      request_fingerprint: fingerprint,
      conversation_id: input.conversationId,
      status: "sending",
    })
    .select("id")
    .maybeSingle();

  if (insertError && insertError.code !== "23505") {
    throw new Error("Failed to reserve outbound idempotency key: " + insertError.message);
  }

  let record: {
    id: string;
    status: "sending" | "sent" | "failed";
    request_fingerprint: string;
    message_id: string | null;
    whatsapp_message_id: string | null;
    error_message: string | null;
  } | null = null;

  if (inserted?.id) {
    record = {
      id: inserted.id,
      status: "sending",
      request_fingerprint: fingerprint,
      message_id: null,
      whatsapp_message_id: null,
      error_message: null,
    };
  } else {
    const { data, error } = await admin
      .from("outbound_message_keys")
      .select(
        "id, status, request_fingerprint, message_id, whatsapp_message_id, error_message",
      )
      .eq("account_id", input.accountId)
      .eq("idempotency_key", key)
      .maybeSingle();

    if (error || !data) {
      throw new Error(
        "Failed to resolve outbound idempotency key: " +
          (error?.message ?? "not found"),
      );
    }
    record = data;
  }

  if (record.request_fingerprint !== fingerprint) {
    throw new OutboundIdempotencyError(
      "idempotency_key_reused",
      "Idempotency-Key was already used for a different message payload.",
      409,
    );
  }

  if (record.status === "sent" && record.message_id && record.whatsapp_message_id) {
    return {
      idempotencyKey: key,
      fingerprint,
      messageId: record.message_id,
      existingStatus: "sent",
      whatsappMessageId: record.whatsapp_message_id,
      errorMessage: null,
      shouldSend: false,
    };
  }

  if (record.status === "failed") {
    throw new OutboundIdempotencyError(
      "idempotent_send_failed",
      record.error_message ||
        "The original message send failed; use a new Idempotency-Key to retry.",
      409,
    );
  }

  if (record.message_id) {
    throw new OutboundIdempotencyError(
      "send_in_progress",
      "This Idempotency-Key is already being processed. Retry later with the same key.",
      409,
    );
  }

  const { data: message, error: messageError } = await admin
    .from("messages")
    .insert({
      conversation_id: input.conversationId,
      sender_type: input.senderType,
      content_type: input.contentType,
      content_text: input.contentText ?? null,
      media_url: input.mediaUrl ?? null,
      template_name: input.templateName ?? null,
      interactive_payload:
        input.contentType === "interactive" ? input.interactivePayload ?? null : null,
      message_id: null,
      status: "sending",
      reply_to_message_id: input.replyToMessageId ?? null,
    })
    .select("id")
    .single();

  if (messageError || !message) {
    await markOutboundFailed(
      input.accountId,
      key,
      messageError?.message ?? "Failed to create local message row before Meta send.",
      null,
    );
    throw new Error(
      "Failed to create outbound message record: " +
        (messageError?.message ?? "unknown error"),
    );
  }

  const { error: linkError } = await admin
    .from("outbound_message_keys")
    .update({ message_id: message.id })
    .eq("account_id", input.accountId)
    .eq("idempotency_key", key)
    .eq("status", "sending")
    .is("message_id", null);

  if (linkError) {
    throw new Error("Failed to link outbound idempotency key: " + linkError.message);
  }

  return {
    idempotencyKey: key,
    fingerprint,
    messageId: message.id,
    existingStatus: null,
    whatsappMessageId: null,
    errorMessage: null,
    shouldSend: true,
  };
}

export async function markOutboundSent(
  accountId: string,
  idempotencyKey: string,
  messageId: string,
  whatsappMessageId: string,
): Promise<void> {
  const admin = supabaseAdmin();

  const { error: messageError } = await admin
    .from("messages")
    .update({
      message_id: whatsappMessageId,
      status: "sent",
    })
    .eq("id", messageId);

  if (messageError) {
    throw new Error(
      "WhatsApp accepted the message but local persistence failed: " +
        messageError.message,
    );
  }

  const { error: keyError } = await admin
    .from("outbound_message_keys")
    .update({
      status: "sent",
      whatsapp_message_id: whatsappMessageId,
      error_message: null,
    })
    .eq("account_id", accountId)
    .eq("idempotency_key", idempotencyKey)
    .eq("status", "sending");

  if (keyError) {
    throw new Error(
      "WhatsApp message persisted but idempotency state could not be finalized: " +
        keyError.message,
    );
  }
}

export async function markOutboundFailed(
  accountId: string,
  idempotencyKey: string,
  errorMessage: string,
  messageId: string | null,
): Promise<void> {
  const admin = supabaseAdmin();
  const safeMessage = errorMessage.slice(0, 2000);

  if (messageId) {
    await admin
      .from("messages")
      .update({ status: "failed" })
      .eq("id", messageId);
  }

  await admin
    .from("outbound_message_keys")
    .update({
      status: "failed",
      error_message: safeMessage,
    })
    .eq("account_id", accountId)
    .eq("idempotency_key", idempotencyKey)
    .eq("status", "sending");
}

export function normalizeIdempotencyKey(input?: string | null): string {
  const key = input?.trim() || cryptoRandomUuid();
  if (key.length < 1 || key.length > 200) {
    throw new OutboundIdempotencyError(
      "invalid_idempotency_key",
      "Idempotency-Key must be between 1 and 200 characters.",
      400,
    );
  }
  return key;
}

function cryptoRandomUuid(): string {
  return globalThis.crypto.randomUUID();
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(stableJson).join(",") + "]";
  }
  const object = value as Record<string, unknown>;
  return (
    "{" +
    Object.keys(object)
      .sort()
      .map((key) => JSON.stringify(key) + ":" + stableJson(object[key]))
      .join(",") +
    "}"
  );
}

export class OutboundIdempotencyError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "OutboundIdempotencyError";
    this.code = code;
    this.status = status;
  }
}

export type OutboundDb = SupabaseClient;
