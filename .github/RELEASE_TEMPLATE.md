## commandcode-go-opencode v0.1.0

Unofficial bridge that lets a **Command Code Go** subscription talk to any
OpenAI- or Anthropic-compatible client — OpenCode, Claude Code, Continue,
curl, etc.

> **Disclaimer.** This project is not affiliated with Command Code. Your
> account may be suspended for using it. The right place to take that up
> with Command Code is `support@commandcode.ai`, not this repo. See the
> README for the full disclaimer and operational guidance.

### Highlights

- One-command install: `npm install -g commandcode-go-opencode`
- One-line OpenCode setup: `commandcode-go-opencode setup-opencode --write`
- Anthropic-compatible `POST /v1/messages` for Claude Code users
- Streaming and non-streaming both supported
- Curated Go plan model catalogue; premium Provider-plan models are
  rejected locally before they hit the upstream

### What's in the box

- `src/auth.ts` — key storage with CR/LF/NUL sanitisation (fixes the
  Windows paste bug that produces `invalid header value` upstream)
- `src/upstream.ts` — talks to `https://api.commandcode.ai/alpha/generate`
- `src/proxy.ts` — Express server, OpenAI + Anthropic surfaces, SSE
  streaming, request-id generation
- `src/models.ts` — Go plan catalogue with aliases
- `scripts/auth.{ps1,sh}` — interactive key saver
- `scripts/setup-opencode.{ps1,sh}` — OpenCode provider writer
- `scripts/setup-claude-code.{ps1,sh}` — Claude Code env var printer
- 24 unit tests covering the sanitiser, model catalogue, and config
  writer; CI on Node 18/20/22 × Ubuntu/macOS/Windows

### Install

```bash
# Global install
npm install -g commandcode-go-opencode

# Or from source
git clone https://github.com/lordon1a/commandcode-go-opencode
cd commandcode-go-opencode
npm install && npm run build
```

### First run

```bash
commandcode-go-opencode auth login        # paste your Command Code API key
commandcode-go-opencode serve             # starts http://127.0.0.1:8787
commandcode-go-opencode setup-opencode --write   # wire up OpenCode
```

### Known limitations

- **Tool-call negotiation isn't implemented.** Clients that need it
  (function-calling) should fall back to the official CLI for those
  requests. The bridge speaks plain chat completions and messages only.
- **Premium Provider-plan models aren't available.** Claude, GPT-5.6
  Sol/Terra, Gemini 3.5+, and Muse Spark 1.1/standard 1.2/1.3 return
  `unsupported_model` from the bridge. If you need them, upgrade to the
  Provider plan or use the official Provider API directly.
- **No client-side authentication.** The bridge trusts whatever can reach
  `127.0.0.1:8787`. Don't bind it to `0.0.0.0` without putting a real
  auth layer in front.

### Acknowledgements

Built to scratch an itch: the Go plan is the cheapest way to run a
coding agent, but the official CLI is the only thing that can use it.
This bridge is a thin, transparent translation layer — every byte that
leaves your machine goes to `api.commandcode.ai` and nowhere else.
