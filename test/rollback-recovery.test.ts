import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

const restoreScript = path.resolve("scripts/restore-ledger-backup.ps1");
const verifierScript = path.resolve("scripts/verify-ledger-backup.mjs");
const manifestPath = path.resolve("scripts/ledger-schema-manifests.mjs");
const keptName = "devharmonics.db.schema37-kept";
const pwshProbe = spawnSync("pwsh", ["-NoLogo", "-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"], {
  encoding: "utf8",
});
const powershellCommand = pwshProbe.error && process.platform === "win32"
  ? "powershell.exe"
  : "pwsh";

type SchemaManifest = {
  migrationNames: readonly string[];
  requiredShape: Readonly<Record<string, readonly string[]>>;
};
type ManifestModule = {
  LEDGER_SCHEMA_MANIFESTS: Readonly<Record<number, SchemaManifest>>;
};

const manifestModule = await import(pathToFileURL(manifestPath).href) as ManifestModule;

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function createLedger(filename: string, version: 34 | 37): void {
  const manifest = manifestModule.LEDGER_SCHEMA_MANIFESTS[version];
  assert.ok(manifest, `missing test manifest for schema ${version}`);
  const database = new DatabaseSync(filename);
  try {
    for (const [table, columns] of Object.entries(manifest.requiredShape)) {
      database.exec(
        `CREATE TABLE ${quoteIdentifier(table)} (${columns.map((column) => {
          const type = table === "schema_migrations" && column === "version"
            ? "INTEGER PRIMARY KEY"
            : "TEXT";
          return `${quoteIdentifier(column)} ${type}`;
        }).join(", ")})`,
      );
    }
    const insert = database.prepare(
      "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
    );
    for (const [index, name] of manifest.migrationNames.entries()) {
      insert.run(index + 1, name, "2026-07-24T00:00:00.000Z");
    }
    database.exec(`PRAGMA user_version = ${version}`);
  } finally {
    database.close();
  }
}

async function digest(filename: string): Promise<string> {
  return createHash("sha256").update(await readFile(filename)).digest("hex");
}

type Fixture = {
  root: string;
  live: string;
  backup: string;
  kept: string;
  staged: string;
  rejected: string;
  recoveryStaged: string;
  backupDigest: string;
  currentDigest: string;
};

async function createFixture(): Promise<Fixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharmonics-rollback-recovery-"));
  const live = path.join(root, "devharmonics.db");
  const backup = path.join(root, "selected-backup.sqlite");
  createLedger(live, 37);
  createLedger(backup, 34);
  return {
    root,
    live,
    backup,
    kept: path.join(root, keptName),
    staged: path.join(root, "devharmonics.db.restore-staged"),
    rejected: path.join(root, "devharmonics.db.restore-rejected"),
    recoveryStaged: path.join(root, "devharmonics.db.newer-recovery-staged"),
    backupDigest: await digest(backup),
    currentDigest: await digest(live),
  };
}

function runRestore(
  fixture: Fixture,
  injectTestExitAfter?: string,
): SpawnSyncReturns<string> {
  const args = [
    "-NoLogo",
    "-NoProfile",
    ...(powershellCommand === "powershell.exe" ? ["-ExecutionPolicy", "Bypass"] : []),
    "-File",
    restoreScript,
    "-LedgerDirectory",
    fixture.root,
    "-BackupPath",
    fixture.backup,
    "-ExpectedUserVersion",
    "34",
    "-CurrentUserVersion",
    "37",
    "-KeptLedgerName",
    keptName,
  ];
  if (injectTestExitAfter) {
    args.push("-InjectTestExitAfter", injectTestExitAfter);
  }
  return spawnSync(powershellCommand, args, {
    encoding: "utf8",
    env: {
      ...process.env,
      DEVHARMONICS_ROLLBACK_TEST_MODE: "1",
    },
  });
}

function outputOf(result: SpawnSyncReturns<string>): string {
  return `${result.stdout}\n${result.stderr}`;
}

