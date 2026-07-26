import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import {
  inventoryManifestsAtCommit,
  resolveReleaseAuthority,
  type ManifestInventory,
  type ManifestInventoryEntry,
  type ProcessRunner,
} from "../src/release-units.js";
import type { ProcessRequest, ProcessResult } from "../src/process.js";

const exec = promisify(execFile);
const COMMIT = "a".repeat(40);
const BLOB = "b".repeat(40);
const record = (pathname = "package.json") => `100644 blob ${BLOB}\t${pathname}`;

function output(stdout: string, overrides: Partial<ProcessResult> = {}): ProcessResult {
  return { stdout, stderr: "", exitCode: 0, durationMs: 1, timedOut: false,
    treeKillUnconfirmed: false, ...overrides };
}

function runner(tree: ProcessResult, blob = output("{}")): ProcessRunner {
  return async (request) => {
    if (request.args[0] === "ls-tree") return tree;
    if (request.args[1] === "-t") return output("commit\n");
    return blob;
  };
}

async function git(root: string, ...args: string[]): Promise<string> {
  return (await exec("git", args, { cwd: root })).stdout.trim();
}

async function repository(files: Record<string, string>): Promise<{ root: string; commit: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "dh-release-units-"));
  await git(root, "init", "-q");
  await git(root, "config", "user.email", "test@example.invalid");
  await git(root, "config", "user.name", "DevHarmonics Test");
  for (const [pathname, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, pathname)), { recursive: true });
    await writeFile(path.join(root, pathname), text);
  }
  await git(root, "add", ".");
  await git(root, "commit", "-qm", "fixture");
  return { root, commit: await git(root, "rev-parse", "HEAD") };
}

function manifest(pathname: string, text?: string, diagnostic?: string): ManifestInventoryEntry {
  return { path: pathname, cwd: path.posix.dirname(pathname),
    kind: path.posix.basename(pathname) as ManifestInventoryEntry["kind"],
    oid: BLOB, mode: "100644", ...(text === undefined ? { diagnostic: diagnostic! } : { text }) };
}

function available(entries: ManifestInventoryEntry[]): ManifestInventory {
  return { state: "available", commit: COMMIT, entries };
}

