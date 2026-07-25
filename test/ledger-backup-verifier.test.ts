import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

const verifierPath = path.resolve("scripts/verify-ledger-backup.mjs");
const manifestPath = path.resolve("scripts/ledger-schema-manifests.mjs");

type RequiredShape = Readonly<Record<string, readonly string[]>>;
type SchemaManifestModule = {
  LEDGER_SCHEMA_MANIFESTS: Readonly<Record<number, {
    requiredShape: RequiredShape;
  }>>;
};

const manifestModule = await import(pathToFileURL(manifestPath).href) as SchemaManifestModule;

const MIGRATION_NAMES = [
  "baseline-v0.1-schema",
  "typed-event-payloads",
  "attempt-runtime-receipts",
  "connection-and-model-registry",
  "durable-run-recovery-links",
  "model-qualification-and-preferences",
  "connection-health-and-cooldowns",
  "blackboard-and-result-envelopes",
  "product-and-repository-registry",
  "durable-task-contracts",
  "model-health-and-cooldowns",
  "catalog-freshness-qualification-fingerprints-and-costs",
  "durable-run-autonomy",
  "model-performance-observation-policy",
  "reviewer-invocation-performance",
  "typed-tool-policy-receipts",
  "structured-review-quorums",
  "durable-objectives-and-plan-revisions",
  "read-only-workbench-consultations",
  "local-repository-configuration-and-inspection",
  "multi-repository-integration-sets",
  "source-backed-product-intelligence",
  "provider-quota-groups-and-honest-model-resolution",
  "review-evidence-bindings",
  "atomic-paid-spend-reservations",
  "paid-spend-reservation-lifecycle",
  "approved-delivery-handoffs",
  "live-run-steering",
  "review-receipt-lens",
  "delivery-merge-and-tag",
  "delivery-release-tag",
  "workflow-revisions",
  "objective-workflow-provenance",
  "delivery-merge-commit-oid",
  "runs-status-index",
  "decision-records",
  "decision-provenance-and-append-only-invariants",
] as const;

