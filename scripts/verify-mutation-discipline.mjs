import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertCiChildResult, replaceExactlyOnce } from "../dist/src/ci-harness.js";
import { runProcess } from "../dist/src/process.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const compiledGuard = path.join(root, "dist", "src", "verification-integrity.js");
const sentinelTest = path.join(root, "dist", "test", "ci-harness.test.js");
const target = 'kind: "test-skipped"';
const mutant = 'kind: "test-skipped-mutant"';
const sentinelName = "mutation sentinel binds the skipped-test detector to its public finding kind";
const sentinelMessage = "MUTATION_SENTINEL: a skipped test must produce the public test-skipped finding";
const timeoutMs = 60_000;
const maxOutputBytes = 256 * 1024;
const original = await readFile(compiledGuard, "utf8");
const mutated = replaceExactlyOnce(original, target, mutant);

function runSentinel() {
  return runProcess({
    command: process.execPath,
    args: [`--test-name-pattern=${sentinelName}`, "--test", sentinelTest],
    cwd: root,
    timeoutMs,
    maxOutputBytes,
  });
}

let red;
try {
  await writeFile(compiledGuard, mutated, "utf8");
  const applied = await readFile(compiledGuard, "utf8");
  if (applied !== mutated || applied === original) throw new Error("Mutation was not applied exactly as prepared");
  console.log("Mutation applied exactly once to the compiled verification-integrity guard.");
  red = await runSentinel();
} finally {
  await writeFile(compiledGuard, original, "utf8");
}

const redOutput = `${red.stdout}${red.stderr}`;
console.log("Expected RED output:");
console.log(redOutput.trim());
assertCiChildResult(
  red,
  { operation: "mutation sentinel", sentinelName, phase: "expected RED", timeoutMs },
  { exit: "nonzero", outputIncludes: sentinelMessage },
);

const green = await runSentinel();
const greenOutput = `${green.stdout}${green.stderr}`;
console.log("Restored GREEN output:");
console.log(greenOutput.trim());
assertCiChildResult(
  green,
  { operation: "mutation sentinel", sentinelName, phase: "restored GREEN", timeoutMs },
  { exit: "zero" },
);

console.log("Mutation discipline passed: asserted mutation → RED, restored guard → GREEN.");
