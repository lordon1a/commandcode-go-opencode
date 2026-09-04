/**
 * Model registry tests: aliases, upstream ids, and the gate against
 * Provider-plan-only models leaking into the list.
 */
import { describe, it, expect } from "vitest";
import { GO_PLAN_MODELS, listModels, resolveModel } from "../src/models.js";

describe("resolveModel", () => {
  it("resolves by canonical alias", () => {
    const m = resolveModel("deepseek-v4-flash");
    expect(m?.upstreamId).toBe("deepseek/deepseek-v4-flash");
  });

  it("resolves by upstream id directly", () => {
    const m = resolveModel("deepseek/deepseek-v4-flash");
    expect(m?.displayName).toBe("DeepSeek V4 Flash");
  });

  it("is case-insensitive", () => {
    expect(resolveModel("DeepSeek-V4-Flash")?.upstreamId).toBe(
      "deepseek/deepseek-v4-flash"
    );
    expect(resolveModel("DEEPSEEK-V4-PRO")?.upstreamId).toBe(
      "deepseek/deepseek-v4-pro"
    );
  });

  it("returns null for unknown models", () => {
    expect(resolveModel("claude-opus-99")).toBeNull();
    expect(resolveModel("gpt-999")).toBeNull();
  });

  it("never lists premium-only Provider-plan models", () => {
    // These models are NOT on the Go plan and must not resolve.
    expect(resolveModel("claude-sonnet-4-6")).toBeNull();
    expect(resolveModel("claude-opus-4-8")).toBeNull();
    expect(resolveModel("gpt-5.6-sol")).toBeNull();
    expect(resolveModel("gpt-5.6-terra")).toBeNull();
    expect(resolveModel("google/gemini-3.8-flash")).toBeNull();
  });
});

describe("GO_PLAN_MODELS", () => {
  it("has no duplicate aliases", () => {
    const seen = new Set<string>();
    for (const m of GO_PLAN_MODELS) {
      for (const a of m.aliases) {
        expect(seen.has(a), `duplicate alias: ${a}`).toBe(false);
        seen.add(a);
      }
    }
  });

  it("has no duplicate upstream ids", () => {
    const ids = GO_PLAN_MODELS.map((m) => m.upstreamId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("includes the Go-plan premium-tier models (Luna, Grok 4.5, Qwen Max/Plus)", () => {
    expect(resolveModel("gpt-5.6-luna")).not.toBeNull();
    expect(resolveModel("grok-4.5")).not.toBeNull();
    expect(resolveModel("qwen3.7-max")).not.toBeNull();
    expect(resolveModel("qwen3.7-plus")).not.toBeNull();
  });

  it("listModels returns the same array", () => {
    expect(listModels()).toBe(GO_PLAN_MODELS);
  });
});
