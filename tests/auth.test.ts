/**
 * Unit tests for the key sanitiser. The CRLF-on-Windows bug is the single
 * most-reported failure mode of this tool, so we lock it in here.
 */
import { describe, it, expect } from "vitest";
import { sanitizeKey, validateKey } from "../src/auth.js";

const VALID_KEY = "user_" + "a".repeat(80); // length >= 32, starts with user_

describe("sanitizeKey", () => {
  it("returns the key unchanged when clean", () => {
    expect(sanitizeKey(VALID_KEY)).toBe(VALID_KEY);
  });

  it("strips surrounding whitespace", () => {
    expect(sanitizeKey(`  ${VALID_KEY}\n`)).toBe(VALID_KEY);
  });

  it("strips CR/LF/tab/NUL embedded mid-key (Windows paste bug)", () => {
    // Real bug: pasting through PowerShell Set-EnvironmentVariable on some
    // Windows builds leaves \r\n inside the value.
    const tainted = VALID_KEY.slice(0, 40) + "\r\n" + VALID_KEY.slice(40);
    expect(sanitizeKey(tainted)).toBe(VALID_KEY);
  });

  it("strips tab characters (Excel paste bug)", () => {
    const tainted = VALID_KEY.slice(0, 40) + "\t\t" + VALID_KEY.slice(40);
    expect(sanitizeKey(tainted)).toBe(VALID_KEY);
  });

  it("strips NUL bytes (some shell bugs)", () => {
    const tainted = VALID_KEY.slice(0, 40) + "\0" + VALID_KEY.slice(40);
    expect(sanitizeKey(tainted)).toBe(VALID_KEY);
  });

  it("strips surrounding double quotes", () => {
    expect(sanitizeKey(`"${VALID_KEY}"`)).toBe(VALID_KEY);
  });

  it("strips surrounding single quotes", () => {
    expect(sanitizeKey(`'${VALID_KEY}'`)).toBe(VALID_KEY);
  });
});

describe("validateKey", () => {
  it("accepts a well-formed key", () => {
    expect(() => validateKey(VALID_KEY)).not.toThrow();
  });

  it("rejects an empty key", () => {
    expect(() => validateKey("")).toThrow(/empty/);
  });

  it("rejects a key without the user_ prefix", () => {
    expect(() => validateKey("sk-" + "a".repeat(80))).toThrow(/user_/);
  });

  it("rejects a key shorter than the minimum length", () => {
    expect(() => validateKey("user_short")).toThrow(/too short/);
  });
});
