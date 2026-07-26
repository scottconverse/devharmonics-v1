import assert from "node:assert/strict"; import { execFile } from "node:child_process"; import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os"; import path from "node:path";
import { promisify } from "node:util"; import test from "node:test";
import { DeliveryService } from "../src/delivery.js"; import { decodeReleaseUnitSelection, Ledger } from "../src/ledger.js";
const exec = promisify(execFile); async function git(root: string, ...args: string[]): Promise<string> { return (await exec("git", args, { cwd: root })).stdout.trim(); }
async function repository(files: Record<string, string>) { const root = await mkdtemp(path.join(os.tmpdir(), "dh-release-selector-"));
  await git(root, "init", "-q"); await git(root, "config", "user.email", "test@example.invalid"); await git(root, "config", "user.name", "DevHarmonics Test");
  for (const [name, text] of Object.entries(files)) { await mkdir(path.dirname(path.join(root, name)), { recursive: true }); await writeFile(path.join(root, name), text); }
  await git(root, "add", "."); await git(root, "commit", "-qm", "fixture"); return { root, commit: await git(root, "rev-parse", "HEAD") }; }
function register(ledger: Ledger, localPath: string, intelligence: Record<string, unknown> = {}) { ledger.upsertProduct({ id: "product:test", name: "Test", organizationUrl: "https://example.invalid/test", description: "fixture", repositories: [] }); return ledger.upsertRepository({ id: "repo:test", productId: "product:test", name: "repo", fullName: "test/repo",
    url: "https://example.invalid/test/repo", cloneUrl: "https://example.invalid/test/repo.git", defaultBranch: "main", visibility: "private",
    archived: false, sizeKb: 0, language: null, description: null, intelligence, localPath, role: "release_truth", expectedBranch: "main",
    owners: [], dependencyRepositoryIds: [], validators: {}, governanceSources: [], governanceRules: [] }); }
