param(
  [string]$Repo = "C:\Users\Quandale Dingle\wholesale-crm",
  [string]$PromptOverride = ""
)

$ErrorActionPreference = "Stop"

$logDir = Join-Path $Repo "logs\loop-runs"
$lockPath = Join-Path $Repo ".loop_tick.lock"
$haltPath = Join-Path $Repo "docs\HALT"
$codexInbox = Join-Path $Repo "councilRoom\agents\CODEX\inbox"
$broadcastDir = Join-Path $Repo "councilRoom\broadcast"
$ledgerPath = Join-Path $Repo "councilRoom\ledger\messages.jsonl"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
New-Item -ItemType Directory -Force -Path $codexInbox | Out-Null
New-Item -ItemType Directory -Force -Path $broadcastDir | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path $ledgerPath -Parent) | Out-Null

function Write-Comms {
  param(
    [string]$Stamp,
    [string]$Subject,
    [string]$Body,
    [switch]$Broadcast
  )

  $safeSubject = ($Subject -replace '[^A-Za-z0-9_-]+', '_').Trim('_')
  $targetDir = if ($Broadcast) { $broadcastDir } else { $codexInbox }
  $targetName = if ($Broadcast) {
    "${Stamp}_FROM_SCHEDULER_TO_ALL_${safeSubject}.msg"
  } else {
    "${Stamp}_FROM_SCHEDULER_TO_CODEX_${safeSubject}.txt"
  }
  $target = Join-Path $targetDir $targetName
  $message = @"
FROM: WHOLESALE_LOOP_SCHEDULER
TO: CODEX
DATE: $(Get-Date -Format o)
SUBJECT: $Subject
PRIORITY: NORMAL

---

$Body

---
SIGNATURE: WHOLESALE_LOOP_SCHEDULER
"@
  Set-Content -Path $target -Value $message -Encoding utf8
  $ledgerEvent = [ordered]@{
    ts = (Get-Date).ToUniversalTime().ToString("o")
    from = "WHOLESALE_LOOP_SCHEDULER"
    to = $(if ($Broadcast) { "ALL" } else { "CODEX" })
    subject = $Subject
    path = $target
  } | ConvertTo-Json -Compress
  Add-Content -Path $ledgerPath -Value $ledgerEvent
}

if (Test-Path $haltPath) {
  Add-Content -Path (Join-Path $logDir "scheduler.log") -Value "$(Get-Date -Format o) HALT present; skipping"
  exit 0
}

if (Test-Path $lockPath) {
  $age = (Get-Date) - (Get-Item $lockPath).LastWriteTime
  if ($age.TotalMinutes -lt 90) {
    Add-Content -Path (Join-Path $logDir "scheduler.log") -Value "$(Get-Date -Format o) lock present; skipping"
    exit 0
  }
  Remove-Item -Force -Path $lockPath
}

Set-Content -Path $lockPath -Value $PID
try {
  Set-Location $Repo
  $stamp = Get-Date -Format "yyyyMMddTHHmmss"
  $out = Join-Path $logDir "$stamp-codex-loop.log"
  Write-Comms -Stamp $stamp -Subject "loop_tick_start" -Body "Starting one scheduled Codex LOOP_PROMPT.md tick. Read /COMMS first: councilRoom/agents/CODEX/STATUS.md, councilRoom/ledger/messages.jsonl, and this inbox before editing."
  $prompt = if ($PromptOverride) {
    $PromptOverride
  } else {
@"
Read LOOP_PROMPT.md and execute exactly one autonomous build-loop tick.

COMMUNICATION IS KEY: use /COMMS first. Read councilRoom/agents/CODEX/STATUS.md,
councilRoom/ledger/messages.jsonl, and your inbox under councilRoom/agents/CODEX/inbox.
Post a short comms note before choosing work and another when done.

Follow the top directive in LOOP_PROMPT.md: analyze dev/architecture/NORTH_STAR_VISION.md,
diff it against the current project state, update LOOP_PROMPT.md if it is incomplete, then
build the topmost unblocked item. Respect docs/HALT, do not push, do not edit external repos,
run the relevant tests, and commit only coherent project changes.
"@
  }

  $promptPath = Join-Path $logDir "$stamp-prompt.txt"
  Set-Content -Path $promptPath -Value $prompt -Encoding utf8
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    Get-Content -Raw -Path $promptPath | & codex exec --cd $Repo --dangerously-bypass-approvals-and-sandbox - *>&1 | Tee-Object -FilePath $out
  }
  finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  $code = $LASTEXITCODE
  Add-Content -Path (Join-Path $logDir "scheduler.log") -Value "$(Get-Date -Format o) exit=$code log=$out"
  Write-Comms -Stamp $stamp -Subject "loop_tick_finished_exit_$code" -Body "Scheduled Codex tick finished with exit code $code. Log: $out"
  exit $code
}
finally {
  Remove-Item -Force -Path $lockPath -ErrorAction SilentlyContinue
}
