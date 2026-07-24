import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const verifierPath = path.resolve("scripts/verify-ledger-backup.mjs");

function createLedger(filename: string, userVersion: number, historyVersions: readonly number[]): void {
  const database = new DatabaseSync(filename);
  try {
    database.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);
    const insert = database.prepare(
      "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
    );
    for (const version of historyVersions) {
      insert.run(version, `migration-${version}`, "2026-07-24T00:00:00.000Z");
    }
    database.exec(`PRAGMA user_version = ${userVersion}`);
  } finally {
    database.close();
  }
}

function runVerifier(filename: string, expectedUserVersion: number): SpawnSyncReturns<string> {
  assert.ok(
    existsSync(verifierPath),
    `planned verifier command is missing: ${verifierPath}`,
  );
  return spawnSync(
    process.execPath,
    [
      verifierPath,
      "--path",
      filename,
      "--expected-user-version",
      String(expectedUserVersion),
    ],
    { encoding: "utf8" },
  );
}

function outputOf(result: SpawnSyncReturns<string>): string {
  return `${result.stdout}\n${result.stderr}`;
}

async function digest(filename: string): Promise<string> {
  return createHash("sha256").update(await readFile(filename)).digest("hex");
}

test("verifier accepts a valid ledger without changing its bytes or metadata", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharmonics-backup-verifier-valid-"));
  const filename = path.join(root, "backup.sqlite");
  try {
    createLedger(filename, 3, [1, 2, 3]);
    const beforeStat = await stat(filename);
    const beforeDigest = await digest(filename);

    const result = runVerifier(filename, 3);

    assert.equal(result.status, 0, outputOf(result));
    const afterStat = await stat(filename);
    assert.equal(await digest(filename), beforeDigest);
    assert.equal(afterStat.size, beforeStat.size);
    assert.equal(afterStat.mtimeMs, beforeStat.mtimeMs);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("verifier rejects the wrong expected user version with actual and expected values", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharmonics-backup-verifier-version-"));
  const filename = path.join(root, "backup.sqlite");
  try {
    createLedger(filename, 3, [1, 2, 3]);

    const result = runVerifier(filename, 2);

    assert.notEqual(result.status, 0, outputOf(result));
    assert.match(outputOf(result), /actual[^0-9]*3[\s\S]*expected[^0-9]*2|expected[^0-9]*2[\s\S]*actual[^0-9]*3/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("verifier rejects corrupt database bytes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharmonics-backup-verifier-corrupt-"));
  const filename = path.join(root, "backup.sqlite");
  try {
    await writeFile(filename, Buffer.from("not a sqlite database", "utf8"));

    const result = runVerifier(filename, 3);

    assert.notEqual(result.status, 0, outputOf(result));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("verifier rejects discontinuous migration history", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharmonics-backup-verifier-gap-"));
  const filename = path.join(root, "backup.sqlite");
  try {
    createLedger(filename, 3, [1, 3]);

    const result = runVerifier(filename, 3);

    assert.notEqual(result.status, 0, outputOf(result));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("verifier rejects migration history whose maximum disagrees with user_version", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharmonics-backup-verifier-history-"));
  const filename = path.join(root, "backup.sqlite");
  try {
    createLedger(filename, 3, [1, 2]);

    const result = runVerifier(filename, 3);

    assert.notEqual(result.status, 0, outputOf(result));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("verifier rejects missing paths and directories", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharmonics-backup-verifier-path-"));
  try {
    const missing = runVerifier(path.join(root, "missing.sqlite"), 3);
    const directory = runVerifier(root, 3);

    assert.notEqual(missing.status, 0, outputOf(missing));
    assert.notEqual(directory.status, 0, outputOf(directory));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
