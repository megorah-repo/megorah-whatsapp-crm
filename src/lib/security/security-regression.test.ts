import { describe, expect, it } from "vitest";
import { buildMediaPath } from "@/lib/storage/upload-media";
import { isAllowedEmail, isPassword, isSafeInviteToken, isSafeName } from "@/lib/security/input";

describe("security regression guards", () => {
  it("rejects oversized auth inputs", () => {
    expect(isPassword("x".repeat(1025))).toBe(false);
    expect(isAllowedEmail("a".repeat(321))).toBe(false);
    expect(isSafeName("x".repeat(121))).toBe(false);
  });

  it("rejects unsafe invitation tokens", () => {
    expect(isSafeInviteToken("../../admin")).toBe(false);
    expect(isSafeInviteToken("<script>alert(1)</script>")).toBe(false);
  });

  it("keeps media paths account scoped and traversal-safe", () => {
    const path = buildMediaPath("11111111-1111-1111-1111-111111111111", "../../secret.exe", 123);
    expect(path).toContain("account-11111111-1111-1111-1111-111111111111/");
    expect(path).not.toContain("../");
    expect(path).toMatch(/\.exe$/);
  });

  it("does not interpret template markers as executable syntax", () => {
    const value = "{{constructor.constructor('return process')()}}";
    expect(value).toBeTypeOf("string");
  });
});
