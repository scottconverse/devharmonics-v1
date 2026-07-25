import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  REVIEWED_ACTION_SHAS,
  assertCiChildResult,
  countDeclaredNodeTests,
  replaceExactlyOnce,
  seededShuffle,
  validateReadmeReleaseScope,
  validateRollbackGuide,
  validateSupportingDocumentReleaseScope,
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

test("workflow policy catches canonical step and job-level remote uses forms", () => {
  const workflowBodies = [
    "    runs-on: ubuntu-latest\n    timeout-minutes: 5\n    steps:\n      - uses: third-party/action@v1",
    "    runs-on: ubuntu-latest\n    timeout-minutes: 5\n    steps:\n      - uses : third-party/action@v1",
    '    runs-on: ubuntu-latest\n    timeout-minutes: 5\n    steps:\n      - "uses": third-party/action@v1',
    "    runs-on: ubuntu-latest\n    timeout-minutes: 5\n    steps:\n      - 'uses': third-party/action@v1",
    "    uses: third-party/reusable/.github/workflows/ci.yml@main",
    '    "uses": third-party/reusable/.github/workflows/ci.yml@main',
  ];
  for (const body of workflowBodies) {
    const workflow = `name: fixture
on: push
permissions:
  contents: read
jobs:
  fixture:
${body}
`;
    assert.match(validateWorkflowPolicy(workflow).join("\n"), /immutable 40-hex SHA/i, body);
  }

  const caseVariantReviewedAction = `name: fixture
on: push
permissions:
  contents: read
jobs:
  fixture:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: Actions/Checkout@${"a".repeat(40)} # v6
        with:
          persist-credentials: false
`;
  assert.match(validateWorkflowPolicy(caseVariantReviewedAction).join("\n"), /must use reviewed SHA/i);
});

test("reviewed actions cannot bypass reviewed SHA or checkout safeguards through subpaths", () => {
  const cases = [
    { action: "actions/checkout/.", checkout: true },
    { action: "Actions/Checkout//", checkout: true },
    { action: "actions/checkout/../checkout", checkout: true },
    { action: "actions/setup-node/.", checkout: false },
  ];
  for (const { action, checkout } of cases) {
    const workflow = `name: fixture
on: push
permissions:
  contents: read
jobs:
  fixture:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: ${action}@${"a".repeat(40)} # v6
`;
    const failures = validateWorkflowPolicy(workflow).join("\n");
    assert.match(failures, /reviewed action.*subpath/i, action);
    assert.match(failures, /must use reviewed SHA/i, action);
    if (checkout) assert.match(failures, /checkout must set persist-credentials: false/i, action);
  }
});

test("unrelated actions retain their valid repository subpaths", () => {
  const workflow = `name: fixture
on: push
permissions:
  contents: read
jobs:
  fixture:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: third-party/action/subdirectory@${"a".repeat(40)}
`;
  assert.deepEqual(validateWorkflowPolicy(workflow), []);
});

test("workflow policy fails closed on ambiguous uses syntax and malformed job topology", () => {
  const ambiguous = `name: fixture
on: push
permissions:
  contents: read
jobs:
  fixture:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - { uses: third-party/action@v1 }
`;
  const malformed = `name: fixture
on: push
permissions:
  contents: read
jobs:
  "fixture":
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - run: echo ok
  dangling:
`;
  const multilineKey = `name: fixture
on: push
permissions:
  contents: read
jobs:
  fixture:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - ? uses
        : third-party/action@v1
`;
  const flowStyleJob = `name: fixture
on: push
permissions:
  contents: read
jobs:
  safe:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - run: echo safe
  bypass: { runs-on: ubuntu-latest, permissions: write-all, steps: [{ run: sleep-forever }] }
`;
  const escapedUses = `name: fixture
on: push
permissions:
  contents: read
jobs:
  fixture:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - "us\\u0065s": third-party/action@v1
`;
  const explicitPermissions = `name: fixture
on: push
permissions:
  contents: read
jobs:
  fixture:
    ? permissions
    : write-all
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - run: echo ok
`;
  const duplicateKey = `name: fixture
on: push
permissions:
  contents: read
jobs:
  fixture:
    runs-on: ubuntu-latest
    runs-on: windows-latest
    timeout-minutes: 5
    steps:
      - run: echo ok
`;
  assert.notDeepEqual(validateWorkflowPolicy(ambiguous), []);
  assert.notDeepEqual(validateWorkflowPolicy(malformed), []);
  assert.notDeepEqual(validateWorkflowPolicy(multilineKey), []);
  assert.match(
    validateWorkflowPolicy(flowStyleJob).join("\n"),
    /bypass.*(?:timeout-minutes|job-level permissions)/i,
  );
  assert.match(validateWorkflowPolicy(escapedUses).join("\n"), /immutable 40-hex SHA/i);
  assert.match(validateWorkflowPolicy(explicitPermissions).join("\n"), /permissions.*contents: read/i);
  assert.match(validateWorkflowPolicy(duplicateKey).join("\n"), /duplicate|unique key/i);
});

