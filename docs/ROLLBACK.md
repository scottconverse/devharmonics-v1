# Rolling back a DevHarmonics upgrade

Every rollback path below is schema-crossing. Migrations are
one-way: an older build refuses to open a ledger whose `user_version` is newer
than it supports. A rollback therefore needs the matching pre-upgrade ledger
backup, not just an older checkout. Restore that verified backup, preserve the
newer ledger, and accept that ledger records created after the upgrade stay
behind.

> [!WARNING]
> Stop DevHarmonics before inspecting or moving its ledger. A ledger backup can
> contain prompts, repository paths, provider output, validator logs, and values
> stored before current redaction boundaries. Protect every copy like the live
> `.devharmonics` directory.

## Shell and platform requirement

This recovery procedure requires **PowerShell 7** on every operating system.
Start it with `pwsh`, not Windows PowerShell 5.1 or a POSIX shell, and confirm
the major version before inspecting a ledger:

```powershell
if ($PSVersionTable.PSVersion.Major -lt 7) {
  throw 'Rollback requires PowerShell 7 or newer. Start this procedure with pwsh.'
}
```

Install PowerShell 7 before continuing if `pwsh` is unavailable. The
DevHarmonics product suite is continuously verified on Windows and Ubuntu;
macOS product verification is manual. This rollback filesystem procedure is
not continuously exercised on any operating system. Its happy path has been
manually exercised on Windows, but the complete injected-failure recovery
matrix has not yet been runtime-qualified on Windows, Ubuntu, or macOS.
Rehearse the procedure against disposable copies before an incident.

## Exact-path restore procedure

Use this procedure for each rollback below. The rollback-specific section gives
the candidate filename pattern, expected pre-upgrade schema, current schema,
kept-ledger name, and older tag. Run the verifier from the current unreleased
checkout **before** checking out the older tag.

First, set the four values given by the rollback-specific section and list the
candidates. The wildcard is used only to display possible files; it never
selects a file for copying or moving.

```powershell
# Windows example. On Linux or macOS, use the exact absolute POSIX path.
$ledgerDirectory = 'C:\path\to\your\project\.devharmonics'
$verifierPath = (Resolve-Path -LiteralPath '.\scripts\verify-ledger-backup.mjs').Path

# Run the four assignments from the applicable rollback section first.
if (
  [string]::IsNullOrWhiteSpace($backupNamePattern) -or
  $null -eq $expectedUserVersion -or
  $null -eq $currentUserVersion -or
  [string]::IsNullOrWhiteSpace($keptLedgerName)
) {
  throw 'Set the rollback-specific values before listing candidates.'
}

$candidates = Get-ChildItem -LiteralPath $ledgerDirectory -File |
  Where-Object { $_.Name -like $backupNamePattern } |
  Sort-Object -Property LastWriteTimeUtc -Descending

$candidates | ForEach-Object {
  [pscustomobject]@{
    FullName = $_.FullName
    LastWriteTimeUtc = $_.LastWriteTimeUtc
    Length = $_.Length
    SHA256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
  }
}
```

Choose the snapshot that belongs to the upgrade being undone and represents
the pre-upgrade state you intend to recover. Copy **one exact `FullName`** from
the table into `$backupPath`; do not derive it from the wildcard or
automatically choose the newest file. Stop if no candidate verifies or if more
than one candidate remains plausible.

Verify the candidate before touching the live ledger:

```powershell
$backupPath = 'C:\paste\the\exact\FullName\from\the\table.sqlite'

if (-not (Test-Path -LiteralPath $backupPath -PathType Leaf)) {
  throw "Backup is not an existing file: $backupPath"
}

node $verifierPath --path $backupPath --expected-user-version $expectedUserVersion
if ($LASTEXITCODE -ne 0) {
  throw 'Backup verification failed; the live ledger was not changed.'
}
```

The verifier opens the database read-only. Continue only when it reports the
expected `PRAGMA user_version`, `PRAGMA integrity_check` as `ok`, no
`PRAGMA foreign_key_check` rows, and migration history ending continuously at
the expected schema.

Copy the exact candidate to a staging name, verify the staged bytes, and only
then preserve and replace the live ledger:

