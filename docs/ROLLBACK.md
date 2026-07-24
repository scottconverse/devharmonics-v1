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

## Exact-path restore procedure

Use this procedure for each rollback below. The rollback-specific section gives
the candidate filename pattern, expected pre-upgrade schema, kept-ledger name,
and older tag. Run the verifier from the current unreleased checkout **before**
checking out the older tag.

First, set the three values given by the rollback-specific section and list the
candidates. The wildcard is used only to display possible files; it never
selects a file for copying or moving.

```powershell
$ledgerDirectory = 'C:\path\to\your\project\.devharmonics'
$verifierPath = (Resolve-Path -LiteralPath '.\scripts\verify-ledger-backup.mjs').Path

# Run the three assignments from the applicable rollback section first.
if (
  [string]::IsNullOrWhiteSpace($backupNamePattern) -or
  $null -eq $expectedUserVersion -or
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

if (-not (Test-Path -LiteralPath $liveLedger -PathType Leaf)) {
  throw "Live ledger is not an existing file: $liveLedger"
}
if (Test-Path -LiteralPath $stagedLedger) {
  throw "Staging path already exists: $stagedLedger"
}
if (Test-Path -LiteralPath $keptLedger) {
  throw "Kept-ledger path already exists: $keptLedger"
}

Copy-Item -LiteralPath $backupPath -Destination $stagedLedger
node $verifierPath --path $stagedLedger --expected-user-version $expectedUserVersion
if ($LASTEXITCODE -ne 0) {
  throw 'Staged copy failed verification; the live ledger was not changed.'
}

Move-Item -LiteralPath $liveLedger -Destination $keptLedger
Move-Item -LiteralPath $stagedLedger -Destination $liveLedger

node $verifierPath --path $liveLedger --expected-user-version $expectedUserVersion
if ($LASTEXITCODE -ne 0) {
  throw 'Restored ledger failed verification; do not start DevHarmonics.'
}
```

Do not start DevHarmonics after any failed verification. The exact
`$keptLedger` path retains the newer database for inspection, re-upgrade, or a
manual recovery if the final swap cannot be verified.

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
