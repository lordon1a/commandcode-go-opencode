/**
 * Go-plan model catalogue + alias resolution.
 *
 * Command Code's Go plan includes a curated set of open-weight and a few
 * premium (Luna, Grok 4.5, Qwen Max/Plus) models. The full Provider API
 * catalogue is gated behind the Provider plan, but `/alpha/generate` (the
 * endpoint the CLI itself uses) accepts these IDs without that gate.
 *
 * The list here mirrors what's live on
 * https://commandcode.ai/docs/plans/go at the time of writing.
 */
export interface ModelInfo {
  /** Aliases users can type; the first one is the canonical short form. */
  aliases: string[];
  /** The exact ID Command Code's upstream expects. */
  upstreamId: string;
  /** Display name shown in client pickers. */
  displayName: string;
  /** Context window in tokens (input). */
  contextWindow: number;
}

/**
 * Models available on the Go plan. Premium-only models (Claude, GPT-5.6
 * Sol/Terra, Gemini 3.5+, Muse Spark >1.2) are intentionally omitted — they
 * will be rejected upstream.
 */
export const GO_PLAN_MODELS: readonly ModelInfo[] = [
  {
    aliases: ["deepseek-v4-flash", "deepseek-flash"],
    upstreamId: "deepseek/deepseek-v4-flash",
    displayName: "DeepSeek V4 Flash",
    contextWindow: 1_000_000,
  },
  {
    aliases: ["deepseek-v4-pro", "deepseek-pro", "deepseek-v4"],
    upstreamId: "deepseek/deepseek-v4-pro",
    displayName: "DeepSeek V4 Pro",
    contextWindow: 1_000_000,
  },
  {
    aliases: ["kimi-k3", "kimi3"],
    upstreamId: "moonshotai/Kimi-K3",
    displayName: "Kimi K3",
    contextWindow: 1_000_000,
  },
  {
    aliases: ["kimi-k2.7-code", "kimi-code"],
    upstreamId: "moonshotai/Kimi-K2.7-Code",
    displayName: "Kimi K2.7 Code",
    contextWindow: 256_000,
  },
  {
    aliases: ["kimi-k2.7-highspeed", "kimi-highspeed"],
    upstreamId: "moonshotai/Kimi-K2.7-Code-Highspeed",
    displayName: "Kimi K2.7 Code HighSpeed",
    contextWindow: 262_000,
  },
  {
    aliases: ["kimi-k2.6", "kimi2.6"],
    upstreamId: "moonshotai/Kimi-K2.6",
    displayName: "Kimi K2.6",
    contextWindow: 256_000,
  },
  {
    aliases: ["glm-5.3-flash", "glm-flash"],
    upstreamId: "z-ai/glm-5.3-flash",
    displayName: "GLM-5.3 Flash",
    contextWindow: 1_048_576,
  },
  {
    aliases: ["glm-5.2", "glm5.2"],
    upstreamId: "zai-org/GLM-5.2",
    displayName: "GLM-5.2",
    contextWindow: 1_000_000,
  },
  {
    aliases: ["glm-5.1", "glm5.1"],
    upstreamId: "zai-org/GLM-5.1",
    displayName: "GLM-5.1",
    contextWindow: 200_000,
  },
  {
    aliases: ["minimax-m3", "minimax3"],
    upstreamId: "MiniMaxAI/MiniMax-M3",
    displayName: "MiniMax M3",
    contextWindow: 1_000_000,
  },
  {
    aliases: ["minimax-m2.7", "minimax2.7"],
    upstreamId: "MiniMaxAI/MiniMax-M2.7",
    displayName: "MiniMax M2.7",
    contextWindow: 200_000,
  },
  {
    aliases: ["qwen3.7-max", "qwen-3.7-max"],
    upstreamId: "Qwen/Qwen3.7-Max",
    displayName: "Qwen 3.7 Max",
    contextWindow: 1_000_000,
  },
  {
    aliases: ["qwen3.7-plus", "qwen-3.7-plus"],
    upstreamId: "Qwen/Qwen3.7-Plus",
    displayName: "Qwen 3.7 Plus",
    contextWindow: 1_000_000,
  },
  {
    aliases: ["qwen3.8-flash", "qwen-flash"],
    upstreamId: "Qwen/Qwen3.8-Flash",
    displayName: "Qwen 3.8 Flash",
    contextWindow: 1_000_000,
  },
  {
    aliases: ["grok-4.5", "grok4.5"],
    upstreamId: "xai/grok-4.5",
    displayName: "Grok 4.5",
    contextWindow: 500_000,
  },
  {
    aliases: ["step-3.5-flash", "step3.5"],
    upstreamId: "stepfun/Step-3.5-Flash",
    displayName: "Step 3.5 Flash",
    contextWindow: 1_000_000,
  },
  {
    aliases: ["gpt-5.6-luna", "luna"],
    upstreamId: "gpt-5.6-luna",
    displayName: "GPT-5.6 Luna",
    contextWindow: 1_050_000,
  },
];

const ALIAS_TO_MODEL: ReadonlyMap<string, ModelInfo> = (() => {
  const m = new Map<string, ModelInfo>();
  for (const model of GO_PLAN_MODELS) {
    m.set(model.upstreamId.toLowerCase(), model);
    for (const a of model.aliases) {
      m.set(a.toLowerCase(), model);
    }
  }
  return m;
})();

/**
 * Resolve a free-form model id to a known ModelInfo. Returns null if the
 * model isn't on the Go plan list — the upstream will reject it anyway,
 * but checking here lets us return a clearer error.
 */
export function resolveModel(idOrAlias: string): ModelInfo | null {
  return ALIAS_TO_MODEL.get(idOrAlias.toLowerCase()) ?? null;
}

export function listModels(): readonly ModelInfo[] {
  return GO_PLAN_MODELS;
}
