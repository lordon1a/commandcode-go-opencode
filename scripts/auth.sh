#!/usr/bin/env bash
# auth.sh — POSIX equivalent of scripts/auth.ps1 for macOS/Linux.
#
# Usage:
#   ./scripts/auth.sh                     (interactive, prompts for key)
#   ./scripts/auth.sh "user_abc..."       (non-interactive)

set -euo pipefail

KEY="${1:-}"

if [[ -z "$KEY" ]]; then
    printf "Enter your Command Code API key: "
    read -rs KEY
    printf "\n"
fi

if [[ -z "$KEY" ]]; then
    echo "No key provided." >&2
    exit 1
fi

# Strip CR/LF/tab/NUL.
CLEAN="$(printf '%s' "$KEY" | tr -d '\r\n\t\0' | sed -E 's/[\x00-\x1f\x7f]//g')"

if [[ ! "$CLEAN" =~ ^user_.{28,}$ ]]; then
    echo "Key does not look valid (must start with 'user_' and be at least 32 chars)." >&2
    exit 1
fi

DIR="$HOME/.config/commandcode-go-opencode"
mkdir -p "$DIR"
chmod 700 "$DIR"

PATH_FILE="$DIR/auth.json"
TMP="$PATH_FILE.tmp.$$"

SAVED_AT="$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ 2>/dev/null || date -u +%Y-%m-%dT%H:%M:%SZ)"

# Build the JSON payload with printf to avoid any extra trailing newline on
# embedded data.
printf '{\n  "apiKey": "%s",\n  "savedAt": "%s"\n}\n' "$CLEAN" "$SAVED_AT" > "$TMP"
mv "$TMP" "$PATH_FILE"
chmod 600 "$PATH_FILE"

echo "Saved key (length=${#CLEAN}) to $PATH_FILE"
echo "Run 'npx . serve' to start the bridge."
