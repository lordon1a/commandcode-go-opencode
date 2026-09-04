#!/usr/bin/env node
/**
 * CLI entry point.
 *
 * Subcommands:
 *   auth login [--key <key>]   Store API key (interactive if no --key).
 *   auth logout                Remove stored key.
 *   auth status                Show whether a key is stored (no value).
 *   serve [--port N] [--host H]
 *                              Start the proxy on the given host/port.
 *   setup-opencode [--write]   Print or write OpenCode provider config.
 *   models                     List Go plan models.
 */
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { authFilePath, deleteKey, loadKey, saveKey } from "./auth.js";
import { startProxy } from "./proxy.js";
import { GO_PLAN_MODELS, resolveModel } from "./models.js";
import { renderOpenCodeConfig } from "./setup.js";

const HELP = `
commandcode-go-opencode — unofficial Go plan bridge for OpenAI/Anthropic clients

Usage:
  commandcode-go-opencode <command> [options]

Commands:
  auth login [--key <key>]    Store API key. Interactive if --key omitted.
  auth logout                 Remove stored key.
  auth status                 Show whether a key is stored (no value printed).
  serve [--port N] [--host H] Start the proxy. Default 127.0.0.1:8787.
  setup-opencode [--write]    Print or write OpenCode provider config (~/.config/opencode/opencode.jsonc).
  models                      List Go plan models.
  help                        Print this help.

Get your API key from https://commandcode.ai/settings/keys.

DISCLAIMER: This is not affiliated with or endorsed by Command Code.
Your account may be suspended for using this tool. See README.
`;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];

  switch (cmd) {
    case "auth": {
      const sub = argv[1];
      if (sub === "login") {
        await cmdAuthLogin(argv.slice(2));
      } else if (sub === "logout") {
        await cmdAuthLogout();
      } else if (sub === "status") {
        await cmdAuthStatus();
      } else {
        process.stderr.write(`Unknown auth subcommand: ${sub}\n${HELP}`);
        process.exit(2);
      }
      break;
    }
    case "serve": {
      await cmdServe(argv.slice(1));
      break;
    }
    case "setup-opencode": {
      await cmdSetupOpenCode(argv.slice(1));
      break;
    }
    case "models": {
      cmdModels();
      break;
    }
    case "help":
    case "--help":
    case "-h":
    case undefined:
      process.stdout.write(HELP);
      break;
    default:
      process.stderr.write(`Unknown command: ${cmd}\n${HELP}`);
      process.exit(2);
  }
}

async function cmdAuthLogin(argv: string[]): Promise<void> {
  const keyIdx = argv.indexOf("--key");
  let raw = keyIdx >= 0 ? argv[keyIdx + 1] : undefined;
  if (!raw) {
    process.stdout.write(
      "Enter your Command Code API key (input is hidden):\n> "
    );
    const rl = createInterface({ input: stdin, output: stdout, terminal: true });
    try {
      raw = await rl.question("");
    } finally {
      rl.close();
    }
  }
  if (!raw) {
    process.stderr.write("No key provided. Aborting.\n");
    process.exit(1);
  }
  await saveKey(raw);
  process.stdout.write(`Saved to ${authFilePath()}\n`);
}

async function cmdAuthLogout(): Promise<void> {
  await deleteKey();
  process.stdout.write(`Removed ${authFilePath()}\n`);
}

async function cmdAuthStatus(): Promise<void> {
  const key = await loadKey();
  if (!key) {
    process.stdout.write(`No key stored at ${authFilePath()}.\n`);
    process.exitCode = 1;
    return;
  }
  // Print length + prefix only — never the full key.
  process.stdout.write(
    `Key stored at ${authFilePath()} (length=${key.length}, prefix=${key.slice(0, 6)}...)\n`
  );
}

async function cmdServe(argv: string[]): Promise<void> {
  const port = readIntFlag(argv, "--port", 8787);
  const host = readStringFlag(argv, "--host", "127.0.0.1");
  const baseURL = readStringFlag(argv, "--base-url", undefined);

  await startProxy({ port, host, baseURL });

  // Stay alive — until SIGINT/SIGTERM.
  const stop = async () => {
    process.stdout.write("\n[bridge] shutting down…\n");
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

async function cmdSetupOpenCode(argv: string[]): Promise<void> {
  const write = argv.includes("--write");
  const out = renderOpenCodeConfig();
  if (!write) {
    process.stdout.write(out + "\n");
    return;
  }
  const { writeOpenCodeConfig } = await import("./setup.js");
  const path = await writeOpenCodeConfig(out);
  process.stdout.write(`Wrote ${path}\n`);
}

function cmdModels(): void {
  process.stdout.write("Go plan models:\n");
  for (const m of GO_PLAN_MODELS) {
    process.stdout.write(
      `  ${m.aliases.join(", ")}  →  ${m.upstreamId}  (${m.displayName})\n`
    );
  }
}

function readIntFlag(argv: string[], name: string, fallback: number): number {
  const idx = argv.indexOf(name);
  if (idx < 0) return fallback;
  const n = Number(argv[idx + 1]);
  return Number.isFinite(n) ? n : fallback;
}

function readStringFlag(
  argv: string[],
  name: string,
  fallback: string | undefined
): string | undefined {
  const idx = argv.indexOf(name);
  if (idx < 0) return fallback;
  return argv[idx + 1] ?? fallback;
}

// Side-effect import for models to keep `resolveModel` referenced (and avoid
// TS6133 with strict noUnusedLocals). The CLI does not currently resolve
// models at runtime, but tests do.
void resolveModel;

main().catch((err) => {
  process.stderr.write(`Error: ${(err as Error).message}\n`);
  process.exit(1);
});