const REQUIRED_SHAPE_26 = manifestModule.LEDGER_SCHEMA_MANIFESTS[26]!.requiredShape;
const REQUIRED_SHAPE_33 = manifestModule.LEDGER_SCHEMA_MANIFESTS[33]!.requiredShape;
const REQUIRED_SHAPE_34 = manifestModule.LEDGER_SCHEMA_MANIFESTS[34]!.requiredShape;
const REQUIRED_SHAPE_37 = manifestModule.LEDGER_SCHEMA_MANIFESTS[37]!.requiredShape;

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function createLedger(
  filename: string,
  userVersion: number,
  historyNames: readonly string[],
  requiredShape: RequiredShape = {},
  omitTable?: string,
  omitColumn?: { table: string; column: string },
  historyVersions: readonly number[] = historyNames.map((_, index) => index + 1),
): void {
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
    for (const [index, name] of historyNames.entries()) {
      const version = historyVersions[index];
      if (version === undefined) throw new Error("each migration name needs a fixture version");
      insert.run(version, name, "2026-07-24T00:00:00.000Z");
    }
    for (const [table, columns] of Object.entries(requiredShape)) {
      if (table === "schema_migrations") continue;
      if (table === omitTable) continue;
      const presentColumns = columns.filter(
        (column) => omitColumn?.table !== table || omitColumn.column !== column,
      );
      database.exec(
        `CREATE TABLE ${quoteIdentifier(table)} (${presentColumns.map((column) => `${quoteIdentifier(column)} TEXT`).join(", ")})`,
      );
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

test("verifier accepts a valid ledger without changing bytes, metadata, or sidecar files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharmonics-backup-verifier-valid-"));
  const filename = path.join(root, "backup.sqlite");
  try {
    createLedger(filename, 34, MIGRATION_NAMES.slice(0, 34), REQUIRED_SHAPE_34);
    const beforeStat = await stat(filename);
    const beforeDigest = await digest(filename);
    const beforeBytes = await readFile(filename);
    const beforeEntries = await readdir(root);

    const result = runVerifier(filename, 34);

    assert.equal(result.status, 0, outputOf(result));
    const afterStat = await stat(filename);
    assert.equal(await digest(filename), beforeDigest);
    assert.deepEqual(await readFile(filename), beforeBytes);
    assert.equal(afterStat.size, beforeStat.size);
    assert.equal(afterStat.mtimeMs, beforeStat.mtimeMs);
    assert.equal(afterStat.ctimeMs, beforeStat.ctimeMs);
    assert.equal(afterStat.mode, beforeStat.mode);
    assert.deepEqual(await readdir(root), beforeEntries);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("verifier accepts canonical schema 26 and 33 compatibility fixtures", async () => {
  const fixtures = [
    { version: 26, shape: REQUIRED_SHAPE_26 },
    { version: 33, shape: REQUIRED_SHAPE_33 },
  ] as const;
  for (const fixture of fixtures) {
    const root = await mkdtemp(path.join(os.tmpdir(), `devharmonics-backup-verifier-v${fixture.version}-`));
    const filename = path.join(root, "backup.sqlite");
    try {
      createLedger(
        filename,
        fixture.version,
        MIGRATION_NAMES.slice(0, fixture.version),
        fixture.shape,
      );

      const result = runVerifier(filename, fixture.version);

      assert.equal(result.status, 0, outputOf(result));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("verifier accepts the canonical schema 37 development baseline", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharmonics-backup-verifier-v37-"));
  const filename = path.join(root, "backup.sqlite");
  try {
    createLedger(filename, 37, MIGRATION_NAMES, REQUIRED_SHAPE_37);

    const result = runVerifier(filename, 37);

    assert.equal(result.status, 0, outputOf(result));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("verifier rejects the wrong expected user version with actual and expected values", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharmonics-backup-verifier-version-"));
  const filename = path.join(root, "backup.sqlite");
  try {
    createLedger(filename, 34, MIGRATION_NAMES.slice(0, 34), REQUIRED_SHAPE_34);

    const result = runVerifier(filename, 33);

    assert.notEqual(result.status, 0, outputOf(result));
    assert.match(outputOf(result), /actual[^0-9]*34[\s\S]*expected[^0-9]*33|expected[^0-9]*33[\s\S]*actual[^0-9]*34/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("verifier rejects corrupt database bytes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharmonics-backup-verifier-corrupt-"));
  const filename = path.join(root, "backup.sqlite");
  try {
    await writeFile(filename, Buffer.from("not a sqlite database", "utf8"));

    const result = runVerifier(filename, 34);

    assert.notEqual(result.status, 0, outputOf(result));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("verifier rejects discontinuous migration history", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharmonics-backup-verifier-gap-"));
  const filename = path.join(root, "backup.sqlite");
  try {
    createLedger(
      filename,
      34,
      MIGRATION_NAMES.slice(0, 33),
      REQUIRED_SHAPE_34,
      undefined,
      undefined,
      [1, ...Array.from({ length: 32 }, (_, index) => index + 3)],
    );

    const result = runVerifier(filename, 34);

    assert.notEqual(result.status, 0, outputOf(result));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("verifier rejects migration history whose maximum disagrees with user_version", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharmonics-backup-verifier-history-"));
  const filename = path.join(root, "backup.sqlite");
  try {
    createLedger(filename, 34, MIGRATION_NAMES.slice(0, 33), REQUIRED_SHAPE_34);

    const result = runVerifier(filename, 34);

    assert.notEqual(result.status, 0, outputOf(result));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("verifier rejects missing paths and directories", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharmonics-backup-verifier-path-"));
  try {
    const missing = runVerifier(path.join(root, "missing.sqlite"), 34);
    const directory = runVerifier(root, 34);

    assert.notEqual(missing.status, 0, outputOf(missing));
    assert.notEqual(directory.status, 0, outputOf(directory));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("verifier rejects continuous migration versions with fake names and no DevHarmonics tables", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharmonics-backup-verifier-fake-"));
  const filename = path.join(root, "backup.sqlite");
  try {
    createLedger(
      filename,
      33,
      MIGRATION_NAMES.slice(0, 33).map((_, index) => `not-devharmonics-${index + 1}`),
    );

    const result = runVerifier(filename, 33);

    assert.notEqual(result.status, 0, outputOf(result));
    assert.match(outputOf(result), /migration history|name|schema/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("verifier rejects canonical migration names when a required table is missing", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharmonics-backup-verifier-table-"));
  const filename = path.join(root, "backup.sqlite");
  try {
    createLedger(
      filename,
      33,
      MIGRATION_NAMES.slice(0, 33),
      REQUIRED_SHAPE_33,
      "delivery_repositories",
    );

    const result = runVerifier(filename, 33);

    assert.notEqual(result.status, 0, outputOf(result));
    assert.match(outputOf(result), /delivery_repositories/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("verifier rejects a canonical-history ledger missing a formerly unchecked required table", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharmonics-backup-verifier-complete-shape-"));
  const filename = path.join(root, "backup.sqlite");
  try {
    createLedger(
      filename,
      34,
      MIGRATION_NAMES.slice(0, 34),
      REQUIRED_SHAPE_34,
      "events",
    );

    const result = runVerifier(filename, 34);

    assert.notEqual(result.status, 0, outputOf(result));
    assert.match(outputOf(result), /events/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("verifier rejects canonical migration names when a required column is missing", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharmonics-backup-verifier-column-"));
  const filename = path.join(root, "backup.sqlite");
  try {
    createLedger(
      filename,
      34,
      MIGRATION_NAMES.slice(0, 34),
      REQUIRED_SHAPE_34,
      undefined,
      { table: "delivery_repositories", column: "merge_commit_oid" },
    );

    const result = runVerifier(filename, 34);

    assert.notEqual(result.status, 0, outputOf(result));
    assert.match(outputOf(result), /delivery_repositories[\s\S]*merge_commit_oid/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("verifier rejects expected schemas without an immutable compatibility manifest", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharmonics-backup-verifier-unsupported-"));
  const filename = path.join(root, "backup.sqlite");
  try {
    createLedger(filename, 3, MIGRATION_NAMES.slice(0, 3));

    const result = runVerifier(filename, 3);

    assert.notEqual(result.status, 0, outputOf(result));
    assert.match(outputOf(result), /unsupported expected schema|supported schemas/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
