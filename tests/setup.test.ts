/**
 * Tests for the OpenCode config writer. We verify that:
 *  - The generated block is valid JSON.
 *  - It points at the local proxy baseURL.
 *  - It contains the model aliases the Go plan supports.
 */
import { describe, it, expect } from "vitest";
import { renderOpenCodeConfig } from "../src/setup.js";

describe("renderOpenCodeConfig", () => {
  it("produces valid JSON", () => {
    const cfg = renderOpenCodeConfig();
    expect(() => JSON.parse(stripComments(cfg))).not.toThrow();
  });

  it("points at the local proxy", () => {
    const cfg = renderOpenCodeConfig();
    expect(cfg).toContain("http://127.0.0.1:8787/v1");
  });

  it("uses the openai-compatible package", () => {
    const cfg = renderOpenCodeConfig();
    expect(cfg).toContain("@ai-sdk/openai-compatible");
  });

  it("uses the current provider schema", () => {
    const cfg = JSON.parse(stripComments(renderOpenCodeConfig()));
    expect(cfg.provider["commandcode-go"].options.baseURL).toBe(
      "http://127.0.0.1:8787/v1"
    );
    expect(cfg.providers).toBeUndefined();
  });

  it("includes the Go plan flagship models", () => {
    const cfg = renderOpenCodeConfig();
    const required = [
      "deepseek-v4-flash",
      "deepseek-v4-pro",
      "kimi-k3",
      "glm-5.3-flash",
      "minimax-m3",
      "gpt-5.6-luna",
    ];
    for (const m of required) {
      expect(cfg).toContain(`"${m}"`);
    }
  });
});

function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}
