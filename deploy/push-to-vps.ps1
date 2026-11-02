<#
.SYNOPSIS
  Push data and/or code from this PC to the production VPS in one command.

.EXAMPLES
  .\deploy\push-to-vps.ps1 -Data shops,warehouses     # copy only shop + warehouse rows
  .\deploy\push-to-vps.ps1 -Data all                  # copy the whole local database (data only)
  .\deploy\push-to-vps.ps1 -Code                      # git pull + rebuild on the server
  .\deploy\push-to-vps.ps1 -Data all -Code            # both

.NOTES
  Local source : container mim-postgres, database mim_erpdb.
  Remote       : /opt/mim-erp, container mim-postgres (created by deploy/server-setup.sh).
  Rows already on the server are skipped (ON CONFLICT DO NOTHING); nothing is overwritten or deleted.
  flyway_schema_history is never copied. A backup is saved on the server before any load.
  Uses ssh/scp: with a working key it is silent; otherwise you get the root password prompt twice.
#>
param(
  [string]$Server = "165.99.219.241",
  [string]$User   = "root",
  [string]$Key    = "$env:USERPROFILE\.ssh\mim_erp_vps",
  [string[]]$Data,                 # shops, warehouses, ... or "all"
  [switch]$Code                    # also git pull + rebuild frontend/backend on the server
)

$ErrorActionPreference = "Stop"
if (-not $Data -and -not $Code) { Write-Host "Nothing to do. Use -Data and/or -Code (see Get-Help)."; exit 1 }

$sshOpts = @("-o", "ConnectTimeout=15")
if (Test-Path $Key) { $sshOpts += @("-i", $Key) }
$target = "$User@$Server"
$work   = Join-Path $env:TEMP "mim-push"
New-Item -ItemType Directory -Force $work | Out-Null

$tableMap = @{
  shops = "shop"; warehouses = "warehouse"
}

# ---------- 1. local dump (binary-safe: dump to a file inside the container, docker cp it out) ----------
$dumpName = ""
if ($Data) {
  docker inspect mim-postgres *> $null
  if ($LASTEXITCODE -ne 0) { throw "Local container mim-postgres not found. Start it: docker compose up -d db" }

  $tableArgs = ""
  if ($Data -notcontains "all") {
    foreach ($d in $Data) {
      $t = if ($tableMap.ContainsKey($d)) { $tableMap[$d] } else { $d }   # unknown names are passed through as table names
      if ($t -notmatch '^[a-z_][a-z0-9_]*$') { throw "Bad table name: $t" }
      $tableArgs += " -t $t"
    }
  } else {
    $tableArgs = " -T flyway_schema_history"
  }

  $dumpName = "mim_data.sql.gz"
  Write-Host ">> Dumping local database ($($Data -join ', '))..."
  docker exec mim-postgres sh -c "pg_dump -U postgres -d mim_erpdb --data-only --column-inserts --on-conflict-do-nothing --disable-triggers$tableArgs 2>/dev/null | gzip > /tmp/$dumpName"
  if ($LASTEXITCODE -ne 0) { throw "pg_dump failed" }
  docker cp "mim-postgres:/tmp/$dumpName" "$work\$dumpName" | Out-Null
  docker exec mim-postgres rm -f "/tmp/$dumpName" | Out-Null
  $kb = [math]::Round((Get-Item "$work\$dumpName").Length / 1KB)
  Write-Host "   dump ready: $kb KB"
}

# ---------- 2. remote script (LF endings, run once over ssh) ----------
$compose = "docker compose -f docker-compose.yml -f docker-compose.prod.yml"
$remote = @"
set -euo pipefail
cd /opt/mim-erp
"@
if ($Code) {
  $remote += @"

echo '>> git pull'
git pull --ff-only
"@
}
if ($Data) {
  $remote += @"

echo '>> backup server database'
mkdir -p /opt/backups
docker exec mim-postgres pg_dump -U postgres mim_erpdb | gzip > /opt/backups/before_push_`$(date +%F_%H%M).sql.gz
echo '>> stop backend'
$compose stop backend
echo '>> load data'
zcat /root/$dumpName | docker exec -i mim-postgres psql -U postgres -d mim_erpdb -q 2>&1 | grep -vE '^(SET|INSERT 0 [01]|set_config|\s*$|-+$|\s*\(1 row\))' | tail -20 || true
rm -f /root/$dumpName
"@
}
if ($Code) {
  $remote += @"

echo '>> rebuild + start'
$compose up -d --build
"@
} elseif ($Data) {
  $remote += @"

echo '>> start backend'
$compose up -d backend
"@
}
$remote += @"

echo '>> status'
$compose ps --format '{{.Name}}  {{.Status}}'
"@
if ($Data) {
  $remote += @"

docker exec mim-postgres psql -U postgres -d mim_erpdb -Atc "select 'shops='||(select count(*) from shop)||'  warehouses='||(select count(*) from warehouse)"
"@
}
$remoteFile = Join-Path $work "mim-load.sh"
[IO.File]::WriteAllText($remoteFile, ($remote -replace "`r`n", "`n"), (New-Object Text.UTF8Encoding $false))

# ---------- 3. upload (one scp) + run (one ssh) ----------
$files = @($remoteFile)
if ($dumpName) { $files += "$work\$dumpName" }
Write-Host ">> Uploading to $target ..."
scp @sshOpts @files "${target}:/root/"
if ($LASTEXITCODE -ne 0) { throw "scp failed (check IP, firewall port 22, key/password)" }

Write-Host ">> Running on server ..."
ssh @sshOpts $target "bash /root/mim-load.sh; rm -f /root/mim-load.sh"
if ($LASTEXITCODE -ne 0) { throw "remote script failed - read the output above" }

Remove-Item -Recurse -Force $work
Write-Host "`nDone. Check http://$Server (or your domain)."
