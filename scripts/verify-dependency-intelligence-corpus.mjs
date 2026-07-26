import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { discoverDependenciesAtCommit } from "../dist/src/dependency-intelligence.js";
import { dependencyIntelligenceCorpusManifest } from "./validator-discovery-corpus-manifest.mjs";

const execFileAsync = promisify(execFile);
const corpusRoot = process.env.CIVICSUITE_ORG_READALL;

if (!corpusRoot) {
  console.error("CIVICSUITE_ORG_READALL must name the local read-only CivicSuite clone directory.");
  process.exit(1);
}

function isDependencyExpectation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  return JSON.stringify(keys) === JSON.stringify(["diagnostics", "facts", "identities", "manifests", "sha256", "state"])
    && ["absent", "detected", "dynamic", "malformed", "unsupported", "wrong_shape", "unavailable"].includes(value.state)
    && ["facts", "identities", "manifests", "diagnostics"].every(
      (key) => Number.isInteger(value[key]) && value[key] >= 0,
    )
    && /^[0-9a-f]{64}$/.test(value.sha256);
}

function loadExpectations() {
  const override = process.env.DEVHARMONICS_DEPENDENCY_CORPUS_TEST_EXPECTATIONS;
  if (override === undefined) return dependencyIntelligenceCorpusManifest;
  if (process.env.DEVHARMONICS_DEPENDENCY_CORPUS_TEST_SEAM !== "1") {
    throw new Error("Dependency-corpus expectation overrides require DEVHARMONICS_DEPENDENCY_CORPUS_TEST_SEAM=1");
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
      !isDependencyExpectation(entry[2]))
  ) {
    throw new Error("Dependency-corpus test expectations must be non-empty [name, 40-character OID, dependency fingerprint] tuples");
  }
  if (new Set(parsed.map(([name]) => name)).size !== parsed.length) {
    throw new Error("Dependency-corpus test expectations contain a duplicate repository name");
  }
  return parsed;
}

function fingerprint(extraction) {
  return {
    state: extraction.state,
    facts: extraction.facts.length,
    identities: extraction.identities.length,
    manifests: extraction.manifests.length,
    diagnostics: extraction.diagnostics.length,
    sha256: createHash("sha256").update(JSON.stringify(extraction)).digest("hex"),
  };
}

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

const expectations = loadExpectations();
const failures = [];

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

    const actual = fingerprint(await discoverDependenciesAtCommit(repositoryPath, oid));
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`expected dependency fingerprint ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
    }

    const statusAfter = await git(repositoryPath, ["status", "--porcelain=v1", "--untracked-files=all"]);
    if (statusAfter) throw new Error(`worktree changed during verification: ${JSON.stringify(statusAfter)}`);
    console.log(`${name} ${oid} ${actual.state} ${actual.facts} facts ${actual.sha256}`);
  } catch (error) {
    failures.push(`${name} ${oid}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (failures.length) {
  console.error(`Dependency-intelligence corpus failed (${failures.length}/${expectations.length}):\n${failures.join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(`Dependency-intelligence corpus passed: ${expectations.length}/${expectations.length} clean immutable repositories; no corpus writes or network operations.`);
}
