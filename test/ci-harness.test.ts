import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assertCiChildResult,
  countDeclaredNodeTests,
  replaceExactlyOnce,
  seededShuffle,
  validateReadmeReleaseScope,
  validateRollbackGuide,
  validateWorkflowPolicy,
} from "../src/ci-harness.js";
import { analyzeVerificationIntegrity } from "../src/verification-integrity.js";

test("seededShuffle is reproducible and does not mutate its input", () => {
  const input = ["core", "integration", "product", "reconciliation", "repository", "status"];

  const first = seededShuffle(input, "run-123");
  const second = seededShuffle(input, "run-123");

  assert.deepEqual(first, second);
  assert.deepEqual(input, ["core", "integration", "product", "reconciliation", "repository", "status"]);
  assert.deepEqual([...first].sort(), [...input].sort());
});

test("seededShuffle can produce different orders for different seeds", () => {
  const input = ["a", "b", "c", "d", "e", "f"];
  const permutations = new Set(
    ["one", "two", "three", "four", "five"].map((seed) => JSON.stringify(seededShuffle(input, seed))),
  );

  assert.ok(permutations.size > 1, "different seeds should not all collapse to one order");
});

test("replaceExactlyOnce applies one asserted mutation", () => {
  assert.equal(replaceExactlyOnce("before guard after", "guard", "mutant"), "before mutant after");
});

test("replaceExactlyOnce refuses missing or ambiguous mutation targets", () => {
  assert.throws(() => replaceExactlyOnce("no target", "guard", "mutant"), /exactly once.*found 0/i);
  assert.throws(() => replaceExactlyOnce("guard and guard", "guard", "mutant"), /exactly once.*found 2/i);
});

test("mutation sentinel binds the skipped-test detector to its public finding kind", () => {
  const result = analyzeVerificationIntegrity([
    {
      path: "test/example.test.ts",
      diff: "@@ -1 +1 @@\n-test(\"works\", () => {});\n+test.skip(\"works\", () => {});",
    },
  ]);

  assert.ok(
    result.findings.some((finding) => finding.kind === "test-skipped"),
    "MUTATION_SENTINEL: a skipped test must produce the public test-skipped finding",
  );
});

test("declared test census counts syntax, not line shape or comment/string phantoms", () => {
  const source = `
    import test from "node:test";
    test("top-level", () => {});
    if (process.platform === "win32") {
      test.skip("indented platform case", () => {});
    }
    test.todo("declared todo");
    // test("line-comment phantom", () => {});
    /* test("block-comment phantom", () => {}); */
    const example = "test('string phantom', () => {})";
    contest("unrelated identifier", () => {});
  `;

  assert.equal(countDeclaredNodeTests(source, "fixture.test.ts"), 3);
});

test("the cross-platform suite uses the runner's canonical temporary directory", async () => {
  const workflow = await readFile(".github/workflows/ci.yml", "utf8");
  const fullSuite = workflow.slice(workflow.indexOf("  full-suite:"), workflow.indexOf("  randomized-order:"));

  assert.match(fullSuite, /TEMP:\s*\$\{\{\s*runner\.temp\s*\}\}/);
  assert.match(fullSuite, /TMP:\s*\$\{\{\s*runner\.temp\s*\}\}/);
});

test("every GitHub Actions job has an explicit bounded timeout", async () => {
  const workflow = await readFile(".github/workflows/ci.yml", "utf8");
  assert.deepEqual(validateWorkflowPolicy(workflow).filter((failure) => failure.includes("timeout-minutes")), []);
});

test("remote GitHub Actions uses references are immutable reviewed SHAs", async () => {
  const workflow = await readFile(".github/workflows/ci.yml", "utf8");
  assert.deepEqual(validateWorkflowPolicy(workflow), []);
});

test("randomized and mutation runners use bounded contextual child execution", async () => {
  const randomized = await readFile("scripts/run-tests-randomized.mjs", "utf8");
  const mutation = await readFile("scripts/verify-mutation-discipline.mjs", "utf8");
  const violations: string[] = [];

  for (const [name, source] of [
    ["randomized", randomized],
    ["mutation", mutation],
  ] as const) {
    if (/\bspawnSync\b/.test(source)) violations.push(`${name} runner still uses spawnSync`);
    if (!/\brunProcess\b/.test(source)) violations.push(`${name} runner does not use runProcess`);
    if (!/\btimeoutMs\b/.test(source)) violations.push(`${name} runner has no finite timeoutMs`);
  }
  if (!/\bfile\b/.test(randomized) || !/\bseed\b/.test(randomized)) {
    violations.push("randomized runner does not expose file and seed context");
  }
  if (
    !/\bsentinelName\b/.test(mutation) ||
    !/expected RED/i.test(mutation) ||
    !/restored GREEN/i.test(mutation)
  ) {
    violations.push("mutation runner does not expose sentinel and phase context");
  }

  assert.deepEqual(violations, [], violations.join("\n"));
});

