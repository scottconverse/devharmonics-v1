import { readdir } from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertCiChildResult, seededShuffle } from "../dist/src/ci-harness.js";
import { runProcess } from "../dist/src/process.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testDirectory = path.join(root, "dist", "test");
const timeoutMs = 5 * 60 * 1_000;
const seedIndex = process.argv.findIndex((argument) => argument === "--seed");
const inlineSeed = process.argv.find((argument) => argument.startsWith("--seed="))?.slice("--seed=".length);
const seed = inlineSeed ?? (seedIndex >= 0 ? process.argv[seedIndex + 1] : undefined) ?? crypto.randomUUID();

if (!seed.trim()) throw new Error("The randomized test seed must not be empty");

const files = (await readdir(testDirectory))
  .filter((name) => name.endsWith(".test.js"))
  .sort()
  .map((name) => path.join(testDirectory, name));

if (files.length === 0) throw new Error(`No compiled test files found in ${testDirectory}`);
if (new Set(files).size !== files.length) throw new Error("Compiled test-file census contains duplicates");

const ordered = seededShuffle(files, seed);
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
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  assertCiChildResult(result, { operation: "randomized test file", file: relativeFile, seed, timeoutMs }, { exit: "zero" });
}

console.log(`Randomized test-file run passed: ${ordered.length}/${files.length} files executed exactly once.`);
