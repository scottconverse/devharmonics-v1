import assert from "node:assert/strict"; import { execFile } from "node:child_process"; import { link, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os"; import path from "node:path"; import { promisify } from "node:util"; import test from "node:test"; import { DeliveryService } from "../src/delivery.js"; import { decodeReleaseUnitSelection, Ledger } from "../src/ledger.js";
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
    assert.deepEqual({ state: authority.state, version: authority.version, source: authority.source, cwd: authority.cwd, reason: authority.reason, units: authority.units.map((unit: any) => [unit.cwd, unit.state]) }, { state: "declared", version: "1.7.3", source: "backend/pyproject.toml", cwd: "backend", reason: "automatic-sole-nested", units: [["backend", "declared"], ["docs", "versionless"], ["frontend", "private"]] });
  } finally { ledger.close(); await rm(fixture.root, { recursive: true, force: true }); }
}); test("typed selector CAS is durable, race-safe, stale-safe, and reserved across metadata refresh", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dh-selector-ledger-")), filename = path.join(root, "ledger.db");
  let ledger = new Ledger(filename); try {
    const injected = { version: 1, cwd: "a", state: "active", revision: 1, selectedAt: "2026-07-25T00:00:00.000Z", invalidatedAt: null, invalidationReason: null };
    const original = register(ledger, root, { releaseUnitSelection: injected }); assert.equal(ledger.getRepository(original.id)?.intelligence.releaseUnitSelection, undefined, "repository insert cannot seed the reserved selector");
    ledger.upsertProduct({ id: "product:test", name: "Test", organizationUrl: "https://example.invalid/test", description: "refreshed", repositories: [{ ...original, intelligence: { releaseUnitSelection: injected } }, { ...original, id: "repo:product", name: "product", fullName: "test/product", intelligence: { releaseUnitSelection: injected } }] });
    assert.deepEqual(["repo:test", "repo:product"].map((id) => ledger.getRepository(id)?.intelligence.releaseUnitSelection), [undefined, undefined], "product refresh and separate insert cannot seed an absent selector"); const selected = ledger.updateReleaseUnitSelection("repo:test", "a", 0);
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
    for (const raw of [injected, null, "literal malformed", { version: 99, cwd: "a" }, [], true, 7]) { (ledger as any).database.prepare("UPDATE repositories SET intelligence_json = ? WHERE id = ?").run(JSON.stringify({ releaseUnitSelection: raw }), "repo:test");
      register(ledger, root, { releaseUnitSelection: injected }); assert.deepEqual(ledger.getRepository("repo:test")!.intelligence.releaseUnitSelection, raw, "repository refresh preserves existing raw selector");
      ledger.upsertProduct({ id: "product:test", name: "Test", organizationUrl: "https://example.invalid/test", description: "raw", repositories: [{ ...original, intelligence: { releaseUnitSelection: injected } }] }); assert.deepEqual(ledger.getRepository("repo:test")!.intelligence.releaseUnitSelection, raw, "product refresh preserves existing raw selector"); }
  } finally { ledger.close(); await rm(root, { recursive: true, force: true }); }
}); test("release lock binds canonical storage and ownership without masking callbacks", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dh-selector-lock-")), filename = path.join(root, "ledger.db"), hardlink = path.join(root, "hardlink.db"); const ledger = new Ledger(filename); let stale = "", diagnostics = 0, escaped: any, frozen = false, originalConsole = console.error;
  try { register(ledger, root); await link(filename, hardlink); let hardError: unknown; try { await ledger.withReleaseUnitLock("repo:hard", async () => undefined); } catch (caught) { hardError = caught; } await rm(hardlink);
    let forgedError: unknown; await ledger.withReleaseUnitLock("repo:other", async (lock) => { try { ledger.updateReleaseUnitSelection("repo:test", "a", 0, { ...lock, key: (ledger as any).releaseUnitLockKey("repo:test") }); } catch (caught) { forgedError = caught; } }); console.error = () => { diagnostics++; throw new Error("diagnostic sentinel"); };
    let value: unknown, cleanupError: unknown, obsoleteError: unknown; try { value = await ledger.withReleaseUnitLock("repo:test", async (lock) => { escaped = lock; frozen = Object.isFrozen(lock); stale = lock.key; await rm(stale); await writeFile(stale, "replacement"); try { ledger.updateReleaseUnitSelection("repo:test", "b", 1, lock); } catch (caught) { obsoleteError = caught; } return "completed"; }); } catch (caught) { cleanupError = caught; }
    const replacement = await readFile(stale, "utf8").catch((error) => String(error)); await rm(stale, { force: true }); stale = ""; let staleError: unknown; try { ledger.updateReleaseUnitSelection("repo:test", "b", 1, escaped); } catch (caught) { staleError = caught; }
    let originalError: unknown; try { await ledger.withReleaseUnitLock("repo:error", async (lock) => { stale = lock.key; await rm(stale); await writeFile(stale, "replacement-error"); throw new Error("callback sentinel"); }); } catch (caught) { originalError = caught; }
    const errorReplacement = await readFile(stale, "utf8").catch((error) => String(error)); await rm(stale, { force: true }); stale = ""; console.error = originalConsole;
    assert.deepEqual({ hardlink: /hard.?link/i.test(String(hardError)), forged: /already in progress/i.test(String(forgedError)), frozen, value, cleanupError: cleanupError ?? null, obsolete: /already in progress/i.test(String(obsoleteError)), replacement, diagnostics, original: /callback sentinel/.test(String(originalError)), errorReplacement, stale: /already in progress/i.test(String(staleError)) }, { hardlink: true, forged: true, frozen: true, value: "completed", cleanupError: null, obsolete: true, replacement: "replacement", diagnostics: 2, original: true, errorReplacement: "replacement-error", stale: true });
  } finally { console.error = originalConsole; if (stale) await rm(stale, { recursive: true, force: true }); ledger.close(); await rm(root, { recursive: true, force: true }); }
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