```powershell
$liveLedger = Join-Path -Path $ledgerDirectory -ChildPath 'devharmonics.db'
$stagedLedger = Join-Path -Path $ledgerDirectory -ChildPath 'devharmonics.db.restore-staged'
$keptLedger = Join-Path -Path $ledgerDirectory -ChildPath $keptLedgerName
$failedRestoredLedger = Join-Path -Path $ledgerDirectory -ChildPath 'devharmonics.db.restore-failed-kept'

if (-not (Test-Path -LiteralPath $liveLedger -PathType Leaf)) {
  throw "Live ledger is not an existing file: $liveLedger"
}
if (Test-Path -LiteralPath $stagedLedger) {
  throw "Staging path already exists: $stagedLedger"
}
if (Test-Path -LiteralPath $keptLedger) {
  throw "Kept-ledger path already exists: $keptLedger"
}
if (Test-Path -LiteralPath $failedRestoredLedger) {
  throw "Failed-restore preservation path already exists: $failedRestoredLedger"
}

node $verifierPath --path $liveLedger --expected-user-version $currentUserVersion
if ($LASTEXITCODE -ne 0) {
  throw 'Current live ledger failed verification; no files were moved.'
}

Copy-Item -LiteralPath $backupPath -Destination $stagedLedger -ErrorAction Stop
node $verifierPath --path $stagedLedger --expected-user-version $expectedUserVersion
if ($LASTEXITCODE -ne 0) {
  throw 'Staged copy failed verification; the live ledger was not changed.'
}

$swapPhase = 'before-live-to-kept'
try {
  Move-Item -LiteralPath $liveLedger -Destination $keptLedger -ErrorAction Stop
  $swapPhase = 'after-live-to-kept'

  Move-Item -LiteralPath $stagedLedger -Destination $liveLedger -ErrorAction Stop
  $swapPhase = 'after-staged-to-live'

  node $verifierPath --path $liveLedger --expected-user-version $expectedUserVersion
  if ($LASTEXITCODE -ne 0) {
    throw 'The restored ledger failed final verification.'
  }
  $swapPhase = 'complete'
} catch {
  $swapFailure = $_
  $liveExists = Test-Path -LiteralPath $liveLedger -PathType Leaf
  $stagedExists = Test-Path -LiteralPath $stagedLedger -PathType Leaf
  $keptExists = Test-Path -LiteralPath $keptLedger -PathType Leaf

  Write-Warning "Rollback swap stopped in phase '$swapPhase': $($swapFailure.Exception.Message)"
  Write-Warning "State: live=$liveExists staged=$stagedExists kept=$keptExists"

  # Failure before live -> kept completed: live remains authoritative.
  if ($swapPhase -eq 'before-live-to-kept' -and $liveExists -and -not $keptExists) {
    node $verifierPath --path $liveLedger --expected-user-version $currentUserVersion
    if ($LASTEXITCODE -ne 0) {
      throw 'The first move failed and the unchanged live ledger no longer verifies. Stop; preserve every file for manual recovery.'
    }
    throw 'The first move failed. The verified newer ledger remains live; the verified staged rollback copy is preserved. Do not start the older build.'
  }

  # Failure after live -> kept but before staged -> live completed:
  # copy kept back to live, retaining kept and staged as source ledgers.
  if ($swapPhase -eq 'after-live-to-kept' -and -not $liveExists -and $stagedExists -and $keptExists) {
    Copy-Item -LiteralPath $keptLedger -Destination $liveLedger -ErrorAction Stop
    node $verifierPath --path $liveLedger --expected-user-version $currentUserVersion
    if ($LASTEXITCODE -ne 0) {
      throw 'The second move failed and the copied-back newer ledger did not verify. Stop; kept and staged sources remain preserved.'
    }
    throw 'The second move failed. A verified copy of the newer kept ledger is live again; kept and staged source ledgers remain preserved. Do not start the older build.'
  }

  # Failure after staged -> live, including final verification failure:
  # preserve the rejected restored file, then copy the kept newer ledger back.
  if ($swapPhase -eq 'after-staged-to-live' -and $liveExists -and $keptExists) {
    Move-Item -LiteralPath $liveLedger -Destination $failedRestoredLedger -ErrorAction Stop
    Copy-Item -LiteralPath $keptLedger -Destination $liveLedger -ErrorAction Stop
    node $verifierPath --path $liveLedger --expected-user-version $currentUserVersion
    if ($LASTEXITCODE -ne 0) {
      throw 'The restored rollback ledger was preserved, but the copied-back newer ledger did not verify. Stop; preserve all files for manual recovery.'
    }
    throw 'The restored rollback ledger failed or was interrupted after the second move. It is preserved at the failed-restore path, and a verified copy of the newer kept ledger is live again. Do not start the older build.'
  }

  throw "Unexpected rollback state in phase '$swapPhase'. Do not copy, move, delete, or start DevHarmonics; preserve every path for manual recovery."
}
```

