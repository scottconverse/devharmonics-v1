import { execFile } from "node:child_process";
import { lstat, mkdir, mkdtemp, realpath, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { validatorDiscoveryCorpusManifest } from "./validator-discovery-corpus-manifest.mjs";

const execFileAsync = promisify(execFile);
const PUBLIC_REPOSITORY_PREFIX = "https://github.com/CivicSuite/";
const TEST_SEAM = process.env.DEVHARMONICS_VALIDATOR_CORPUS_PROVISION_TEST_SEAM === "1";
const TARGET = process.argv[2];
const SAFE_NAME = /^[a-z0-9](?:[a-z0-9-]{0,62})$/;
const OID = /^[0-9a-f]{40}$/;
const GIT_TIMEOUT_MS = 180_000;
const POOL_SIZE = 4;

function loadManifest() {
  const override = process.env.DEVHARMONICS_VALIDATOR_CORPUS_TEST_MANIFEST;
  if (override === undefined) return validatorDiscoveryCorpusManifest;
  if (!TEST_SEAM) throw new Error("Provisioning manifest overrides require DEVHARMONICS_VALIDATOR_CORPUS_PROVISION_TEST_SEAM=1");
  return JSON.parse(override);
}

function validateManifest(manifest) {
  if (!Array.isArray(manifest) || manifest.length === 0) throw new Error("Corpus manifest must be a non-empty tuple array");
  const names = new Set();
  for (const entry of manifest) {
    if (!Array.isArray(entry) || entry.length !== 4) throw new Error("Corpus manifest entries must be four-item tuples");
    const [name, oid, validators, signals] = entry;
    if (typeof name !== "string" || !SAFE_NAME.test(name)) throw new Error(`Unsafe repository name in corpus manifest: ${JSON.stringify(name)}`);
    if (names.has(name)) throw new Error(`Duplicate repository name in corpus manifest: ${name}`);
    names.add(name);
    if (typeof oid !== "string" || !OID.test(oid)) throw new Error(`Invalid 40-hex commit OID for ${name}`);
    if (!Array.isArray(validators) || !Array.isArray(signals)) throw new Error(`Invalid expectation arrays for ${name}`);
  }
  return manifest;
}

function safeGitEnvironment(stagingHome) {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: path.join(stagingHome, "disabled-global.gitconfig"),
    GIT_LFS_SKIP_SMUDGE: "1",
    XDG_CONFIG_HOME: stagingHome,
  };
}

async function git(cwd, args, stagingHome) {
  const common = [
    "-c", "credential.helper=",
    "-c", "core.askPass=",
    "-c", "filter.lfs.smudge=",
    "-c", "filter.lfs.process=",
    "-c", "filter.lfs.required=false",
  ];
  const { stdout } = await execFileAsync("git", [...common, ...args], {
    cwd,
    encoding: "utf8",
    env: safeGitEnvironment(stagingHome),
    timeout: GIT_TIMEOUT_MS,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout.trim();
}

function repositoryUrl(name) {
  const testRoot = process.env.DEVHARMONICS_VALIDATOR_CORPUS_TEST_REMOTE_ROOT;
  if (testRoot !== undefined) {
    if (!TEST_SEAM) throw new Error("Provisioning remote overrides require DEVHARMONICS_VALIDATOR_CORPUS_PROVISION_TEST_SEAM=1");
    return path.join(path.resolve(testRoot), `${name}.git`);
  }
  return `${PUBLIC_REPOSITORY_PREFIX}${name}.git`;
}

async function provisionRepository(stagingRoot, stagingHome, [name, oid]) {
  const destination = path.join(stagingRoot, name);
  await mkdir(destination);
  await git(destination, ["init", "--initial-branch=main"], stagingHome);
  await git(destination, ["fetch", "--depth=1", "--no-tags", repositoryUrl(name), oid], stagingHome);
  await git(destination, ["checkout", "--detach", oid], stagingHome);
  const head = await git(destination, ["rev-parse", "HEAD"], stagingHome);
  if (head !== oid) throw new Error(`${name}: expected HEAD ${oid}, found ${head}`);
  const dirty = await git(destination, ["status", "--porcelain=v1", "--untracked-files=all"], stagingHome);
  if (dirty) throw new Error(`${name}: checkout is dirty: ${JSON.stringify(dirty)}`);
  const remotes = await git(destination, ["remote"], stagingHome);
  if (remotes) throw new Error(`${name}: retained Git remotes: ${remotes}`);
  try {
    const promisor = await git(destination, ["config", "--local", "--get-regexp", "^(remote\\..*\\.promisor|extensions\\.partialClone)$"], stagingHome);
    if (promisor) throw new Error(`${name}: retained promisor configuration: ${promisor}`);
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === 1)) throw error;
  }
}

async function runPool(entries, worker) {
  let cursor = 0;
  let failure;
  const runners = Array.from({ length: Math.min(POOL_SIZE, entries.length) }, async () => {
    while (cursor < entries.length && failure === undefined) {
      const index = cursor;
      cursor += 1;
      try {
        await worker(entries[index]);
      } catch (error) {
        failure ??= error;
      }
    }
  });
  await Promise.all(runners);
  if (failure !== undefined) throw failure;
}

async function assertAbsent(target) {
  try {
    await lstat(target);
    throw new Error(`Target already exists: ${target}`);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
}

async function main() {
  if (!TARGET) throw new Error("Usage: node scripts/provision-validator-discovery-corpus.mjs <new-target-directory>");
  const target = path.resolve(TARGET);
  const parsed = path.parse(target);
  if (target === parsed.root) throw new Error("Refusing unsafe filesystem-root target");
  const manifest = validateManifest(loadManifest());
  await assertAbsent(target);

  const parent = path.dirname(target);
  await mkdir(parent, { recursive: true });
  const realParent = await realpath(parent);
  const stagingRoot = await mkdtemp(path.join(realParent, `.${path.basename(target)}.staging-`));
  const stagingHome = await mkdtemp(path.join(realParent, `.${path.basename(target)}.git-home-`));
  let stagingVerified = false;
  try {
    const expectedStagingPrefix = path.join(realParent, `.${path.basename(target)}.staging-`);
    if (!path.resolve(stagingRoot).startsWith(expectedStagingPrefix)) throw new Error("Unsafe staging directory resolution");
    stagingVerified = true;
    await runPool(manifest, (entry) => provisionRepository(stagingRoot, stagingHome, entry));
    await assertAbsent(target);
    await rename(stagingRoot, target);
    stagingVerified = false;
    console.log(`Provisioned validator-discovery corpus: ${manifest.length}/${manifest.length} exact detached checkouts at ${target}`);
  } finally {
    if (stagingVerified) await rm(stagingRoot, { recursive: true, force: true });
    await rm(stagingHome, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`Validator-discovery corpus provisioning failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
