[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$LedgerDirectory,

  [Parameter(Mandatory = $true)]
  [string]$BackupPath,

  [Parameter(Mandatory = $true)]
  [ValidateRange(0, 2147483647)]
  [int]$ExpectedUserVersion,

  [Parameter(Mandatory = $true)]
  [ValidateRange(0, 2147483647)]
  [int]$CurrentUserVersion,

  [Parameter(Mandatory = $true)]
  [string]$KeptLedgerName,

  [string]$VerifierPath,

  [ValidateSet(
    'stage-copy',
    'discard-partial-stage',
    'live-to-kept',
    'staged-to-live',
    'live-to-rejected',
    'kept-to-recovery-stage',
    'discard-partial-recovery-stage',
    'recovery-stage-to-live'
  )]
  [string]$InjectTestExitAfter
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($VerifierPath)) {
  $VerifierPath = Join-Path -Path $PSScriptRoot -ChildPath 'verify-ledger-backup.mjs'
}

if (
  $PSVersionTable.PSVersion.Major -lt 7 -and
  $env:DEVHARMONICS_ROLLBACK_TEST_MODE -ne '1'
) {
  throw 'Ledger recovery requires PowerShell 7 or newer. Start it with pwsh.'
}
if ($ExpectedUserVersion -eq $CurrentUserVersion) {
  throw 'ExpectedUserVersion and CurrentUserVersion must describe different schemas.'
}
if (
  [string]::IsNullOrWhiteSpace($KeptLedgerName) -or
  [IO.Path]::GetFileName($KeptLedgerName) -ne $KeptLedgerName
) {
  throw 'KeptLedgerName must be one plain filename, not a path.'
}
if (
  $InjectTestExitAfter -and
  $env:DEVHARMONICS_ROLLBACK_TEST_MODE -ne '1'
) {
  throw 'InjectTestExitAfter is available only when DEVHARMONICS_ROLLBACK_TEST_MODE=1.'
}

$ledgerRoot = (Resolve-Path -LiteralPath $LedgerDirectory -ErrorAction Stop).Path
$backup = (Resolve-Path -LiteralPath $BackupPath -ErrorAction Stop).Path
$verifier = (Resolve-Path -LiteralPath $VerifierPath -ErrorAction Stop).Path

if (-not (Test-Path -LiteralPath $ledgerRoot -PathType Container)) {
  throw "LedgerDirectory is not a directory: $ledgerRoot"
}
if (-not (Test-Path -LiteralPath $backup -PathType Leaf)) {
  throw "BackupPath is not a file: $backup"
}
if (-not (Test-Path -LiteralPath $verifier -PathType Leaf)) {
  throw "VerifierPath is not a file: $verifier"
}

$liveLedger = Join-Path -Path $ledgerRoot -ChildPath 'devharmonics.db'
$staged = Join-Path -Path $ledgerRoot -ChildPath 'devharmonics.db.restore-staged'
$kept = Join-Path -Path $ledgerRoot -ChildPath $KeptLedgerName
$rejected = Join-Path -Path $ledgerRoot -ChildPath 'devharmonics.db.restore-rejected'
$recoveryStaged = Join-Path -Path $ledgerRoot -ChildPath 'devharmonics.db.newer-recovery-staged'

$runningOnWindows = if ($PSVersionTable.PSEdition -eq 'Desktop') {
  $true
} else {
  [System.OperatingSystem]::IsWindows()
}
$comparison = if ($runningOnWindows) {
  [StringComparison]::OrdinalIgnoreCase
} else {
  [StringComparison]::Ordinal
}
$reservedPaths = @($liveLedger, $staged, $rejected, $recoveryStaged)
foreach ($reservedPath in $reservedPaths) {
  if ([string]::Equals($kept, $reservedPath, $comparison)) {
    throw "KeptLedgerName resolves to a reserved recovery path: $kept"
  }
  if ([string]::Equals($backup, $reservedPath, $comparison) -or [string]::Equals($backup, $kept, $comparison)) {
    throw "BackupPath must be distinct from every live or recovery path: $backup"
  }
}

function Test-LedgerSchema {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [Parameter(Mandatory = $true)]
    [int]$Version
  )

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    return $false
  }
  $ErrorActionPreference = 'Continue'
  & node $verifier --path $Path --expected-user-version $Version *>$null
  $verified = $LASTEXITCODE -eq 0
  $ErrorActionPreference = 'Stop'
  return $verified
}

function Assert-LedgerSchema {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [Parameter(Mandatory = $true)]
    [int]$Version,
    [Parameter(Mandatory = $true)]
    [string]$Label
  )

  if (-not (Test-LedgerSchema -Path $Path -Version $Version)) {
    throw "$Label does not verify as ledger schema $Version`: $Path"
  }
}

function Invoke-TestExit {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Boundary
  )

  if ($InjectTestExitAfter -eq $Boundary) {
    [Console]::Error.WriteLine("Injected test exit after mutation boundary: $Boundary")
    exit 91
  }
}

Assert-LedgerSchema -Path $backup -Version $ExpectedUserVersion -Label 'Exact backup'

