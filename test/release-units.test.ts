import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import type { ProcessRequest, ProcessResult } from "../src/process.js";

const exec = promisify(execFile);
const modulePath = "../src/" + "release-units.js";
const api = await import(modulePath).catch(() => ({})) as {
  inventoryManifestsAtCommit?: (root: string, commit: string, runner?: Runner) => Promise<unknown>;
  resolveReleaseAuthority?: (inventory: Inventory, selectorCwd?: string) => unknown;
};
type Runner = (request: ProcessRequest) => Promise<ProcessResult>;
type Entry = {
  path: string;
  cwd: string;
  kind: "package.json" | "pyproject.toml";
  oid: string;
  mode: "100644" | "100755";
  text?: string;
  diagnostic?: string;
};
type Inventory =
  | { state: "available"; commit: string; entries: Entry[] }
  | { state: "unavailable"; commit: string; detail: string };

async function git(root: string, ...args: string[]): Promise<string> {
  return (await exec("git", args, { cwd: root })).stdout.trim();
}

async function repository(): Promise<{ root: string; commit: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "dh-release-units-"));
  await git(root, "init", "-q");
  await git(root, "config", "user.email", "test@example.invalid");
  await git(root, "config", "user.name", "DevHarmonics Test");
  return { root, commit: "" };
}

async function inventory(root: string, commit: string, runner?: Runner): Promise<unknown> {
  return typeof api.inventoryManifestsAtCommit === "function"
    ? api.inventoryManifestsAtCommit(root, commit, runner)
    : { state: "missing-inventory-api" };
}

function resolve(value: Inventory, selectorCwd?: string): unknown {
  return typeof api.resolveReleaseAuthority === "function"
    ? api.resolveReleaseAuthority(value, selectorCwd)
    : { state: "missing-resolver-api" };
}

function entry(pathname: string, text: string, diagnostic?: string): Entry {
  const kind = path.posix.basename(pathname) as Entry["kind"];
  const cwd = path.posix.dirname(pathname);
  return {
    path: pathname,
    cwd,
    kind,
    oid: "b".repeat(40),
    mode: "100644",
    ...(diagnostic === undefined ? { text } : { diagnostic }),
  };
}

function available(entries: Entry[]): Inventory {
  return { state: "available", commit: "a".repeat(40), entries };
}

