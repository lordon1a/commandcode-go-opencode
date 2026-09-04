# Security policy

## Supported versions

Only the latest minor version receives security updates. Older versions
are best-effort.

## Reporting a vulnerability

Please **do not** open a public issue for security-sensitive reports.

Email: `security@commandcode-go-opencode.example` (replace with the
project's actual security contact before publishing).

We aim to acknowledge new reports within 72 hours.

## Operational notes

This project intentionally handles a sensitive credential — your Command
Code API key. Treat the running bridge as a process with that level of
sensitivity:

- **Bind only to `127.0.0.1`.** The CLI defaults to this; do not change it
  to `0.0.0.0` without putting a real auth layer in front.
- **Do not commit `auth.json`.** It's covered by `.gitignore` but a manual
  `git add -f` will override that.
- **Do not paste your key into issues or chats.** Strip it from logs with
  `sed` or your editor before sharing.
- **Rotate the key if you suspect exposure.** Generate a new one at
  https://commandcode.ai/settings/keys — old keys are not auto-revoked, but
  a fresh key after logout invalidates the old one.
