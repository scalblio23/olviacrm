import { describe, it, expect } from "vitest";
import { normalizeAuPhone } from "./phone";

describe("normalizeAuPhone", () => {
  it("normalizes Australian local format (leading 0)", () => {
    expect(normalizeAuPhone("0434869538")).toBe("+61434869538");
  });

  it("normalizes bare subscriber number (no 0, no country code)", () => {
    expect(normalizeAuPhone("434869538")).toBe("+61434869538");
  });

  it("normalizes country code without +", () => {
    expect(normalizeAuPhone("61434869538")).toBe("+61434869538");
  });

  it("leaves an already-E.164 number as-is", () => {
    expect(normalizeAuPhone("+61434869538")).toBe("+61434869538");
  });

  it("strips whitespace and dashes", () => {
    expect(normalizeAuPhone("61 434 869 538")).toBe("+61434869538");
    expect(normalizeAuPhone("0434-869-538")).toBe("+61434869538");
    expect(normalizeAuPhone("(04) 3486 9538")).toBe("+61434869538");
    expect(normalizeAuPhone("+61 434 869 538")).toBe("+61434869538");
  });

  it("returns null for invalid input", () => {
    expect(normalizeAuPhone("")).toBeNull();
    expect(normalizeAuPhone("   ")).toBeNull();
    expect(normalizeAuPhone("abc")).toBeNull();
    expect(normalizeAuPhone("0434 call me")).toBeNull();
    expect(normalizeAuPhone("123")).toBeNull();
    expect(normalizeAuPhone(null)).toBeNull();
    expect(normalizeAuPhone(undefined)).toBeNull();
  });
});
