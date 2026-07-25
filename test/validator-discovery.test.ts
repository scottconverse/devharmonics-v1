import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createValidatorDiscoverySnapshot,
  diffValidatorDiscoveries,
  discoverRepositoryValidators,
  discoveredValidatorMap,
  effectiveValidatorAllowlist,
} from "../src/validator-discovery.js";

async function fixture(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "devharmonics-validator-discovery-"));
}

test("empty repository discovery returns exactly zero validators", async () => {
  const root = await fixture();
  try {
    const result = await discoverRepositoryValidators(root);
    assert.deepEqual(result.validators, []);
    assert.deepEqual(discoveredValidatorMap(result), {});
    assert.equal(JSON.stringify(result).includes("diff-check"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("npm discovery selects fixed templates and discards hostile script bodies", async () => {
  const root = await fixture();
  try {
    await writeFile(path.join(root, "package.json"), JSON.stringify({
      scripts: {
        test: "node --test; touch ATTACKER",
        lint: "eslint . && $(ATTACKER)",
        build: "tsc > ATTACKER",
        typecheck: "`ATTACKER`",
        deploy: "curl ATTACKER",
      },
    }));
    const result = await discoverRepositoryValidators(root);
    assert.deepEqual(discoveredValidatorMap(result), {
      build: { command: "npm", args: ["run", "build"], timeoutMs: 600_000 },
      lint: { command: "npm", args: ["run", "lint"], timeoutMs: 600_000 },
      test: { command: "npm", args: ["run", "test"], timeoutMs: 900_000 },
      typecheck: { command: "npm", args: ["run", "typecheck"], timeoutMs: 600_000 },
    });
    assert.equal(JSON.stringify(result).includes("ATTACKER"), false);
    assert.deepEqual(result.validators.map((entry) => entry.name), ["build", "lint", "test", "typecheck"]);
    assert.ok(result.validators.every((entry) => entry.sources[0]?.kind === "package_json_script"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("pyproject discovery recognizes exact pytest and Ruff tables without prose false positives", async () => {
  const positive = await fixture();
  const negative = await fixture();
  try {
    await writeFile(path.join(positive, "pyproject.toml"), [
      "[project]",
      "description = \"mentions pytest and ruff\"",
      "[tool.pytest.ini_options]",
      "testpaths = [\"test\"]",
      "[tool.ruff.lint]",
      "select = [\"E\"]",
    ].join("\n"));
    await writeFile(path.join(negative, "pyproject.toml"), [
      "# [tool.pytest.ini_options]",
      "description = \"[tool.ruff]\"",
      "basic = \"\"\"",
      "[tool.pytest.ini_options]",
      "\"\"\"",
      "literal = '''",
      "[tool.ruff]",
      "'''",
      "[tool.ruffian]",
      "name = \"pytest\"",
    ].join("\n"));
    assert.deepEqual(discoveredValidatorMap(await discoverRepositoryValidators(positive)), {
      pytest: { command: "python", args: ["-m", "pytest"], timeoutMs: 900_000 },
      ruff: { command: "python", args: ["-m", "ruff", "check", "."], timeoutMs: 600_000 },
    });
    assert.deepEqual(discoveredValidatorMap(await discoverRepositoryValidators(negative)), {});
  } finally {
    await rm(positive, { recursive: true, force: true });
    await rm(negative, { recursive: true, force: true });
  }
});

test("source failures are isolated and release discovery refuses symlinks", async () => {
  const root = await fixture();
  const outside = await fixture();
  try {
    await mkdir(path.join(root, "scripts"), { recursive: true });
    await writeFile(path.join(root, "package.json"), "{broken");
    await writeFile(path.join(root, "pyproject.toml"), "[tool.pytest.ini_options]\n");
    await writeFile(path.join(root, "scripts", "verify-release.sh"), "#!/bin/sh\n");
    const valid = await discoverRepositoryValidators(root);
    assert.deepEqual(Object.keys(discoveredValidatorMap(valid)), ["pytest", "verify-release"]);
    assert.ok(valid.diagnostics.some((item) => item.source === "package.json" && item.code === "malformed"));

    await rm(path.join(root, "scripts", "verify-release.sh"));
    await writeFile(path.join(outside, "escape.sh"), "#!/bin/sh\n");
    try {
      await symlink(path.join(outside, "escape.sh"), path.join(root, "scripts", "verify-release.sh"));
    } catch (error) {
      const code = error instanceof Error && "code" in error
        ? (error as NodeJS.ErrnoException).code
        : undefined;
      if (code !== "EPERM") throw error;
      await mkdir(path.join(root, "scripts", "verify-release.sh"));
    }
    const unsafe = await discoverRepositoryValidators(root);
    assert.equal(discoveredValidatorMap(unsafe)["verify-release"], undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("workflow recipes are exact fixed selectors and malicious shell text is never replayed", async () => {
  const root = await fixture();
  try {
    await mkdir(path.join(root, ".github", "workflows"), { recursive: true });
    await writeFile(path.join(root, ".github", "workflows", "safe.yml"), [
      "name: checks",
      "jobs:",
      "  test:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - run: python -m pytest",
      "      - run: python -m ruff check .",
      "      - run: npm run build",
      "      - run: bash scripts/verify-release.sh",
    ].join("\n"));
    await writeFile(path.join(root, ".github", "workflows", "hostile.yml"), [
      "jobs:",
      "  attack:",
      "    steps:",
      "      - name: pytest",
      "        run: python -m pytest; echo ATTACKER",
      "      - run: echo \"npm run test\"",
    ].join("\n"));
    await writeFile(path.join(root, ".github", "workflows", "compose.yml"), [
      "jobs:",
      "  integration:",
      "    steps:",
      "      - run: |",
      "          docker compose run --rm --no-deps \\",
      "            api python -m pytest tests -q",
    ].join("\n"));
    const result = await discoverRepositoryValidators(root);
    assert.deepEqual(discoveredValidatorMap(result), {
      pytest: { command: "python", args: ["-m", "pytest"], timeoutMs: 900_000 },
      ruff: { command: "python", args: ["-m", "ruff", "check", "."], timeoutMs: 600_000 },
    });
    assert.equal(JSON.stringify(result).includes("ATTACKER"), false);
    assert.ok(result.validators.every((entry) => entry.sources.every((source) => source.evidence !== "python -m pytest")));
    assert.deepEqual(result.signals, [{
      kind: "compose_test_evidence",
      path: ".github/workflows/compose.yml",
      reason: "Setup-dependent Compose validation evidence; no standalone validator recipe.",
    }]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("workflow recipes ignore step, job, and workflow-default non-root working directories", async () => {
  const root = await fixture();
  try {
    await mkdir(path.join(root, ".github", "workflows"), { recursive: true });
    await writeFile(path.join(root, ".github", "workflows", "nested.yml"), [
      "defaults:",
      "  run:",
      "    working-directory: workflow-default",
      "jobs:",
      "  job_default:",
      "    defaults:",
      "      run:",
      "        working-directory: frontend",
      "    steps:",
      "      - run: python -m pytest",
      "      - run: python -m ruff check .",
      "  step_default:",
      "    steps:",
      "      - run: python -m pytest",
      "        working-directory: services/api",
      "      - run: python -m ruff check .",
      "        working-directory: services/api",
    ].join("\n"));
    const result = await discoverRepositoryValidators(root);
    assert.deepEqual(discoveredValidatorMap(result), {});
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("workflow discovery fails closed after the bounded workflow-count cap", async () => {
  const root = await fixture();
  try {
    const workflows = path.join(root, ".github", "workflows");
    await mkdir(workflows, { recursive: true });
    await Promise.all(Array.from({ length: 65 }, (_, index) => writeFile(
      path.join(workflows, `check-${String(index).padStart(2, "0")}.yml`),
      "jobs:\n  tests:\n    steps:\n      - run: python -m pytest\n",
    )));
    const result = await discoverRepositoryValidators(root);
    assert.deepEqual(discoveredValidatorMap(result), {});
    assert.ok(result.diagnostics.some((item) => item.source === ".github/workflows" && item.code === "limit_reached"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("workflow discovery discards the whole workflow source after the aggregate byte cap", async () => {
  const root = await fixture();
  try {
    const workflows = path.join(root, ".github", "workflows");
    await mkdir(workflows, { recursive: true });
    const validPrefix = "jobs:\n  tests:\n    steps:\n      - run: python -m pytest\n";
    await Promise.all(Array.from({ length: 9 }, (_, index) => {
      const prefix = index === 0 ? validPrefix : "name: filler\n";
      return writeFile(
        path.join(workflows, `large-${index}.yml`),
        `${prefix}#${"x".repeat(500_000 - prefix.length - 2)}\n`,
      );
    }));
    const result = await discoverRepositoryValidators(root);
    assert.deepEqual(discoveredValidatorMap(result), {});
    assert.ok(result.diagnostics.some((item) => item.source === ".github/workflows" && item.code === "limit_reached"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("source byte limits accept exact boundaries and reject the first oversized byte", async () => {
  const exact = await fixture();
  const oversized = await fixture();
  try {
    const packagePrefix = JSON.stringify({ scripts: { test: "hostile text is evidence only" } });
    await writeFile(path.join(exact, "package.json"), `${packagePrefix}${" ".repeat(1024 * 1024 - packagePrefix.length)}`);
    await writeFile(path.join(oversized, "package.json"), `${packagePrefix}${" ".repeat(1024 * 1024 + 1 - packagePrefix.length)}`);
    await mkdir(path.join(exact, "scripts"), { recursive: true });
    await mkdir(path.join(oversized, "scripts"), { recursive: true });
    await writeFile(path.join(exact, "scripts", "verify-release.sh"), Buffer.alloc(4 * 1024 * 1024, 35));
    await writeFile(path.join(oversized, "scripts", "verify-release.sh"), Buffer.alloc(4 * 1024 * 1024 + 1, 35));
    await mkdir(path.join(exact, ".github", "workflows"), { recursive: true });
    await mkdir(path.join(oversized, ".github", "workflows"), { recursive: true });
    const workflowPrefix = "jobs:\n  tests:\n    steps:\n      - run: python -m pytest\n#";
    await writeFile(
      path.join(exact, ".github", "workflows", "boundary.yml"),
      `${workflowPrefix}${"x".repeat(512 * 1024 - workflowPrefix.length)}`,
    );
    await writeFile(
      path.join(oversized, ".github", "workflows", "boundary.yml"),
      `${workflowPrefix}${"x".repeat(512 * 1024 + 1 - workflowPrefix.length)}`,
    );

    const exactResult = await discoverRepositoryValidators(exact);
    assert.deepEqual(Object.keys(discoveredValidatorMap(exactResult)), ["pytest", "test", "verify-release"]);
    assert.deepEqual(exactResult.diagnostics, []);

    const oversizedResult = await discoverRepositoryValidators(oversized);
    assert.deepEqual(discoveredValidatorMap(oversizedResult), {});
    assert.deepEqual(oversizedResult.diagnostics, [
      { source: ".github/workflows/boundary.yml", code: "oversized" },
      { source: "package.json", code: "oversized" },
      { source: "scripts/verify-release.sh", code: "oversized" },
    ]);
  } finally {
    await rm(exact, { recursive: true, force: true });
    await rm(oversized, { recursive: true, force: true });
  }
});

test("workflow count and directory-entry caps accept the boundary and fail closed at boundary plus one", async () => {
  const exactCount = await fixture();
  const exactEntries = await fixture();
  const overEntries = await fixture();
  try {
    for (const root of [exactCount, exactEntries, overEntries]) {
      await mkdir(path.join(root, ".github", "workflows"), { recursive: true });
    }
    await Promise.all(Array.from({ length: 64 }, (_, index) => writeFile(
      path.join(exactCount, ".github", "workflows", `check-${String(index).padStart(2, "0")}.yml`),
      "jobs:\n  tests:\n    steps:\n      - run: python -m pytest\n",
    )));
    assert.deepEqual(Object.keys(discoveredValidatorMap(await discoverRepositoryValidators(exactCount))), ["pytest"]);

    for (const [root, entries] of [[exactEntries, 256], [overEntries, 257]] as const) {
      await writeFile(
        path.join(root, ".github", "workflows", "check.yml"),
        "jobs:\n  tests:\n    steps:\n      - run: python -m pytest\n",
      );
      await Promise.all(Array.from({ length: entries - 1 }, (_, index) => writeFile(
        path.join(root, ".github", "workflows", `note-${String(index).padStart(3, "0")}.txt`),
        "not a workflow",
      )));
    }
    assert.deepEqual(Object.keys(discoveredValidatorMap(await discoverRepositoryValidators(exactEntries))), ["pytest"]);
    const over = await discoverRepositoryValidators(overEntries);
    assert.deepEqual(discoveredValidatorMap(over), {});
    assert.ok(over.diagnostics.some((item) => item.source === ".github/workflows" && item.code === "limit_reached"));
  } finally {
    await rm(exactCount, { recursive: true, force: true });
    await rm(exactEntries, { recursive: true, force: true });
    await rm(overEntries, { recursive: true, force: true });
  }
});

test("persisted discovery retains sorted diagnostics for later API and UI projection", async () => {
  const root = await fixture();
  try {
    await writeFile(path.join(root, "package.json"), "{broken");
    await writeFile(path.join(root, "pyproject.toml"), "x".repeat(1_048_577));
    const snapshot = createValidatorDiscoverySnapshot(
      await discoverRepositoryValidators(root),
      "a".repeat(40),
      "2026-07-25T00:00:00.000Z",
    );
    assert.deepEqual((snapshot as { diagnostics?: unknown }).diagnostics, [
      { source: "package.json", code: "malformed" },
      { source: "pyproject.toml", code: "oversized" },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("effective allowlist exposes provenance, suppression, and manual override without placeholders", async () => {
  const root = await fixture();
  try {
    await writeFile(path.join(root, "pyproject.toml"), "[tool.pytest.ini_options]\n[tool.ruff]\n");
    const snapshot = createValidatorDiscoverySnapshot(
      await discoverRepositoryValidators(root),
      "a".repeat(40),
      "2026-07-25T00:00:00.000Z",
    );
    const manual = { command: "python", args: ["-m", "pytest", "-q"], timeoutMs: 1_000 };
    const state = effectiveValidatorAllowlist(snapshot, {}, { pytest: manual }, ["ruff"]);
    assert.deepEqual(state.effectiveValidators, { pytest: manual });
    assert.equal(state.entries.find((entry) => entry.name === "pytest")?.effectiveOrigin, "manual_override");
    assert.ok(state.entries.find((entry) => entry.name === "pytest")?.discovered);
    assert.equal(state.entries.find((entry) => entry.name === "ruff")?.suppressed, true);
    assert.equal(state.entries.find((entry) => entry.name === "ruff")?.effectiveConfig, null);
    assert.deepEqual(effectiveValidatorAllowlist(null, {}, {}, []).effectiveValidators, {});
    assert.deepEqual(effectiveValidatorAllowlist(null, {}, {}, []).entries, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rescan diff includes detection-source changes as changed", async () => {
  const first = await fixture();
  const second = await fixture();
  try {
    await writeFile(path.join(first, "pyproject.toml"), "[tool.pytest.ini_options]\n[tool.ruff]\n");
    await mkdir(path.join(second, ".github", "workflows"), { recursive: true });
    await writeFile(path.join(second, "pyproject.toml"), "[tool.pytest.ini_options]\n");
    await writeFile(path.join(second, ".github", "workflows", "ruff.yml"), [
      "jobs:",
      "  lint:",
      "    steps:",
      "      - run: python -m ruff check .",
    ].join("\n"));
    await writeFile(path.join(second, "package.json"), JSON.stringify({ scripts: { build: "ignored body" } }));
    const before = createValidatorDiscoverySnapshot(await discoverRepositoryValidators(first), "a".repeat(40));
    const after = createValidatorDiscoverySnapshot(await discoverRepositoryValidators(second), "a".repeat(40));
    assert.deepEqual(diffValidatorDiscoveries(before, after), {
      added: ["build"],
      changed: ["ruff"],
      removed: [],
      unchanged: ["pytest"],
    });
  } finally {
    await rm(first, { recursive: true, force: true });
    await rm(second, { recursive: true, force: true });
  }
});
