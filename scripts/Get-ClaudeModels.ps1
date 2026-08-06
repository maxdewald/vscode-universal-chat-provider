[CmdletBinding()]
param(
  [string]$ClaudeCommand = 'claude',
  [switch]$Raw
)

$ErrorActionPreference = 'Stop'

$result = & $ClaudeCommand -p '/model' --output-format json | ConvertFrom-Json
if ($result.is_error) {
  throw $result.result
}

if ($Raw) {
  $result.result
  return
}

$available = [regex]::Match([string]$result.result, 'Available:\s*(.+)\.$').Groups[1].Value
if ([string]::IsNullOrWhiteSpace($available)) {
  throw "Claude Code did not return an available-model list: $($result.result)"
}

$available -split ',\s*' | ForEach-Object {
  $model = $_.Trim()
  if ($model -notmatch '^or a full model ID$') {
    [PSCustomObject]@{ Model = $model }
  }
} | Format-Table -AutoSize