for ($transition = 0; $transition -lt 12; $transition += 1) {
  foreach ($statePath in @($liveLedger, $staged, $kept, $rejected, $recoveryStaged)) {
    if ((Test-Path -LiteralPath $statePath) -and -not (Test-Path -LiteralPath $statePath -PathType Leaf)) {
      throw "Recovery state path exists but is not a regular file: $statePath"
    }
  }

  $liveExists = Test-Path -LiteralPath $liveLedger -PathType Leaf
  $stagedExists = Test-Path -LiteralPath $staged -PathType Leaf
  $keptExists = Test-Path -LiteralPath $kept -PathType Leaf
  $rejectedExists = Test-Path -LiteralPath $rejected -PathType Leaf
  $recoveryStagedExists = Test-Path -LiteralPath $recoveryStaged -PathType Leaf

  $liveIsExpected = $liveExists -and (Test-LedgerSchema -Path $liveLedger -Version $ExpectedUserVersion)
  $liveIsCurrent = $liveExists -and (Test-LedgerSchema -Path $liveLedger -Version $CurrentUserVersion)
  $keptIsCurrent = $keptExists -and (Test-LedgerSchema -Path $kept -Version $CurrentUserVersion)
  $stagedIsExpected = $stagedExists -and (Test-LedgerSchema -Path $staged -Version $ExpectedUserVersion)
  $recoveryStagedIsCurrent = $recoveryStagedExists -and (
    Test-LedgerSchema -Path $recoveryStaged -Version $CurrentUserVersion
  )

  if ($keptExists -and -not $keptIsCurrent) {
    throw "Kept newer ledger does not verify as ledger schema $CurrentUserVersion`: $kept"
  }
  if ($stagedExists -and -not $stagedIsExpected) {
    if (-not $keptExists -and $liveIsCurrent -and -not $rejectedExists -and -not $recoveryStagedExists) {
      Remove-Item -LiteralPath $staged -Force -ErrorAction Stop
      Invoke-TestExit -Boundary 'discard-partial-stage'
      continue
    }
    throw "Staged rollback ledger is invalid in an ambiguous state: $staged"
  }
  if ($recoveryStagedExists -and -not $recoveryStagedIsCurrent) {
    if ($keptIsCurrent -and $rejectedExists -and -not $liveExists -and -not $stagedExists) {
      Remove-Item -LiteralPath $recoveryStaged -Force -ErrorAction Stop
      Invoke-TestExit -Boundary 'discard-partial-recovery-stage'
      continue
    }
    throw "Staged newer-ledger recovery copy is invalid in an ambiguous state: $recoveryStaged"
  }

  if (-not $keptExists) {
    if ($rejectedExists -or $recoveryStagedExists) {
      throw 'Ambiguous recovery state: rejected/recovery files exist before the newer ledger has been kept. Preserve every file and stop.'
    }
    if ($liveIsCurrent -and -not $stagedExists) {
      Copy-Item -LiteralPath $backup -Destination $staged -ErrorAction Stop
      Invoke-TestExit -Boundary 'stage-copy'
      continue
    }
    if ($liveIsCurrent -and $stagedExists) {
      Move-Item -LiteralPath $liveLedger -Destination $kept -ErrorAction Stop
      Invoke-TestExit -Boundary 'live-to-kept'
      continue
    }
    throw 'Ambiguous initial recovery state. Expected a verified newer live ledger, optionally with one verified rollback staging copy; preserve every file and stop.'
  }

  if ($stagedExists) {
    if (-not $liveExists -and -not $rejectedExists -and -not $recoveryStagedExists) {
      Move-Item -LiteralPath $staged -Destination $liveLedger -ErrorAction Stop
      Invoke-TestExit -Boundary 'staged-to-live'
      continue
    }
    throw 'Ambiguous swap state while the rollback staging copy exists. Preserve every file and stop.'
  }

  if (-not $rejectedExists) {
    if ($liveIsExpected -and -not $recoveryStagedExists) {
      Write-Output "Rollback complete. Verified schema $ExpectedUserVersion is live; the exact backup and schema-$CurrentUserVersion kept ledger are preserved."
      exit 0
    }
    if ($liveExists -and -not $liveIsExpected -and -not $liveIsCurrent -and -not $recoveryStagedExists) {
      Move-Item -LiteralPath $liveLedger -Destination $rejected -ErrorAction Stop
      Invoke-TestExit -Boundary 'live-to-rejected'
      continue
    }
    throw 'Ambiguous post-swap state. The live ledger is not the verified rollback ledger, or an unexpected recovery staging file exists; preserve every file and stop.'
  }

  if ($liveIsCurrent -and -not $recoveryStagedExists) {
    [Console]::Error.WriteLine("Rollback rejected. The rejected restore is preserved, and verified schema $CurrentUserVersion is live from the kept source.")
    exit 2
  }
  if (-not $liveExists -and -not $recoveryStagedExists) {
    Copy-Item -LiteralPath $kept -Destination $recoveryStaged -ErrorAction Stop
    Invoke-TestExit -Boundary 'kept-to-recovery-stage'
    continue
  }
  if (-not $liveExists -and $recoveryStagedExists) {
    Move-Item -LiteralPath $recoveryStaged -Destination $liveLedger -ErrorAction Stop
    Invoke-TestExit -Boundary 'recovery-stage-to-live'
    continue
  }

  throw 'Ambiguous rejected-restore recovery state. Preserve the backup, kept, rejected, live, and recovery-staged paths and stop.'
}

throw 'Recovery exceeded its bounded transition count. Preserve every file and stop.'
