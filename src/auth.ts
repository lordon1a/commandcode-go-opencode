/**
 * Authentication storage for Command Code API keys.
 *
 * Why this exists:
 * - Command Code CLI stores its key in `~/.commandcode/auth.json`.
 * - Manually pasting the key on Windows can leave CRLF (`\r\n`) characters
 *   embedded in the value, which makes the upstream API reject the request
 *   with `Headers.append: "Bearer ...\r\n..." is an invalid header value`.
 * - We strip CR/LF/tab/NUL from any input and validate the token format
 *   before persisting it.
 */
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const AUTH_DIR = join(homedir(), ".config", "commandcode-go-opencode");
const AUTH_FILE = join(AUTH_DIR, "auth.json");

/**
 * Command Code user API keys start with `user_`. This is a defence-in-depth
 * check, not a strict spec — Command Code can change it.
 */
const KEY_PREFIX = "user_";
const KEY_MIN_LENGTH = 32;

export interface StoredAuth {
  apiKey: string;
  savedAt: string;
}

/**
 * Aggressively normalise a raw key string so it can be safely embedded in
 * an HTTP header. Strips ASCII whitespace (incl. CR/LF), tabs, NUL, and any
 * surrounding quotes the user might have pasted along with the key.
 */
export function sanitizeKey(raw: string): string {
  let v = raw.trim();

  // Strip surrounding quotes the user might paste in.
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1);
  }

  // Remove any whitespace, tabs, or control characters that snuck in.
  // eslint-disable-next-line no-control-regex
  v = v.replace(/[\s\u0000-\u001f\u007f]/g, "");

  return v;
}

/**
 * Throws a descriptive error if the key looks malformed. We never log the key.
 */
export function validateKey(key: string): void {
  if (!key) {
    throw new Error("API key is empty.");
  }
  if (!key.startsWith(KEY_PREFIX)) {
    throw new Error(
      `API key must start with "${KEY_PREFIX}". ` +
        `Get your key from https://commandcode.ai/settings/keys.`
    );
  }
  if (key.length < KEY_MIN_LENGTH) {
    throw new Error(
      `API key looks too short (${key.length} chars). ` +
        `Expected at least ${KEY_MIN_LENGTH}.`
    );
  }
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(AUTH_DIR, { recursive: true, mode: 0o700 });
}

/**
 * Persist the API key to disk in atomic write fashion.
 *
 * Atomic: writes to a temp file in the same directory and renames. On Windows
 * `rename` over an existing file can throw `EPERM`; we unlink the target
 * first when needed.
 */
export async function saveKey(rawKey: string): Promise<void> {
  const key = sanitizeKey(rawKey);
  validateKey(key);

  await ensureDir();

  const payload: StoredAuth = {
    apiKey: key,
    savedAt: new Date().toISOString(),
  };

  const tmp = `${AUTH_FILE}.tmp-${process.pid}`;
  const json = JSON.stringify(payload, null, 2);

  // Always write in LF mode — Node respects the input string exactly when
  // we pass it as a Buffer with no encoding hint. UTF-8, no BOM.
  await fs.writeFile(tmp, Buffer.from(json, "utf8"));
  try {
    await fs.rename(tmp, AUTH_FILE);
  } catch (err: unknown) {
    // Best-effort retry: unlink target then rename.
    try {
      await fs.unlink(AUTH_FILE);
    } catch {
      /* ignore */
    }
    await fs.rename(tmp, AUTH_FILE);
    void err;
  }

  // Tighten permissions on POSIX; no-op on Windows where chmod is limited.
  try {
    await fs.chmod(AUTH_FILE, 0o600);
  } catch {
    /* ignore */
  }
}

export async function loadKey(): Promise<string | null> {
  try {
    const buf = await fs.readFile(AUTH_FILE);
    const text = buf.toString("utf8");
    const parsed = JSON.parse(text) as Partial<StoredAuth>;
    const key = sanitizeKey(parsed.apiKey ?? "");
    return key || null;
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

export async function deleteKey(): Promise<void> {
  try {
    await fs.unlink(AUTH_FILE);
  } catch (err: unknown) {
    if (isNodeError(err) && err.code !== "ENOENT") {
      throw err;
    }
  }
}

/** Returns the path so callers can show it in messages. */
export function authFilePath(): string {
  return AUTH_FILE;
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return Boolean(err) && typeof err === "object" && "code" in (err as object);
}