test("declared test census follows node:test aliases and namespaces but ignores foreign and shadowed bindings", () => {
  const cases = {
    defaultAlias: countDeclaredNodeTests(
      `import check from "node:test"; check("direct", () => {}); check.skip("skipped", () => {});`,
      "default-alias.test.ts",
    ),
    namespace: countDeclaredNodeTests(
      `import * as nodeTest from "node:test"; nodeTest.test("direct", () => {}); nodeTest.test.todo("later");`,
      "namespace.test.ts",
    ),
    foreign: countDeclaredNodeTests(
      `import test from "foreign-test-library"; test("foreign", () => {}); test.skip("foreign skip", () => {});`,
      "foreign.test.ts",
    ),
    shadowed: countDeclaredNodeTests(
      `import test from "node:test"; test("canonical", () => {}); function register(test: Function) { test("shadowed", () => {}); }`,
      "shadowed.test.ts",
    ),
  };

  assert.deepEqual(cases, { defaultAlias: 2, namespace: 2, foreign: 0, shadowed: 1 });
});

test("declared test census fails closed on malformed source", () => {
  assert.throws(
    () => countDeclaredNodeTests(`import test from "node:test"; test("broken", () => {`, "malformed.test.ts"),
    /malformed\.test\.ts.*source is malformed/i,
  );
});

test("CI child timeout reports file, seed, timeout, and confirmed termination", () => {
  assert.throws(
    () =>
      assertCiChildResult(
        {
          stdout: "",
          stderr: "",
          exitCode: 124,
          durationMs: 301_250,
          timedOut: true,
          treeKillUnconfirmed: false,
        },
        {
          operation: "randomized test file",
          file: "dist/test/integration.test.js",
          seed: "repair-seed",
          timeoutMs: 300_000,
        },
        { exit: "zero" },
      ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /dist\/test\/integration\.test\.js/);
      assert.match(error.message, /repair-seed/);
      assert.match(error.message, /timeoutMs=300000/);
      assert.match(error.message, /termination confirmed/i);
      return true;
    },
  );
});

test("CI child timeout fails louder when process-tree termination is unconfirmed", () => {
  assert.throws(
    () =>
      assertCiChildResult(
        {
          stdout: "",
          stderr: "",
          exitCode: 124,
          durationMs: 61_000,
          timedOut: true,
          treeKillUnconfirmed: true,
        },
        { operation: "mutation sentinel", sentinelName: "guard sentinel", phase: "expected RED", timeoutMs: 60_000 },
        { exit: "nonzero", outputIncludes: "expected failure" },
      ),
    /process-tree termination is unconfirmed[\s\S]*sentinel=guard sentinel[\s\S]*phase=expected RED/i,
  );
});

test("CI child nonzero exit reports status and captured output without calling it a timeout", () => {
  assert.throws(
    () =>
      assertCiChildResult(
        {
          stdout: "distinct stdout",
          stderr: "distinct stderr",
          exitCode: 7,
          durationMs: 25,
          timedOut: false,
          treeKillUnconfirmed: false,
        },
        { operation: "randomized test file", file: "dist/test/core.test.js", seed: "repair-seed", timeoutMs: 300_000 },
        { exit: "zero" },
      ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.doesNotMatch(error.message, /exceeded its configured timeout/i);
      assert.match(error.message, /exitCode=7/);
      assert.match(error.message, /distinct stdoutdistinct stderr/);
      return true;
    },
  );
});

test("build starts by cleaning only the repository dist directory", async () => {
  const [packageJsonText, cleaner] = await Promise.all([
    readFile("package.json", "utf8"),
    readFile("scripts/clean-dist.mjs", "utf8"),
  ]);
  const packageJson = JSON.parse(packageJsonText) as { scripts: { build: string } };
  assert.match(packageJson.scripts.build, /^node scripts\/clean-dist\.mjs && /);
  assert.match(cleaner, /path\.resolve\(root,\s*"dist"\)/);
  assert.match(cleaner, /path\.dirname\(dist\)\s*!==\s*root/);
  assert.match(cleaner, /path\.basename\(dist\)\s*!==\s*"dist"/);
  assert.match(cleaner, /rm\(dist,\s*\{\s*recursive:\s*true,\s*force:\s*true\s*\}\)/);
});

test("README distinguishes the latest tag from unreleased main and qualifies continuous platform verification", async () => {
  const [readme, packageJsonText] = await Promise.all([
    readFile("README.md", "utf8"),
    readFile("package.json", "utf8"),
  ]);
  const version = (JSON.parse(packageJsonText) as { version: string }).version;
  assert.deepEqual(validateReadmeReleaseScope(readme, version), []);
});

test("rollback guide uses count-independent staged exact-path restore instructions with pre-restore verification", async () => {
  const rollback = await readFile("docs/ROLLBACK.md", "utf8");
  assert.deepEqual(validateRollbackGuide(rollback), []);
});
