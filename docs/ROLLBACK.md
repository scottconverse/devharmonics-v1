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

The recovery state machine requires **PowerShell 7** on every operating system.
Start it with `pwsh`, not Windows PowerShell 5.1 or a POSIX shell:

```powershell
if ($PSVersionTable.PSVersion.Major -lt 7) {
  throw 'Rollback requires PowerShell 7 or newer. Start this procedure with pwsh.'
}
```

Install PowerShell 7 before continuing if `pwsh` is unavailable. The automated
suite runs the real recovery script and verifier against disposable ledgers. It
injects an abrupt exit after every primary and compensating filesystem mutation,
then reruns the same command and proves either a verified rollback or a verified
newer live ledger with all source ledgers preserved. The product suite is
continuously verified on Windows and Ubuntu; macOS product verification remains
manual. Rehearse the procedure against disposable copies before an incident.

## Exact-path restore procedure

Use this procedure for each rollback below. The rollback-specific section gives
the candidate filename pattern, expected pre-upgrade schema, current schema,
kept-ledger name, and older tag. Run the state machine from the current
unreleased checkout **before** checking out the older tag.

First, set the four values given by the rollback-specific section and list the
candidates. The wildcard is used only to display possible files; it never
selects a file for copying or moving.

```powershell
$projectPath = (Resolve-Path -LiteralPath '/absolute/path/to/your/project').Path
$ledgerDirectory = Join-Path -Path $projectPath -ChildPath '.devharmonics'

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

Set the four values from the applicable rollback section and invoke the single
state-machine command:

```powershell
$backupPath = (Resolve-Path -LiteralPath '/paste/the/exact/FullName/from/the/table.sqlite').Path

pwsh -NoProfile -File ./scripts/restore-ledger-backup.ps1 `
  -LedgerDirectory $ledgerDirectory `
  -BackupPath $backupPath `
  -ExpectedUserVersion $expectedUserVersion `
  -CurrentUserVersion $currentUserVersion `
  -KeptLedgerName $keptLedgerName
```

The script verifies the exact backup and live ledger with the read-only Node
verifier before mutation, including `PRAGMA user_version`,
`PRAGMA integrity_check`, `PRAGMA foreign_key_check`, canonical migration
history, and required schema shape. It then advances through named,
deterministic file states. The exact backup is copied, never moved. The newer
live ledger is moved once to the named kept path and never consumed. A restore
that fails final verification is moved to
`devharmonics.db.restore-rejected`; the kept newer ledger is copied to a
separate recovery staging path, verified, and then moved live.

Exit code `0` means the rollback schema is verified live. Exit code `2` means
the rollback was rejected, the rejected file is preserved, and a verified copy
of the newer kept ledger is live again. Any other nonzero exit fails closed on
invalid input or an ambiguous state.

### Resume after interruption

Do not improvise cleanup. If `pwsh`, the terminal, or the machine stops at any
point, run the **same command with the same exact arguments** again. The script
re-verifies every existing state file and resumes the next safe transition.
Repeated runs are idempotent. An incomplete derived staging copy is discarded
and recreated only from the still-verified exact backup or kept newer ledger.
The script never guesses through an unexpected combination of live, staged,
kept, rejected, or recovery-staged files.

The implementation keeps exact-path mutation mechanically auditable. These are
internal state-machine operations, not commands to run by hand:

```powershell
Copy-Item -LiteralPath $backup -Destination $staged -ErrorAction Stop
Move-Item -LiteralPath $recoveryStaged -Destination $liveLedger -ErrorAction Stop
```

## Development-line rollback: ledger schema 38 → v0.6.1

The unreleased development line after v0.6.1 advances the ledger through four
ordered migrations:

1. **Ledger schema 34 → 35** adds the `runs_status` index used by the approval
   Inbox projection.
2. **Ledger schema 35 → 36** adds append-only decision records.
3. **Ledger schema 36 → 37** adds decision provenance, uniqueness indexes, and
   database triggers that prevent decision-record updates and deletes.
4. **Ledger schema 37 → 38** adds per-repository validator-discovery snapshots
   plus distinct local-config validator snapshots and suppression tombstones.
   Existing `validators_json` rows remain unchanged owner overrides.
5. **Ledger schema 38 → 39** adds the `compatibility_catalog_trust` table, which
   records the signed model-catalog version this ledger has accepted. A
   downgrade loses only that acceptance record; the next build re-verifies the
   signed catalog from scratch, so nothing needs restoring.
6. **Ledger schema 39 → 40** adds `catalog_digest` to that table and resets any
   acceptance recorded without one back to `invalid`, forcing a fresh signed
   revalidation. A downgrade again loses only the acceptance record.

Backups describe the schema the database actually started at and the maximum
schema supported by the build that opened it. Opening a schema-34 v0.6.1
ledger directly with the schema-38 development build creates one snapshot:

`devharmonics.db.backup-v34-to-v38-<timestamp>-<id>.sqlite`

It does **not** create separate v34-to-v35, v35-to-v36, v36-to-v37, and
v37-to-v38 files while applying the four migrations in one transaction.
Pairwise names exist only when an intermediate development build performed
that upgrade. A schema-37 development ledger opened by this build instead gets
`devharmonics.db.backup-v37-to-v38-<timestamp>-<id>.sqlite`.

For the exact-path procedure, set:

```powershell
$backupNamePattern = 'devharmonics.db.backup-v34-to-v38-*.sqlite'
$expectedUserVersion = 34
$currentUserVersion = 38
$keptLedgerName = 'devharmonics.db.schema38-kept'
```

After the restored ledger passes verification, check out and build the older
release, then restart:

```powershell
git checkout v0.6.1
npm ci
npm run build
node dist/src/cli.js serve --project $projectPath
```

The restored ledger contains none of the Inbox-index, decision-record, or
decision-provenance changes made after the schema-34 snapshot. The kept
schema-38 ledger retains that later data, including validator discovery,
suppression, and override state.

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
npm ci
npm run build
node dist/src/cli.js serve --project $projectPath
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
npm ci
npm run build
node dist/src/cli.js serve --project $projectPath
```

Verify that `node dist/src/cli.js doctor` reports providers normally, the
dashboard lists the pre-upgrade runs, and `node dist/src/cli.js --version`
reports 0.5.1.

Runs, receipts, deliveries, workflow revisions, and steering recorded after
the v0.6.0 upgrade exist only in the kept schema-33 ledger. GitHub branches,
pull requests, merges, and tags remain valid.
