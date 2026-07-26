import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { DeliveryService } from "../src/delivery.js";
import { decodeReleaseUnitSelection, Ledger } from "../src/ledger.js";
const exec = promisify(execFile);
async function git(root: string, ...args: string[]): Promise<string> { return (await exec("git", args, { cwd: root })).stdout.trim(); }
async function repository(files: Record<string, string>) {
  const root = await mkdtemp(path.join(os.tmpdir(), "dh-release-selector-"));
  await git(root, "init", "-q");
  await git(root, "config", "user.email", "test@example.invalid"); await git(root, "config", "user.name", "DevHarmonics Test");
  for (const [name, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true }); await writeFile(path.join(root, name), text); }
  await git(root, "add", "."); await git(root, "commit", "-qm", "fixture");
  return { root, commit: await git(root, "rev-parse", "HEAD") };
}
function register(ledger: Ledger, localPath: string, intelligence: Record<string, unknown> = {}) {
  ledger.upsertProduct({ id: "product:test", name: "Test", organizationUrl: "https://example.invalid/test", description: "fixture", repositories: [] });
  return ledger.upsertRepository({ id: "repo:test", productId: "product:test", name: "repo", fullName: "test/repo",
    url: "https://example.invalid/test/repo", cloneUrl: "https://example.invalid/test/repo.git", defaultBranch: "main",
    visibility: "private", archived: false, sizeKb: 0, language: null, description: null,
    intelligence, localPath, role: "release_truth", expectedBranch: "main", owners: [], dependencyRepositoryIds: [],
    validators: {}, governanceSources: [], governanceRules: [],
  });
}
test("nested authority automatically selects CivicRecords-style backend with excluded provenance", async () => {
  const fixture = await repository({ "backend/pyproject.toml": '[project]\nversion="1.7.3"\n',
    "frontend/package.json": '{"private":true,"version":"1.7.3"}', "docs/package.json": '{"name":"docs"}' });
  const ledger = new Ledger(path.join(fixture.root, "ledger.db"));
  try {
    const authority: any = await new DeliveryService(ledger).versionAuthorityAtCommit(fixture.root, fixture.commit);
    assert.deepEqual({ state: authority.state, version: authority.version, source: authority.source, cwd: authority.cwd,
      reason: authority.reason, units: authority.units.map((unit: any) => [unit.cwd, unit.state]) },
    { state: "declared", version: "1.7.3", source: "backend/pyproject.toml", cwd: "backend",
      reason: "automatic-sole-nested", units: [["backend", "declared"], ["docs", "versionless"], ["frontend", "private"]] });
  } finally {
    ledger.close(); await rm(fixture.root, { recursive: true, force: true });
  }
});
test("typed selector CAS is durable, race-safe, stale-safe, and reserved across metadata refresh", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dh-selector-ledger-"));
  const filename = path.join(root, "ledger.db");
  let ledger = new Ledger(filename);
  try {
    const original = register(ledger, root, { releaseUnitSelection: { version: 1, cwd: "a", state: "active", revision: 1,
      selectedAt: "2026-07-25T00:00:00.000Z", invalidatedAt: null, invalidationReason: null } });
    register(ledger, root, { refreshed: true });
    assert.deepEqual(ledger.getRepository(original.id)?.intelligence.releaseUnitSelection,
      original.intelligence.releaseUnitSelection, "metadata upsert preserves the reserved selector");
    ledger.upsertProduct({ id: "product:test", name: "Test", organizationUrl: "https://example.invalid/test", description: "refreshed",
      repositories: [{ ...original, intelligence: { refreshedAgain: true } }] });
    assert.deepEqual(ledger.getRepository(original.id)?.intelligence.releaseUnitSelection,
      original.intelligence.releaseUnitSelection, "product metadata upsert also preserves the reserved selector");
    const api = ledger as unknown as { updateReleaseUnitSelection(id: string, cwd: string, expected: number):
      { revision: number; cwd: string; state: string }; invalidateReleaseUnitSelection(id: string, expected: number, reason: string): { revision: number; state: string } };
    assert.equal(typeof api.updateReleaseUnitSelection, "function", "ledger exposes the consequential CAS update");
    const race = await Promise.allSettled([Promise.resolve().then(() => api.updateReleaseUnitSelection("repo:test", "b", 1)),
      Promise.resolve().then(() => api.updateReleaseUnitSelection("repo:test", "a", 1))]);
    assert.equal(race.filter((item) => item.status === "fulfilled").length, 1);
    assert.throws(() => api.updateReleaseUnitSelection("repo:test", "a", 1), /stale|revision|conflict/i);
    const winner = race.find((item): item is PromiseFulfilledResult<{ revision: number; cwd: string; state: string }> => item.status === "fulfilled")!.value;
    api.invalidateReleaseUnitSelection("repo:test", winner.revision, "selected release unit is missing");
    ledger.close(); ledger = new Ledger(filename);
    const persisted = ledger.getRepository("repo:test")!.intelligence.releaseUnitSelection as Record<string, unknown>;
    assert.deepEqual({ state: persisted.state, revision: persisted.revision }, { state: "invalidated", revision: winner.revision + 1 });
    const reselected = api.updateReleaseUnitSelection.call(ledger, "repo:test", "a", winner.revision + 1);
    assert.deepEqual({ state: reselected.state, revision: reselected.revision }, { state: "active", revision: winner.revision + 2 });
  } finally {
    ledger.close(); await rm(root, { recursive: true, force: true });
  }
});
test("configured authority ignores unrelated defects, then persists selected failure without reactivation", async () => {
  const fixture = await repository({ "a/package.json": '{"version":"1.0.0"}',
    "b/pyproject.toml": '[project]\nversion="2.0.0"\n', "broken/package.json": "{" });
  const filename = path.join(fixture.root, "ledger.db");
  let ledger = new Ledger(filename);
  try {
    register(ledger, fixture.root);
    const api = ledger as any;
    assert.equal(typeof api.updateReleaseUnitSelection, "function");
    api.updateReleaseUnitSelection("repo:test", "a", 0);
    let authority: any = await (new DeliveryService(ledger) as any).versionAuthorityAtCommit(fixture.root, fixture.commit, "repo:test");
    assert.deepEqual({ state: authority.state, cwd: authority.cwd, reason: authority.reason, revision: authority.selection?.value?.revision },
      { state: "declared", cwd: "a", reason: "configured-nested", revision: 1 });
    const worktree = `${fixture.root}-worktree`;
    await git(fixture.root, "worktree", "add", "--detach", worktree, fixture.commit);
    authority = await (new DeliveryService(ledger) as any).versionAuthorityAtCommit(worktree, fixture.commit, fixture.root);
    assert.equal(authority.reason, "configured-nested", "a path-like repository identity maps a delivery worktree to its registered primary path");
    await git(fixture.root, "worktree", "remove", "--force", worktree);
    await rm(path.join(fixture.root, "a"), { recursive: true, force: true });
    await git(fixture.root, "add", "-A"); await git(fixture.root, "commit", "-qm", "remove selected unit");
    const missingCommit = await git(fixture.root, "rev-parse", "HEAD");
    const invalidate = api.invalidateReleaseUnitSelection.bind(ledger);
    api.invalidateReleaseUnitSelection = (id: string, revision: number) => {
      api.updateReleaseUnitSelection(id, "b", revision); throw new Error("simulated invalidation revision conflict"); };
    authority = await (new DeliveryService(ledger) as any).versionAuthorityAtCommit(fixture.root, missingCommit, "repo:test");
    assert.deepEqual({ state: authority.state, cwd: authority.cwd, revision: authority.selection?.value?.revision },
      { state: "declared", cwd: "b", revision: 2 }, "one CAS conflict reloads and re-resolves against the new selection");
    api.invalidateReleaseUnitSelection = invalidate;
    await rm(path.join(fixture.root, "b"), { recursive: true, force: true });
    await git(fixture.root, "add", "-A"); await git(fixture.root, "commit", "-qm", "remove replacement selected unit");
    authority = await (new DeliveryService(ledger) as any).versionAuthorityAtCommit(fixture.root,
      await git(fixture.root, "rev-parse", "HEAD"), "repo:test");
    assert.equal(authority.state, "invalid");
    assert.equal(authority.selection?.value?.state, "invalidated");
    ledger.close(); ledger = new Ledger(filename);
    await mkdir(path.join(fixture.root, "a")); await writeFile(path.join(fixture.root, "a/package.json"), '{"version":"3.0.0"}');
    await git(fixture.root, "add", "."); await git(fixture.root, "commit", "-qm", "restore selected unit");
    authority = await (new DeliveryService(ledger) as any).versionAuthorityAtCommit(fixture.root,
      await git(fixture.root, "rev-parse", "HEAD"), "repo:test");
    assert.equal(authority.state, "invalid", "an invalidated selection never silently reactivates");
  } finally {
    ledger.close(); await rm(fixture.root, { recursive: true, force: true });
  }
});
test("malformed selection fails closed", async () => {
  const fixture = await repository({ "a/package.json": '{"version":"1.0.0"}', "b/package.json": '{"version":"1.0.0"}' });
  const ledger = new Ledger(path.join(fixture.root, "ledger.db"));
  try {
    register(ledger, fixture.root, { releaseUnitSelection: { version: 99, cwd: "a" } });
    const authority: any = await (new DeliveryService(ledger) as any).versionAuthorityAtCommit(fixture.root, fixture.commit, "repo:test");
    assert.deepEqual([authority.state, authority.selection?.kind], ["invalid", "malformed"]);
  } finally {
    ledger.close(); await rm(fixture.root, { recursive: true, force: true });
  }
});
test("selection decoding distinguishes absence, valid v1, malformed, and unknown data", () => {
  const decode = decodeReleaseUnitSelection;
  const active = { version: 1, cwd: "backend", state: "active", revision: 1,
    selectedAt: "2026-07-25T00:00:00.000Z", invalidatedAt: null, invalidationReason: null };
  assert.equal(decode({}).kind, "absent"); assert.equal(decode({ releaseUnitSelection: "literal malformed" }).kind, "malformed");
  assert.equal(decode({ releaseUnitSelection: { version: 2 } }).kind, "malformed");
  for (const cwd of ["C:/outside", "bad\u0001cwd"]) assert.equal(decode({ releaseUnitSelection: { ...active, cwd } }).kind, "malformed");
  assert.equal(decode({ releaseUnitSelection: { ...active, selectedAt: "2026-07-25" } }).kind, "malformed");
  assert.equal(decode({ releaseUnitSelection: active }).kind, "valid");
});
