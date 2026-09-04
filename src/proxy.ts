/**
 * OpenAI / Anthropic compatible HTTP server.
 *
 * Listens on 127.0.0.1:<port> by default and exposes:
 *   GET  /health
 *   GET  /v1/models
 *   POST /v1/chat/completions
 *   POST /v1/messages                  (Anthropic-shaped)
 *
 * The proxy authenticates the upstream with the user's stored Command Code
 * key. Clients (OpenCode, Claude Code, curl) can pass any non-empty
 * Authorization header — we treat the local loopback as trusted and don't
 * re-authenticate clients, because shipping a separate client-side secret
 * would defeat the point of localhost-only operation.
 */
import express, { type Request, type Response } from "express";
import type { Server } from "node:http";
import { loadKey, authFilePath } from "./auth.js";
import {
  GO_PLAN_MODELS,
  resolveModel,
  type ModelInfo,
} from "./models.js";
import { UpstreamClient, UpstreamError } from "./upstream.js";

export interface ProxyOptions {
  host?: string;
  port?: number;
  baseURL?: string;
  timeoutMs?: number;
  cliVersion?: string;
}

export interface RunningProxy {
  url: string;
  port: number;
  close: () => Promise<void>;
}

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8787;

export async function startProxy(opts: ProxyOptions = {}): Promise<RunningProxy> {
  const host = opts.host ?? DEFAULT_HOST;
  const port = opts.port ?? DEFAULT_PORT;

  const apiKey = await loadKey();
  if (!apiKey) {
    throw new Error(
      `No API key stored at ${authFilePath()}. ` +
        `Run "commandcode-go-opencode auth login" first.`
    );
  }

  const upstream = new UpstreamClient({
    apiKey,
    baseURL: opts.baseURL,
    timeoutMs: opts.timeoutMs,
    cliVersion: opts.cliVersion,
  });

  const app = express();
  app.use(express.json({ limit: "10mb" }));

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", version: "0.1.0" });
  });

  app.get("/v1/models", (_req: Request, res: Response) => {
    res.json({
      object: "list",
      data: GO_PLAN_MODELS.map((m) => ({
        id: m.aliases[0] ?? m.upstreamId,
        object: "model",
        owned_by: "command-code",
        // OpenCode and similar clients read these fields.
        name: m.displayName,
        context_window: m.contextWindow,
        // Expose the upstream id so advanced clients can flip it.
        upstream_id: m.upstreamId,
      })),
    });
  });

  app.post("/v1/chat/completions", handleChatCompletions(upstream));

  // Anthropic Messages API — minimal compatible surface. We only translate
  // the common fields; clients should keep their request shape close to the
  // official Anthropic spec.
  app.post("/v1/messages", handleAnthropicMessages(upstream));

  const server: Server = await new Promise((resolve, reject) => {
    const s = app.listen(port, host, () => resolve(s));
    s.once("error", reject);
  });

  const url = `http://${host}:${port}`;
  // eslint-disable-next-line no-console
  console.log(`[bridge] listening on ${url}`);
  // eslint-disable-next-line no-console
  console.log(`[bridge] upstream: ${opts.baseURL ?? "default"}`);
  // eslint-disable-next-line no-console
  console.log(
    `[bridge] models available: ${GO_PLAN_MODELS.length} (Go plan + Luna)`
  );

  return {
    url,
    port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

function handleChatCompletions(upstream: UpstreamClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const body = req.body as Partial<ChatCompletionRequest> | undefined;
    if (!body || !Array.isArray(body.messages)) {
      res.status(400).json({
        error: {
          message: "Request must include `messages` array.",
          type: "invalid_request_error",
        },
      });
      return;
    }

    const requested = String(body.model ?? "");
    const model = resolveModel(requested);
    if (!model) {
      res.status(400).json({
        error: {
          message:
            `Model "${requested}" is not on the Go plan. ` +
            `Use GET /v1/models to list available models.`,
          type: "invalid_request_error",
          code: "unsupported_model",
        },
      });
      return;
    }

    const messages = normaliseMessages(body.messages);
    if (messages.length === 0) {
      res.status(400).json({
        error: {
          message: "`messages` is empty after normalisation.",
          type: "invalid_request_error",
        },
      });
      return;
    }

    const wantsStream = body.stream === true;
    const upstreamReq = {
      model: model.upstreamId,
      messages,
      maxTokens: body.max_tokens,
      reasoningEffort: normaliseEffort(body.reasoning_effort),
      signal: clientAbortSignal(req),
    };

    if (!wantsStream) {
      try {
        let content = "";
        let reasoning = "";
        let usage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined;
        for await (const chunk of upstream.streamChat(upstreamReq)) {
          if (chunk.delta) content += chunk.delta;
          if (chunk.reasoning) reasoning += chunk.reasoning;
          if (chunk.usage) usage = chunk.usage;
        }
        res.json({
          id: `chatcmpl-${cryptoRandom()}`,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: model.aliases[0] ?? model.upstreamId,
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content,
                ...(reasoning ? { reasoning_content: reasoning } : {}),
              },
              finish_reason: "stop",
            },
          ],
          usage: usage
            ? {
                prompt_tokens: usage.promptTokens,
                completion_tokens: usage.completionTokens,
                total_tokens: usage.totalTokens,
              }
            : undefined,
        });
      } catch (err) {
        respondUpstreamError(err, res);
      }
      return;
    }

    // Streaming: emit OpenAI-style SSE chunks.
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const id = `chatcmpl-${cryptoRandom()}`;
    const created = Math.floor(Date.now() / 1000);
    const outModel = model.aliases[0] ?? model.upstreamId;

    try {
      // Initial role chunk so OpenAI clients render an empty bubble.
      res.write(
        `data: ${JSON.stringify({
          id,
          object: "chat.completion.chunk",
          created,
          model: outModel,
          choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
        })}\n\n`
      );

      let sentReasoningRole = false;
      for await (const chunk of upstream.streamChat(upstreamReq)) {
        if (chunk.reasoning && !sentReasoningRole) {
          // OpenAI has no first-class reasoning channel; mirror Claude's
          // pattern by emitting a `reasoning_content` delta on the first
          // reasoning chunk.
          res.write(
            `data: ${JSON.stringify({
              id,
              object: "chat.completion.chunk",
              created,
              model: outModel,
              choices: [
                {
                  index: 0,
                  delta: { reasoning_content: chunk.reasoning },
                  finish_reason: null,
                },
              ],
            })}\n\n`
          );
          sentReasoningRole = true;
        } else if (chunk.reasoning) {
          res.write(
            `data: ${JSON.stringify({
              id,
              object: "chat.completion.chunk",
              created,
              model: outModel,
              choices: [
                {
                  index: 0,
                  delta: { reasoning_content: chunk.reasoning },
                  finish_reason: null,
                },
              ],
            })}\n\n`
          );
        }

        if (chunk.delta) {
          res.write(
            `data: ${JSON.stringify({
              id,
              object: "chat.completion.chunk",
              created,
              model: outModel,
              choices: [
                {
                  index: 0,
                  delta: { content: chunk.delta },
                  finish_reason: null,
                },
              ],
            })}\n\n`
          );
        }

        if (chunk.done) {
          res.write(
            `data: ${JSON.stringify({
              id,
              object: "chat.completion.chunk",
              created,
              model: outModel,
              choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            })}\n\n`
          );
        }
      }

      res.write(`data: [DONE]\n\n`);
      res.end();
    } catch (err) {
      // On error mid-stream, send an OpenAI-style error frame and close.
      const status =
        err instanceof UpstreamError ? err.status : 502;
      const message =
        err instanceof Error ? err.message : "Unknown upstream error.";
      res.write(
        `data: ${JSON.stringify({
          error: { message, type: "server_error", code: status },
        })}\n\n`
      );
      res.end();
    }
  };
}

