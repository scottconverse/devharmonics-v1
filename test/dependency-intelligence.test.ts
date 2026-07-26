import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import type { ManifestInventory, ManifestInventoryEntry } from "../src/release-units.js";

const exec = promisify(execFile);
const COMMIT = "a".repeat(40);
const BLOB = "b".repeat(40);
const dependencyModulePath = "../src/" + "dependency-intelligence.js";

async function subject(): Promise<Record<string, unknown>> {
  return import(dependencyModulePath).catch(() => ({}));
}

function manifest(pathname: string, text?: string, diagnostic?: string): ManifestInventoryEntry {
  return {
    path: pathname,
    cwd: path.posix.dirname(pathname),
    kind: path.posix.basename(pathname) as ManifestInventoryEntry["kind"],
    oid: BLOB,
    mode: "100644",
    ...(text === undefined ? { diagnostic: diagnostic! } : { text }),
  };
}

function available(entries: ManifestInventoryEntry[]): ManifestInventory {
  return { state: "available", commit: COMMIT, entries };
}

async function extract(inventory: ManifestInventory): Promise<any> {
  const module = await subject();
  assert.equal(
    typeof module.extractDependencyDeclarations,
    "function",
    "the dependency domain must expose a pure inventory projection",
  );
  return (module.extractDependencyDeclarations as (value: ManifestInventory) => unknown)(inventory);
}

async function git(root: string, ...args: string[]): Promise<string> {
  return (await exec("git", args, { cwd: root })).stdout.trim();
}

async function repository(files: Record<string, string>): Promise<{ root: string; commit: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "dh-dependencies-"));
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

test("npm dependency groups and scoped names retain exact structural provenance", async () => {
  const result = await extract(available([
    manifest("apps/web/package.json", JSON.stringify({
      dependencies: { "@Scope/Core": "1.2.3" },
      devDependencies: { typescript: "^5.9.0" },
      optionalDependencies: { sharp: "workspace:*" },
      peerDependencies: { react: ">=18 <20" },
    })),
  ]));

  assert.equal(result.state, "detected");
  assert.deepEqual(result.manifests, [{
    state: "detected",
    ecosystem: "npm",
    commit: COMMIT,
    blobOid: BLOB,
    path: "apps/web/package.json",
    cwd: "apps/web",
    factCount: 4,
  }]);
  assert.deepEqual(result.facts.map((fact: any) => ({
    packageName: fact.packageName,
    scope: fact.scope,
    group: fact.group,
    rawDeclaration: fact.rawDeclaration,
    locator: fact.provenance.locator,
    kind: fact.constraint.kind,
    exactVersion: fact.constraint.exactVersion,
  })), [
    {
      packageName: "@scope/core",
      scope: "@scope",
      group: "runtime",
      rawDeclaration: "1.2.3",
      locator: "/dependencies/@Scope~1Core",
      kind: "exact",
      exactVersion: "1.2.3",
    },
    {
      packageName: "typescript",
      scope: null,
      group: "development",
      rawDeclaration: "^5.9.0",
      locator: "/devDependencies/typescript",
      kind: "range",
      exactVersion: undefined,
    },
    {
      packageName: "sharp",
      scope: null,
      group: "optional",
      rawDeclaration: "workspace:*",
      locator: "/optionalDependencies/sharp",
      kind: "workspace",
      exactVersion: undefined,
    },
    {
      packageName: "react",
      scope: null,
      group: "peer",
      rawDeclaration: ">=18 <20",
      locator: "/peerDependencies/react",
      kind: "range",
      exactVersion: undefined,
    },
  ]);
  assert.ok(result.facts.every((fact: any) => (
    fact.provenance.commit === COMMIT
    && fact.provenance.blobOid === BLOB
    && fact.provenance.path === "apps/web/package.json"
    && fact.provenance.cwd === "apps/web"
  )));
});