test("inventory reads one immutable recursive tree with sorted exact provenance", async () => {
  const fixture = await repository();
  try {
    await mkdir(path.join(fixture.root, "backend"));
    await mkdir(path.join(fixture.root, "docs"));
    await writeFile(path.join(fixture.root, "package.json"), '{"version":"1.0.0"}');
    await writeFile(path.join(fixture.root, "backend", "pyproject.toml"), '[project]\nversion="2.0.0"\n');
    await writeFile(path.join(fixture.root, "docs", "not-package.json"), "{}");
    await git(fixture.root, "add", ".");
    await git(fixture.root, "commit", "-qm", "fixture");
    fixture.commit = await git(fixture.root, "rev-parse", "HEAD");
    const packageOid = await git(fixture.root, "rev-parse", `${fixture.commit}:package.json`);
    const pyprojectOid = await git(fixture.root, "rev-parse", `${fixture.commit}:backend/pyproject.toml`);
    await writeFile(path.join(fixture.root, "package.json"), '{"version":"MUTABLE"}');

    assert.deepEqual(await inventory(fixture.root, fixture.commit), {
      state: "available",
      commit: fixture.commit,
      entries: [
        {
          path: "backend/pyproject.toml",
          cwd: "backend",
          kind: "pyproject.toml",
          oid: pyprojectOid,
          mode: "100644",
          text: '[project]\nversion="2.0.0"\n',
        },
        {
          path: "package.json",
          cwd: ".",
          kind: "package.json",
          oid: packageOid,
          mode: "100644",
          text: '{"version":"1.0.0"}',
        },
      ],
    });
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("inventory rejects identities that are not exact proved commits", async () => {
  const fixture = await repository();
  try {
    await writeFile(path.join(fixture.root, "README.md"), "fixture");
    await git(fixture.root, "add", ".");
    await git(fixture.root, "commit", "-qm", "fixture");
    fixture.commit = await git(fixture.root, "rev-parse", "HEAD");
    const tree = await git(fixture.root, "rev-parse", `${fixture.commit}^{tree}`);
    for (const identity of ["HEAD", "-n1", fixture.commit.slice(0, 12), tree, "f".repeat(64)]) {
      assert.equal((await inventory(fixture.root, identity) as { state: string }).state, "unavailable", identity);
    }
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("inventory uses the fixed bounded protocol and rejects unsafe recognized records", async () => {
  const calls: ProcessRequest[] = [];
  const oid = "c".repeat(40);
  const result = (stdout: string, overrides: Partial<ProcessResult> = {}): ProcessResult => ({
    stdout,
    stderr: "",
    exitCode: 0,
    durationMs: 1,
    timedOut: false,
    treeKillUnconfirmed: false,
    ...overrides,
  });
  const runner: Runner = async (request) => {
    calls.push(request);
    if (request.args[0] === "cat-file" && request.args[1] === "-e") return result("");
    if (request.args[0] === "ls-tree") return result(`120000 blob ${oid}\tnested/package.json\0`);
    return result("{}");
  };

  const actual = await inventory("C:\\fixture", "a".repeat(40), runner) as { state: string };
  assert.equal(actual.state, "unavailable");
  assert.deepEqual(calls[1]?.args, [
    "ls-tree",
    "-r",
    "-z",
    "--full-tree",
    "--format=%(objectmode) %(objecttype) %(objectname)%x09%(path)",
    "a".repeat(40),
  ]);
  assert.ok(calls.every((call) => call.timeoutMs === 30_000 && call.maxOutputBytes !== undefined));
});

test("pure resolver freezes precedence, ambiguity, selector, and invalidation semantics", () => {
  const publicPackage = entry("app/package.json", '{"version":"1.2.3"}');
  const malformedPyproject = entry("app/pyproject.toml", "[project");
  const sole = resolve(available([
    entry("backend/pyproject.toml", '[project]\nversion="1.7.3"'),
    entry("frontend/package.json", '{"private":true,"version":"1.7.3"}'),
    entry("docs/package.json", '{"name":"docs"}'),
  ])) as Record<string, unknown>;
  assert.deepEqual(
    { state: sole.state, version: sole.version, cwd: sole.cwd, source: sole.source, reason: sole.reason },
    { state: "declared", version: "1.7.3", cwd: "backend", source: "backend/pyproject.toml", reason: "automatic-sole-nested" },
  );
  assert.deepEqual((sole.units as Array<{ cwd: string; state: string }>).map(({ cwd, state }) => [cwd, state]), [
    ["backend", "declared"], ["docs", "versionless"], ["frontend", "private"],
  ]);

  const root = resolve(available([
    entry("package.json", '{"version":"3.0.0"}'),
    entry("pyproject.toml", "[project"),
    entry("nested/package.json", '{"version":"9.0.0"}'),
  ])) as Record<string, unknown>;
  assert.deepEqual(
    { state: root.state, cwd: root.cwd, source: root.source, reason: root.reason },
    { state: "declared", cwd: ".", source: "package.json", reason: "automatic-root" },
  );
  assert.equal((resolve(available([])) as { state: string }).state, "absent");
  assert.equal((resolve(available([publicPackage, malformedPyproject])) as { state: string }).state, "declared");
  assert.equal((resolve(available([entry("app/package.json", "{"), entry("app/pyproject.toml", '[project]\nversion="2"')])) as { state: string }).state, "invalid");
  assert.equal((resolve(available([entry("package.json", "{"), entry("nested/package.json", '{"version":"2"}')])) as { state: string }).state, "invalid");
  assert.equal((resolve({ state: "unavailable", commit: "a".repeat(40), detail: "tree truncated" }) as { state: string }).state, "unavailable");
  assert.equal((resolve(available([
    entry("a/package.json", '{"version":"1.0.0"}'),
    entry("b/pyproject.toml", '[project]\nversion="1.0.0"'),
  ])) as { state: string }).state, "invalid");
  assert.equal((resolve(available([
    entry("good/package.json", '{"version":"1.0.0"}'),
    entry("broken/package.json", "{"),
  ])) as { state: string }).state, "invalid");

  const configured = resolve(available([
    publicPackage,
    entry("broken/package.json", "{"),
    entry("other/pyproject.toml", '[project]\nversion="8.0.0"'),
  ]), "app") as Record<string, unknown>;
  assert.deepEqual(
    { state: configured.state, cwd: configured.cwd, reason: configured.reason },
    { state: "declared", cwd: "app", reason: "configured-nested" },
  );
  assert.equal((configured.diagnostics as unknown[]).length, 1);

  for (const selected of [
    available([]),
    available([entry("app/package.json", '{"private":true,"version":"1.0.0"}')]),
    available([entry("app/pyproject.toml", '[project]\ndynamic=["version"]')]),
    available([entry("app/package.json", "{")]),
  ]) {
    const invalid = resolve(selected, "app") as Record<string, unknown>;
    assert.equal(invalid.state, "invalid");
    assert.equal(invalid.invalidationNeeded, true);
  }
  const conflict = resolve(available([entry("package.json", '{"version":"1.0.0"}')]), "app") as Record<string, unknown>;
  assert.equal(conflict.state, "invalid");
  assert.equal(conflict.selectorConflict, true);
  assert.equal(conflict.invalidationNeeded, true);
});