function handleAnthropicMessages(upstream: UpstreamClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const body = req.body as Partial<AnthropicMessagesRequest> | undefined;
    if (!body || !Array.isArray(body.messages)) {
      res.status(400).json({
        type: "error",
        error: {
          type: "invalid_request_error",
          message: "Request must include `messages` array.",
        },
      });
      return;
    }

    const requested = String(body.model ?? "");
    const model = resolveModel(requested);
    if (!model) {
      res.status(400).json({
        type: "error",
        error: {
          type: "invalid_request_error",
          message: `Model "${requested}" is not on the Go plan.`,
        },
      });
      return;
    }

    const systemText = extractAnthropicSystem(body.system);
    const messages: { role: "system" | "user" | "assistant"; content: string }[] = [];
    if (systemText) {
      // Command Code's /alpha/generate accepts system as a first-class role.
      messages.push({ role: "system", content: systemText });
    }
    for (const m of body.messages) {
      const role = m.role === "assistant" ? "assistant" : "user";
      messages.push({ role, content: flattenAnthropicContent(m.content) });
    }

    const wantsStream = body.stream === true;
    const upstreamReq = {
      model: model.upstreamId,
      messages,
      maxTokens: body.max_tokens,
      signal: clientAbortSignal(req),
    };

    if (!wantsStream) {
      try {
        let content = "";
        let usage:
          | { promptTokens: number; completionTokens: number; totalTokens: number }
          | undefined;
        for await (const chunk of upstream.streamChat(upstreamReq)) {
          if (chunk.delta) content += chunk.delta;
          if (chunk.usage) usage = chunk.usage;
        }
        res.json({
          id: `msg_${cryptoRandom()}`,
          type: "message",
          role: "assistant",
          model: model.aliases[0] ?? model.upstreamId,
          content: [{ type: "text", text: content }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: {
            input_tokens: usage?.promptTokens ?? 0,
            output_tokens: usage?.completionTokens ?? 0,
          },
        });
      } catch (err) {
        respondAnthropicError(err, res);
      }
      return;
    }

    // Anthropic SSE format.
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const id = `msg_${cryptoRandom()}`;
    const outModel = model.aliases[0] ?? model.upstreamId;

    try {
      sendAnthropicEvent(res, "message_start", {
        type: "message_start",
        message: {
          id,
          type: "message",
          role: "assistant",
          model: outModel,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      });

      let inputTokens = 0;
      let outputTokens = 0;
      const textBlockOpen = (index: number) =>
        sendAnthropicEvent(res, "content_block_start", {
          type: "content_block_start",
          index,
          content_block: { type: "text", text: "" },
        });
      const textBlockDelta = (index: number, text: string) =>
        sendAnthropicEvent(res, "content_block_delta", {
          type: "content_block_delta",
          index,
          delta: { type: "text_delta", text },
        });
      const textBlockStop = (index: number) =>
        sendAnthropicEvent(res, "content_block_stop", {
          type: "content_block_stop",
          index,
        });

      let blockIndex = -1;
      let blockOpen = false;
      for await (const chunk of upstream.streamChat(upstreamReq)) {
        if (chunk.usage) {
          inputTokens = chunk.usage.promptTokens;
          outputTokens = chunk.usage.completionTokens;
        }
        if (chunk.delta) {
          if (!blockOpen) {
            blockIndex += 1;
            textBlockOpen(blockIndex);
            blockOpen = true;
          }
          textBlockDelta(blockIndex, chunk.delta);
        }
      }
      if (blockOpen) textBlockStop(blockIndex);
      sendAnthropicEvent(res, "message_delta", {
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { input_tokens: inputTokens, output_tokens: outputTokens },
      });
      sendAnthropicEvent(res, "message_stop", { type: "message_stop" });
      res.end();
    } catch (err) {
      const status = err instanceof UpstreamError ? err.status : 502;
      const message =
        err instanceof Error ? err.message : "Unknown upstream error.";
      res.write(
        `event: error\ndata: ${JSON.stringify({
          type: "error",
          error: { type: "api_error", message },
        })}\n\n`
      );
      res.end();
      void status;
    }
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ChatCompletionRequest {
  model: string;
  messages: Array<{ role: string; content: unknown }>;
  stream?: boolean;
  max_tokens?: number;
  reasoning_effort?: string;
}

interface AnthropicMessagesRequest {
  model: string;
  messages: Array<{ role: string; content: unknown }>;
  system?: unknown;
  max_tokens?: number;
  stream?: boolean;
}

function normaliseMessages(
  raw: Array<{ role: string; content: unknown }>
): { role: "system" | "user" | "assistant"; content: string }[] {
  const out: { role: "system" | "user" | "assistant"; content: string }[] = [];
  for (const m of raw) {
    const role =
      m.role === "system" || m.role === "assistant" ? m.role : "user";
    const text = typeof m.content === "string"
      ? m.content
      : Array.isArray(m.content)
        ? m.content
            .map((p) => extractTextFromPart(p))
            .filter(Boolean)
            .join("\n")
        : "";
    if (text) out.push({ role, content: text });
  }
  return out;
}

function extractTextFromPart(part: unknown): string {
  if (!part || typeof part !== "object") return "";
  const p = part as Record<string, unknown>;
  if (typeof p.text === "string") return p.text;
  return "";
}

function normaliseEffort(
  v: unknown
): "low" | "medium" | "high" | "xhigh" | "max" | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.toLowerCase();
  if (s === "low" || s === "medium" || s === "high" || s === "xhigh" || s === "max") {
    return s;
  }
  return undefined;
}

function extractAnthropicSystem(system: unknown): string {
  if (!system) return "";
  if (typeof system === "string") return system;
  if (Array.isArray(system)) {
    return system
      .map((p) => (typeof p === "object" && p && "text" in p ? String((p as Record<string, unknown>).text) : ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function flattenAnthropicContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => (typeof p === "object" && p && "text" in p ? String((p as Record<string, unknown>).text) : ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function sendAnthropicEvent(
  res: Response,
  event: string,
  data: unknown
): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function respondUpstreamError(err: unknown, res: Response): void {
  if (err instanceof UpstreamError) {
    res.status(err.status >= 400 && err.status < 600 ? err.status : 502).json({
      error: {
        message: err.message,
        type: err.status === 401 ? "authentication_error"
          : err.status === 403 ? "permission_error"
          : err.status === 429 ? "rate_limit_error"
          : err.status === 400 ? "invalid_request_error"
          : "server_error",
        code: err.upstreamCode,
      },
    });
    return;
  }
  const message = err instanceof Error ? err.message : "Unknown error.";
  res.status(502).json({
    error: { message, type: "server_error" },
  });
}

function respondAnthropicError(err: unknown, res: Response): void {
  if (err instanceof UpstreamError) {
    res.status(err.status >= 400 && err.status < 600 ? err.status : 502).json({
      type: "error",
      error: {
        type: err.status === 401 ? "authentication_error"
          : err.status === 403 ? "permission_error"
          : err.status === 429 ? "rate_limit_error"
          : "api_error",
        message: err.message,
      },
    });
    return;
  }
  const message = err instanceof Error ? err.message : "Unknown error.";
  res.status(502).json({
    type: "error",
    error: { type: "api_error", message },
  });
}

/**
 * Express doesn't expose `req.signal` on the base Request. We adapt the
 * client's disconnect event into an AbortSignal so we can cancel the
 * upstream fetch when the client goes away mid-stream.
 */
function clientAbortSignal(req: Request): AbortSignal {
  const controller = new AbortController();
  if (req.aborted) {
    controller.abort();
  } else {
    req.on("close", () => controller.abort());
  }
  return controller.signal;
}

function cryptoRandom(): string {
  // 16 bytes of randomness as hex. Sufficient for request ids; not security
  // sensitive — clients don't validate these.
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Re-export for tests that want to peek at the resolved model map. */
export const _internal = { resolveModel };

/** ModelInfo is exported for tests. */
export type { ModelInfo };
