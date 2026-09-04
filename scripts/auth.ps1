# save-key.ps1 — Save a Command Code API key to ~/.config/commandcode-go-opencode/auth.json
#
# Usage:
#   .\scripts\auth.ps1                       (interactive, prompts for key)
#   .\scripts\auth.ps1 -Key "user_abc..."    (non-interactive, key as arg)
#
# We strip CR/LF from the input because Windows copy-paste through
# PowerShell session variables can leak carriage returns into the value.

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$Key
)

$ErrorActionPreference = "Stop"

# Load the same sanitiser the CLI uses.
$src = Join-Path $PSScriptRoot "..\src\auth.ts"
if (-not (Test-Path $src)) {
    Write-Error "Cannot find $src. Are you running this from the repo root?"
}

# Just shell out to the built CLI for consistency.
$cli = Join-Path $PSScriptRoot "..\src\index.ts"
if (-not $Key) {
    Write-Host "Enter your Command Code API key (input is hidden by Read-Host -AsSecureString? No, plain for compatibility):"
    $secure = Read-Host -Prompt "API key" -AsSecureString
    $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        $Key = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
    } finally {
        [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
}

if (-not $Key) {
    Write-Error "No key provided."
    exit 1
}

# Strip CR/LF/tab/NUL — the bug we're protecting against.
# (Mirrors src/auth.ts sanitizeKey.)
$clean = $Key -replace "[\s\u0000-\u001f\u007f]", ""

if ($clean -notmatch '^user_.{28,}$') {
    Write-Error "Key does not look valid (must start with 'user_' and be at least 32 chars)."
    exit 1
}

$dir = Join-Path $env:USERPROFILE ".config\commandcode-go-opencode"
if (-not (Test-Path $dir)) {
    New-Item -ItemType Directory -Path $dir | Out-Null
}

$payload = @{
    apiKey  = $clean
    savedAt = (Get-Date).ToString("o")
} | ConvertTo-Json

$path = Join-Path $dir "auth.json"
# Atomic write: tmp + move. UTF-8 without BOM.
$tmp = "$path.tmp-$PID"
[System.IO.File]::WriteAllText($tmp, $payload, [System.Text.UTF8Encoding]::new($false))
Move-Item -Path $tmp -Destination $path -Force

Write-Host "Saved key (length=$($clean.Length)) to $path"
Write-Host "Run 'npx commandcode-go-opencode serve' (or 'npx . serve' in the repo) to start."
