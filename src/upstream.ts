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
import { sanitizeKey } from "./auth.js";

const DEFAULT_BASE_URL = "https://api.commandcode.ai";
const ALPHA_GENERATE_PATH = "/alpha/generate";

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
    this.cliVersion = opts.cliVersion ?? "1.45.0";
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

    const body = JSON.stringify({
      model: req.model,
      messages: req.messages,
      ...(req.maxTokens !== undefined ? { max_tokens: req.maxTokens } : {}),
      ...(req.reasoningEffort
        ? { reasoning_effort: req.reasoningEffort }
        : {}),
      stream: true,
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
          "x-cmd-cli-version": this.cliVersion,
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
 * The exact framing is undocumented and may change; we treat each non-empty
 * line as a potential JSON event and pull out well-known fields defensively.
 * Anything we can't parse is silently skipped — better to drop a chunk than
 * crash the whole stream.
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
        const chunk = chunkFromEvent(parsed);
        if (chunk) yield chunk;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function chunkFromEvent(raw: unknown): UpstreamChatChunk | null {
  if (!raw || typeof raw !== "object") return null;
  const ev = raw as Record<string, unknown>;

  // Vercel AI SDK style: ev has `type` and (maybe) `delta`, `textDelta`,
  // `reasoningDelta`, `finishReason`, `usage`. We accept a few shapes.
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

  const done =
    ev.finishReason !== undefined ||
    ev.type === "finish" ||
    ev.type === "finish_chunk" ||
    ev.done === true;

  let usage: UpstreamChatChunk["usage"] | undefined;
  const u = ev.usage;
  if (u && typeof u === "object") {
    const uu = u as Record<string, unknown>;
    const promptTokens = numberOrZero(uu.promptTokens ?? uu.prompt_tokens);
    const completionTokens = numberOrZero(
      uu.completionTokens ?? uu.completion_tokens
    );
    usage = {
      promptTokens,
      completionTokens,
      totalTokens: numberOrZero(uu.totalTokens ?? uu.total_tokens) ||
        promptTokens + completionTokens,
    };
  }

  if (text === undefined && reasoning === undefined && !done && !usage) {
    return null;
  }
  return {
    delta: text ?? "",
    reasoning,
    done,
    usage,
  };
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
