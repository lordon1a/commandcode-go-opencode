/**
 * Thin client over Command Code's `/alpha/generate` endpoint.
 *
 * This is the same endpoint the official CLI uses. The OpenAI-compatible
 * `/provider/v1/*` surface is gated behind the Provider plan (paid add-on).
 * The Go plan ($1/mo) only allows traffic on `/alpha/generate`, which is
 * what this client speaks.
 *
 * The endpoint speaks a Vercel AI SDK stream format — we translate to/from
 * OpenAI Chat Completions in `proxy.ts`.
 */
import { randomUUID } from "node:crypto";
import { sanitizeKey } from "./auth.js";

const DEFAULT_BASE_URL = "https://api.commandcode.ai";
const ALPHA_GENERATE_PATH = "/alpha/generate";
// Must match the official CLI — upstream rejects requests without it
// (upgrade_required). Reverse-engineered from command-code@1.51.2 bundle:
// header CLI_VERSION = "x-command-code-version".
const DEFAULT_CLI_VERSION = "1.51.2";

export interface UpstreamChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface UpstreamChatRequest {
  model: string;
  messages: UpstreamChatMessage[];
  /** Maps loosely to OpenAI's max_tokens. Optional. */
  maxTokens?: number;
  /** "low" | "medium" | "high" | "xhigh" | "max". Optional. */
  reasoningEffort?: "low" | "medium" | "high" | "xhigh" | "max";
  /** Abort signal for client-side cancellation. */
  signal?: AbortSignal;
}

export interface UpstreamChatChunk {
  /** Delta text fragment from the model. */
  delta: string;
  /** Reasoning text (DeepSeek-style thinking), if the model emits it. */
  reasoning?: string;
  /** Set on the final chunk to signal end-of-stream. */
  done?: boolean;
  /** Final usage payload, present only on the last chunk. */
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export class UpstreamError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly upstreamCode?: string
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

export interface UpstreamClientOptions {
  apiKey: string;
  baseURL?: string;
  /** Per-request timeout in ms. Default: 10 minutes. */
  timeoutMs?: number;
  /** CLI version to send as a header, mirrors official CLI behaviour. */
  cliVersion?: string;
}

export class UpstreamClient {
  private readonly apiKey: string;
  private readonly baseURL: string;
  private readonly timeoutMs: number;
  private readonly cliVersion: string;

