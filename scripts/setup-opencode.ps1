# setup-opencode.ps1 — Write the OpenCode provider block.
#
# Reads ~/.config/opencode/opencode.jsonc (if present), merges our
# "commandcode-go" provider entry, and writes it back atomically. Existing
# providers are preserved.

[CmdletBinding()]
param(
    [switch]$Force
)

$ErrorActionPreference = "Stop"

$cfgDir = Join-Path $env:USERPROFILE ".config\opencode"
$cfgPath = Join-Path $cfgDir "opencode.jsonc"

if (-not (Test-Path $cfgDir)) {
    New-Item -ItemType Directory -Path $cfgDir | Out-Null
}

$existing = $null
if (Test-Path $cfgPath) {
    if (-not $Force) {
        Write-Host "Found existing $cfgPath — will preserve other providers."
    }
    $raw = Get-Content $cfgPath -Raw
    # Strip line and block comments so we can parse.
    $stripped = $raw -replace '(?m)^\s*//.*$', '' -replace '(?s)/\*.*?\*/', ''
    $stripped = $stripped -replace ',\s*([\]}])', '$1'
    try {
        $existing = $stripped | ConvertFrom-Json -AsHashtable -ErrorAction Stop
    } catch {
        Write-Error "Refusing to overwrite: failed to parse $cfgPath. Fix it manually or pass -Force."
        exit 1
    }
}

if (-not $existing) {
    $existing = @{ providers = @{} }
}
if (-not $existing.ContainsKey('providers') -or $null -eq $existing.providers) {
    $existing.providers = @{}
}

$existing.providers['commandcode-go'] = @{
    name    = 'Command Code (Go, via bridge)'
    package = '@opencode-ai/ai/providers/openai-compatible'
    settings = @{
        baseURL = 'http://127.0.0.1:8787/v1'
        apiKey  = 'proxy-managed'
    }
    models = @{
        'deepseek-v4-flash' = @{ name = 'DeepSeek V4 Flash' }
        'deepseek-v4-pro'   = @{ name = 'DeepSeek V4 Pro' }
        'kimi-k3'           = @{ name = 'Kimi K3' }
        'kimi-k2.7-code'    = @{ name = 'Kimi K2.7 Code' }
        'glm-5.3-flash'     = @{ name = 'GLM 5.3 Flash' }
        'glm-5.2'           = @{ name = 'GLM 5.2' }
        'minimax-m3'        = @{ name = 'MiniMax M3' }
        'qwen3.7-plus'      = @{ name = 'Qwen 3.7 Plus' }
        'qwen3.7-max'       = @{ name = 'Qwen 3.7 Max' }
        'grok-4.5'          = @{ name = 'Grok 4.5' }
        'step-3.5-flash'    = @{ name = 'Step 3.5 Flash' }
        'gpt-5.6-luna'      = @{ name = 'GPT-5.6 Luna' }
    }
}

$json = $existing | ConvertTo-Json -Depth 10

$tmp = "$cfgPath.tmp-$PID"
[System.IO.File]::WriteAllText($tmp, $json, [System.Text.UTF8Encoding]::new($false))
Move-Item -Path $tmp -Destination $cfgPath -Force

Write-Host "Wrote provider 'commandcode-go' to $cfgPath"
Write-Host "Make sure the bridge is running: npx . serve"
