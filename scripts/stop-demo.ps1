# Stops the Sisa-Saji demo of THIS repository (called by stop-demo.cmd).
#
# 1. PID files (preferred): `npm run demo` writes node_modules/.cache/sisa-saji/demo-<port>.json
#    with its own PID and the PIDs of its children (db, web, worker). Exactly those
#    processes and their descendants are stopped, and only when the recorded demo PID
#    still belongs to a node.exe running scripts/demo.ts from this repo (PID reuse guard).
# 2. Fallback (no live PID file, e.g. a server started by hand): node.exe processes whose
#    command line contains this repo's path AND one of
#      node_modules/next/ | scripts/demo.ts | scripts/db-local.ts | scripts/worker.ts
#    Other node processes (other projects, editors, tools) are never touched.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\stop-demo.ps1 [-DryRun] [-Port 3000]
#
#   -DryRun  only list what would be stopped
#   -Port    only the demo started with this DEMO_PORT (PID file only, no fallback)
param([switch]$DryRun, [int]$Port = 0)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$repoNorm = $repo.Replace('\', '/').TrimEnd('/').ToLowerInvariant()
$pidDir = Join-Path $repo 'node_modules\.cache\sisa-saji'

$all = @(Get-CimInstance Win32_Process)
$byPid = @{}
foreach ($p in $all) { $byPid[[int]$p.ProcessId] = $p }

function Format-Cmd([string]$s) { if ($s) { $s.Replace('\', '/').ToLowerInvariant() } else { '' } }

function Get-Descendants([int]$rootPid) {
  $result = New-Object System.Collections.Generic.List[int]
  $queue = New-Object System.Collections.Generic.Queue[int]
  $queue.Enqueue($rootPid)
  while ($queue.Count -gt 0) {
    $current = $queue.Dequeue()
    foreach ($p in $all) {
      $id = [int]$p.ProcessId
      if ([int]$p.ParentProcessId -eq $current -and $id -ne $current -and $id -ne $rootPid -and -not $result.Contains($id)) {
        $result.Add($id)
        $queue.Enqueue($id)
      }
    }
  }
  return ,$result
}

$targets = New-Object System.Collections.Generic.List[int]
function Add-Target([int]$id) { if ($byPid.ContainsKey($id) -and -not $targets.Contains($id)) { $targets.Add($id) } }
$source = ''

# --- 1. PID files -------------------------------------------------------------
$pidFiles = @()
if (Test-Path $pidDir) {
  $filter = if ($Port -gt 0) { "demo-$Port.json" } else { 'demo-*.json' }
  $pidFiles = @(Get-ChildItem -Path $pidDir -Filter $filter -File -ErrorAction SilentlyContinue)
}
foreach ($f in $pidFiles) {
  try { $data = Get-Content -Raw -Path $f.FullName | ConvertFrom-Json } catch { continue }
  $demoPid = [int]$data.demoPid
  $demo = $byPid[$demoPid]
  $cmd = if ($demo) { Format-Cmd $demo.CommandLine } else { '' }
  if (-not $cmd.Contains($repoNorm) -or -not $cmd.Contains('scripts/demo.ts')) {
    Write-Host "[stop-demo] $($f.Name): demo (PID $demoPid) sudah tidak berjalan, file diabaikan"
    if (-not $DryRun) { Remove-Item -Force $f.FullName -ErrorAction SilentlyContinue }
    continue
  }
  $source = 'PID file'
  # Children (web, worker, then db) with their descendants first, the demo itself last.
  $kids = @($data.children | Sort-Object { if ($_.name -eq 'db') { 1 } else { 0 } })
  foreach ($c in $kids) {
    foreach ($d in (Get-Descendants ([int]$c.pid))) { Add-Target $d }
    Add-Target ([int]$c.pid)
  }
  foreach ($d in (Get-Descendants $demoPid)) { Add-Target $d }
  Add-Target $demoPid
}

# --- 2. Fallback: repo path match ------------------------------------------------
if ($targets.Count -eq 0 -and $Port -eq 0) {
  $patterns = @('node_modules/next/', 'scripts/demo.ts', 'scripts/db-local.ts', 'scripts/worker.ts')
  $matched = @($all | Where-Object {
    if ($_.Name -ne 'node.exe') { return $false }
    $c = Format-Cmd $_.CommandLine
    if (-not $c.Contains($repoNorm)) { return $false }
    foreach ($p in $patterns) { if ($c.Contains($p)) { return $true } }
    return $false
  })
  # Database last, so the app and the worker do not log connection errors on the way down.
  foreach ($p in @($matched | Sort-Object { if ($_.CommandLine -match 'db-local') { 1 } else { 0 } })) {
    Add-Target ([int]$p.ProcessId)
  }
  if ($targets.Count -gt 0) { $source = 'cocok dengan path repo' }
}

if ($targets.Count -eq 0) {
  Write-Host "[stop-demo] Tidak ada proses demo Sisa-Saji yang berjalan dari $repo"
  exit 0
}

Write-Host "[stop-demo] $($targets.Count) proses ditemukan ($source)"
foreach ($id in $targets) {
  $cmd = $byPid[$id].CommandLine
  if ($cmd -and $cmd.Length -gt 160) { $cmd = $cmd.Substring(0, 157) + '...' }
  if ($DryRun) {
    Write-Host ("[stop-demo] (dry-run) akan menghentikan PID {0}: {1}" -f $id, $cmd)
  } else {
    try {
      Stop-Process -Id $id -Force -ErrorAction Stop
      Write-Host ("[stop-demo] dihentikan PID {0}: {1}" -f $id, $cmd)
    } catch {
      # Already gone (e.g. a child that exited together with its parent).
      Write-Host ("[stop-demo] PID {0} sudah berhenti" -f $id)
    }
  }
}

if ($DryRun) {
  Write-Host "[stop-demo] dry-run: tidak ada yang dihentikan."
} else {
  foreach ($f in $pidFiles) { Remove-Item -Force $f.FullName -ErrorAction SilentlyContinue }
  Write-Host "[stop-demo] selesai."
}