test("npm declarations use maintained package-spec semantics instead of prefix guesses", async () => {
  const result = await extract(available([
    manifest("package.json", JSON.stringify({
      dependencies: {
        shortRange: "1.2",
        alias: "npm:real-package@1.2.3",
        tarball: "https://example.invalid/archive.tgz",
        local: "file:../local",
        channel: "latest",
        equalsPin: "=1.0.0",
        equalsVPin: "=v2.3.4",
      },
    })),
  ]));

  assert.equal(result.state, "detected");
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.facts.map((fact: any) => [
    fact.packageName,
    fact.constraint.kind,
    fact.constraint.exactVersion,
  ]), [
    ["shortrange", "range", undefined],
    ["alias", "alias", undefined],
    ["tarball", "direct", undefined],
    ["local", "file", undefined],
    ["channel", "tag", undefined],
    ["equalspin", "exact", "1.0.0"],
    ["equalsvpin", "exact", "2.3.4"],
  ]);
});

test("npm parser failures become explicit evidence instead of dependency facts", async () => {
  const result = await extract(available([
    manifest("package.json", JSON.stringify({
      dependencies: {
        malformed: "not a valid tag",
        unsupported: "catalog:shared",
      },
    })),
  ]));

  assert.equal(result.state, "malformed");
  assert.equal(result.facts.length, 0);
  assert.deepEqual(result.diagnostics.map((item: any) => ({
    state: item.state,
    locator: item.locator,
  })), [
    { state: "malformed", locator: "/dependencies/malformed" },
    { state: "unsupported", locator: "/dependencies/unsupported" },
  ]);
});

test("PEP 621 and PEP 518 declarations use the standards parser and preserve extras, markers, URLs, pins, and ranges", async () => {
  const result = await extract(available([
    manifest("services/api/pyproject.toml", [
      "[project]",
      `dependencies = ["Requests[security]==2.32.3 ; python_version >= '3.11'", "urllib3>=2,<3", "demo @ https://example.invalid/demo.whl ; sys_platform == 'linux'"]`,
      "[project.optional-dependencies]",
      'docs = ["Sphinx~=8.0"]',
      "[build-system]",
      'requires = ["setuptools==75.0.0"]',
      'build-backend = "setuptools.build_meta"',
      "",
    ].join("\n")),
  ]));

  assert.equal(result.state, "detected");
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.facts.map((fact: any) => ({
    packageName: fact.packageName,
    group: fact.group,
    scope: fact.scope,
    extras: fact.constraint.extras,
    marker: fact.constraint.marker,
    directReference: fact.constraint.directReference,
    kind: fact.constraint.kind,
    exactVersion: fact.constraint.exactVersion,
    locator: fact.provenance.locator,
  })), [
    {
      packageName: "requests",
      group: "runtime",
      scope: null,
      extras: ["security"],
      marker: "python_version >= '3.11'",
      directReference: null,
      kind: "exact",
      exactVersion: "2.32.3",
      locator: "/project/dependencies/0",
    },
    {
      packageName: "urllib3",
      group: "runtime",
      scope: null,
      extras: [],
      marker: null,
      directReference: null,
      kind: "range",
      exactVersion: undefined,
      locator: "/project/dependencies/1",
    },
    {
      packageName: "demo",
      group: "runtime",
      scope: null,
      extras: [],
      marker: "sys_platform == 'linux'",
      directReference: "https://example.invalid/demo.whl",
      kind: "direct",
      exactVersion: undefined,
      locator: "/project/dependencies/2",
    },
    {
      packageName: "sphinx",
      group: "optional",
      scope: "docs",
      extras: [],
      marker: null,
      directReference: null,
      kind: "range",
      exactVersion: undefined,
      locator: "/project/optional-dependencies/docs/0",
    },
    {
      packageName: "setuptools",
      group: "build",
      scope: null,
      extras: [],
      marker: null,
      directReference: null,
      kind: "exact",
      exactVersion: "75.0.0",
      locator: "/build-system/requires/0",
    },
  ]);
});

