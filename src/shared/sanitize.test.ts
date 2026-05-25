import { describe, expect, it } from "vitest";
import { isSensitiveField, sanitizeValue } from "./sanitize";

describe("sensitive value handling", () => {
  it("never stores password values", () => {
    expect(sanitizeValue("secret", true, "password")).toBeUndefined();
  });

  it("masks sensitive-looking fields", () => {
    expect(isSensitiveField({ name: "api_key" })).toBe(true);
    expect(sanitizeValue("sk-test", true, "text")).toBe("[MASKED]");
  });

  it("keeps normal values literal", () => {
    expect(isSensitiveField({ name: "email" })).toBe(false);
    expect(sanitizeValue("hello", false, "text")).toBe("hello");
  });
});
