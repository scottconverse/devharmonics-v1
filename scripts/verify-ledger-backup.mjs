import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";

function parseArguments(argv) {
  let filename;
  let expectedUserVersionText;

  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (!option || value === undefined || value.startsWith("--")) {
      throw new Error(
        "usage: node scripts/verify-ledger-backup.mjs --path <exact-file> --expected-user-version <integer>",
      );
    }
    if (option === "--path") {
      if (filename !== undefined) {
        throw new Error("--path must be provided exactly once");
      }
      filename = value;
    } else if (option === "--expected-user-version") {
      if (expectedUserVersionText !== undefined) {
        throw new Error("--expected-user-version must be provided exactly once");
      }
      expectedUserVersionText = value;
    } else {
      throw new Error(`unknown option: ${option}`);
    }
  }

  if (!filename || expectedUserVersionText === undefined) {
    throw new Error(
      "usage: node scripts/verify-ledger-backup.mjs --path <exact-file> --expected-user-version <integer>",
    );
  }
  if (!/^(0|[1-9]\d*)$/.test(expectedUserVersionText)) {
    throw new Error("--expected-user-version must be a non-negative integer");
  }

  const expectedUserVersion = Number(expectedUserVersionText);
  if (!Number.isSafeInteger(expectedUserVersion)) {
    throw new Error("--expected-user-version must be a safe integer");
  }

  return {
    filename: path.resolve(filename),
    expectedUserVersion,
  };
}

async function sha256(filename) {
  const hash = createHash("sha256");
  const stream = createReadStream(filename);
  for await (const chunk of stream) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

function readUserVersion(database) {
  const row = database.prepare("PRAGMA user_version").get();
  if (!row || !Number.isInteger(row.user_version)) {
    throw new Error("database did not return an integer PRAGMA user_version");
  }
  return row.user_version;
}

function verifyIntegrity(database) {
  const rows = database.prepare("PRAGMA integrity_check").all();
  if (
    rows.length !== 1
    || rows[0]?.integrity_check !== "ok"
  ) {
    throw new Error("PRAGMA integrity_check did not return exactly one 'ok' result");
  }

  const foreignKeyViolations = database.prepare("PRAGMA foreign_key_check").all();
  if (foreignKeyViolations.length !== 0) {
    throw new Error(
      `PRAGMA foreign_key_check found ${foreignKeyViolations.length} violation(s)`,
    );
  }
}

function verifyMigrationHistory(database, expectedUserVersion) {
  const rows = database
    .prepare("SELECT version FROM schema_migrations ORDER BY version")
    .all();

  if (rows.length !== expectedUserVersion) {
    const actualMaximum = rows.length === 0 ? 0 : rows.at(-1)?.version;
    throw new Error(
      `migration history length/maximum mismatch: expected ${expectedUserVersion} continuous version(s), actual count ${rows.length}, actual maximum ${String(actualMaximum)}`,
    );
  }

  for (let index = 0; index < rows.length; index += 1) {
    const expectedVersion = index + 1;
    const actualVersion = rows[index]?.version;
    if (actualVersion !== expectedVersion) {
      throw new Error(
        `migration history is discontinuous: expected version ${expectedVersion}, actual ${String(actualVersion)}`,
      );
    }
  }
}

async function verify() {
  const { filename, expectedUserVersion } = parseArguments(process.argv.slice(2));
  const beforeStat = await stat(filename);
  if (!beforeStat.isFile()) {
    throw new Error(`path is not a regular file: ${filename}`);
  }
  const beforeHash = await sha256(filename);

  let database;
  try {
    database = new DatabaseSync(filename, { readOnly: true });
    const actualUserVersion = readUserVersion(database);
    if (actualUserVersion !== expectedUserVersion) {
      throw new Error(
        `user_version mismatch: actual ${actualUserVersion}, expected ${expectedUserVersion}`,
      );
    }
    verifyIntegrity(database);
    verifyMigrationHistory(database, expectedUserVersion);
  } finally {
    database?.close();
  }

  const afterStat = await stat(filename);
  const afterHash = await sha256(filename);
  if (
    afterStat.size !== beforeStat.size
    || afterStat.mtimeMs !== beforeStat.mtimeMs
    || afterHash !== beforeHash
  ) {
    throw new Error("verification changed the candidate file");
  }

  process.stdout.write(`${JSON.stringify({
    verdict: "valid",
    path: filename,
    size: beforeStat.size,
    mtime: beforeStat.mtime.toISOString(),
    sha256: beforeHash,
    userVersion: expectedUserVersion,
    migrationHistoryMaximum: expectedUserVersion,
    integrityCheck: "ok",
    foreignKeyViolations: 0,
  })}\n`);
}

try {
  await verify();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Backup verification failed: ${message}\n`);
  process.exitCode = 1;
}