function verifySchema(filename: string, version: number): void {
  const result = spawnSync(
    process.execPath,
    [
      verifierScript,
      "--path",
      filename,
      "--expected-user-version",
      String(version),
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, outputOf(result));
}

test("rollback recovery is an executable PowerShell 7 state machine", () => {
  assert.ok(
    existsSync(restoreScript),
    `missing executable recovery state machine: ${restoreScript}`,
  );
});

test("rollback completion commands are platform-neutral", async () => {
  const rollback = await readFile("docs/ROLLBACK.md", "utf8");
  assert.doesNotMatch(rollback, /\bnpm\.cmd\b/i);
  assert.doesNotMatch(
    rollback,
    /node\s+dist\/src\/cli\.js\s+serve\s+--project\s+[A-Za-z]:\\/i,
  );
});

test("happy-path restore is idempotent and preserves exact backup and kept newer ledger", async () => {
  const fixture = await createFixture();
  try {
    const first = runRestore(fixture);
    assert.equal(first.status, 0, outputOf(first));
    assert.match(first.stdout, /rollback complete/i);
    verifySchema(fixture.live, 34);
    verifySchema(fixture.kept, 37);
    assert.equal(await digest(fixture.backup), fixture.backupDigest);
    assert.equal(await digest(fixture.kept), fixture.currentDigest);
    assert.equal(existsSync(fixture.staged), false);
    assert.equal(existsSync(fixture.rejected), false);
    assert.equal(existsSync(fixture.recoveryStaged), false);

    const second = runRestore(fixture);
    assert.equal(second.status, 0, outputOf(second));
    verifySchema(fixture.live, 34);
    assert.equal(await digest(fixture.backup), fixture.backupDigest);
    assert.equal(await digest(fixture.kept), fixture.currentDigest);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("resume completes safely after every primary restore mutation boundary", async (context) => {
  for (const boundary of ["stage-copy", "live-to-kept", "staged-to-live"]) {
    await context.test(boundary, async () => {
      const fixture = await createFixture();
      try {
        const interrupted = runRestore(fixture, boundary);
        assert.equal(interrupted.status, 91, outputOf(interrupted));
        assert.match(outputOf(interrupted), new RegExp(boundary));

        const resumed = runRestore(fixture);
        assert.equal(resumed.status, 0, outputOf(resumed));
        verifySchema(fixture.live, 34);
        verifySchema(fixture.kept, 37);
        assert.equal(await digest(fixture.backup), fixture.backupDigest);
        assert.equal(await digest(fixture.kept), fixture.currentDigest);
        assert.equal(existsSync(fixture.staged), false);
        assert.equal(existsSync(fixture.rejected), false);
        assert.equal(existsSync(fixture.recoveryStaged), false);
      } finally {
        await rm(fixture.root, { recursive: true, force: true });
      }
    });
  }
});

test("resume restores the newer ledger after every compensating recovery mutation boundary", async (context) => {
  for (const boundary of [
    "live-to-rejected",
    "kept-to-recovery-stage",
    "recovery-stage-to-live",
  ]) {
    await context.test(boundary, async () => {
      const fixture = await createFixture();
      try {
        const swapped = runRestore(fixture, "staged-to-live");
        assert.equal(swapped.status, 91, outputOf(swapped));
        await writeFile(fixture.live, Buffer.from(`rejected-${boundary}`, "utf8"));
        const rejectedDigest = await digest(fixture.live);

        const interrupted = runRestore(fixture, boundary);
        assert.equal(interrupted.status, 91, outputOf(interrupted));
        assert.match(outputOf(interrupted), new RegExp(boundary));

        const resumed = runRestore(fixture);
        assert.equal(resumed.status, 2, outputOf(resumed));
        assert.match(outputOf(resumed), /rollback rejected/i);
        verifySchema(fixture.live, 37);
        verifySchema(fixture.kept, 37);
        assert.equal(await digest(fixture.backup), fixture.backupDigest);
        assert.equal(await digest(fixture.kept), fixture.currentDigest);
        assert.equal(await digest(fixture.rejected), rejectedDigest);
        assert.equal(existsSync(fixture.staged), false);
        assert.equal(existsSync(fixture.recoveryStaged), false);

        const repeated = runRestore(fixture);
        assert.equal(repeated.status, 2, outputOf(repeated));
        assert.equal(await digest(fixture.rejected), rejectedDigest);
        assert.equal(await digest(fixture.kept), fixture.currentDigest);
      } finally {
        await rm(fixture.root, { recursive: true, force: true });
      }
    });
  }
});

test("resume replaces interrupted partial staging copies only from preserved exact sources", async (context) => {
  await context.test("partial rollback staging copy", async () => {
    const fixture = await createFixture();
    try {
      await writeFile(fixture.staged, Buffer.from("partial rollback copy", "utf8"));
      const discarded = runRestore(fixture, "discard-partial-stage");
      assert.equal(discarded.status, 91, outputOf(discarded));
      assert.equal(existsSync(fixture.staged), false);

      const resumed = runRestore(fixture);
      assert.equal(resumed.status, 0, outputOf(resumed));
      verifySchema(fixture.live, 34);
      verifySchema(fixture.kept, 37);
      assert.equal(await digest(fixture.backup), fixture.backupDigest);
      assert.equal(await digest(fixture.kept), fixture.currentDigest);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  await context.test("partial newer-ledger recovery staging copy", async () => {
    const fixture = await createFixture();
    try {
      const swapped = runRestore(fixture, "staged-to-live");
      assert.equal(swapped.status, 91, outputOf(swapped));
      await writeFile(fixture.live, Buffer.from("rejected restore", "utf8"));
      const rejectedDigest = await digest(fixture.live);
      const preserved = runRestore(fixture, "live-to-rejected");
      assert.equal(preserved.status, 91, outputOf(preserved));
      await writeFile(fixture.recoveryStaged, Buffer.from("partial newer copy", "utf8"));

      const discarded = runRestore(fixture, "discard-partial-recovery-stage");
      assert.equal(discarded.status, 91, outputOf(discarded));
      assert.equal(existsSync(fixture.recoveryStaged), false);

      const resumed = runRestore(fixture);
      assert.equal(resumed.status, 2, outputOf(resumed));
      verifySchema(fixture.live, 37);
      assert.equal(await digest(fixture.backup), fixture.backupDigest);
      assert.equal(await digest(fixture.kept), fixture.currentDigest);
      assert.equal(await digest(fixture.rejected), rejectedDigest);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});

test("ambiguous states and invalid backups fail closed without changing source ledgers", async (context) => {
  await context.test("ambiguous duplicate live and kept state", async () => {
    const fixture = await createFixture();
    try {
      await copyFile(fixture.live, fixture.kept);
      const liveDigest = await digest(fixture.live);
      const result = runRestore(fixture);
      assert.notEqual(result.status, 0, outputOf(result));
      assert.match(outputOf(result), /ambiguous/i);
      assert.equal(await digest(fixture.live), liveDigest);
      assert.equal(await digest(fixture.kept), fixture.currentDigest);
      assert.equal(await digest(fixture.backup), fixture.backupDigest);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  await context.test("invalid exact backup", async () => {
    const fixture = await createFixture();
    try {
      await writeFile(fixture.backup, Buffer.from("not sqlite", "utf8"));
      const liveDigest = await digest(fixture.live);
      const invalidBackupDigest = await digest(fixture.backup);
      const result = runRestore(fixture);
      assert.notEqual(result.status, 0, outputOf(result));
      assert.match(outputOf(result), /exact backup/i);
      assert.equal(await digest(fixture.live), liveDigest);
      assert.equal(await digest(fixture.backup), invalidBackupDigest);
      assert.equal(existsSync(fixture.kept), false);
      assert.equal(existsSync(fixture.staged), false);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  await context.test("reserved recovery path is a directory", async () => {
    const fixture = await createFixture();
    try {
      await mkdir(fixture.staged);
      const liveDigest = await digest(fixture.live);
      const result = runRestore(fixture);
      assert.notEqual(result.status, 0, outputOf(result));
      assert.match(outputOf(result), /not a regular file/i);
      assert.equal(await digest(fixture.live), liveDigest);
      assert.equal(await digest(fixture.backup), fixture.backupDigest);
      assert.equal(existsSync(fixture.kept), false);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});
