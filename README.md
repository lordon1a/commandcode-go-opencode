# commandcode-go-opencode

> Unofficial bridge that lets you use your **Command Code Go plan** from
> OpenAI- and Anthropic-compatible clients — **OpenCode**, Claude Code,
> Continue.dev, curl, or anything that speaks `POST /v1/chat/completions`.

| | |
|---|---|
| License | MIT |
| Status | Works, but **unofficial** — see the disclaimer below. |
| Tested with | Node 18.17+, OpenCode ≥ 1.18, Claude Code, curl |
| Upstream | Command Code `/alpha/generate` (the same endpoint the official CLI uses) |

> ## ⚠️ Disclaimer
>
> This project is **not affiliated with, endorsed by, or supported by
> Command Code**. By using it, you accept that:
>
> - Your Command Code account **may be suspended or terminated** without
>   notice. The maintainers of this project cannot help you recover a
>   suspended account — only `support@commandcode.ai` can.
> - The `/alpha/generate` endpoint used here is the same one the official
>   Command Code CLI uses. It is **not part of any documented public API**,
>   and Command Code may change or rate-limit it at any time.
> - This tool exists because the official Provider API is gated behind the
>   paid Provider plan, while the $1/mo Go plan is CLI-only. If Command Code
>   decides that's not OK, the right place to take that up is with them,
>   not by harassing this project.
>
> If you don't accept those terms, **don't install this tool**. Use the
> official CLI (`npm i -g command-code`) or upgrade to the Provider plan.

## Why does this exist?

The Command Code Go plan ($1/month) is the cheapest way to run a coding
agent in a terminal, but it has one sharp edge: the model catalogue is only
reachable from the official CLI. The OpenAI-compatible Provider API
(`https://api.commandcode.ai/provider/v1/chat/completions`) is gated behind
the paid Provider plan, and the upstream returns
`{"code": "upgrade_required"}` if you try it on Go.

This tool bridges that gap. It runs a small local HTTP server on
`127.0.0.1:8787`, accepts OpenAI / Anthropic requests from your favourite
client, and forwards them to Command Code's `/alpha/generate` endpoint —
the same one the official CLI uses. From Command Code's perspective, your
traffic looks like normal CLI usage; from your client's perspective, it
sees a normal OpenAI-compatible server.

## Installation

```bash
npm install -g commandcode-go-opencode
```

Or, to run from source without installing globally:

```bash
git clone https://github.com/lordon1a/commandcode-go-opencode
cd commandcode-go-opencode
npm install
npm run build
```

## Quick start

### 1. Get your API key

Open https://commandcode.ai/settings/keys and create a key. The CLI and
the API share the same key.

### 2. Save the key locally

```bash
commandcode-go-opencode auth login
# paste the key when prompted
```

Or non-interactive:

```bash
commandcode-go-opencode auth login --key "user_..."
```

The key is stored at `~/.config/commandcode-go-opencode/auth.json` with
`0600` permissions. Any CR/LF/NUL/whitespace characters that snuck into the
key during paste are stripped before saving — this protects against a
known bug where PowerShell copy-paste leaves carriage returns in
environment variable values, which would otherwise cause upstream to
reject the request.

### 3. Start the bridge

```bash
commandcode-go-opencode serve
# [bridge] listening on http://127.0.0.1:8787
```

It stays in the foreground; stop it with `Ctrl+C`. Bind only to
`127.0.0.1` — never expose this to the network. There is **no client-side
authentication**: it's designed to be reachable only from your own
machine.

### 4. Wire up OpenCode

```bash
commandcode-go-opencode setup-opencode --write
# Wrote provider 'commandcode-go' to ~/.config/opencode/opencode.jsonc
```

This adds a `commandcode-go` provider entry to your OpenCode config,
pointing at the bridge on `http://127.0.0.1:8787/v1`. Other providers you
have configured are preserved.

Then in OpenCode, run `/model` and pick any model under the
`commandcode-go` heading — `deepseek-v4-flash` is a good default.

### 5. (Optional) Wire up Claude Code

For Claude Code, the bridge exposes an Anthropic-compatible
`POST /v1/messages` endpoint. Set:

```bash
export ANTHROPIC_BASE_URL=http://127.0.0.1:8787
export ANTHROPIC_AUTH_TOKEN=proxy-managed      # value is unused, just non-empty
export ANTHROPIC_DEFAULT_SONNET_MODEL=deepseek-v4-pro
export ANTHROPIC_DEFAULT_OPUS_MODEL=deepseek-v4-pro
export ANTHROPIC_DEFAULT_HAIKU_MODEL=deepseek-v4-flash
```

Or run the generator script:

```bash
# macOS / Linux
./scripts/setup-claude-code.sh

# Windows (PowerShell)
./scripts/setup-claude-code.ps1
```

### 6. Test with curl

```bash
curl -s http://127.0.0.1:8787/v1/models | head -c 200
# {"object":"list","data":[{"id":"deepseek-v4-flash","object":"model",...}]}

curl -s http://127.0.0.1:8787/v1/chat/completions \
  -H "Authorization: Bearer proxy-managed" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-v4-flash",
    "messages": [{"role": "user", "content": "Say OK only."}]
  }'
# {"choices":[{"message":{"role":"assistant","content":"OK"},...}]}
```

## Available models (Go plan)

The bridge ships the Go plan's model list. Anything not on this list will
be rejected locally with `unsupported_model` before it hits the upstream —
saving you from accidentally spending credits on a Provider-plan-only
model that would `403` anyway.

