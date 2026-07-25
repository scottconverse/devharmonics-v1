import { readdir, realpath, stat } from "node:fs/promises";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertCiChildResult, seededShuffle } from "../dist/src/ci-harness.js";
import { runProcess } from "../dist/src/process.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaults = {
  testDirectory: path.join(root, "dist", "test"),
  timeoutMs: 5 * 60 * 1_000,
  maxOutputBytes: 1024 * 1024,
};

async function parseArguments(argv) {
  let seed;
  let testDirectory;
  let timeoutMs;
  let maxOutputBytes;
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const [option, inlineValue] = argument.includes("=") ? argument.split(/=(.*)/s, 2) : [argument, undefined];
    if (!["--seed", "--test-directory", "--timeout-ms", "--max-output-bytes"].includes(option)) {
      throw new Error(`Unknown randomized-runner option: ${option}`);
    }
    if (seen.has(option)) throw new Error(`Randomized-runner option must be provided at most once: ${option}`);
    seen.add(option);
    const value = inlineValue ?? argv[++index];
    if (value === undefined || value.startsWith("--")) throw new Error(`${option} requires one value`);
    if (option === "--seed") seed = value;
    else if (option === "--test-directory") testDirectory = value;
    else if (option === "--timeout-ms") timeoutMs = Number(value);
    else maxOutputBytes = Number(value);
  }

  const seamRequested = testDirectory !== undefined || timeoutMs !== undefined || maxOutputBytes !== undefined;
  if (seamRequested) {
    if (process.env.DEVHARMONICS_RANDOMIZED_RUNNER_TEST_SEAM !== "1") {
      throw new Error("Randomized-runner test overrides require DEVHARMONICS_RANDOMIZED_RUNNER_TEST_SEAM=1");
    }
    if (testDirectory === undefined || timeoutMs === undefined || maxOutputBytes === undefined) {
      throw new Error("Randomized-runner test overrides must provide directory, timeout, and output bound together");
    }
    if (!path.isAbsolute(testDirectory)) throw new Error("Randomized-runner test directory must be absolute");
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 5_000) {
      throw new Error("Randomized-runner test timeout must be an integer in 50..5000");
    }
    if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 256 || maxOutputBytes > 65_536) {
      throw new Error("Randomized-runner test output bound must be an integer in 256..65536");
    }
    const [canonicalDirectory, canonicalTemp] = await Promise.all([realpath(testDirectory), realpath(os.tmpdir())]);
    const relativeToTemp = path.relative(canonicalTemp, canonicalDirectory);
    if (!relativeToTemp || relativeToTemp.startsWith("..") || path.isAbsolute(relativeToTemp)) {
      throw new Error("Randomized-runner test directory must be a descendant of the canonical temporary directory");
    }
    testDirectory = canonicalDirectory;
  }

  return {
    seed: seed ?? crypto.randomUUID(),
    testDirectory: testDirectory ?? defaults.testDirectory,
    timeoutMs: timeoutMs ?? defaults.timeoutMs,
    maxOutputBytes: maxOutputBytes ?? defaults.maxOutputBytes,
  };
}

const { seed, testDirectory, timeoutMs, maxOutputBytes } = await parseArguments(process.argv.slice(2));
if (!seed.trim()) throw new Error("The randomized test seed must not be empty");

const files = [];
for (const name of (await readdir(testDirectory)).filter((candidate) => candidate.endsWith(".test.js")).sort()) {
  const filename = path.join(testDirectory, name);
  if (!(await stat(filename)).isFile()) throw new Error(`Compiled test entry is not a regular file: ${filename}`);
  files.push(filename);
}
const ordered = seededShuffle(
  files
  .sort()
  .map((name) => path.resolve(name)),
  seed,
);

if (files.length === 0) throw new Error(`No compiled test files found in ${testDirectory}`);
if (new Set(files).size !== files.length) throw new Error("Compiled test-file census contains duplicates");

console.log(`Randomized test-file seed: ${seed}`);
console.log("Randomized test-file order:");
ordered.forEach((file, index) => console.log(`${index + 1}. ${path.relative(root, file)}`));

for (const file of ordered) {
  const relativeFile = path.relative(root, file);
  const result = await runProcess({
    command: process.execPath,
    args: ["--test", file],
    cwd: root,
    timeoutMs,
    maxOutputBytes,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.stdoutTruncated || result.stderrTruncated) {
    console.error(
      `Randomized test output truncated: file=${relativeFile} stdoutTruncated=${result.stdoutTruncated ?? false} stderrTruncated=${result.stderrTruncated ?? false} maxOutputBytes=${maxOutputBytes}`,
    );
  }
  assertCiChildResult(result, { operation: "randomized test file", file: relativeFile, seed, timeoutMs }, { exit: "zero" });
}

console.log(`Randomized test-file run passed: ${ordered.length}/${files.length} files executed exactly once.`);