test("PEP parser contract preserves whitespace and distinguishes unversioned declarations", async () => {
  const result = await extract(available([
    manifest("pyproject.toml", [
      "[project]",
      'dependencies = ["  idna == 3.10  ", "packaging"]',
      "",
    ].join("\n")),
  ]));
  assert.equal(result.state, "detected");
  assert.deepEqual(result.facts.map((fact: any) => ({
    packageName: fact.packageName,
    rawDeclaration: fact.rawDeclaration,
    kind: fact.constraint.kind,
    assessment: fact.constraint.assessment,
    exactVersion: fact.constraint.exactVersion,
  })), [
    {
      packageName: "idna",
      rawDeclaration: "  idna == 3.10  ",
      kind: "exact",
      assessment: "exact_pin",
      exactVersion: "3.10",
    },
    {
      packageName: "packaging",
      rawDeclaration: "packaging",
      kind: "unversioned",
      assessment: "unassessed",
      exactVersion: undefined,
    },
  ]);
});

test("PEP 440 arbitrary equality remains an exact dependency constraint", async () => {
  const result = await extract(available([
    manifest("pyproject.toml", [
      "[project]",
      'dependencies = ["demo===1.0", "legacy===legacy-version"]',
      "",
    ].join("\n")),
  ]));

  assert.equal(result.state, "detected");
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.facts.map((fact: any) => ({
    packageName: fact.packageName,
    kind: fact.constraint.kind,
    assessment: fact.constraint.assessment,
    exactVersion: fact.constraint.exactVersion,
  })), [
    { packageName: "demo", kind: "exact", assessment: "exact_pin", exactVersion: "1.0" },
    { packageName: "legacy", kind: "exact", assessment: "exact_pin", exactVersion: "legacy-version" },
  ]);
});

test("PEP arbitrary equality is preserved in environment markers", async () => {
  const result = await extract(available([
    manifest("pyproject.toml", [
      "[project]",
      "dependencies = [",
      `  "demo===legacy-version ; python_version === '3.10-custom'",`,
      `  "plain ; implementation_version === 'custom-build'",`,
      `  "wheel @ https://example.com/wheel.whl ; python_full_version === '3.10-custom'",`,
      "]",
      "",
    ].join("\n")),
  ]));

  assert.equal(result.state, "detected");
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.facts.map((fact: any) => ({
    packageName: fact.packageName,
    kind: fact.constraint.kind,
    assessment: fact.constraint.assessment,
    exactVersion: fact.constraint.exactVersion,
    marker: fact.constraint.marker,
    directReference: fact.constraint.directReference,
  })), [
    {
      packageName: "demo",
      kind: "exact",
      assessment: "unassessed",
      exactVersion: "legacy-version",
      marker: "python_version === '3.10-custom'",
      directReference: null,
    },
    {
      packageName: "plain",
      kind: "unversioned",
      assessment: "unassessed",
      exactVersion: undefined,
      marker: "implementation_version === 'custom-build'",
      directReference: null,
    },
    {
      packageName: "wheel",
      kind: "direct",
      assessment: "unassessed",
      exactVersion: undefined,
      marker: "python_full_version === '3.10-custom'",
      directReference: "https://example.com/wheel.whl",
    },
  ]);
});

test("PEP arbitrary-equality fallback leaves quoted marker values unchanged", async () => {
  const result = await extract(available([
    manifest("pyproject.toml", [
      "[project]",
      `dependencies = ["demo===legacy-version ; implementation_version == 'build===legacy'"]`,
      "",
    ].join("\n")),
  ]));

  assert.equal(result.state, "detected");
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.facts[0].constraint.exactVersion, "legacy-version");
  assert.equal(result.facts[0].constraint.marker, "implementation_version == 'build===legacy'");
});

test("PEP marker rendering preserves the parser tree's boolean grouping", async () => {
  const result = await extract(available([
    manifest("pyproject.toml", [
      "[project]",
      `dependencies = ["demo ; (python_version < '3.10' or platform_system == 'Windows') and implementation_name == 'cpython'"]`,
      "",
    ].join("\n")),
  ]));

  assert.equal(result.state, "detected");
  assert.equal(
    result.facts[0].constraint.marker,
    "((python_version < '3.10' or platform_system == 'Windows') and implementation_name == 'cpython')",
  );
});

