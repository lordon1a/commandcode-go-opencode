#!/usr/bin/env bash
# setup-opencode.sh — POSIX equivalent of scripts/setup-opencode.ps1.

set -euo pipefail

cfgDir="$HOME/.config/opencode"
cfgPath="$cfgDir/opencode.jsonc"

mkdir -p "$cfgDir"

if [[ -f "$cfgPath" ]]; then
    echo "Found existing $cfgPath — will preserve other providers."
fi

# We write the merged config via a small Node.js snippet to avoid having to
# shell out to jq (not always installed) and to keep JSON validity tight.
node - <<'NODE'
const fs = require("fs");
const path = require("path");
const cfgPath = path.join(process.env.HOME, ".config", "opencode", "opencode.jsonc");

function stripJsonc(src) {
  let out = "";
  let i = 0;
  let inStr = false;
  let quote = "";
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (inStr) {
      out += c;
      if (c === "\\" && i + 1 < src.length) { out += n; i += 2; continue; }
      if (c === quote) inStr = false;
      i += 1; continue;
    }
    if (c === '"' || c === "'") { inStr = true; quote = c; out += c; i += 1; continue; }
    if (c === "/" && n === "/") { while (i < src.length && src[i] !== "\n") i += 1; continue; }
    if (c === "/" && n === "*") { i += 2; while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i += 1; i += 2; continue; }
    out += c; i += 1;
  }
  return out.replace(/,(\s*[\]}])/g, "$1");
}

let existing = { providers: {} };
try {
  const raw = fs.readFileSync(cfgPath, "utf8");
  existing = JSON.parse(stripJsonc(raw));
  if (!existing.providers || typeof existing.providers !== "object") {
    existing.providers = {};
  }
} catch (err) {
  if (err.code !== "ENOENT") {
    console.error(`Refusing to overwrite ${cfgPath}: ${err.message}`);
    process.exit(1);
  }
}

existing.providers = existing.providers || {};
existing.providers["commandcode-go"] = {
  name: "Command Code (Go, via bridge)",
  package: "@opencode-ai/ai/providers/openai-compatible",
  settings: {
    baseURL: "http://127.0.0.1:8787/v1",
    apiKey: "proxy-managed",
  },
  models: {
    "deepseek-v4-flash": { name: "DeepSeek V4 Flash" },
    "deepseek-v4-pro":   { name: "DeepSeek V4 Pro" },
    "kimi-k3":           { name: "Kimi K3" },
    "kimi-k2.7-code":    { name: "Kimi K2.7 Code" },
    "glm-5.3-flash":     { name: "GLM 5.3 Flash" },
    "glm-5.2":           { name: "GLM 5.2" },
    "minimax-m3":        { name: "MiniMax M3" },
    "qwen3.7-plus":      { name: "Qwen 3.7 Plus" },
    "qwen3.7-max":       { name: "Qwen 3.7 Max" },
    "grok-4.5":          { name: "Grok 4.5" },
    "step-3.5-flash":    { name: "Step 3.5 Flash" },
    "gpt-5.6-luna":      { name: "GPT-5.6 Luna" },
  },
};

if (!existing.$schema) existing.$schema = "https://opencode.ai/config.json";

const tmp = `${cfgPath}.tmp-${process.pid}`;
fs.writeFileSync(tmp, JSON.stringify(existing, null, 2) + "\n");
fs.renameSync(tmp, cfgPath);
console.log(`Wrote provider 'commandcode-go' to ${cfgPath}`);
NODE
