import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { discoverRepositoryValidators } from "../dist/src/validator-discovery.js";
import { validatorDiscoveryCorpusManifest } from "./validator-discovery-corpus-manifest.mjs";

const execFileAsync = promisify(execFile);
const corpusRoot = process.env.CIVICSUITE_ORG_READALL;

if (!corpusRoot) {
  console.error("CIVICSUITE_ORG_READALL must name the local read-only CivicSuite clone directory.");
  process.exit(1);
}

function loadExpectations() {
  const override = process.env.DEVHARMONICS_VALIDATOR_CORPUS_TEST_EXPECTATIONS;
  if (override === undefined) return validatorDiscoveryCorpusManifest;
  if (process.env.DEVHARMONICS_VALIDATOR_CORPUS_TEST_SEAM !== "1") {
    throw new Error("Validator corpus expectation overrides require DEVHARMONICS_VALIDATOR_CORPUS_TEST_SEAM=1");
  }
  const parsed = JSON.parse(override);
  if (
    !Array.isArray(parsed)
    || parsed.length === 0
    || parsed.some((entry) => (
      !Array.isArray(entry)
      || entry.length !== 4
      || typeof entry[0] !== "string"
      || !/^[0-9a-f]{40}$/.test(entry[1])
      || !Array.isArray(entry[2])
      || entry[2].some((name) => typeof name !== "string")
      || !Array.isArray(entry[3])
      || entry[3].some((kind) => typeof kind !== "string")
    ))
  ) {
    throw new Error("Validator corpus expectations must be non-empty [name, 40-character OID, validator names[], signal kinds[]] tuples");
  }
  return parsed;
}

const expectations = loadExpectations();
const resolvedCorpusRoot = path.resolve(corpusRoot);
const failures = [];
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "devharmonics-validator-corpus-"));

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

try {
  const entries = await readdir(resolvedCorpusRoot, { withFileTypes: true });
  const repositories = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(resolvedCorpusRoot, entry.name);
    try {
      if (await git(candidate, ["rev-parse", "--is-inside-work-tree"]) === "true") repositories.push(entry.name);
    } catch {
      // Ordinary non-Git helper directories are outside the closed corpus.
    }
  }
  const expectedNames = expectations.map(([name]) => name).sort();
  repositories.sort();
  const missing = expectedNames.filter((name) => !repositories.includes(name));
  const unexpected = repositories.filter((name) => !expectedNames.includes(name));
  if (missing.length) failures.push(`missing top-level Git repositories: ${missing.join(", ")}`);
  if (unexpected.length) failures.push(`unexpected top-level Git repositories: ${unexpected.join(", ")}`);

  for (const [name, oid, expectedValidators, expectedSignals] of expectations) {
    const repositoryPath = path.join(resolvedCorpusRoot, name);
    try {
      if (!(await stat(repositoryPath)).isDirectory()) throw new Error("path is not a directory");
      const before = await git(repositoryPath, ["status", "--porcelain=v1", "--untracked-files=all"]);
      if (before) throw new Error(`worktree is dirty before verification: ${JSON.stringify(before)}`);
      const head = await git(repositoryPath, ["rev-parse", "HEAD"]);
      if (head !== oid) throw new Error(`expected checkout HEAD ${oid}, but found ${head}`);
      await git(repositoryPath, ["cat-file", "-e", `${oid}^{commit}`]);

      const archive = path.join(temporaryRoot, `${name}.tar`);
      const extracted = path.join(temporaryRoot, name);
      await mkdir(extracted);
      await execFileAsync("git", ["archive", "--format=tar", "-o", archive, oid], {
        cwd: repositoryPath,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
        timeout: 30_000,
        windowsHide: true,
      });
      await execFileAsync("tar", ["-xf", archive, "-C", extracted], {
        timeout: 30_000,
        windowsHide: true,
      });

      const result = await discoverRepositoryValidators(extracted);
      const names = result.validators.map((entry) => entry.name);
      const signals = [...new Set(result.signals.map((signal) => signal.kind))].sort();
      if (JSON.stringify(names) !== JSON.stringify(expectedValidators)) {
        throw new Error(`expected validators ${JSON.stringify(expectedValidators)}, received ${JSON.stringify(names)}`);
      }
      if (JSON.stringify(signals) !== JSON.stringify(expectedSignals)) {
        throw new Error(`expected signals ${JSON.stringify(expectedSignals)}, received ${JSON.stringify(signals)}`);
      }
      if (JSON.stringify(result).includes("diff-check")) throw new Error("automatic diff-check placeholder reappeared");
      for (const entry of result.validators) {
        if (!entry.sources.length) throw new Error(`${entry.name} has no detection source`);
        if (entry.config.command.includes(";") || entry.config.args.some((argument) => /[;$`]|\$\(/.test(argument))) {
          throw new Error(`${entry.name} contains repository-derived shell syntax`);
        }
      }

      const after = await git(repositoryPath, ["status", "--porcelain=v1", "--untracked-files=all"]);
      if (after) throw new Error(`worktree changed during verification: ${JSON.stringify(after)}`);
      console.log(`${name} ${oid} validators=${names.join(",") || "ZERO"} signals=${signals.join(",") || "none"}`);
    } catch (error) {
      failures.push(`${name} ${oid}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
} catch (error) {
  failures.push(`validator corpus census failed: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`Validator-discovery corpus failed (${failures.length}/${expectations.length}):\n${failures.join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(`Validator-discovery corpus passed: ${expectations.length}/${expectations.length} exact immutable archives; clean clones; no clone writes, network, or validator execution.`);
}