test("standards parser packages stay pinned to the audited artifacts", async () => {
  const packageJson = JSON.parse(await readFile(path.resolve("package.json"), "utf8"));
  const packageLock = JSON.parse(await readFile(path.resolve("package-lock.json"), "utf8"));
  assert.equal(packageJson.dependencies["@renovatebot/pep440"], undefined);
  assert.equal(packageLock.packages["node_modules/@renovatebot/pep440"], undefined);
  assert.equal(packageJson.dependencies["npm-package-arg"], "13.0.2");
  assert.deepEqual(packageLock.packages["node_modules/npm-package-arg"], {
    version: "13.0.2",
    resolved: "https://registry.npmjs.org/npm-package-arg/-/npm-package-arg-13.0.2.tgz",
    integrity: "sha512-IciCE3SY3uE84Ld8WZU23gAPPV9rIYod4F+rc+vJ7h7cwAJt9Vk6TVsK60ry7Uj3SRS3bqRRIGuTp9YVlk6WNA==",
    license: "ISC",
    dependencies: {
      "hosted-git-info": "^9.0.0",
      "proc-log": "^6.0.0",
      semver: "^7.3.5",
      "validate-npm-package-name": "^7.0.0",
    },
    engines: { node: "^20.17.0 || >=22.9.0" },
  });
  assert.equal(packageJson.dependencies["pip-requirements-js"], "1.0.3");
  assert.deepEqual(packageLock.packages["node_modules/pip-requirements-js"], {
    version: "1.0.3",
    resolved: "https://registry.npmjs.org/pip-requirements-js/-/pip-requirements-js-1.0.3.tgz",
    integrity: "sha512-1O9Bx0mPOZht3tW4LuxOA46qkD8A1AGymWXz3UwIMqGQgiTiOaFptsCf+9IE67qcbBrg8KHG6l8ePF7CoFRW/A==",
    license: "MPL-2.0",
    dependencies: { "ohm-js": "^17.1.0" },
  });
});

test("PEP 621 rejects fields declared both statically and dynamically", async () => {
  const result = await extract(available([
    manifest("pyproject.toml", [
      "[project]",
      'dynamic = ["dependencies", "optional-dependencies"]',
      'dependencies = ["requests==2.32.3"]',
      "[project.optional-dependencies]",
      'docs = ["sphinx==8.0.0"]',
      "",
    ].join("\n")),
  ]));

  assert.equal(result.state, "wrong_shape");
  assert.equal(result.facts.length, 0);
  assert.deepEqual(result.diagnostics.map((item: any) => ({
    state: item.state,
    locator: item.locator,
  })), [
    { state: "wrong_shape", locator: "/project/dependencies" },
    { state: "wrong_shape", locator: "/project/optional-dependencies" },
  ]);
});

test("PEP 518 requires build-system.requires when the table is present", async () => {
  const result = await extract(available([
    manifest("pyproject.toml", [
      "[build-system]",
      'build-backend = "setuptools.build_meta"',
      "",
    ].join("\n")),
  ]));

  assert.equal(result.state, "wrong_shape");
  assert.equal(result.facts.length, 0);
  assert.deepEqual(result.diagnostics.map((item: any) => ({
    state: item.state,
    locator: item.locator,
  })), [
    { state: "wrong_shape", locator: "/build-system/requires" },
  ]);
});

test("PEP 621 rejects invalid or normalization-colliding optional-extra names", async () => {
  const result = await extract(available([
    manifest("pyproject.toml", [
      "[project.optional-dependencies]",
      '"not valid!" = ["invalid==1.0"]',
      'Docs = ["uppercase==1.0"]',
      'docs_test = ["underscore==1.0"]',
      '"docs.test" = ["dot==1.0"]',
      '"docs--test" = ["double==1.0"]',
      'docs-test = ["valid==1.0"]',
      "",
    ].join("\n")),
  ]));

  assert.equal(result.state, "wrong_shape");
  assert.deepEqual(result.facts.map((fact: any) => fact.packageName), ["valid"]);
  assert.deepEqual(result.diagnostics.map((item: any) => ({
    state: item.state,
    locator: item.locator,
  })), [
    { state: "wrong_shape", locator: "/project/optional-dependencies/Docs" },
    { state: "wrong_shape", locator: "/project/optional-dependencies/docs--test" },
    { state: "wrong_shape", locator: "/project/optional-dependencies/docs.test" },
    { state: "wrong_shape", locator: "/project/optional-dependencies/docs_test" },
    { state: "wrong_shape", locator: "/project/optional-dependencies/not valid!" },
  ]);
});

