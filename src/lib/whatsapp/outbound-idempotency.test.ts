import { describe, expect, it } from "vitest";

import { normalizeIdempotencyKey } from "./outbound-idempotency";

describe("outbound idempotency key normalization", () => {
  it("generates a key when omitted", () => {
    const key = normalizeIdempotencyKey();
    expect(key).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("trims supplied keys", () => {
    expect(normalizeIdempotencyKey("  abc-123  ")).toBe("abc-123");
  });

  it("rejects oversized keys", () => {
    expect(() => normalizeIdempotencyKey("x".repeat(201))).toThrow(/200/);
  });
});
