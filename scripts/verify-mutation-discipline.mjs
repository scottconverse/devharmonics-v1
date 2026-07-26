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

async function proveAdditionalMutation({
  compiledPath,
  testPath,
  mutationTarget,
  mutationReplacement,
  sentinelName: additionalSentinelName,
  expectedRedOutputIncludes = [additionalSentinelName],
}) {
  const clean = await readFile(compiledPath, "utf8");
  const changed = replaceExactlyOnce(clean, mutationTarget, mutationReplacement);
  const run = () => runProcess({
    command: process.execPath,
    args: [`--test-name-pattern=${additionalSentinelName}`, "--test", testPath],
    cwd: root,
    timeoutMs,
    maxOutputBytes,
  });
  let expectedRed;
  try {
    await writeFile(compiledPath, changed, "utf8");
    expectedRed = await run();
  } finally {
    await writeFile(compiledPath, clean, "utf8");
  }
  console.log(`Expected RED output (${additionalSentinelName}):`);
  const expectedRedOutput = `${expectedRed.stdout}${expectedRed.stderr}`;
  console.log(expectedRedOutput.trim());
  for (const expectedText of expectedRedOutputIncludes) {
    if (!expectedRedOutput.includes(expectedText)) {
      throw new Error(`Mutation sentinel did not fail the expected test: ${expectedText}`);
    }
  }
  assertCiChildResult(
    expectedRed,
    { operation: "mutation sentinel", sentinelName: additionalSentinelName, phase: "expected RED", timeoutMs },
    { exit: "nonzero", outputIncludes: expectedRedOutputIncludes[0] },
  );
  const restoredGreen = await run();
  console.log(`Restored GREEN output (${additionalSentinelName}):`);
  console.log(`${restoredGreen.stdout}${restoredGreen.stderr}`.trim());
  assertCiChildResult(
    restoredGreen,
    { operation: "mutation sentinel", sentinelName: additionalSentinelName, phase: "restored GREEN", timeoutMs },
    { exit: "zero" },
  );
}

await proveAdditionalMutation({
  compiledPath: path.join(root, "dist", "src", "delivery.js"),
  testPath: path.join(root, "dist", "test", "core.test.js"),
  mutationTarget: 'if (authority.state === "invalid" || authority.state === "unavailable") {',
  mutationReplacement: 'if (false && (authority.state === "invalid" || authority.state === "unavailable")) {',
  sentinelName: "invalid release authority refuses tagging even with mismatch confirmation and records no tag side effects",
});

await proveAdditionalMutation({
  compiledPath: path.join(root, "dist", "src", "release-units.js"),
  testPath: path.join(root, "dist", "test", "core.test.js"),
  mutationTarget: "else if (result.stdoutUtf8Valid === false)",
  mutationReplacement: "else if (false && result.stdoutUtf8Valid === false)",
  sentinelName: "immutable package and pyproject blobs reject malformed UTF-8 before parsing",
});

await proveAdditionalMutation({
  compiledPath: path.join(root, "dist", "src", "validator-discovery.js"),
  testPath: path.join(root, "dist", "test", "validator-discovery.test.js"),
  mutationTarget: 'new TextDecoder("utf-8", { fatal: true }).decode(bytes)',
  mutationReplacement: 'new TextDecoder("utf-8").decode(bytes)',
  sentinelName: "malformed UTF-8 (package.json|pyproject.toml) reports malformed and yields no validator candidate",
  expectedRedOutputIncludes: [
    "malformed UTF-8 package.json reports malformed and yields no validator candidate",
    "malformed UTF-8 pyproject.toml reports malformed and yields no validator candidate",
  ],
});

await proveAdditionalMutation({
  compiledPath: path.join(root, "dist", "src", "validator-discovery.js"),
  testPath: path.join(root, "dist", "test", "validator-discovery.test.js"),
  mutationTarget: "const document = parseTomlRecord(source, text);",
  mutationReplacement: "const document = {};",
  sentinelName: "malformed TOML reports malformed and yields no pyproject validator candidate",
});

console.log("Additional release-authority, immutable-manifest UTF-8, validator-source UTF-8, and validator-malformed mutation sentinels passed.");
