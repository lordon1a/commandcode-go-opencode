## What

<!-- One or two sentences summarising the change. -->

## Why

<!-- The problem this solves, with a link to the issue if any. -->

## How

<!-- Implementation notes: any non-obvious decisions, trade-offs, tests. -->

## Risk

- [ ] Touches auth handling (`src/auth.ts`)
- [ ] Touches the upstream wire format (`src/upstream.ts`)
- [ ] Touches the model catalogue (`src/models.ts`)
- [ ] Touches OpenCode config writing (`src/setup.ts`)

If any box is checked, explain what could go wrong and how you tested it.

## Self-review

- [ ] `npm run typecheck` is clean
- [ ] `npm test` is clean
- [ ] No API keys, tokens, or user-identifying data in the diff
- [ ] README and inline comments updated where relevant
- [ ] PR title is `<scope>: <change>` (e.g. `auth: strip NUL bytes from pasted keys`)

## Legal

- [ ] I am not submitting a Command Code API key, login credentials, or
      any information I do not have the right to share.
- [ ] I understand that this is an unofficial project and that Command Code
      may suspend accounts using it.