Only a `complete` swap may continue to the older checkout. Every failure branch
throws after either proving that the original newer ledger is still live or
copying the retained newer ledger back to the live path. The exact backup and
the exact `$keptLedger` are never consumed by recovery; a rejected restored
ledger is retained at `$failedRestoredLedger`. Do not delete any of them until
the rollback has been independently confirmed.

### Resume after the shell or process was interrupted

If `pwsh`, the terminal, or the machine stopped before the `catch` block could
run, do not restart either DevHarmonics build. Open PowerShell 7, re-run the
rollback-specific four assignments and the path assignments above, and then
run this state-based recovery block exactly once:

```powershell
$liveExists = Test-Path -LiteralPath $liveLedger -PathType Leaf
$stagedExists = Test-Path -LiteralPath $stagedLedger -PathType Leaf
$keptExists = Test-Path -LiteralPath $keptLedger -PathType Leaf

# Interruption before live -> kept: the verified newer ledger is still live.
if ($liveExists -and $stagedExists -and -not $keptExists) {
  node $verifierPath --path $liveLedger --expected-user-version $currentUserVersion
  if ($LASTEXITCODE -ne 0) {
    throw 'The live ledger does not verify as the newer schema. Preserve every file for manual recovery.'
  }
  throw 'The verified newer ledger remains live and the staged rollback copy remains preserved. Do not start the older build.'
}

# Interruption after live -> kept but before staged -> live:
# restore service from a copy, preserving kept and staged.
if (-not $liveExists -and $stagedExists -and $keptExists) {
  Copy-Item -LiteralPath $keptLedger -Destination $liveLedger -ErrorAction Stop
  node $verifierPath --path $liveLedger --expected-user-version $currentUserVersion
  if ($LASTEXITCODE -ne 0) {
    throw 'The copied-back newer ledger did not verify. Kept and staged sources remain preserved; stop for manual recovery.'
  }
  throw 'A verified copy of the newer kept ledger is live again. Kept and staged sources remain preserved. Do not start the older build.'
}

# Interruption after staged -> live but before/while final verification.
if ($liveExists -and -not $stagedExists -and $keptExists) {
  node $verifierPath --path $liveLedger --expected-user-version $expectedUserVersion
  if ($LASTEXITCODE -eq 0) {
    Write-Output 'The restored ledger verifies at the rollback schema. The swap is complete.'
    return
  }

  if (Test-Path -LiteralPath $failedRestoredLedger) {
    throw "Failed-restore preservation path already exists: $failedRestoredLedger"
  }
  Move-Item -LiteralPath $liveLedger -Destination $failedRestoredLedger -ErrorAction Stop
  Copy-Item -LiteralPath $keptLedger -Destination $liveLedger -ErrorAction Stop
  node $verifierPath --path $liveLedger --expected-user-version $currentUserVersion
  if ($LASTEXITCODE -ne 0) {
    throw 'The rejected rollback ledger was preserved, but the copied-back newer ledger did not verify. Stop for manual recovery.'
  }
  throw 'The rejected rollback ledger is preserved at the failed-restore path, and a verified copy of the newer kept ledger is live again. Do not start the older build.'
}

throw "Unexpected rollback state: live=$liveExists staged=$stagedExists kept=$keptExists. Do not copy, move, delete, or start DevHarmonics; preserve every path for manual recovery."
```

## Development-line rollback: ledger schema 37 → v0.6.1

The unreleased development line after v0.6.1 advances the ledger through three
ordered migrations:

1. **Ledger schema 34 → 35** adds the `runs_status` index used by the approval
   Inbox projection.
