import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { discoverRepositoryValidators } from "../dist/src/validator-discovery.js";

const execFileAsync = promisify(execFile);
const corpusRoot = process.env.CIVICSUITE_ORG_READALL;
const standard = ["pytest", "ruff", "verify-release"];
const defaultExpectations = [
  ["civic311", "b65d21c7d19aa1b3f458e56333481bb75f6ef584", standard, []],
  ["civicboards", "845e777f432ad512953ed49be994c366b87a6070", standard, []],
  ["civicbudget", "731a6b4802cfd8593a00180c37ca3d76a7236de0", standard, []],
  ["civicclerk", "dae807ec9d1370dd22cf6aba88e4c6fc6b4168d5", ["pytest", "verify-release"], []],
  ["civiccode", "05994fe716fa904682ec91b574a35e7cef066aa1", ["build", "pytest", "ruff", "typecheck", "verify-release"], []],
  ["civiccomms", "73be36fdcd3b7d429321fbe8d51cec07a466e16b", standard, []],
  ["civiccontracts", "23bcee99a09e1d58441775f2a03b7dcda870ed21", standard, []],
  ["civiccore", "aca61910a3dd58325d4cfc02da10df90fb6b9efa", standard, []],
  ["civiccourt", "666525cb1e646127a8150894deec1e97fa64912d", standard, []],
  ["civicdata", "5d8378d59bd4e5a7f68d0df48e794c5721d0c8eb", standard, []],
  ["civicelections", "c532f6ceaeba9ed6399e848ce067c50c3789cb74", standard, []],
  ["civicgrants", "5b01d8c6b9c2952591b28f2c5f09039382d4573a", standard, []],
  ["civichr", "7cd481b75f6d97eb3f28c68c78e12940f5879cdd", standard, []],
  ["civicinspect", "02f7912bfb492988d740f303f694d9b782a4a139", standard, []],
  ["civiclegal", "ac511514ed1d52a8e9c1433e757f8a97ddb53f64", standard, []],
  ["civiclibrary", "d7699189707f6dc9b75ad33c5a498d88cb572ab5", standard, []],
  ["civicparks", "7b9b5147c6a265184b713f5bb71f430a81810085", standard, []],
  ["civicpermit", "3d0998ae40930e71094f511471689846abc350f1", standard, []],
  ["civicplan", "252f23cc83638944fadd303955cda11e13bee674", standard, []],
  ["civicprocure", "5836032f396cb901769e9f2ff7a168e30aefb2f6", standard, []],
  ["civicrecords-ai", "538766523ad90ee7553b0ffa75b626d3d4850b17", ["verify-release"], ["compose_test_evidence"]],
  ["civicsafety", "38038f9cab7857b278250ff41946f4d1777715f1", standard, []],
  ["civicutility", "4342098cfc72d5cbd52326fa9fc5db8ec3fde346", standard, []],
  ["civiczone", "1d37826d909a601eea5a10f4ebce0b31a605f5d0", standard, []],
];

if (!corpusRoot) {
  console.error("CIVICSUITE_ORG_READALL must name the local read-only CivicSuite clone directory.");
  process.exit(1);
}

function loadExpectations() {
  const override = process.env.DEVHARMONICS_VALIDATOR_CORPUS_TEST_EXPECTATIONS;
  if (override === undefined) return defaultExpectations;
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