| Alias | Upstream id | Notes |
|---|---|---|
| `deepseek-v4-flash` | `deepseek/deepseek-v4-flash` | Cheapest, fastest — good default. |
| `deepseek-v4-pro` | `deepseek/deepseek-v4-pro` | Stronger reasoning. |
| `kimi-k3` | `moonshotai/Kimi-K3` | 1M context. |
| `kimi-k2.7-code` | `moonshotai/Kimi-K2.7-Code` | Code-tuned. |
| `glm-5.3-flash` | `z-ai/glm-5.3-flash` | Fast, cheap. |
| `glm-5.2` | `zai-org/GLM-5.2` | Solid generalist. |
| `minimax-m3` | `MiniMaxAI/MiniMax-M3` | 2× usage promo. |
| `qwen3.7-plus` | `Qwen/Qwen3.7-Plus` | |
| `qwen3.7-max` | `Qwen/Qwen3.7-Max` | |
| `grok-4.5` | `xai/grok-4.5` | Closed, runs on Go. |
| `step-3.5-flash` | `stepfun/Step-3.5-Flash` | |
| `gpt-5.6-luna` | `gpt-5.6-luna` | Closed, runs on Go. |

Aliases are case-insensitive and the upstream id also works. See
`src/models.ts` for the canonical list. If Command Code rotates the list,
send a PR updating that file.

Premium Provider-plan models — Claude (all), GPT-5.6 Sol/Terra, Gemini
3.5+, Muse Spark 1.1 and standard 1.2/1.3 — are **not** available here,
even if you pass their ids.

## CLI reference

```text
commandcode-go-opencode <command> [options]

Commands:
  auth login [--key <key>]    Store API key. Interactive if --key omitted.
  auth logout                 Remove stored key.
  auth status                 Show whether a key is stored (no value printed).
  serve [--port N] [--host H] Start the proxy. Default 127.0.0.1:8787.
  setup-opencode [--write]    Print or write OpenCode provider config.
  models                      List Go plan models.
  help                        Print this help.

Get your API key from https://commandcode.ai/settings/keys.
```

## Configuration

| Env var | Default | Notes |
|---|---|---|
| `PORT` | `8787` | Override `--port`. |
| `HOST` | `127.0.0.1` | Override `--host`. **Don't change to `0.0.0.0`.** |
| `LOG_LEVEL` | `info` | `info` or `debug`. |

The bridge has no other configuration. It does not auto-update, phone
home, or write telemetry. The only outbound request it makes per chat is
the forwarded request to `api.commandcode.ai`.

## Operational guidance

- **Single concurrent client.** Don't point OpenCode, Claude Code, and curl
  at the bridge at the same time. Concurrent sessions may trip the same
  anti-abuse heuristics the CLI does.
- **Match your normal CLI cadence.** If you normally send 30 requests a
  day, don't suddenly send 300. Tool-call-heavy workflows look like agent
  traffic from upstream's perspective.
- **Don't run multiple machines.** Two machines sharing one API key is a
  classic account-takeover pattern. Use one key per machine.
- **Rotate the key if you suspect leakage.** `auth login --key ...`
  overwrites the file. Old key is invalidated as soon as Command Code
  issues the new one.
- **Don't disable ZDR.** Command Code's `CMD_ZDR=1` / `x-cmd-zdr: 1`
  zero-data-retention header is honoured by upstream. If you care about
  privacy, keep it on.

## Architecture

```
                 ┌────────────────────────────────┐
                 │  OpenCode / Claude Code / curl │   OpenAI or Anthropic
                 │  on your machine               │   /v1/chat/completions
                 └─────────────┬──────────────────┘   /v1/messages
                               │
                               ▼
            ┌─────────────────────────────────────────┐
            │  commandcode-go-opencode (this project)  │
            │  127.0.0.1:8787                         │
            │  - Validates model id                   │
            │  - Translates OpenAI ↔ /alpha/generate  │
            │  - Streams SSE both ways                │
            └─────────────────┬───────────────────────┘
                              │
                              ▼
              https://api.commandcode.ai/alpha/generate
              (the same endpoint command-code CLI uses)
```

The bridge is intentionally tiny. It does not implement tool-call
negotiation (clients that need it should use the official CLI). It does
not implement the full Provider API surface — only the parts that
clients actually use.

## Troubleshooting

### `Headers.append: "Bearer ...\r\n..." is an invalid header value.`

The bridge stripped CR/LF before saving, so this shouldn't happen with
this tool. If you see it, your key is being injected by something other
than the bridge (a global env var? a shell function?). Re-run `auth login`
and remove any duplicate key sources.

### Upstream returns `upgrade_required` for any model

You might be on the Go plan but the upstream sometimes returns this for
edge cases. Verify with `auth status` that your key is stored, then
`curl -s -H "Authorization: Bearer proxy-managed" http://127.0.0.1:8787/v1/models`.
If `v1/models` works but a chat request doesn't, it's an upstream issue,
not the bridge.

### Models list is empty

Run `commandcode-go-opencode models` to see the bundled catalogue. If
it's empty, your `npm install` was incomplete — try reinstalling.

### My account got suspended. What now?

Please read the disclaimer. Only `support@commandcode.ai` can help. Be
polite, explain that you were using a third-party CLI tool, and ask
whether you can be reinstated. There is no guarantee. **Do not open a
public issue here demanding that we "fix it"** — we cannot.

## Development

See [CONTRIBUTING.md](./CONTRIBUTING.md). Run `npm test` before sending a
PR. The CI matrix tests Node 18, 20, and 22 on Ubuntu, macOS, and
Windows.

## License

MIT. See [LICENSE](./LICENSE).