2. **Ledger schema 35 → 36** adds append-only decision records.
3. **Ledger schema 36 → 37** adds decision provenance, uniqueness indexes, and
   database triggers that prevent decision-record updates and deletes.

Backups describe the schema the database actually started at and the maximum
schema supported by the build that opened it. Opening a schema-34 v0.6.1
ledger directly with the schema-37 development build creates one snapshot:

`devharmonics.db.backup-v34-to-v37-<timestamp>-<id>.sqlite`

It does **not** create separate v34-to-v35, v35-to-v36, and v36-to-v37 files
while applying the three migrations in one transaction. Pairwise names exist
only when an intermediate development build whose maximum schema was 35 or 36
performed that upgrade.

For the exact-path procedure, set:

```powershell
$backupNamePattern = 'devharmonics.db.backup-v34-to-v37-*.sqlite'
$expectedUserVersion = 34
$currentUserVersion = 37
$keptLedgerName = 'devharmonics.db.schema37-kept'
```

After the restored ledger passes verification, check out and build the older
release, then restart:

```powershell
git checkout v0.6.1
npm.cmd ci
npm.cmd run build
node dist/src/cli.js serve --project C:\path\to\your\project
```

The restored ledger contains none of the Inbox-index, decision-record, or
decision-provenance changes made after the schema-34 snapshot. The kept
schema-37 ledger retains that later data.

## Rollback plan for v0.6.1 → v0.6.0

**Ledger schema 33 → 34.** v0.6.1 applies migration 34 and runs ledger schema
34; v0.6.0 understands only schema 33 and refuses to start against a newer
`user_version`. Opening an existing project's ledger with v0.6.1 upgrades it
from 33 to 34, so simply checking out v0.6.0 afterward is **not** a safe
downgrade.

Before migration 33 → 34, DevHarmonics writes a byte-consistent `VACUUM INTO`
snapshot beside the ledger:

`devharmonics.db.backup-v33-to-v34-<timestamp>-<id>.sqlite`

Project configuration remains at schema version 2, so no configuration
rollback is needed. Completed, owner-approved GitHub pushes, pull requests,
merges, and tags are external facts and are not undone by a local rollback.

For the exact-path procedure, set:

```powershell
$backupNamePattern = 'devharmonics.db.backup-v33-to-v34-*.sqlite'
$expectedUserVersion = 33
$currentUserVersion = 34
$keptLedgerName = 'devharmonics.db.schema34-kept'
```

After the restored ledger passes verification, check out and build v0.6.0:

```powershell
git checkout v0.6.0
npm.cmd ci
npm.cmd run build
node dist/src/cli.js serve --project C:\path\to\your\project
```

Verify that `node dist/src/cli.js doctor` reports providers normally, the
dashboard lists the pre-upgrade runs, and `node dist/src/cli.js --version`
reports 0.6.0.

Runs, receipts, deliveries, workflow revisions, and steering recorded after
the v0.6.1 upgrade exist only in the kept schema-34 ledger. GitHub branches,
pull requests, merges, and tags remain valid.

## Rollback plan for v0.6.0 → v0.5.1

**Ledger schema 26 → 33.** v0.6.0 advances the ledger through these migrations.
Before the first migration, it writes a byte-consistent `VACUUM INTO` snapshot
beside the ledger:

`devharmonics.db.backup-v26-to-v33-<timestamp>-<id>.sqlite`

Project configuration remains at schema version 2. Completed, owner-approved
GitHub actions are not undone by the local software rollback.

For the exact-path procedure, set:

```powershell
$backupNamePattern = 'devharmonics.db.backup-v26-to-v33-*.sqlite'
$expectedUserVersion = 26
$currentUserVersion = 33
$keptLedgerName = 'devharmonics.db.schema33-kept'
```

After the restored ledger passes verification, check out and build v0.5.1:

```powershell
git checkout v0.5.1
npm.cmd ci
npm.cmd run build
node dist/src/cli.js serve --project C:\path\to\your\project
```

Verify that `node dist/src/cli.js doctor` reports providers normally, the
dashboard lists the pre-upgrade runs, and `node dist/src/cli.js --version`
reports 0.5.1.

Runs, receipts, deliveries, workflow revisions, and steering recorded after
the v0.6.0 upgrade exist only in the kept schema-33 ledger. GitHub branches,
pull requests, merges, and tags remain valid.