test("workflow policy fails closed on YAML parser warnings", () => {
  const workflow = `name: fixture
on: push
permissions:
  contents: read
jobs:
  fixture:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - run: !unsupported echo ok
`;
  assert.match(validateWorkflowPolicy(workflow).join("\n"), /warning.*unresolved tag/i);
});

test("workflow policy allows local actions and pinned remote actions in canonical step forms", () => {
  const sha = "a".repeat(40);
  const workflow = `name: fixture
on: push
permissions:
  contents: read
jobs:
  "fixture":
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: ./local-action
      - "uses": "third-party/action@${sha}"
      - uses: actions/checkout@${REVIEWED_ACTION_SHAS["actions/checkout"]} # v6
        with:
          persist-credentials: false
`;
  assert.deepEqual(validateWorkflowPolicy(workflow), []);

  const anchoredCheckout = `name: fixture
on: push
permissions:
  contents: read
jobs:
  fixture:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - &checkout
        uses: actions/checkout@${REVIEWED_ACTION_SHAS["actions/checkout"]} # v6
        with:
          persist-credentials: false
      - *checkout
`;
  assert.deepEqual(validateWorkflowPolicy(anchoredCheckout), []);
});

test("each reviewed uses scalar must carry its own readable version comment", () => {
  const sha = REVIEWED_ACTION_SHAS["actions/checkout"];
  const workflow = `name: fixture
on: push
permissions:
  contents: read
jobs:
  fixture:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@${sha}
        with:
          persist-credentials: false
      - run: echo actions/checkout@${sha} # v6
`;
  assert.match(validateWorkflowPolicy(workflow).join("\n"), /checkout must retain the readable # v6 comment/i);
});

test("workflow policy rejects duplicate or widened top-level permissions", () => {
  const workflow = `name: fixture
on: push
permissions:
  contents: read
"permissions": write-all
jobs:
  fixture:
    runs-on: ubuntu-latest
    "timeout-minutes" : 5
    steps:
      - run: echo ok
`;
  assert.match(validateWorkflowPolicy(workflow).join("\n"), /permissions must remain contents: read/i);
});

test("workflow policy rejects job-level permission widening", () => {
  const workflow = `name: fixture
on: push
permissions:
  contents: read
jobs:
  fixture:
    permissions: write-all
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - run: echo ok
`;
  assert.match(validateWorkflowPolicy(workflow).join("\n"), /fixture.*permissions must remain contents: read/i);

  const mergedPermissions = `name: fixture
on: push
permissions:
  contents: read
unsafe-job-policy: &unsafe-job-policy
  permissions: write-all
jobs:
  fixture:
    <<: *unsafe-job-policy
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - run: echo ok
`;
  assert.match(validateWorkflowPolicy(mergedPermissions).join("\n"), /fixture.*permissions must remain contents: read/i);
});

test("checkout credentials cannot be satisfied by a later unnamed step", () => {
  const workflow = `name: fixture
on: push
permissions:
  contents: read
jobs:
  fixture:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@${REVIEWED_ACTION_SHAS["actions/checkout"]} # v6
      - uses: third-party/action@${"a".repeat(40)}
        with:
          persist-credentials: false
`;
  assert.match(validateWorkflowPolicy(workflow).join("\n"), /checkout must set persist-credentials: false/i);
});

test("checkout credentials require an active false setting under with", () => {
  const misleadingStepBodies = [
    "        # persist-credentials: false",
    "        env:\n          NOTE: persist-credentials: false",
  ];
  for (const body of misleadingStepBodies) {
    const workflow = `name: fixture
on: push
permissions:
  contents: read
jobs:
  fixture:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@${REVIEWED_ACTION_SHAS["actions/checkout"]} # v6
${body}
`;
    assert.match(
      validateWorkflowPolicy(workflow).join("\n"),
      /checkout must set persist-credentials: false/i,
      body,
    );
  }

  const caseVariantCheckout = `name: fixture
on: push
permissions:
  contents: read
jobs:
  fixture:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: Actions/Checkout@${REVIEWED_ACTION_SHAS["actions/checkout"]} # v6
`;
  assert.match(
    validateWorkflowPolicy(caseVariantCheckout).join("\n"),
    /checkout must set persist-credentials: false/i,
  );
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
    if (!/\bmaxOutputBytes\b/.test(source)) violations.push(`${name} runner has no bounded output capture`);
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

test("actual randomized runner times out a noisy hanging test and terminates its descendant", async () => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "devharmonics-randomized-runner-"));
  const fixtureTestDirectory = path.join(fixtureRoot, "tests");
  const pidfile = path.join(fixtureRoot, "descendant.pid");
  let descendantPid = 0;
  try {
    await mkdir(fixtureTestDirectory, { recursive: true });
    await writeFile(
      path.join(fixtureTestDirectory, "noisy-hang.test.js"),
      `import test from "node:test";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
test("noisy hang", async () => {
  const descendant = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 60000)"], { stdio: "ignore" });
  writeFileSync(process.env.RUNNER_PID_FILE, String(descendant.pid));
  process.stdout.write("NOISY_PREFIX:" + "x".repeat(20000) + ":NOISY_TAIL");
  await new Promise(() => {});
});
`,
    );

    const { NODE_TEST_CONTEXT: _nodeTestContext, ...runnerEnvironment } = process.env;
    const result = spawnSync(
      process.execPath,
      [
        "scripts/run-tests-randomized.mjs",
        "--seed",
        "black-box-seed",
        "--test-directory",
        fixtureTestDirectory,
        "--timeout-ms",
        "300",
        "--max-output-bytes",
        "1024",
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 10_000,
        env: {
          ...runnerEnvironment,
          DEVHARMONICS_RANDOMIZED_RUNNER_TEST_SEAM: "1",
          RUNNER_PID_FILE: pidfile,
        },
      },
    );

    const output = `${result.stdout}\n${result.stderr}`;
    assert.notEqual(result.status, 0, output);
    assert.equal(result.signal, null, output);
    assert.match(output, /file=.*noisy-hang\.test\.js/i);
    assert.match(output, /seed=black-box-seed/i);
    assert.match(output, /timeoutMs=300/i);
    assert.match(output, /timedOut=true/i);
    assert.doesNotMatch(output, /NOISY_PREFIX/, "discarded output must not be live-forwarded before the bounded tail");
    assert.match(output, /NOISY_TAIL/, "the bounded diagnostic tail should preserve the most recent output");
    assert.ok(Buffer.byteLength(output) < 10_000, `expected bounded runner output, received ${Buffer.byteLength(output)} bytes`);
    descendantPid = Number((await readFile(pidfile, "utf8")).trim());
    assert.ok(Number.isSafeInteger(descendantPid) && descendantPid > 0);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.throws(() => process.kill(descendantPid, 0), /ESRCH|not found|no such process/i);
  } finally {
    if (descendantPid > 0) {
      try {
        if (process.platform === "win32") {
          spawnSync("taskkill", ["/pid", String(descendantPid), "/T", "/F"], { stdio: "ignore" });
        } else {
          process.kill(descendantPid, "SIGKILL");
        }
      } catch {
        // already gone
      }
    }
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("randomized-runner test overrides fail closed without the explicit seam environment", () => {
  const result = spawnSync(
    process.execPath,
    [
      "scripts/run-tests-randomized.mjs",
      "--test-directory",
      os.tmpdir(),
      "--timeout-ms",
      "300",
      "--max-output-bytes",
      "1024",
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: Object.fromEntries(
        Object.entries(process.env).filter(([name]) => name !== "DEVHARMONICS_RANDOMIZED_RUNNER_TEST_SEAM"),
      ),
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /test overrides require DEVHARMONICS_RANDOMIZED_RUNNER_TEST_SEAM=1/i);
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

test("declared test census ignores node:test names shadowed by loop bindings", () => {
  const source = `
    import test from "node:test";
    test("canonical", () => {});
    for (const test of [() => {}]) {
      test("foreign loop callback", () => {});
    }
    for (let test = () => {}; false; ) {
      test("foreign for callback", () => {});
    }
  `;
  assert.equal(countDeclaredNodeTests(source, "loop-shadow.test.ts"), 1);
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
  const packageJsonText = await readFile("package.json", "utf8");
  const packageJson = JSON.parse(packageJsonText) as { scripts: { build: string } };
  assert.match(packageJson.scripts.build, /^node scripts\/clean-dist\.mjs && /);
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "devharmonics-clean-dist-"));
  try {
    await mkdir(path.join(fixtureRoot, "scripts"), { recursive: true });
    await mkdir(path.join(fixtureRoot, "dist"), { recursive: true });
    await copyFile("scripts/clean-dist.mjs", path.join(fixtureRoot, "scripts", "clean-dist.mjs"));
    await writeFile(path.join(fixtureRoot, "dist", "stale.js"), "stale");
    await writeFile(path.join(fixtureRoot, "keep.txt"), "keep");

    const result = spawnSync(process.execPath, [path.join(fixtureRoot, "scripts", "clean-dist.mjs")], {
      cwd: fixtureRoot,
      encoding: "utf8",
    });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    await assert.rejects(readFile(path.join(fixtureRoot, "dist", "stale.js")), /ENOENT/);
    assert.equal(await readFile(path.join(fixtureRoot, "keep.txt"), "utf8"), "keep");
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("README distinguishes the latest tag from unreleased main and qualifies continuous platform verification", async () => {
  const [readme, packageJsonText] = await Promise.all([
    readFile("README.md", "utf8"),
    readFile("package.json", "utf8"),
  ]);
  const version = (JSON.parse(packageJsonText) as { version: string }).version;
  assert.deepEqual(validateReadmeReleaseScope(readme, version), []);
});

test("release-scope validation is mode-aware across README and supporting documents", () => {
  const validateByMode = validateReadmeReleaseScope as unknown as (
    readme: string,
    version: string,
    mode: "development" | "release",
  ) => string[];
  const common = `Latest tagged release: **v1.2.3**
git checkout v1.2.3
continuously verified on Windows and Ubuntu; macOS verification is currently manual`;
  const development = `${common}
## Project status
This section describes \`main\`.
This branch: **unreleased main after v1.2.3**`;
  const release = `${common}
## Project status
This section describes tagged release v1.2.3.
This checkout: **tagged release v1.2.3**`;

  assert.deepEqual(validateByMode(development, "1.2.3", "development"), []);
  assert.deepEqual(validateByMode(release, "1.2.3", "release"), []);
  assert.match(validateByMode(development, "1.2.3", "release").join("\n"), /must not claim.*unreleased main/i);
  assert.match(validateByMode(release, "1.2.3", "development").join("\n"), /unreleased main after/i);

  for (const label of ["Manual target", "Architecture snapshot"] as const) {
    const supportingDevelopment = `${label}: **unreleased \`main\` after v1.2.3**`;
    const supportingRelease = `${label}: **tagged release v1.2.3**`;

    assert.deepEqual(validateSupportingDocumentReleaseScope(supportingDevelopment, "1.2.3", label, "development"), []);
    assert.deepEqual(validateSupportingDocumentReleaseScope(supportingRelease, "1.2.3", label, "release"), []);
    assert.match(
      validateSupportingDocumentReleaseScope(supportingDevelopment, "1.2.3", label, "release").join("\n"),
      /tagged release/i,
    );
    assert.match(
      validateSupportingDocumentReleaseScope(supportingRelease, "1.2.3", label, "development").join("\n"),
      /unreleased main/i,
    );
  }
});

test("rollback guide uses count-independent staged exact-path restore instructions with pre-restore verification", async () => {
  const rollback = await readFile("docs/ROLLBACK.md", "utf8");
  assert.deepEqual(validateRollbackGuide(rollback), []);
});
