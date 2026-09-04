/**
 * Generate an OpenCode provider config block that points at the local proxy.
 *
 * The block is appended to (or, if missing, inserted into) the user's
 * `opencode.jsonc`. We never overwrite other providers — we only add or
 * replace the `commandcode-go` entry by id.
 */
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_PATH = join(
  homedir(),
  ".config",
  "opencode",
  "opencode.jsonc"
);

const PROVIDER_ID = "commandcode-go";

const TEMPLATE = `{
  "$schema": "https://opencode.ai/config.json",
  "providers": {
    "${PROVIDER_ID}": {
      "name": "Command Code (Go, via bridge)",
      "package": "@opencode-ai/ai/providers/openai-compatible",
      "settings": {
        "baseURL": "http://127.0.0.1:8787/v1",
        "apiKey": "proxy-managed"
      },
      "models": {
        "deepseek-v4-flash":   { "name": "DeepSeek V4 Flash" },
        "deepseek-v4-pro":     { "name": "DeepSeek V4 Pro" },
        "kimi-k3":             { "name": "Kimi K3" },
        "kimi-k2.7-code":      { "name": "Kimi K2.7 Code" },
        "glm-5.3-flash":       { "name": "GLM 5.3 Flash" },
        "glm-5.2":             { "name": "GLM 5.2" },
        "minimax-m3":          { "name": "MiniMax M3" },
        "qwen3.7-plus":        { "name": "Qwen 3.7 Plus" },
        "qwen3.7-max":         { "name": "Qwen 3.7 Max" },
        "grok-4.5":            { "name": "Grok 4.5" },
        "step-3.5-flash":      { "name": "Step 3.5 Flash" },
        "gpt-5.6-luna":        { "name": "GPT-5.6 Luna" }
      }
    }
  }
}
`;

export function renderOpenCodeConfig(): string {
  return TEMPLATE;
}

export async function writeOpenCodeConfig(content: string): Promise<string> {
  const dir = join(homedir(), ".config", "opencode");
  await fs.mkdir(dir, { recursive: true });

  // Read existing JSONC (strip comments tolerantly). If parsing fails, we
  // refuse to write — protecting the user's existing config from corruption.
  let existing: Record<string, unknown> = {};
  let raw = "";
  try {
    raw = await fs.readFile(CONFIG_PATH, "utf8");
    const stripped = stripJsonComments(raw);
    existing = JSON.parse(stripped) as Record<string, unknown>;
  } catch (err: unknown) {
    if (isNodeError(err) && err.code !== "ENOENT") {
      throw new Error(
        `Refusing to overwrite ${CONFIG_PATH}: failed to parse (${err.message}). ` +
          `Fix the file manually and re-run.`
      );
    }
  }

  const next = JSON.parse(stripJsonComments(content)) as Record<
    string,
    unknown
  >;
  const providers = (existing.providers as Record<string, unknown> | undefined) ?? {};
  const newProviders = (next.providers as Record<string, unknown>) ?? {};
  // Replace just our slot; leave other providers untouched.
  for (const k of Object.keys(newProviders)) {
    providers[k] = newProviders[k];
  }
  existing.providers = providers;

  // Preserve the user's `$schema` if they have one and we don't.
  if (!existing.$schema && next.$schema) {
    existing.$schema = next.$schema;
  }

  const out = JSON.stringify(existing, null, 2) + "\n";
  // Atomic-ish write: tmp + rename. Same pattern as auth.ts.
  const tmp = `${CONFIG_PATH}.tmp-${process.pid}`;
  await fs.writeFile(tmp, out, "utf8");
  try {
    await fs.rename(tmp, CONFIG_PATH);
  } catch {
    try {
      await fs.unlink(CONFIG_PATH);
    } catch {
      /* ignore */
    }
    await fs.rename(tmp, CONFIG_PATH);
  }
  return CONFIG_PATH;
}

/**
 * Strip JS-style line and block comments, and trailing commas, so we can
 * parse a `.jsonc` file with the standard JSON parser. Not a full JSONC
 * implementation — sufficient for our template, may mis-parse exotic input.
 */
function stripJsonComments(s: string): string {
  let out = "";
  let i = 0;
  let inString = false;
  let stringQuote = "";
  while (i < s.length) {
    const c = s[i];
    const next = s[i + 1];
    if (inString) {
      out += c;
      if (c === "\\" && i + 1 < s.length) {
        out += next;
        i += 2;
        continue;
      }
      if (c === stringQuote) inString = false;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'") {
      inString = true;
      stringQuote = c;
      out += c;
      i += 1;
      continue;
    }
    if (c === "/" && next === "/") {
      while (i < s.length && s[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < s.length && !(s[i] === "*" && s[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    out += c;
    i += 1;
  }
  // Strip trailing commas in objects/arrays: `,\n}` → `\n}`.
  return out.replace(/,(\s*[\]}])/g, "$1");
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return Boolean(err) && typeof err === "object" && "code" in (err as object);
}
