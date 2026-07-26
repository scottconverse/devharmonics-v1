import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { DeliveryService } from "../dist/src/delivery.js";
import { Ledger } from "../dist/src/ledger.js";
import { versionAuthorityCorpusManifest } from "./validator-discovery-corpus-manifest.mjs";

const execFileAsync = promisify(execFile);
const corpusRoot = process.env.CIVICSUITE_ORG_READALL;

if (!corpusRoot) {
  console.error("CIVICSUITE_ORG_READALL must name the local read-only CivicSuite clone directory.");
  process.exit(1);
}

function isAuthorityExpectation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.state !== "string") return false;
  const keys = Object.keys(value).sort();
  if (value.state === "absent") return JSON.stringify(keys) === JSON.stringify(["state"]);
  if (value.state === "declared") {
    return JSON.stringify(keys) === JSON.stringify(["source", "state", "version"])
      && ["package.json", "pyproject.toml"].includes(value.source)
      && typeof value.version === "string"
      && value.version.trim().length > 0;
  }
  if (value.state === "invalid") {
    return JSON.stringify(keys) === JSON.stringify(["detail", "source", "state"])
      && ["package.json", "pyproject.toml"].includes(value.source)
      && typeof value.detail === "string"
      && value.detail.length > 0;
  }
  if (value.state === "unavailable") {
    return JSON.stringify(keys) === JSON.stringify(["detail", "source", "state"])
      && ["package.json", "pyproject.toml", "root manifests"].includes(value.source)
      && typeof value.detail === "string"
      && value.detail.length > 0;
  }
  return false;
}

function loadExpectations() {
  const override = process.env.DEVHARMONICS_CORPUS_TEST_EXPECTATIONS;
  if (override === undefined) return versionAuthorityCorpusManifest;
  if (process.env.DEVHARMONICS_CORPUS_TEST_SEAM !== "1") {
    throw new Error("Corpus expectation overrides require DEVHARMONICS_CORPUS_TEST_SEAM=1");
  }
  const parsed = JSON.parse(override);
  if (
    !Array.isArray(parsed) ||
    parsed.length === 0 ||
    parsed.some((entry) =>
      !Array.isArray(entry) ||
      entry.length !== 3 ||
      typeof entry[0] !== "string" ||
      !/^[0-9a-f]{40}$/.test(entry[1]) ||
      !isAuthorityExpectation(entry[2]))
  ) {
    throw new Error("Corpus test expectations must be non-empty [name, 40-character OID, version-authority result] tuples");
  }
  if (new Set(parsed.map(([name]) => name)).size !== parsed.length) throw new Error("Corpus test expectations contain a duplicate repository name");
  return parsed;
}

const expectations = loadExpectations();

async function git(cwd, args) {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    timeout: 30_000,
    windowsHide: true,
  });
  return stdout.trim();
}

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "devharmonics-version-corpus-"));
const ledger = new Ledger(path.join(temporaryRoot, "devharmonics.db"));
const delivery = new DeliveryService(ledger);
const failures = [];

try {
  try {
    const entries = await readdir(path.resolve(corpusRoot), { withFileTypes: true });
    const discoveredRepositories = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(path.resolve(corpusRoot), entry.name);
      try {
        if (await git(candidate, ["rev-parse", "--is-inside-work-tree"]) === "true") {
          discoveredRepositories.push(entry.name);
        }
      } catch {
        // An ordinary non-Git directory is outside the corpus repository set.
      }
    }
    const expectedNames = expectations.map(([name]) => name).sort();
    discoveredRepositories.sort();
    const missing = expectedNames.filter((name) => !discoveredRepositories.includes(name));
    const unexpected = discoveredRepositories.filter((name) => !expectedNames.includes(name));
    if (missing.length) failures.push(`missing top-level Git repositories: ${missing.join(", ")}`);
    if (unexpected.length) failures.push(`unexpected top-level Git repositories: ${unexpected.join(", ")}`);
  } catch (error) {
    failures.push(`corpus repository census failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  for (const [name, oid, expected] of expectations) {
    const repositoryPath = path.join(path.resolve(corpusRoot), name);
    try {
      const info = await stat(repositoryPath);
      if (!info.isDirectory()) throw new Error("path is not a directory");
      const statusBefore = await git(repositoryPath, ["status", "--porcelain=v1", "--untracked-files=all"]);
      if (statusBefore) throw new Error(`worktree is dirty before verification: ${JSON.stringify(statusBefore)}`);
      const currentHead = await git(repositoryPath, ["rev-parse", "HEAD"]);
      if (currentHead !== oid) throw new Error(`expected checkout HEAD ${oid}, but found ${currentHead}`);
      await git(repositoryPath, ["cat-file", "-e", `${oid}^{commit}`]);

      const actual = await delivery.versionAuthorityAtCommit(repositoryPath, oid);
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
      }

      const statusAfter = await git(repositoryPath, ["status", "--porcelain=v1", "--untracked-files=all"]);
      if (statusAfter) throw new Error(`worktree changed during verification: ${JSON.stringify(statusAfter)}`);
      console.log(`${name} ${oid} ${actual.state}${actual.state === "declared" ? ` ${actual.version}` : ""}`);
    } catch (error) {
      failures.push(`${name} ${oid}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
} finally {
  ledger.close();
  await rm(temporaryRoot, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`Version-authority corpus failed (${failures.length}/${expectations.length}):\n${failures.join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(`Version-authority corpus passed: ${expectations.length}/${expectations.length} clean immutable repositories; no corpus writes or network operations.`);
}