test("repair RED: annotated tag object OID is not a commit identity", async () => {
  const fixture = await repository({ "README.md": "fixture" });
  try {
    await git(fixture.root, "tag", "-a", "v1", "-m", "annotated");
    const tagOid = await git(fixture.root, "rev-parse", "refs/tags/v1");
    assert.equal((await inventoryManifestsAtCommit(fixture.root, tagOid)).state, "unavailable");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("repair RED: tracked recognized directories fail the inventory closed", async () => {
  const fixture = await repository({
    "package.json/inside.txt": "fixture",
    "pyproject.toml/inside.txt": "fixture",
  });
  try {
    assert.equal((await inventoryManifestsAtCommit(fixture.root, fixture.commit)).state, "unavailable");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("repair RED: invalid UTF-8 tree enumeration is unavailable", async () => {
  const tree = output(`${record()}\0`, { stdoutUtf8Valid: false });
  assert.equal((await inventoryManifestsAtCommit("C:\\fixture", COMMIT, runner(tree))).state, "unavailable");
});

test("inventory preserves immutable sorted provenance and a fixed bounded protocol", async () => {
  const fixture = await repository({
    "package.json": '{"version":"1.0.0"}',
    "backend/pyproject.toml": '[project]\nversion="2.0.0"\n',
    "docs/not-package.json": "{}",
  });
  try {
    const packageOid = await git(fixture.root, "rev-parse", `${fixture.commit}:package.json`);
    const pyprojectOid = await git(fixture.root, "rev-parse", `${fixture.commit}:backend/pyproject.toml`);
    await writeFile(path.join(fixture.root, "package.json"), '{"version":"MUTABLE"}');
    assert.deepEqual(await inventoryManifestsAtCommit(fixture.root, fixture.commit), {
      state: "available", commit: fixture.commit, entries: [
        { path: "backend/pyproject.toml", cwd: "backend", kind: "pyproject.toml",
          oid: pyprojectOid, mode: "100644", text: '[project]\nversion="2.0.0"\n' },
        { path: "package.json", cwd: ".", kind: "package.json",
          oid: packageOid, mode: "100644", text: '{"version":"1.0.0"}' },
      ],
    });
    const treeOid = await git(fixture.root, "rev-parse", `${fixture.commit}^{tree}`);
    for (const identity of ["HEAD", "-n1", fixture.commit.slice(0, 12), treeOid, "f".repeat(64)]) {
      assert.equal((await inventoryManifestsAtCommit(fixture.root, identity)).state, "unavailable", identity);
    }
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
  const calls: ProcessRequest[] = [];
  const fake: ProcessRunner = async (request) => {
    calls.push(request);
    if (request.args[1] === "-t") return output("commit\n");
    return output(`120000 blob ${BLOB}\tnested/package.json\0`);
  };
  assert.equal((await inventoryManifestsAtCommit("C:\\fixture", COMMIT, fake)).state, "unavailable");
  assert.deepEqual(calls[1]?.args, ["ls-tree", "-r", "-t", "-z", "--full-tree",
    "--format=%(objectmode) %(objecttype) %(objectname)%x09%(path)", COMMIT]);
  assert.ok(calls.every((call) => call.timeoutMs === 30_000 && call.maxOutputBytes !== undefined));
});

test("post-build proof: tree and blob failures retain exact fail-closed provenance", async () => {
  const treeFailures: Array<[string, Partial<ProcessResult>]> = [
    ["timeout", { timedOut: true }],
    ["nonzero", { exitCode: 1 }],
    ["truncation", { stdoutTruncated: true }],
    ["tree-kill", { treeKillUnconfirmed: true }],
  ];
  for (const [name, flags] of treeFailures) {
    const actual = await inventoryManifestsAtCommit("C:\\fixture", COMMIT, runner(output("", flags)));
    assert.equal(actual.state, "unavailable", name);
  }
  const malformed = [
    ["malformed", "not-a-tree-record\0"],
    ["duplicate", `${record()}\0${record()}\0`],
    ["unsafe", `${record("../package.json")}\0`],
  ];
  for (const [name, stdout] of malformed) {
    const actual = await inventoryManifestsAtCommit("C:\\fixture", COMMIT, runner(output(stdout!)));
    assert.equal(actual.state, "unavailable", name);
  }
  const blobFailures: Array<[string, Partial<ProcessResult>, string]> = [
    ["truncation", { stdoutTruncated: true }, "git blob read exceeded its output limit"],
    ["UTF-8", { stdoutUtf8Valid: false }, "manifest is not valid UTF-8"],
  ];
  for (const [name, flags, detail] of blobFailures) {
    const inventory = await inventoryManifestsAtCommit(
      "C:\\fixture", COMMIT, runner(output(`${record("nested/package.json")}\0`), output("{}", flags)));
    assert.equal(inventory.state, "available", name);
    if (inventory.state !== "available") continue;
    assert.deepEqual(inventory.entries[0], { path: "nested/package.json", cwd: "nested",
      kind: "package.json", oid: BLOB, mode: "100644", diagnostic: detail }, name);
    const authority = resolveReleaseAuthority(inventory, "nested");
    assert.deepEqual({ state: authority.state, invalidationNeeded: authority.invalidationNeeded,
      diagnostics: authority.diagnostics }, { state: "unavailable", invalidationNeeded: true,
      diagnostics: [{ path: "nested/package.json", cwd: "nested", detail }] }, name);
  }
});

test("post-build proof: resolver fallback, absence, ambiguity, and selection are deterministic", () => {
  for (const packageText of ['{"private":true,"version":"9"}', '{"name":"tooling"}']) {
    const actual = resolveReleaseAuthority(available([
      manifest("package.json", packageText),
      manifest("pyproject.toml", '[project]\nversion="2.3.4"'),
    ]));
    assert.deepEqual({ state: actual.state, version: actual.version, source: actual.source },
      { state: "declared", version: "2.3.4", source: "pyproject.toml" });
  }
  const absentCases: Array<[string, ManifestInventoryEntry, string]> = [
    ["private", manifest("app/package.json", '{"private":true,"version":"1"}'), "private"],
    ["versionless", manifest("app/package.json", '{"name":"app"}'), "versionless"],
    ["dynamic", manifest("app/pyproject.toml", '[project]\ndynamic=["version"]'), "dynamic"],
  ];
  for (const [name, item, unitState] of absentCases) {
    const actual = resolveReleaseAuthority(available([item]));
    assert.equal(actual.state, "absent", name);
    assert.equal(actual.units[0]?.state, unitState, name);
  }
  for (const second of ["1.0.0", "2.0.0"]) {
    const actual = resolveReleaseAuthority(available([
      manifest("a/package.json", '{"version":"1.0.0"}'),
      manifest("b/pyproject.toml", `[project]\nversion="${second}"`),
    ]));
    assert.deepEqual({ state: actual.state, detail: actual.detail },
      { state: "invalid", detail: "ambiguous nested release authority" }, second);
  }
  const chosen = resolveReleaseAuthority(available([
    manifest("app/package.json", '{"version":"1.2.3"}'),
    manifest("broken/package.json", "{"),
    manifest("other/pyproject.toml", '[project]\nversion="8"'),
  ]), "app");
  assert.deepEqual({ state: chosen.state, cwd: chosen.cwd, reason: chosen.reason,
    diagnostics: chosen.diagnostics.map(({ cwd, path }) => ({ cwd, path })) },
  { state: "declared", cwd: "app", reason: "configured-nested",
    diagnostics: [{ cwd: "broken", path: "broken/package.json" }] });
  const unavailable = resolveReleaseAuthority(available([
    manifest("app/package.json", undefined, "git blob read exceeded its output limit"),
  ]), "app");
  assert.deepEqual({ state: unavailable.state, invalidationNeeded: unavailable.invalidationNeeded,
    diagnostics: unavailable.diagnostics }, { state: "unavailable", invalidationNeeded: true,
    diagnostics: [{ cwd: "app", path: "app/package.json",
      detail: "git blob read exceeded its output limit" }] });
  for (const selected of [available([]),
    available([manifest("app/package.json", '{"private":true,"version":"1"}')]),
    available([manifest("app/pyproject.toml", '[project]\ndynamic=["version"]')]),
    available([manifest("app/package.json", "{")])]) {
    assert.equal(resolveReleaseAuthority(selected, "app").invalidationNeeded, true);
  }
  const root = resolveReleaseAuthority(available([manifest("package.json", '{"version":"1"}')]), "app");
  assert.deepEqual({ state: root.state, conflict: root.selectorConflict, invalidate: root.invalidationNeeded },
    { state: "invalid", conflict: true, invalidate: true });
});
