import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
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

type ValidatorCorpusExpectation = string | [string, string | null, string[]];
type ValidatorCorpusRow = [string, string, ValidatorCorpusExpectation[], string[]];

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
        "1000",
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
    assert.match(output, /timeoutMs=1000/i);
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

test("version-authority corpus gate rejects a moved HEAD and an unexpected top-level Git repository", async () => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "devharmonics-version-corpus-gate-"));

  const git = (cwd: string, args: string[]): string => {
    const result = spawnSync("git", args, {
      cwd,
      encoding: "utf8",
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    return result.stdout.trim();
  };

  const createRepository = async (
    root: string,
    name: string,
    packageText: string | null = JSON.stringify({ name, version: "1.0.0" }),
  ): Promise<{ path: string; oid: string }> => {
    const repositoryPath = path.join(root, name);
    await mkdir(repositoryPath, { recursive: true });
    git(repositoryPath, ["init", "--initial-branch=main"]);
    git(repositoryPath, ["config", "user.email", "corpus-fixture@example.invalid"]);
    git(repositoryPath, ["config", "user.name", "Corpus Fixture"]);
    const fixturePath = packageText === null ? "README.md" : "package.json";
    await writeFile(path.join(repositoryPath, fixturePath), packageText ?? "# No release manifest\n", "utf8");
    git(repositoryPath, ["add", fixturePath]);
    git(repositoryPath, ["commit", "-m", "initial fixture"]);
    return { path: repositoryPath, oid: git(repositoryPath, ["rev-parse", "HEAD"]) };
  };

  const runGate = (
    root: string,
    expectations: Array<[string, string,
      | { state: "declared"; source: "package.json" | "pyproject.toml"; version: string }
      | { state: "absent" }
      | { state: "invalid"; source: "package.json" | "pyproject.toml"; detail: string }
      | { state: "unavailable"; source: "package.json" | "pyproject.toml" | "root manifests"; detail: string }
    ]>,
  ): ReturnType<typeof spawnSync> => {
    const { NODE_TEST_CONTEXT: _nodeTestContext, ...runnerEnvironment } = process.env;
    return spawnSync(process.execPath, ["scripts/verify-version-authority-corpus.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 30_000,
      env: {
        ...runnerEnvironment,
        CIVICSUITE_ORG_READALL: root,
        DEVHARMONICS_CORPUS_TEST_SEAM: "1",
        DEVHARMONICS_CORPUS_TEST_EXPECTATIONS: JSON.stringify(expectations),
      },
    });
  };

  try {
    const movedRoot = path.join(fixtureRoot, "moved");
    await mkdir(movedRoot, { recursive: true });
    const moved = await createRepository(movedRoot, "expected");
    await writeFile(path.join(moved.path, "README.md"), "new checkout head\n", "utf8");
    git(moved.path, ["add", "README.md"]);
    git(moved.path, ["commit", "-m", "move checkout head"]);

    const movedResult = runGate(movedRoot, [["expected", moved.oid, { state: "declared", source: "package.json", version: "1.0.0" }]]);
    const movedOutput = `${movedResult.stdout}\n${movedResult.stderr}`;
    assert.notEqual(movedResult.status, 0, movedOutput);
    assert.match(movedOutput, /expected checkout HEAD .* but found/i, "the stale pinned object must not hide a moved checkout HEAD");

    const unexpectedRoot = path.join(fixtureRoot, "unexpected");
    await mkdir(unexpectedRoot, { recursive: true });
    const expected = await createRepository(unexpectedRoot, "expected");
    await createRepository(unexpectedRoot, "new-repository");

    const unexpectedResult = runGate(unexpectedRoot, [["expected", expected.oid, { state: "declared", source: "package.json", version: "1.0.0" }]]);
    const unexpectedOutput = `${unexpectedResult.stdout}\n${unexpectedResult.stderr}`;
    assert.notEqual(unexpectedResult.status, 0, unexpectedOutput);
    assert.match(unexpectedOutput, /unexpected top-level Git repositories: new-repository/i, "a newly discovered repository must fail the closed-world corpus census");

    const statesRoot = path.join(fixtureRoot, "states");
    await mkdir(statesRoot, { recursive: true });
    const declared = await createRepository(statesRoot, "declared");
    const absent = await createRepository(statesRoot, "absent", null);
    const invalid = await createRepository(statesRoot, "invalid", "{ malformed");
    const stateResult = runGate(statesRoot, [
      ["declared", declared.oid, { state: "declared", source: "package.json", version: "1.0.0" }],
      ["absent", absent.oid, { state: "absent" }],
      ["invalid", invalid.oid, { state: "invalid", source: "package.json", detail: "JSON parser rejected the document" }],
    ]);
    assert.equal(stateResult.status, 0, `${stateResult.stdout}\n${stateResult.stderr}`);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("validator-discovery corpus gate is closed-world and rejects a dropped nested cwd", async () => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "devharmonics-validator-corpus-gate-"));
  const git = (cwd: string, args: string[]): string => {
    const result = spawnSync("git", args, {
      cwd,
      encoding: "utf8",
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    return result.stdout.trim();
  };
  const createRepository = async (root: string, name: string): Promise<{ path: string; oid: string }> => {
    const repositoryPath = path.join(root, name);
    await mkdir(path.join(repositoryPath, "backend"), { recursive: true });
    await mkdir(path.join(repositoryPath, "frontend"), { recursive: true });
    await mkdir(path.join(repositoryPath, "scripts"), { recursive: true });
    git(repositoryPath, ["init", "--initial-branch=main"]);
    git(repositoryPath, ["config", "user.email", "validator-corpus@example.invalid"]);
    git(repositoryPath, ["config", "user.name", "Validator Corpus Fixture"]);
    await writeFile(path.join(repositoryPath, "backend", "pyproject.toml"), "[tool.pytest.ini_options]\n[tool.ruff]\n", "utf8");
    await writeFile(
      path.join(repositoryPath, "frontend", "package.json"),
      JSON.stringify({ private: true, scripts: { build: "node build.mjs", test: "node --test" } }),
      "utf8",
    );
    await writeFile(path.join(repositoryPath, "scripts", "verify-release.sh"), "#!/bin/sh\n", "utf8");
    git(repositoryPath, ["add", "."]);
    git(repositoryPath, ["commit", "-m", "validator fixture"]);
    return { path: repositoryPath, oid: git(repositoryPath, ["rev-parse", "HEAD"]) };
  };
  const runGate = (
    root: string,
    expectations: ValidatorCorpusRow[],
    seam = true,
  ): ReturnType<typeof spawnSync> => {
    const { NODE_TEST_CONTEXT: _nodeTestContext, ...runnerEnvironment } = process.env;
    return spawnSync(process.execPath, ["scripts/verify-validator-discovery-corpus.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 30_000,
      env: {
        ...runnerEnvironment,
        CIVICSUITE_ORG_READALL: root,
        ...(seam ? { DEVHARMONICS_VALIDATOR_CORPUS_TEST_SEAM: "1" } : {}),
        DEVHARMONICS_VALIDATOR_CORPUS_TEST_EXPECTATIONS: JSON.stringify(expectations),
      },
    });
  };
  try {
    const mutationRoot = path.join(fixtureRoot, "mutation");
    await mkdir(mutationRoot, { recursive: true });
    const fixture = await createRepository(mutationRoot, "expected");
    const expected: ValidatorCorpusRow = [
      "expected",
      fixture.oid,
      [
        ["build", "frontend", ["frontend/package.json"]],
        ["pytest", "backend", ["backend/pyproject.toml"]],
        ["ruff", "backend", ["backend/pyproject.toml"]],
        ["test", "frontend", ["frontend/package.json"]],
        ["verify-release", null, ["scripts/verify-release.sh"]],
      ],
      [],
    ];
    const green = runGate(mutationRoot, [expected]);
    assert.equal(green.status, 0, `${green.stdout}\n${green.stderr}`);

    const droppedCwd = runGate(mutationRoot, [[
      "expected",
      fixture.oid,
      [
        ["build", null, ["frontend/package.json"]],
        ["pytest", "backend", ["backend/pyproject.toml"]],
        ["ruff", "backend", ["backend/pyproject.toml"]],
        ["test", "frontend", ["frontend/package.json"]],
        ["verify-release", null, ["scripts/verify-release.sh"]],
      ],
      [],
    ]]);
    assert.notEqual(droppedCwd.status, 0, `${droppedCwd.stdout}\n${droppedCwd.stderr}`);
    assert.match(`${droppedCwd.stdout}\n${droppedCwd.stderr}`, /expected validators .* received/i);

    const unguarded = runGate(mutationRoot, [expected], false);
    assert.notEqual(unguarded.status, 0, `${unguarded.stdout}\n${unguarded.stderr}`);
    assert.match(`${unguarded.stdout}\n${unguarded.stderr}`, /overrides require .*seam=1/i);

    await writeFile(path.join(fixture.path, "README.md"), "moved\n", "utf8");
    git(fixture.path, ["add", "README.md"]);
    git(fixture.path, ["commit", "-m", "move head"]);
    const moved = runGate(mutationRoot, [expected]);
    assert.notEqual(moved.status, 0, `${moved.stdout}\n${moved.stderr}`);
    assert.match(`${moved.stdout}\n${moved.stderr}`, /expected checkout HEAD .* but found/i);

    const unexpectedRoot = path.join(fixtureRoot, "unexpected");
    await mkdir(unexpectedRoot, { recursive: true });
    const expectedRepo = await createRepository(unexpectedRoot, "expected");
    await createRepository(unexpectedRoot, "new-repository");
    const unexpected = runGate(unexpectedRoot, [[
      "expected",
      expectedRepo.oid,
      expected[2],
      [],
    ]]);
    assert.notEqual(unexpected.status, 0, `${unexpected.stdout}\n${unexpected.stderr}`);
    assert.match(`${unexpected.stdout}\n${unexpected.stderr}`, /unexpected top-level Git repositories: new-repository/i);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("validator-discovery corpus manifest is the exact frozen 24-repository census", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      "import { validatorDiscoveryCorpusManifest as manifest } from './scripts/validator-discovery-corpus-manifest.mjs'; console.log(JSON.stringify(manifest));",
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const manifest = JSON.parse(result.stdout) as ValidatorCorpusRow[];
  assert.deepEqual(
    manifest.find(([name]) => name === "civicrecords-ai")?.[2],
    [
      ["build", "frontend", ["frontend/package.json"]],
      ["pytest", "backend", ["backend/pyproject.toml"]],
      ["ruff", "backend", ["backend/pyproject.toml"]],
      ["test", "frontend", ["frontend/package.json"]],
      ["verify-release", null, ["scripts/verify-release.sh", ".github/workflows/release.yml"]],
    ],
    "CivicRecords AI must freeze each nested validator cwd and detection source",
  );
  assert.deepEqual(
    manifest.map(([name, oid]) => [name, oid]),
    [
      ["civic311", "b65d21c7d19aa1b3f458e56333481bb75f6ef584"],
      ["civicboards", "845e777f432ad512953ed49be994c366b87a6070"],
      ["civicbudget", "731a6b4802cfd8593a00180c37ca3d76a7236de0"],
      ["civicclerk", "dae807ec9d1370dd22cf6aba88e4c6fc6b4168d5"],
      ["civiccode", "05994fe716fa904682ec91b574a35e7cef066aa1"],
      ["civiccomms", "73be36fdcd3b7d429321fbe8d51cec07a466e16b"],
      ["civiccontracts", "23bcee99a09e1d58441775f2a03b7dcda870ed21"],
      ["civiccore", "aca61910a3dd58325d4cfc02da10df90fb6b9efa"],
      ["civiccourt", "666525cb1e646127a8150894deec1e97fa64912d"],
      ["civicdata", "5d8378d59bd4e5a7f68d0df48e794c5721d0c8eb"],
      ["civicelections", "c532f6ceaeba9ed6399e848ce067c50c3789cb74"],
      ["civicgrants", "5b01d8c6b9c2952591b28f2c5f09039382d4573a"],
      ["civichr", "7cd481b75f6d97eb3f28c68c78e12940f5879cdd"],
      ["civicinspect", "02f7912bfb492988d740f303f694d9b782a4a139"],
      ["civiclegal", "ac511514ed1d52a8e9c1433e757f8a97ddb53f64"],
      ["civiclibrary", "d7699189707f6dc9b75ad33c5a498d88cb572ab5"],
      ["civicparks", "7b9b5147c6a265184b713f5bb71f430a81810085"],
      ["civicpermit", "3d0998ae40930e71094f511471689846abc350f1"],
      ["civicplan", "252f23cc83638944fadd303955cda11e13bee674"],
      ["civicprocure", "5836032f396cb901769e9f2ff7a168e30aefb2f6"],
      ["civicrecords-ai", "538766523ad90ee7553b0ffa75b626d3d4850b17"],
      ["civicsafety", "38038f9cab7857b278250ff41946f4d1777715f1"],
      ["civicutility", "4342098cfc72d5cbd52326fa9fc5db8ec3fde346"],
      ["civiczone", "1d37826d909a601eea5a10f4ebce0b31a605f5d0"],
    ],
  );
  assert.equal(new Set(manifest.map(([name]) => name)).size, 24);
  assert.ok(manifest.every((entry) => entry.length === 4 && /^[0-9a-f]{40}$/.test(entry[1])));
  const standard = ["pytest", "ruff", "verify-release"];
  assert.deepEqual(
    manifest.map(([name, , validators, signals]) => [name, validators, signals]),
    manifest.map(([name]) => [
      name,
      name === "civicclerk"
        ? ["build", "pytest", "test", "verify-release"]
        : name === "civiccode"
          ? ["build", "pytest", "ruff", "typecheck", "verify-release"]
          : name === "civicrecords-ai"
            ? [
              ["build", "frontend", ["frontend/package.json"]],
              ["pytest", "backend", ["backend/pyproject.toml"]],
              ["ruff", "backend", ["backend/pyproject.toml"]],
              ["test", "frontend", ["frontend/package.json"]],
              ["verify-release", null, ["scripts/verify-release.sh", ".github/workflows/release.yml"]],
            ]
            : standard,
      name === "civicrecords-ai" ? ["compose_test_evidence"] : [],
    ]),
  );
});

test("validator corpus provisioner publishes an exact detached clean checkout without retained remotes", async () => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "devharmonics-validator-provision-"));
  const source = path.join(fixtureRoot, "source");
  const remotes = path.join(fixtureRoot, "remotes");
  const target = path.join(fixtureRoot, "published");
  const git = (cwd: string, args: string[]): ReturnType<typeof spawnSync> =>
    spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } });
  try {
    await mkdir(source);
    await mkdir(remotes);
    assert.equal(git(source, ["init", "--initial-branch=main"]).status, 0);
    assert.equal(git(source, ["config", "user.email", "fixture@example.invalid"]).status, 0);
    assert.equal(git(source, ["config", "user.name", "Fixture"]).status, 0);
    await writeFile(path.join(source, "README.md"), "fixture\n", "utf8");
    assert.equal(git(source, ["add", "README.md"]).status, 0);
    assert.equal(git(source, ["commit", "-m", "fixture"]).status, 0);
    const oid = String(git(source, ["rev-parse", "HEAD"]).stdout).trim();
    const bare = spawnSync("git", ["clone", "--bare", source, path.join(remotes, "fixture.git")], { encoding: "utf8" });
    assert.equal(bare.status, 0, `${bare.stdout}\n${bare.stderr}`);

    const result = spawnSync(process.execPath, ["scripts/provision-validator-discovery-corpus.mjs", target], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 30_000,
      env: {
        ...process.env,
        DEVHARMONICS_VALIDATOR_CORPUS_PROVISION_TEST_SEAM: "1",
        DEVHARMONICS_VALIDATOR_CORPUS_TEST_MANIFEST: JSON.stringify([["fixture", oid, [], []]]),
        DEVHARMONICS_VALIDATOR_CORPUS_TEST_REMOTE_ROOT: remotes,
      },
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const checkout = path.join(target, "fixture");
    assert.equal(String(git(checkout, ["rev-parse", "HEAD"]).stdout).trim(), oid);
    assert.equal(String(git(checkout, ["status", "--porcelain=v1", "--untracked-files=all"]).stdout), "");
    assert.notEqual(git(checkout, ["symbolic-ref", "-q", "HEAD"]).status, 0, "HEAD must be detached");
    assert.equal(String(git(checkout, ["remote"]).stdout), "");
    assert.notEqual(
      git(checkout, ["config", "--local", "--get-regexp", "^(remote\\..*\\.promisor|extensions\\.partialClone)$"]).status,
      0,
    );
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("validator corpus provisioner rejects unsafe input and never publishes partial or pre-existing targets", async () => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "devharmonics-validator-provision-fail-"));
  const remotes = path.join(fixtureRoot, "remotes");
  const run = (target: string, manifest: unknown): ReturnType<typeof spawnSync> =>
    spawnSync(process.execPath, ["scripts/provision-validator-discovery-corpus.mjs", target], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 30_000,
      env: {
        ...process.env,
        DEVHARMONICS_VALIDATOR_CORPUS_PROVISION_TEST_SEAM: "1",
        DEVHARMONICS_VALIDATOR_CORPUS_TEST_MANIFEST: JSON.stringify(manifest),
        DEVHARMONICS_VALIDATOR_CORPUS_TEST_REMOTE_ROOT: remotes,
      },
    });
  try {
    await mkdir(remotes);
    const badOidTarget = path.join(fixtureRoot, "bad-oid");
    const badOid = run(badOidTarget, [["missing", "a".repeat(40), [], []]]);
    assert.notEqual(badOid.status, 0, `${badOid.stdout}\n${badOid.stderr}`);
    await assert.rejects(stat(badOidTarget), /ENOENT/);

    const unsafeTarget = path.join(fixtureRoot, "unsafe");
    const unsafe = run(unsafeTarget, [["../escape", "a".repeat(40), [], []]]);
    assert.notEqual(unsafe.status, 0, `${unsafe.stdout}\n${unsafe.stderr}`);
    assert.match(`${unsafe.stdout}\n${unsafe.stderr}`, /unsafe.*name/i);
    await assert.rejects(stat(path.join(fixtureRoot, "escape")), /ENOENT/);

    const malformedOidTarget = path.join(fixtureRoot, "malformed-oid");
    const malformedOid = run(malformedOidTarget, [["safe-name", "not-an-oid", [], []]]);
    assert.notEqual(malformedOid.status, 0, `${malformedOid.stdout}\n${malformedOid.stderr}`);
    assert.match(`${malformedOid.stdout}\n${malformedOid.stderr}`, /invalid 40-hex commit OID/i);
    await assert.rejects(stat(malformedOidTarget), /ENOENT/);

    const duplicateTarget = path.join(fixtureRoot, "duplicate");
    const duplicate = run(duplicateTarget, [
      ["same", "a".repeat(40), [], []],
      ["same", "b".repeat(40), [], []],
    ]);
    assert.notEqual(duplicate.status, 0, `${duplicate.stdout}\n${duplicate.stderr}`);
    assert.match(`${duplicate.stdout}\n${duplicate.stderr}`, /duplicate repository name/i);
    await assert.rejects(stat(duplicateTarget), /ENOENT/);

    const existingTarget = path.join(fixtureRoot, "existing");
    await mkdir(existingTarget);
    await writeFile(path.join(existingTarget, "marker"), "preserve", "utf8");
    const existing = run(existingTarget, [["missing", "a".repeat(40), [], []]]);
    assert.notEqual(existing.status, 0, `${existing.stdout}\n${existing.stderr}`);
    assert.match(`${existing.stdout}\n${existing.stderr}`, /already exists/i);
    assert.equal(await readFile(path.join(existingTarget, "marker"), "utf8"), "preserve");
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("CI provisions and verifies the frozen validator corpus in a dedicated uncached Ubuntu job", async () => {
  const workflow = await readFile(".github/workflows/ci.yml", "utf8");
  const start = workflow.indexOf("  validator-discovery-corpus:");
  assert.ok(start >= 0, "dedicated validator-discovery-corpus job is required");
  const job = workflow.slice(start);
  assert.match(job, /runs-on:\s*ubuntu-latest/);
  assert.match(job, /timeout-minutes:\s*30/);
  assert.doesNotMatch(job, /cache:\s*npm/);
  assert.match(job, /node scripts\/provision-validator-discovery-corpus\.mjs\s+"?\$RUNNER_TEMP\/validator-discovery-corpus"?/);
  assert.match(job, /CIVICSUITE_ORG_READALL=.*npm run verify:validator-discovery-corpus/);
  assert.match(job, /CIVICSUITE_ORG_READALL=.*npm run verify:version-authority-corpus/);
  assert.doesNotMatch(job, /DEVHARMONICS_VALIDATOR_CORPUS_TEST_(?:SEAM|EXPECTATIONS)/);
  assert.doesNotMatch(job, /DEVHARMONICS_CORPUS_TEST_(?:SEAM|EXPECTATIONS)/);
});

test("validator corpus verifier shares the manifest and stays offline, read-only, and execution-free", async () => {
  const [verifier, provisioner] = await Promise.all([
    readFile("scripts/verify-validator-discovery-corpus.mjs", "utf8"),
    readFile("scripts/provision-validator-discovery-corpus.mjs", "utf8"),
  ]);
  assert.match(verifier, /import\s+\{\s*validatorDiscoveryCorpusManifest\s*\}\s+from\s+"\.\/validator-discovery-corpus-manifest\.mjs"/);
  assert.match(verifier, /discoverRepositoryValidatorsAtCommit\(repositoryPath,\s*oid\)/);
  assert.doesNotMatch(verifier, /\b(?:npm|npx|pnpm|yarn)\b/);
  assert.doesNotMatch(verifier, /\["(?:clone|fetch|pull|push|ls-remote)"/);
  assert.doesNotMatch(verifier, /\b(?:writeFile|appendFile|copyFile|rename|mkdir|mkdtemp|rm)\s*\(/);
  assert.match(provisioner, /const GIT_TIMEOUT_MS = 180_000/);
  assert.match(provisioner, /const POOL_SIZE = 4/);
  assert.match(provisioner, /\["fetch", "--depth=1", "--no-tags", repositoryUrl\(name\), oid\]/);
  for (const guard of ["GIT_TERMINAL_PROMPT", "GIT_CONFIG_NOSYSTEM", "GIT_CONFIG_GLOBAL", "GIT_LFS_SKIP_SMUDGE"]) {
    assert.match(provisioner, new RegExp(`\\b${guard}\\b`), guard);
  }
});

test("version authority verifier shares the frozen census and stays offline and read-only", async () => {
  const verifier = await readFile("scripts/verify-version-authority-corpus.mjs", "utf8");
  assert.match(verifier, /import\s+\{\s*versionAuthorityCorpusManifest\s*\}\s+from\s+"\.\/validator-discovery-corpus-manifest\.mjs"/);
  assert.match(verifier, /versionAuthorityAtCommit\(repositoryPath,\s*oid\)/);
  assert.doesNotMatch(verifier, /\["(?:clone|fetch|pull|push|ls-remote)"/);
  assert.doesNotMatch(verifier, /\b(?:writeFile|appendFile|copyFile|rename)\s*\(/);
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
