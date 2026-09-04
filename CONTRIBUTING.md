# Contributing

Thanks for taking the time to send a PR. This project is small but moves
quickly when the upstream Command Code API changes, so the most valuable
contributions are:

1. Bug reports with a minimal reproduction.
2. Patches that pin down regressions with a unit test.
3. Documentation fixes — typos, missing steps, broken examples.

## Development setup

Requires Node 18.17 or newer.

```bash
git clone https://github.com/lordon1a/commandcode-go-opencode.git
cd commandcode-go-opencode
npm install
npm run dev          # tsx watch mode for src/index.ts
npm test             # vitest run
npm run typecheck    # tsc --noEmit
```

## House rules

- **No new dependencies without discussion.** The runtime stays small.
- **No raw API keys in tests, logs, or fixtures.** Even "fake" keys shaped
  like `user_...` are filtered in CI by `gitleaks`.
- **Touching the wire format?** Update `src/upstream.ts` *and* the unit
  tests in `tests/`. The stream parser is intentionally lenient, but if
  upstream introduces a new event type, we want a test that fails first.
- **Touching the auth file format?** It's currently a single key object.
  If you need to add fields, prefer additive changes (new fields are
  ignored by old clients).

## Commit messages

`<scope>: <imperative summary>` — for example:

- `auth: strip NUL bytes from pasted keys`
- `models: drop Qwen 3.6 Max (no longer on Go plan)`
- `docs: add Claude Code setup snippet`

Keep the summary under 72 characters. Body wrapped at 72.

## Pull request checklist

See `.github/pull_request_template.md`. CI must be green before review.

## Code of conduct

This project follows the [Contributor Covenant](https://www.contributor-covenant.org/).
Be patient with newcomers. Argue ideas, not people.