test("dependency evidence distinguishes absent, malformed, wrong-shaped, dynamic, unsupported, and unavailable", async () => {
  const absent = await extract(available([manifest("package.json", '{"name":"empty"}')]));
  assert.equal(absent.state, "absent");
  assert.equal(absent.manifests[0].state, "absent");

  const malformed = await extract(available([
    manifest("bad/package.json", "{"),
    manifest("invalid/pyproject.toml", '[project]\ndependencies = ["not a valid requirement !!!"]\n'),
  ]));
  assert.equal(malformed.state, "malformed");
  assert.deepEqual(malformed.manifests.map((item: any) => item.state), ["malformed", "malformed"]);
  assert.equal(malformed.facts.length, 0);

  const wrongShape = await extract(available([
    manifest("npm/package.json", '{"dependencies":[]}'),
    manifest("python/pyproject.toml", '[project]\ndependencies = "requests==2"\n'),
  ]));
  assert.equal(wrongShape.state, "wrong_shape");
  assert.deepEqual(wrongShape.manifests.map((item: any) => item.state), ["wrong_shape", "wrong_shape"]);

  const dynamic = await extract(available([
    manifest("dynamic/pyproject.toml", '[project]\ndynamic = ["dependencies"]\n'),
  ]));
  assert.equal(dynamic.state, "dynamic");
  assert.equal(dynamic.manifests[0].state, "dynamic");

  const unsupported = await extract(available([
    manifest("include/pyproject.toml", '[project]\ndependencies = ["-r requirements.txt"]\n'),
  ]));
  assert.equal(unsupported.state, "unsupported");
  assert.equal(unsupported.manifests[0].state, "unsupported");

  const unreadable = await extract(available([
    manifest("broken/package.json", undefined, "git blob read exited nonzero"),
  ]));
  assert.equal(unreadable.state, "unavailable");
  assert.equal(unreadable.manifests[0].state, "unavailable");
  assert.match(unreadable.diagnostics[0].detail, /git blob read exited nonzero/);

  const inventoryUnavailable = await extract({
    state: "unavailable",
    commit: COMMIT,
    detail: "recursive tree enumeration exited nonzero",
  });
  assert.equal(inventoryUnavailable.state, "unavailable");
  assert.deepEqual(inventoryUnavailable.manifests, []);
  assert.match(inventoryUnavailable.diagnostics[0].detail, /recursive tree enumeration exited nonzero/);
});

test("exact-commit extraction includes nested manifests and ignores dirty checkout edits", async () => {
  const fixture = await repository({
    "README.md": "not a governance source",
    "apps/web/package.json": '{"dependencies":{"committed":"1.0.0"}}',
    "services/api/pyproject.toml": '[project]\ndependencies = ["requests==2.32.3"]\n',
  });
  try {
    await writeFile(
      path.join(fixture.root, "apps/web/package.json"),
      '{"dependencies":{"dirty":"9.9.9"}}',
    );
    const module = await subject();
    assert.equal(
      typeof module.discoverDependenciesAtCommit,
      "function",
      "the dependency domain must reuse exact-commit manifest discovery",
    );
    const result = await (
      module.discoverDependenciesAtCommit as (root: string, commit: string) => Promise<any>
    )(fixture.root, fixture.commit);
    assert.equal(result.commit, fixture.commit);
    assert.deepEqual(
      result.facts.map((fact: any) => fact.packageName),
      ["committed", "requests"],
    );
    assert.ok(result.facts.every((fact: any) => fact.provenance.commit === fixture.commit));
    assert.ok(result.facts.every((fact: any) => /^[0-9a-f]{40}$/.test(fact.provenance.blobOid)));
    assert.equal(result.facts.some((fact: any) => fact.packageName === "dirty"), false);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