  constructor(opts: UpstreamClientOptions) {
    // Defensive: refuse to even construct with a tainted key.
    this.apiKey = sanitizeKey(opts.apiKey);
    this.baseURL = (opts.baseURL ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.timeoutMs = opts.timeoutMs ?? 600_000;
    this.cliVersion = opts.cliVersion ?? DEFAULT_CLI_VERSION;
  }

  /**
   * Stream a chat completion. Yields `UpstreamChatChunk` events. The
   * underlying fetch is consumed via ReadableStream<Uint8Array> and parsed
   * line-by-line. The wire format is opaque on purpose — Command Code can
   * evolve it; we only care about emitting OpenAI-shaped chunks.
   */
  async *streamChat(
    req: UpstreamChatRequest
  ): AsyncGenerator<UpstreamChatChunk, void, void> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    // Propagate caller-provided cancellation.
    req.signal?.addEventListener("abort", () => controller.abort());

    // Wire format reverse-engineered from the official CLI (1.51.2): the
    // endpoint speaks an agent-loop envelope, not flat {model, messages}.
    // Minimal shape verified against prod upstream 2026-09-09.
    const { systemParts, chatMessages } = splitWireMessages(req.messages);
    const body = JSON.stringify({
      config: {
        workingDir: process.cwd(),
        date: new Date().toISOString().slice(0, 10),
        environment: process.platform,
        structure: [],
        isGitRepo: false,
        currentBranch: "",
        mainBranch: "",
        gitStatus: "",
        recentCommits: [],
      },
      memory: null,
      taste: null,
      skills: null,
      permissionMode: "auto-accept",
      threadId: randomUUID(),
      params: {
        model: req.model,
        messages: chatMessages,
        tools: [],
        system:
          systemParts.length > 0
            ? systemParts
            : [{ type: "text", text: "You are a helpful assistant." }],
        max_tokens: req.maxTokens ?? 64000,
        stream: true,
        ...(req.reasoningEffort
          ? { reasoning_effort: req.reasoningEffort }
          : {}),
      },
    });

    let response: Response;
    try {
      response = await fetch(`${this.baseURL}${ALPHA_GENERATE_PATH}`, {
        method: "POST",
        headers: {
          // IMPORTANT: never let the key carry trailing whitespace/CRLF —
          // `sanitizeKey` runs in the constructor, but we belt-and-braces
          // here by trimming again before sending.
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          // Header name matters: the old "x-cmd-cli-version" gets
          // upgrade_required from upstream.
          "x-command-code-version": this.cliVersion,
          "User-Agent": "cli",
          "x-cli-environment": "cli",
        },
        body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      const text = await safeReadText(response);
      const code = parseErrorCode(text) ?? undefined;
      throw new UpstreamError(
        `Upstream returned ${response.status}: ${text.slice(0, 200)}`,
        response.status,
        code
      );
    }

    if (!response.body) {
      throw new UpstreamError("Upstream returned no body", 502);
    }

    yield* parseAlphaStream(response.body);
  }
}

/**
 * Parse the /alpha/generate stream format.
 *
 * Current wire format (command-code@1.51.2) is Vercel AI SDK style
 * newline-delimited JSON events:
 *   {"type":"start"} {"type":"start-step",...}
 *   {"type":"text-delta","id":"txt-0","text":"..."}
 *   {"type":"reasoning-delta","id":"...","text":"..."}
 *   {"type":"finish-step",...,"usage":{...}}
 *   {"type":"finish",...,"totalUsage":{...}}
 *   {"type":"error",...}
 * Anything we can't parse is silently skipped — better to drop a chunk than
 * crash the whole stream. Error events abort the stream with UpstreamError.
 */
async function* parseAlphaStream(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<UpstreamChatChunk, void, void> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Split on either \n\n (SSE-style) or \n alone.
      const events = buffer.split(/\r?\n\r?\n|\r?\n/);
      buffer = events.pop() ?? "";

      for (const ev of events) {
        const trimmed = ev.trim();
        if (!trimmed || trimmed.startsWith(":")) continue;
        // Strip a leading "data: " if present (SSE compatibility).
        const payload = trimmed.startsWith("data:")
          ? trimmed.slice(5).trim()
          : trimmed;
        if (payload === "[DONE]") return;

        let parsed: unknown;
        try {
          parsed = JSON.parse(payload);
        } catch {
          continue;
        }
        throwOnStreamError(parsed);
        const chunk = chunkFromEvent(parsed);
        if (chunk) yield chunk;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function throwOnStreamError(raw: unknown): void {
  if (!raw || typeof raw !== "object") return;
  const ev = raw as Record<string, unknown>;
  if (ev.type !== "error") return;
  const inner = ev.error;
  let message = "Upstream stream error.";
  let status: number | undefined;
  if (typeof inner === "string" && inner) {
    message = inner;
  } else if (inner && typeof inner === "object") {
    const o = inner as Record<string, unknown>;
    if (typeof o.message === "string" && o.message) message = o.message;
    if (typeof o.statusCode === "number") status = o.statusCode;
  } else if (typeof ev.message === "string" && ev.message) {
    message = ev.message;
  }
  throw new UpstreamError(message, status ?? 502);
}

function chunkFromEvent(raw: unknown): UpstreamChatChunk | null {
  if (!raw || typeof raw !== "object") return null;
  const ev = raw as Record<string, unknown>;
  const type = typeof ev.type === "string" ? ev.type : undefined;

  if (type === "text-delta") {
    const text = typeof ev.text === "string" ? ev.text : "";
    if (!text) return null;
    return { delta: text };
  }

  if (type === "reasoning-delta") {
    const text =
      typeof ev.text === "string"
        ? ev.text
        : typeof ev.reasoning === "string"
          ? ev.reasoning
          : "";
    if (!text) return null;
    return { delta: "", reasoning: text };
  }

  if (type === "finish-step") {
    const usage = readUsage(ev.usage);
    if (!usage) return null;
    // A step finished but the turn may continue; don't mark done yet.
    return { delta: "", usage };
  }

  if (type === "finish") {
    const usage = readUsage(ev.totalUsage ?? ev.usage);
    return { delta: "", done: true, usage };
  }

  // Terminal markers without a "finish" event.
  if (ev.finishReason !== undefined || ev.done === true) {
    const usage = readUsage(ev.usage ?? ev.totalUsage);
    return { delta: "", done: true, usage };
  }

  // Legacy fallback (pre-1.5x wire format): ev has `delta`, `textDelta`,
  // `text`, `reasoningDelta` or `reasoning` without a `type`.
  if (type === undefined) {
    const text =
      typeof ev.delta === "string"
        ? ev.delta
        : typeof ev.textDelta === "string"
          ? ev.textDelta
          : typeof ev.text === "string"
            ? ev.text
            : undefined;
    const reasoning =
      typeof ev.reasoningDelta === "string"
        ? ev.reasoningDelta
        : typeof ev.reasoning === "string"
          ? ev.reasoning
          : undefined;
    const usage = readUsage(ev.usage ?? ev.totalUsage);
    if (text === undefined && reasoning === undefined && !usage) return null;
    return { delta: text ?? "", reasoning, usage };
  }

  // start, start-step, text-start, text-end, reasoning-start, reasoning-end,
  // tool-call, provider-metadata, etc. carry no text for our clients.
  return null;
}

function readUsage(u: unknown): UpstreamChatChunk["usage"] | undefined {
  if (!u || typeof u !== "object") return undefined;
  const uu = u as Record<string, unknown>;
  // Wire uses inputTokens/outputTokens (AI SDK); accept legacy aliases too.
  const promptTokens = numberOrZero(
    uu.inputTokens ?? uu.promptTokens ?? uu.input_tokens ?? uu.prompt_tokens
  );
  const completionTokens = numberOrZero(
    uu.outputTokens ??
      uu.completionTokens ??
      uu.output_tokens ??
      uu.completion_tokens
  );
  const totalTokens =
    numberOrZero(uu.totalTokens ?? uu.total_tokens) ||
    promptTokens + completionTokens;
  if (!promptTokens && !completionTokens && !totalTokens) return undefined;
  return { promptTokens, completionTokens, totalTokens };
}

/**
 * Split normalized {role, content} messages into the AI SDK wire shape the
 * upstream expects: system prompts go to params.system as text parts,
 * user/assistant turns go to params.messages with text-part content.
 */
function splitWireMessages(messages: UpstreamChatMessage[]): {
  systemParts: Array<{ type: "text"; text: string }>;
  chatMessages: Array<{
    role: "user" | "assistant";
    content: Array<{ type: "text"; text: string }>;
  }>;
} {
  const systemParts: Array<{ type: "text"; text: string }> = [];
  const chatMessages: Array<{
    role: "user" | "assistant";
    content: Array<{ type: "text"; text: string }>;
  }> = [];
  for (const m of messages) {
    if (!m.content) continue;
    if (m.role === "system") {
      systemParts.push({ type: "text", text: m.content });
    } else {
      chatMessages.push({
        role: m.role === "assistant" ? "assistant" : "user",
        content: [{ type: "text", text: m.content }],
      });
    }
  }
  return { systemParts, chatMessages };
}

function numberOrZero(n: unknown): number {
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "<failed to read body>";
  }
}

function parseErrorCode(text: string): string | null {
  try {
    const j = JSON.parse(text) as { error?: { code?: unknown } };
    if (j.error && typeof j.error.code === "string") return j.error.code;
  } catch {
    /* not JSON */
  }
  return null;
}