test("nested authority automatically selects CivicRecords-style backend with excluded provenance", async () => {
  const fixture = await repository({ "backend/pyproject.toml": '[project]\nversion="1.7.3"\n', "frontend/package.json": '{"private":true,"version":"1.7.3"}', "docs/package.json": '{"name":"docs"}' });
  const ledger = new Ledger(path.join(fixture.root, "ledger.db")); try { const authority: any = await new DeliveryService(ledger).versionAuthorityAtCommit(fixture.root, fixture.commit);
    assert.deepEqual({ state: authority.state, version: authority.version, source: authority.source, cwd: authority.cwd, reason: authority.reason, units: authority.units.map((unit: any) => [unit.cwd, unit.state]) }, { state: "declared", version: "1.7.3",
      source: "backend/pyproject.toml", cwd: "backend", reason: "automatic-sole-nested",
      units: [["backend", "declared"], ["docs", "versionless"], ["frontend", "private"]] });
  } finally { ledger.close(); await rm(fixture.root, { recursive: true, force: true }); }
}); test("typed selector CAS is durable, race-safe, stale-safe, and reserved across metadata refresh", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dh-selector-ledger-")), filename = path.join(root, "ledger.db");
  let ledger = new Ledger(filename); try {
    const injected = { version: 1, cwd: "a", state: "active", revision: 1, selectedAt: "2026-07-25T00:00:00.000Z", invalidatedAt: null, invalidationReason: null };
    const original = register(ledger, root, { releaseUnitSelection: injected }); assert.equal(ledger.getRepository(original.id)?.intelligence.releaseUnitSelection, undefined, "repository insert cannot seed the reserved selector");
    ledger.upsertProduct({ id: "product:test", name: "Test", organizationUrl: "https://example.invalid/test", description: "refreshed", repositories: [{ ...original, intelligence: { releaseUnitSelection: injected } }] });
    assert.equal(ledger.getRepository(original.id)?.intelligence.releaseUnitSelection, undefined, "product refresh cannot seed an absent selector"); const selected = ledger.updateReleaseUnitSelection("repo:test", "a", 0);
    register(ledger, root, { refreshed: true }); assert.deepEqual(ledger.getRepository(original.id)?.intelligence.releaseUnitSelection, selected, "repository metadata upsert preserves the reserved selector");
    ledger.upsertProduct({ id: "product:test", name: "Test", organizationUrl: "https://example.invalid/test", description: "refreshed", repositories: [{ ...original, intelligence: { refreshedAgain: true } }] });
    assert.deepEqual(ledger.getRepository(original.id)?.intelligence.releaseUnitSelection, selected, "product metadata upsert also preserves the reserved selector");
    const contender = new Ledger(filename);
    const race = await Promise.allSettled([Promise.resolve().then(() => ledger.updateReleaseUnitSelection("repo:test", "b", 1)),
      Promise.resolve().then(() => contender.updateReleaseUnitSelection("repo:test", "a", 1))]);
    assert.equal(race.filter((item) => item.status === "fulfilled").length, 1);
    const winner = (race.find((item) => item.status === "fulfilled") as PromiseFulfilledResult<ReturnType<Ledger["updateReleaseUnitSelection"]>>).value;
    const refresher = race[0].status === "fulfilled" ? contender : ledger; register(refresher, root, { releaseUnitSelection: selected, staleRefresh: true });
    assert.equal((refresher.getRepository("repo:test")!.intelligence.releaseUnitSelection as any).revision, winner.revision, "a stale metadata refresh cannot roll back another connection's selector revision"); contender.close();
    assert.throws(() => ledger.updateReleaseUnitSelection("repo:test", "a", 1), /stale|revision|conflict/i);
    ledger.invalidateReleaseUnitSelection("repo:test", winner.revision, "selected release unit is missing");
    ledger.close(); ledger = new Ledger(filename);
    const persisted = ledger.getRepository("repo:test")!.intelligence.releaseUnitSelection as Record<string, unknown>;
    assert.deepEqual({ state: persisted.state, revision: persisted.revision }, { state: "invalidated", revision: winner.revision + 1 });
    const reselected = ledger.updateReleaseUnitSelection("repo:test", "a", winner.revision + 1);
    assert.deepEqual({ state: reselected.state, revision: reselected.revision }, { state: "active", revision: winner.revision + 2 });
    for (const raw of [null, "literal malformed", { version: 99, cwd: "a" }]) { (ledger as any).database.prepare("UPDATE repositories SET intelligence_json = ? WHERE id = ?").run(JSON.stringify({ releaseUnitSelection: raw }), "repo:test");
      register(ledger, root, { releaseUnitSelection: injected }); assert.deepEqual(ledger.getRepository("repo:test")!.intelligence.releaseUnitSelection, raw, "repository refresh preserves existing raw selector");
      ledger.upsertProduct({ id: "product:test", name: "Test", organizationUrl: "https://example.invalid/test", description: "raw", repositories: [{ ...original, intelligence: { releaseUnitSelection: injected } }] }); assert.deepEqual(ledger.getRepository("repo:test")!.intelligence.releaseUnitSelection, raw, "product refresh preserves existing raw selector"); }
  } finally { ledger.close(); await rm(root, { recursive: true, force: true }); }
}); test("release lock binds its frozen token to one canonical key and cleanup never masks callbacks", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dh-selector-lock-")); const ledger = new Ledger(path.join(root, "ledger.db")); let stale = "", tokenEvidence = "";
  try { register(ledger, root);
    await ledger.withReleaseUnitLock("repo:other", async (lock) => { let error: unknown; try { ledger.updateReleaseUnitSelection("repo:test", "a", 0, { ...lock, key: (ledger as any).releaseUnitLockKey("repo:test") }); } catch (caught) { error = caught; }
      tokenEvidence = `lock frozen=${Object.isFrozen(lock)}; forged result=${String(error)}`; });
    let value: unknown, error: unknown; try { value = await ledger.withReleaseUnitLock("repo:test", async (lock) => { stale = lock.key; await rm(stale); await mkdir(stale); return "completed"; }); } catch (caught) { error = caught; }
    assert.deepEqual({ value, error: error === undefined ? null : String(error) }, { value: "completed", error: null }, "cleanup cannot mask callback success"); assert.throws(() => ledger.updateReleaseUnitSelection("repo:test", "a", 0), /already in progress/i);
    await rm(stale, { recursive: true }); stale = ""; error = undefined;
    try { await ledger.withReleaseUnitLock("repo:test", async (lock) => { stale = lock.key; await rm(stale); await mkdir(stale); throw new Error("callback sentinel"); }); } catch (caught) { error = caught; }
    assert.match(String(error), /callback sentinel/, "cleanup cannot mask the original callback error"); assert.throws(() => ledger.updateReleaseUnitSelection("repo:test", "a", 0), /already in progress/i); assert.match(tokenEvidence, /frozen=true; forged result=Error: Release-unit selection or tagging is already in progress/);
  } finally { if (stale) await rm(stale, { recursive: true, force: true }); ledger.close(); await rm(root, { recursive: true, force: true }); }
}); test("configured authority ignores unrelated defects, then persists selected failure without reactivation", async () => {
  const fixture = await repository({ "a/package.json": '{"version":"1.0.0"}', "b/pyproject.toml": '[project]\nversion="2.0.0"\n', "broken/package.json": "{" });
  const filename = path.join(fixture.root, "ledger.db"); let ledger = new Ledger(filename);
  try {
    register(ledger, fixture.root); const api = ledger as any; api.updateReleaseUnitSelection("repo:test", "a", 0);
    let authority: any = await new DeliveryService(ledger).versionAuthorityAtCommit(fixture.root, fixture.commit, "repo:test");
    assert.deepEqual({ state: authority.state, cwd: authority.cwd, reason: authority.reason, revision: authority.selection?.value?.revision }, { state: "declared", cwd: "a", reason: "configured-nested", revision: 1 });
    const worktree = `${fixture.root}-worktree`; await git(fixture.root, "worktree", "add", "--detach", worktree, fixture.commit);
    authority = await new DeliveryService(ledger).versionAuthorityAtCommit(worktree, fixture.commit, fixture.root);
    assert.equal(authority.reason, "configured-nested", "a path-like repository identity maps a delivery worktree to its registered primary path");
    await git(fixture.root, "worktree", "remove", "--force", worktree); await rm(path.join(fixture.root, "a"), { recursive: true, force: true });
    await git(fixture.root, "add", "-A"); await git(fixture.root, "commit", "-qm", "remove selected unit"); const missingCommit = await git(fixture.root, "rev-parse", "HEAD");
    const invalidate = api.invalidateReleaseUnitSelection.bind(ledger);
    api.invalidateReleaseUnitSelection = (id: string, revision: number) => { api.updateReleaseUnitSelection(id, "b", revision); throw new Error("simulated invalidation revision conflict"); };
    authority = await new DeliveryService(ledger).versionAuthorityAtCommit(fixture.root, missingCommit, "repo:test");
    assert.deepEqual({ state: authority.state, cwd: authority.cwd, revision: authority.selection?.value?.revision }, { state: "declared", cwd: "b", revision: 2 }, "one CAS conflict reloads and re-resolves against the new selection");
    api.invalidateReleaseUnitSelection = invalidate; await rm(path.join(fixture.root, "b"), { recursive: true, force: true });
    await git(fixture.root, "add", "-A"); await git(fixture.root, "commit", "-qm", "remove replacement selected unit");
    authority = await new DeliveryService(ledger).versionAuthorityAtCommit(fixture.root, await git(fixture.root, "rev-parse", "HEAD"), "repo:test");
    assert.equal(authority.state, "invalid"); assert.equal(authority.selection?.value?.state, "invalidated"); ledger.close(); ledger = new Ledger(filename);
    await mkdir(path.join(fixture.root, "a")); await writeFile(path.join(fixture.root, "a/package.json"), '{"version":"3.0.0"}');
    await git(fixture.root, "add", "."); await git(fixture.root, "commit", "-qm", "restore selected unit");
    authority = await new DeliveryService(ledger).versionAuthorityAtCommit(fixture.root, await git(fixture.root, "rev-parse", "HEAD"), "repo:test");
    assert.equal(authority.state, "invalid", "an invalidated selection never silently reactivates");
  } finally { ledger.close(); await rm(fixture.root, { recursive: true, force: true }); }
}); test("malformed selection fails closed", async () => {
  const fixture = await repository({ "package.json": '{"version":"9.0.0"}', "a/package.json": '{"version":"1.0.0"}', "b/package.json": '{"version":"1.0.0"}' });
  const ledger = new Ledger(path.join(fixture.root, "ledger.db"));
  try {
    register(ledger, fixture.root); (ledger as any).database.prepare("UPDATE repositories SET intelligence_json = ? WHERE id = ?").run(JSON.stringify({ releaseUnitSelection: { version: 99, cwd: "a" } }), "repo:test"); const service = new DeliveryService(ledger);
    const authority: any = await service.versionAuthorityAtCommit(fixture.root, fixture.commit, "repo:test");
    assert.deepEqual([authority.state, authority.selection?.kind], ["invalid", "malformed"]);
    const before = ledger.getRepository("repo:test")!.intelligence.releaseUnitSelection;
    await assert.rejects(() => service.selectReleaseUnit("repo:test", fixture.root, fixture.commit, "a", 0), /root release authority/i);
    assert.deepEqual(ledger.getRepository("repo:test")!.intelligence.releaseUnitSelection, before, "root conflict refuses before selection write");
  } finally { ledger.close(); await rm(fixture.root, { recursive: true, force: true }); }
}); test("selection decoding distinguishes absence, valid v1, malformed, and unknown data", () => {
  const active = { version: 1, cwd: "backend", state: "active", revision: 1, selectedAt: "2026-07-25T00:00:00.000Z", invalidatedAt: null, invalidationReason: null };
  assert.equal(decodeReleaseUnitSelection({}).kind, "absent"); assert.equal(decodeReleaseUnitSelection({ releaseUnitSelection: "literal malformed" }).kind, "malformed");
  assert.equal(decodeReleaseUnitSelection({ releaseUnitSelection: { version: 2 } }).kind, "malformed");
  for (const cwd of ["C:/outside", "bad\u0001cwd"]) assert.equal(decodeReleaseUnitSelection({ releaseUnitSelection: { ...active, cwd } }).kind, "malformed");
  assert.equal(decodeReleaseUnitSelection({ releaseUnitSelection: { ...active, selectedAt: "2026-07-25" } }).kind, "malformed"); assert.equal(decodeReleaseUnitSelection({ releaseUnitSelection: active }).kind, "valid");
});
