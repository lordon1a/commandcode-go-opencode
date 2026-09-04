# setup-claude-code.ps1 — Print Anthropic-compatible env vars for Claude Code.
#
# Claude Code reads ANTHROPIC_* env vars. We point its base URL at the
# bridge and map its three tiers (sonnet/opus/haiku) to Go plan models.
#
# Usage:
#   .\scripts\setup-claude-code.ps1                  (prints to stdout)
#   .\scripts\setup-claude-code.ps1 -Persist         (also sets them in
#                                                    the current user env)

[CmdletBinding()]
param(
    [switch]$Persist
)

$ErrorActionPreference = "Stop"

$vars = @{
    ANTHROPIC_BASE_URL             = "http://127.0.0.1:8787"
    ANTHROPIC_AUTH_TOKEN           = "proxy-managed"   # value is ignored
    ANTHROPIC_DEFAULT_SONNET_MODEL = "deepseek-v4-pro"
    ANTHROPIC_DEFAULT_OPUS_MODEL   = "deepseek-v4-pro"
    ANTHROPIC_DEFAULT_HAIKU_MODEL  = "deepseek-v4-flash"
}

Write-Host "# Add these to your shell, or run with -Persist to save them globally."
foreach ($k in $vars.Keys) {
    $v = $vars[$k]
    Write-Host "[System.Environment]::SetEnvironmentVariable('$k','$v','User')  # or use export $k=`"$v`""
    if ($Persist) {
        [System.Environment]::SetEnvironmentVariable($k, $v, "User")
        Write-Host "# Saved $k to user env"
    }
}

Write-Host ""
Write-Host "# Then start Claude Code:"
Write-Host "# claude"
