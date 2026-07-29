import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { chromium } from "playwright";

import { defaultConfig, devHarmonicsDirectory, initializeProject } from "../dist/src/config.js";
import { Ledger } from "../dist/src/ledger.js";
import { startDashboard } from "../dist/src/server.js";

const execFileAsync = promisify(execFile);

async function git(repository, ...args) {
  await execFileAsync("git", ["-C", repository, ...args], { windowsHide: true });
}

async function createRepositoryFixture(directory, files) {
  await mkdir(directory, { recursive: true });
  await execFileAsync("git", ["init", "--initial-branch=main", directory], { windowsHide: true });
  await git(directory, "config", "user.email", "dependency-browser@example.invalid");
  await git(directory, "config", "user.name", "Dependency Browser Test");
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(directory, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
  await git(directory, "add", ".");
  await git(directory, "commit", "-m", "Create dependency browser fixture");
  return (await execFileAsync("git", ["-C", directory, "rev-parse", "HEAD"], { windowsHide: true })).stdout.trim();
}

async function json(response) {
  const body = await response.json();
  assert.ok(response.ok(), `${response.url()} returned ${response.status()}: ${JSON.stringify(body)}`);
  return body;
}

test("validator allowlist works through the real dashboard at mobile and desktop widths", { timeout: 90_000 }, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharmonics-validator-browser-"));
  const repository = path.join(root, "fixture");
  await execFileAsync("git", ["init", "--initial-branch=main", repository], { windowsHide: true });
  await git(repository, "config", "user.email", "validator-browser@example.invalid");
  await git(repository, "config", "user.name", "Validator Browser Test");
  await writeFile(
    path.join(repository, "package.json"),
    `${JSON.stringify({ name: "validator-browser-fixture", private: true, scripts: { test: "node --test" } }, null, 2)}\n`,
    "utf8",
  );
  await git(repository, "add", "package.json");
  await git(repository, "commit", "-m", "Create browser fixture");

  const dashboard = await startDashboard({ projectPath: repository, port: 0, open: false });
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    await dashboard.close();
    await rm(root, { recursive: true, force: true });
  });

  const setupContext = await browser.newContext();
  const setupRequest = setupContext.request;
  const productResponse = await setupRequest.post(`${dashboard.url}/api/products`, {
    data: {
      id: "browser-fixture",
      name: "Browser Fixture",
      organizationUrl: "https://example.invalid/browser-fixture",
      description: "Real Chromium validator journey",
      repositories: [],
    },
  });
  assert.equal(productResponse.status(), 201, await productResponse.text());
  const attachment = await json(await setupRequest.post(`${dashboard.url}/api/products/browser-fixture/repositories`, {
    data: {
      localPath: repository,
      role: "module",
      expectedBranch: "main",
      owners: ["browser-test"],
      dependencyRepositoryIds: [],
      governanceSources: [],
      validators: {},
    },
  }));
  const repositoryId = attachment.repository.id;
  const validatorPath = `/api/products/browser-fixture/repositories/${encodeURIComponent(repositoryId)}/validators`;
  const validatorUrl = `${dashboard.url}${validatorPath}`;
  await setupContext.close();

  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const errorResponses = [];
  const validatorRequests = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) errorResponses.push({ status: response.status(), url: response.url() });
  });
  page.on("request", (request) => {
    if (request.url().startsWith(validatorUrl)) {
      validatorRequests.push({
        method: request.method(),
        url: request.url(),
        body: request.postDataJSON?.() ?? null,
      });
    }
  });

  await page.goto(dashboard.url, { waitUntil: "domcontentloaded" });
  await assert.doesNotReject(() => page.getByRole("button", { name: "Products", exact: true }).waitFor());
  const productList = page.locator("#product-list");
  const renderVersion = async () => Number(await productList.getAttribute("data-render-version") || 0);
  await page.waitForFunction(() => Number(document.querySelector("#product-list")?.dataset.renderVersion || 0) > 0);
  let beforeRender = await renderVersion();
  await page.getByRole("button", { name: "Products", exact: true }).click();
  await page.waitForFunction((before) => Number(document.querySelector("#product-list")?.dataset.renderVersion || 0) > before, beforeRender);
  const allowlist = page.locator(`[data-validator-disclosure][data-repository-id="${repositoryId}"]`);
  const waitForCompletedRender = async (before, action, name = null) => {
    await page.waitForFunction(
      ({ before, repositoryId, action, name }) => {
        const list = document.querySelector("#product-list");
        const disclosure = document.querySelector(`[data-validator-disclosure][data-repository-id="${CSS.escape(repositoryId)}"]`);
        const selector = `[data-validator-action="${CSS.escape(action)}"][data-repository-id="${CSS.escape(repositoryId)}"]${name ? `[data-validator-name="${CSS.escape(name)}"]` : ""}`;
        const successor = document.querySelector(selector);
        return Number(list?.dataset.renderVersion || 0) > before
          && disclosure?.open === true
          && successor === document.activeElement;
      },
      { before, repositoryId, action, name },
    );
  };
  const openAllowlist = async () => {
    await allowlist.evaluate((details) => {
      details.open = true;
    });
  };
  const manualEditorForRepository = async () => {
    const editor = allowlist.locator("[data-validator-editor]");
    assert.equal(await editor.count(), 1, "the manual validator editor must be unique within the target repository allowlist");
    return editor;
  };
  await assert.doesNotReject(() => allowlist.waitFor({ state: "visible" }));
  await openAllowlist();
  const initialTestValidator = allowlist
    .locator('.validator-entry:has([data-validator-name="test"])')
    .getByText("test", { exact: true });
  assert.equal(await initialTestValidator.count(), 1, "the initial test validator locator must be unique");
  assert.equal(await initialTestValidator.isVisible(), true, "the initial test validator must be visible");
  await assert.doesNotReject(() => page.getByText("Detected from package.json").waitFor());

  beforeRender = await renderVersion();
  await page.getByRole("button", { name: "Add manual validator" }).click();
  await waitForCompletedRender(beforeRender, "save-editor");
  let manualEditor = await manualEditorForRepository();
  await manualEditor.locator("[data-validator-editor-name]").fill("manual-check");
  await manualEditor.locator("[data-validator-editor-command]").fill("node");
  await manualEditor.locator("[data-validator-argument]").nth(0).fill("manual.js");
  await manualEditor.locator("[data-validator-editor-timeout]").fill("30");
  await manualEditor.locator("[data-validator-editor-cwd]").fill("tools");
  beforeRender = await renderVersion();
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/manual-check/override") && response.request().method() === "PUT"),
    manualEditor.getByRole("button", { name: "Save manual validator" }).click(),
  ]);
  await waitForCompletedRender(beforeRender, "edit-override", "manual-check");

  beforeRender = await renderVersion();
  await page.getByRole("button", { name: "Edit manual validator manual-check" }).click();
  await waitForCompletedRender(beforeRender, "save-editor");
  manualEditor = await manualEditorForRepository();
  assert.equal(await manualEditor.locator("[data-validator-editor-name]").inputValue(), "manual-check");
  assert.equal(await manualEditor.locator("[data-validator-editor-command]").inputValue(), "node");
  assert.equal(await manualEditor.locator("[data-validator-argument]").nth(0).inputValue(), "manual.js");
  assert.equal(await manualEditor.locator("[data-validator-editor-timeout]").inputValue(), "30");
  assert.equal(await manualEditor.locator("[data-validator-editor-cwd]").inputValue(), "tools");
  await manualEditor.locator("[data-validator-editor-command]").fill("node-cancelled");
  beforeRender = await renderVersion();
  await manualEditor.getByRole("button", { name: "Cancel" }).click();
  await waitForCompletedRender(beforeRender, "edit-override", "manual-check");
  const afterCancel = await (await context.request.get(validatorUrl)).json();
  assert.equal(afterCancel.effectiveValidators["manual-check"].command, "node", "Cancel is non-destructive");

  beforeRender = await renderVersion();
  await page.getByRole("button", { name: "Edit manual validator manual-check" }).click();
  await waitForCompletedRender(beforeRender, "save-editor");
  manualEditor = await manualEditorForRepository();
  await manualEditor.locator("[data-validator-editor-command]").fill("node");
  let releaseValidatorGet;
  const validatorGetHeld = new Promise((resolve) => {
    releaseValidatorGet = resolve;
  });
  let validatorGetReached;
  const validatorGetReachedPromise = new Promise((resolve) => {
    validatorGetReached = resolve;
  });
  let gateValidatorGet = true;
  const validatorGetRoute = async (route) => {
    if (gateValidatorGet && route.request().method() === "GET") {
      validatorGetReached();
      await validatorGetHeld;
    }
    await route.continue();
  };
  await page.route(validatorUrl, validatorGetRoute);
  beforeRender = await renderVersion();
  const refreshPortfolio = page.getByRole("button", { name: "Products", exact: true }).click();
  await validatorGetReachedPromise;
  await manualEditor.locator("[data-validator-argument]").nth(0).fill("manual-updated.js");
  await manualEditor.locator("[data-validator-editor-timeout]").fill("45");
  releaseValidatorGet();
  await refreshPortfolio;
  await page.waitForFunction((before) => Number(document.querySelector("#product-list")?.dataset.renderVersion || 0) > before, beforeRender);
  gateValidatorGet = false;
  await page.unroute(validatorUrl, validatorGetRoute);
  manualEditor = await manualEditorForRepository();
  assert.equal(await manualEditor.locator("[data-validator-editor-name]").inputValue(), "manual-check", "the validator name draft must survive refresh");
  assert.equal(await manualEditor.locator("[data-validator-editor-command]").inputValue(), "node", "the validator command draft must survive refresh");
  assert.equal(await manualEditor.locator("[data-validator-argument]").nth(0).inputValue(), "manual-updated.js", "the validator argument draft must survive refresh");
  assert.equal(await manualEditor.locator("[data-validator-editor-timeout]").inputValue(), "45", "the validator timeout draft must survive refresh");
  assert.equal(await manualEditor.locator("[data-validator-editor-cwd]").inputValue(), "tools", "the validator cwd draft must survive refresh");
  beforeRender = await renderVersion();
  const [secondManualPut] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/manual-check/override") && response.request().method() === "PUT"),
    manualEditor.getByRole("button", { name: "Save manual validator" }).click(),
  ]);
  const secondManualPutBody = secondManualPut.request().postDataJSON();
  const secondManualPutResponse = await json(secondManualPut);
  await waitForCompletedRender(beforeRender, "edit-override", "manual-check");
  assert.match(secondManualPutBody.baseStateFingerprint, /^[a-f0-9]{64}$/);
  assert.deepEqual(secondManualPutBody.validator, {
    command: "node",
    args: ["manual-updated.js"],
    timeoutMs: 45_000,
    cwd: "tools",
  });
  assert.deepEqual(secondManualPutResponse.effectiveValidators["manual-check"], secondManualPutBody.validator);
  const afterEdit = await (await context.request.get(validatorUrl)).json();
  assert.deepEqual(afterEdit.effectiveValidators["manual-check"], {
    command: "node",
    args: ["manual-updated.js"],
    timeoutMs: 45_000,
    cwd: "tools",
  });

  await page.getByRole("button", { name: "Override validator test" }).click();
  const editor = allowlist.locator("[data-validator-editor]");
  await assert.doesNotReject(() => editor.waitFor({ state: "visible" }));
  assert.equal(await editor.count(), 1, "the test validator editor must be unique within the target repository allowlist");
  await editor.locator("[data-validator-editor-command]").fill("node");
  await editor.locator("[data-validator-argument]").nth(0).fill("--test");
  await editor.locator("[data-validator-argument]").nth(1).fill("--watch");
  await editor.locator("[data-validator-editor-timeout]").fill("600");
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/test/override") && response.request().method() === "PUT"),
    editor.getByRole("button", { name: "Save manual validator" }).click(),
  ]);
  await editor.waitFor({ state: "detached" });
  assert.equal(await allowlist.getAttribute("open"), "");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-validator-action")), "edit-override");
  await assert.doesNotReject(() => page.getByText("manual override", { exact: true }).first().waitFor());
  const overridePut = validatorRequests.find((request) => request.method === "PUT" && request.url.endsWith("/test/override"));
  assert.match(overridePut?.body?.baseStateFingerprint ?? "", /^[a-f0-9]{64}$/);
  assert.deepEqual(
    {
      method: overridePut?.method,
      validator: overridePut?.body?.validator,
    },
    {
      method: "PUT",
      validator: { command: "node", args: ["--test", "--watch"], timeoutMs: 600_000 },
    },
  );

  const removeTestOverride = page.getByRole("button", { name: "Remove manual override test" });
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/test/override") && response.request().method() === "DELETE"),
    removeTestOverride.click(),
  ]);
  await removeTestOverride.waitFor({ state: "detached" });
  assert.equal(await allowlist.getAttribute("open"), "");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-validator-action")), "override");
  await assert.doesNotReject(() => page.getByText("discovered", { exact: true }).waitFor());
  assert.ok(validatorRequests.some((request) => request.method === "DELETE" && request.url.endsWith("/test/override")));

  await mkdir(path.join(repository, "frontend", "&quot;ui"), { recursive: true });
  await writeFile(path.join(repository, "frontend", "&quot;ui", "package.json"), `${JSON.stringify({ private: true, scripts: { build: "tsc" } }, null, 2)}\n`, "utf8");
  await git(repository, "add", "frontend/&quot;ui/package.json");
  await git(repository, "commit", "-m", "Add nested browser validator");
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/rescan-preview") && response.request().method() === "POST"),
    page.getByRole("button", { name: "Preview validator rescan" }).click(),
  ]);
  const apply = page.getByRole("button", { name: "Apply these validator changes" });
  await assert.doesNotReject(() => apply.waitFor({ state: "visible" }));
  await assert.doesNotReject(() => page.getByText(/frontend\/&quot;ui\/package\.json/).waitFor());
  await assert.doesNotReject(() => page.getByText(/Runs inside frontend\/&quot;ui/).waitFor());
  assert.equal(await allowlist.locator("a").count(), 0, "nested provenance is escaped, not parsed as markup");
  assert.equal(await page.locator(".validator-allowlist").getAttribute("open"), "");
  assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), "Apply these validator changes");
  beforeRender = await renderVersion();
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/rescan-apply") && response.request().method() === "POST"),
    apply.click(),
  ]);
  await waitForCompletedRender(beforeRender, "preview-rescan");
  await page.getByText("build", { exact: true }).waitFor({ state: "attached" });
  await assert.doesNotReject(() => page.getByText("build", { exact: true }).waitFor());
  await assert.doesNotReject(() => allowlist.getByText(/Detected from frontend\/&quot;ui\/package\.json/).waitFor());
  await assert.doesNotReject(() => allowlist.getByText(/Runs inside frontend\/&quot;ui/).waitFor());
  const rescanApply = validatorRequests.find((request) => request.method === "POST" && request.url.endsWith("/rescan-apply"));
  assert.match(rescanApply?.body?.previewToken ?? "", /^[a-f0-9-]{36}$/);
  assert.match(rescanApply?.body?.baseStateFingerprint ?? "", /^[a-f0-9]{64}$/);

  await writeFile(path.join(repository, "frontend", "&quot;ui", "package.json"), `${JSON.stringify({ private: true, scripts: { build: "tsc", lint: "eslint ." } }, null, 2)}\n`, "utf8");
  await git(repository, "add", "frontend/&quot;ui/package.json");
  await git(repository, "commit", "-m", "Add nested lint validator");
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/rescan-preview") && response.request().method() === "POST"),
    page.getByRole("button", { name: "Preview validator rescan" }).click(),
  ]);
  const staleApply = page.getByRole("button", { name: "Apply these validator changes" });
  await staleApply.waitFor({ state: "visible" });
  const staleFingerprint = (await (await context.request.get(validatorUrl)).json()).stateFingerprint;
  const externalMutation = await context.request.put(`${validatorUrl}/external/override`, {
    data: {
      baseStateFingerprint: staleFingerprint,
      validator: { command: "node", args: ["external.js"], timeoutMs: 1_000 },
    },
  });
  assert.equal(externalMutation.status(), 200, await externalMutation.text());
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/rescan-apply") && response.status() === 409),
    staleApply.click(),
  ]);
  const localAlert = page.locator(`[data-validator-error-for="${repositoryId}"]`);
  await assert.doesNotReject(() => localAlert.waitFor({ state: "attached" }));
  await assert.doesNotReject(() => localAlert.getByText(/preview is stale/i).waitFor());
  assert.equal(await page.evaluate((id) => document.activeElement?.getAttribute("data-validator-error-for") === id, repositoryId), true);
  const previewAgain = localAlert.getByRole("button", { name: "Preview again" });
  assert.equal(await previewAgain.isVisible(), true);
  assert.ok(await previewAgain.evaluate((button) => button.getBoundingClientRect().height >= 44), "rendered stale Preview again control is at least 44px tall");
  assert.equal(await allowlist.getAttribute("open"), "");
  assert.ok(validatorRequests.some((request) => request.method === "POST" && request.url.endsWith("/rescan-apply")));

  await page.getByRole("button", { name: "Products", exact: true }).click();
  await openAllowlist();
  for (const name of ["build", "test"]) {
    const remove = page.getByRole("button", { name: `Remove validator ${name}` });
    beforeRender = await renderVersion();
    await Promise.all([
      page.waitForResponse((response) => response.url().endsWith(`/${name}/suppression`) && response.status() === 200),
      remove.click(),
    ]);
    await waitForCompletedRender(beforeRender, "restore", name);
  }
  const restoreBuild = page.getByRole("button", { name: "Restore validator build to the executable allowlist" });
  beforeRender = await renderVersion();
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/build/suppression") && response.request().method() === "DELETE"),
    restoreBuild.click(),
  ]);
  await waitForCompletedRender(beforeRender, "suppress", "build");
  const suppressBuildAgain = page.getByRole("button", { name: "Remove validator build" });
  beforeRender = await renderVersion();
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/build/suppression") && response.request().method() === "PUT" && response.status() === 200),
    suppressBuildAgain.click(),
  ]);
  await waitForCompletedRender(beforeRender, "restore", "build");
  const removeManualCheck = page.getByRole("button", { name: "Remove manual override manual-check" });
  beforeRender = await renderVersion();
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/manual-check/override") && response.request().method() === "DELETE"),
    removeManualCheck.click(),
  ]);
  await waitForCompletedRender(beforeRender, "add-override");
  const removeExternal = page.getByRole("button", { name: "Remove manual override external" });
  beforeRender = await renderVersion();
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/external/override") && response.request().method() === "DELETE"),
    removeExternal.click(),
  ]);
  await waitForCompletedRender(beforeRender, "add-override");
  await assert.doesNotReject(() => allowlist.locator("summary").getByText("0 executable", { exact: true }).waitFor());
  const zeroState = await (await context.request.get(validatorUrl)).json();
  assert.deepEqual(zeroState.effectiveValidators, {});

  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await allowlist.scrollIntoViewIfNeeded();
    const geometry = await page.evaluate(() => {
      const controls = [...document.querySelectorAll(".validator-allowlist button, .validator-allowlist summary")];
      return {
        overflowing: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        shortControls: controls
          .map((control) => ({ text: control.textContent?.trim(), height: control.getBoundingClientRect().height }))
          .filter((control) => control.height < 44),
      };
    });
    assert.equal(geometry.overflowing, false, `${width}px viewport must not scroll horizontally`);
    assert.deepEqual(geometry.shortControls, [], `${width}px validator controls must be at least 44px tall`);
  }

  const unexpectedResponses = errorResponses.filter(({ status, url }) => !(
    (status === 404 && url === `${dashboard.url}/api/products/browser-fixture/intelligence`)
    || (status === 409 && url === `${validatorUrl}/rescan-apply`)
  ));
  const resourceConsoleStatuses = consoleErrors.map((message) => {
    const match = /^Failed to load resource: the server responded with a status of (404|409) \((?:Not Found|Conflict)\)$/.exec(message);
    return match ? Number(match[1]) : null;
  });
  const unexpectedConsoleErrors = consoleErrors.filter((_message, index) => resourceConsoleStatuses[index] === null);
  assert.deepEqual(unexpectedResponses, []);
  assert.deepEqual(
    resourceConsoleStatuses.filter((status) => status !== null).sort(),
    errorResponses.map((response) => response.status).sort(),
    "every tolerated resource-console message must correspond one-for-one with an exact expected HTTP response",
  );
  assert.deepEqual(unexpectedConsoleErrors, []);
  assert.deepEqual(pageErrors, []);
  await context.close();
});

test("dependency evidence is honest, complete, escaped, and safely rescannable in real Chromium", { timeout: 90_000 }, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharmonics-dependency-browser-"));
  const control = path.join(root, "control");
  const hostileDeclaration = "https://example.invalid/archive.tgz?</code><img src=x onerror=\"document.body.dataset.dependencyXss='executed'\">";
  await createRepositoryFixture(control, { "README.md": "# Dependency browser control\n" });
  await initializeProject(control);

  const legacyLedger = new Ledger(path.join(devHarmonicsDirectory(control), "devharmonics.db"));
  legacyLedger.upsertProduct({
    id: "legacy-dependencies",
    name: "Legacy Dependency Snapshot",
    organizationUrl: "https://example.invalid/legacy-dependencies",
    description: "Snapshot created before dependency evidence existed",
    repositories: [],
  });
  legacyLedger.recordProductIntelligenceSnapshot({
    id: "legacy-dependency-snapshot",
    productId: "legacy-dependencies",
    status: "ready",
    repositories: [],
    sources: [],
    claims: [],
    findings: [],
    createdAt: "2026-07-26T00:00:00.000Z",
  });
  legacyLedger.close();

  const fixtures = {
    detected: {
      "package.json": `${JSON.stringify({
        name: "shared",
        dependencies: {
          shared: "1.0.0",
          duplicate: "1.0.0",
          remote: hostileDeclaration,
        },
        devDependencies: { "dev-only": "^2.0.0" },
      }, null, 2)}\n`,
    },
    duplicate: {
      "package.json": `${JSON.stringify({ name: "duplicate" }, null, 2)}\n`,
      "packages/second/package.json": `${JSON.stringify({ name: "duplicate" }, null, 2)}\n`,
    },
    absent: { "package.json": `${JSON.stringify({ name: "no-declarations" }, null, 2)}\n` },
    unsupported: { "pyproject.toml": '[project]\nname = "unsupported"\ndependencies = ["-r requirements.txt"]\n' },
    malformed: { "package.json": "{\n" },
    wrong_shape: { "package.json": `${JSON.stringify({ name: "wrong-shape", dependencies: [] }, null, 2)}\n` },
    dynamic: { "pyproject.toml": '[project]\nname = "dynamic"\ndynamic = ["dependencies"]\n' },
    unavailable: { "package.json": `${JSON.stringify({ name: "unavailable" }, null, 2)}\n` },
  };
  const paths = {};
  for (const [state, files] of Object.entries(fixtures)) {
    paths[state] = path.join(root, state);
    await createRepositoryFixture(paths[state], files);
  }

  const dashboard = await startDashboard({ projectPath: control, port: 0, open: false });
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    await dashboard.close();
    await rm(root, { recursive: true, force: true });
  });

  const setupContext = await browser.newContext();
  const setupRequest = setupContext.request;
  const product = await setupRequest.post(`${dashboard.url}/api/products`, {
    data: {
      id: "dependency-states",
      name: "Dependency State Fixture",
      organizationUrl: "https://example.invalid/dependency-states",
      description: "Exact dependency evidence across every retained state",
      repositories: [],
    },
  });
  assert.equal(product.status(), 201, await product.text());
  const repositoryIds = {};
  for (const [state, localPath] of Object.entries(paths)) {
    const attachment = await json(await setupRequest.post(`${dashboard.url}/api/products/dependency-states/repositories`, {
      data: {
        localPath,
        role: "module",
        expectedBranch: "main",
        owners: ["browser-test"],
        dependencyRepositoryIds: [],
        governanceSources: [],
        validators: {},
      },
    }));
    repositoryIds[state] = attachment.repository.id;
  }
  await writeFile(path.join(paths.unavailable, ".git", "refs", "heads", "main"), `${"f".repeat(40)}\n`, "utf8");
  const scan = await setupRequest.post(`${dashboard.url}/api/products/dependency-states/intelligence`, { data: {} });
  assert.equal(scan.status(), 201, await scan.text());
  await setupContext.close();

  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const errorResponses = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) errorResponses.push({ status: response.status(), url: response.url() });
  });

  await page.goto(dashboard.url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Number(document.querySelector("#product-list")?.dataset.renderVersion || 0) > 0);
  const beforeProductsRender = Number(await page.locator("#product-list").getAttribute("data-render-version") || 0);
  await page.getByRole("button", { name: "Products", exact: true }).click();
  await page.waitForFunction(
    (before) => Number(document.querySelector("#product-list")?.dataset.renderVersion || 0) > before,
    beforeProductsRender,
  );
  const stateCard = page.locator("article.product-card").filter({ hasText: "Dependency State Fixture" });
  const intelligence = stateCard.locator("details.product-intelligence");
  await intelligence.evaluate((details) => { details.open = true; });
  const dependencyPanel = intelligence.locator(".dependency-intelligence");
  await dependencyPanel.getByText("Dependency evidence", { exact: true }).waitFor();

  for (const [state, label] of Object.entries({
    detected: "detected",
    duplicate: "absent",
    absent: "absent",
    unsupported: "unsupported",
    malformed: "malformed",
    wrong_shape: "wrong shape",
    dynamic: "dynamic",
    unavailable: "unavailable",
  })) {
    const summary = dependencyPanel.locator(`[data-dependency-repository="${repositoryIds[state]}"] > summary`);
    assert.match((await summary.textContent()) || "", new RegExp(label, "i"), `${state} repository renders its honest state`);
  }

  const detected = dependencyPanel.locator(`[data-dependency-repository="${repositoryIds.detected}"]`);
  await detected.evaluate((details) => { details.open = true; });
  const unique = detected.locator(".dependency-fact").filter({ hasText: "shared" }).first();
  const ambiguous = detected.locator(".dependency-fact").filter({ hasText: "duplicate" });
  const unresolved = detected.locator(".dependency-fact").filter({ hasText: "remote" });
  const development = detected.locator(".dependency-fact").filter({ hasText: "dev-only" });
  assert.match((await unique.textContent()) || "", /runtime.*exact: 1\.0\.0.*unique target/is);
  assert.match((await ambiguous.textContent()) || "", /ambiguous targets/is);
  assert.equal(await ambiguous.locator(".dependency-targets li").count(), 2, "two identities in one repository remain visibly ambiguous");
  assert.ok((await ambiguous.locator(".dependency-targets li").allTextContents()).every((text) => text.includes(repositoryIds.duplicate)));
  assert.match((await unresolved.textContent()) || "", new RegExp(`direct: ${hostileDeclaration.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*unresolved targets`, "is"));
  assert.equal(await unresolved.locator("a, img, script").count(), 0, "manifest-controlled direct references render as text, never links or markup");
  assert.equal(await page.locator("body").getAttribute("data-dependency-xss"), null, "hostile manifest text never executes");
  assert.match((await development.textContent()) || "", /development.*range: \^2\.0\.0/is);
  const declarationSource = unique.locator(".dependency-provenance").filter({ hasText: "Declaration source" });
  for (const label of ["commit", "blob", "path", "cwd", "locator"]) {
    await declarationSource.getByText(label, { exact: true }).waitFor();
  }

  const wrongShape = dependencyPanel.locator(`[data-dependency-repository="${repositoryIds.wrong_shape}"]`);
  await wrongShape.evaluate((details) => { details.open = true; });
  await wrongShape.getByText("Diagnostics", { exact: true }).waitFor();
  await wrongShape.getByText(/dependencies.*must be an object/i).waitFor();

  const rescan = dependencyPanel.getByRole("button", { name: "Rescan dependency evidence" });
  const beforeRescanRender = Number(await page.locator("#product-list").getAttribute("data-render-version") || 0);
  const rescanResponse = await Promise.all([
    page.waitForResponse((response) =>
      response.url().endsWith("/api/products/dependency-states/intelligence")
      && response.request().method() === "POST"
      && response.status() === 201),
    rescan.click(),
  ]);
  assert.equal(rescanResponse[0].status(), 201);
  await page.waitForFunction(
    (before) => Number(document.querySelector("#product-list")?.dataset.renderVersion || 0) > before,
    beforeRescanRender,
  );

  const legacyCard = page.locator("article.product-card").filter({ hasText: "Legacy Dependency Snapshot" });
  const legacyIntelligence = legacyCard.locator("details.product-intelligence");
  assert.equal(await legacyCard.count(), 1);
  assert.equal(await legacyIntelligence.count(), 1);
  await legacyIntelligence.locator(":scope > summary").click();
  const legacyPanel = legacyIntelligence.locator(".dependency-intelligence.legacy");
  await legacyPanel.getByText(/Legacy snapshot.*rescan required/i).waitFor();
  await legacyPanel.getByRole("button", { name: "Rescan dependency evidence" }).waitFor();

  const refreshedStateCard = page.locator("article.product-card").filter({ hasText: "Dependency State Fixture" });
  const refreshedIntelligence = refreshedStateCard.locator("details.product-intelligence");
  await refreshedIntelligence.evaluate((details) => { details.open = true; });
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await refreshedIntelligence.locator(".dependency-intelligence").scrollIntoViewIfNeeded();
    const geometry = await page.evaluate(() => ({
      overflowing: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      shortButtons: [...document.querySelectorAll(".dependency-intelligence button")]
        .map((button) => ({ text: button.textContent?.trim(), height: button.getBoundingClientRect().height }))
        .filter((button) => button.height < 44),
    }));
    assert.equal(geometry.overflowing, false, `${width}px dependency evidence must not cause horizontal scrolling`);
    assert.deepEqual(geometry.shortButtons, [], `${width}px dependency controls must be at least 44px tall`);
  }

  assert.deepEqual(errorResponses, []);
  assert.deepEqual(consoleErrors, []);
  assert.deepEqual(pageErrors, []);
  await context.close();
});

test("invalid immutable release authority is distinct and disables tagging in real Chromium", { timeout: 60_000 }, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharmonics-release-authority-browser-"));
  const repository = path.join(root, "fixture");
  await execFileAsync("git", ["init", "--initial-branch=main", repository], { windowsHide: true });
  await git(repository, "config", "user.email", "release-browser@example.invalid");
  await git(repository, "config", "user.name", "Release Browser Test");
  await writeFile(path.join(repository, "README.md"), "# Release fixture\n", "utf8");
  await git(repository, "add", "README.md");
  await git(repository, "commit", "-m", "Create release fixture");
  await initializeProject(repository);
  const config = structuredClone(defaultConfig);
  config.runPolicy.allowExternalWrites = true;
  await writeFile(path.join(devHarmonicsDirectory(repository), "config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");

  const ledger = new Ledger(path.join(devHarmonicsDirectory(repository), "devharmonics.db"));
  const runId = ledger.createRun("Show invalid release authority", repository);
  ledger.setRunStatus(runId, "running");
  ledger.setRunStatus(runId, "ready", "READY");
  ledger.prepareDeliveryRepository({
    runId,
    repositoryId: "repo:release-browser",
    localPath: repository,
    baseBranch: "main",
    baseCommit: "a".repeat(40),
    headCommit: "b".repeat(40),
    branch: "devharmonics/release-browser",
  });
  ledger.updateDeliveryRepository(runId, "repo:release-browser", {
    status: "merged",
    remoteUrl: "https://github.com/civicsuite/release-browser",
    pullRequestUrl: "https://github.com/civicsuite/release-browser/pull/1",
    mergeCommitOid: "c".repeat(40),
  });
  ledger.close();

  const runner = async (request) => {
    const result = { stdout: "", stderr: "", exitCode: 0, durationMs: 1, timedOut: false, treeKillUnconfirmed: false };
    if (request.command === "git" && request.args[0] === "cat-file" && request.args[1] === "-t") return { ...result, stdout: "commit\n" };
    if (request.command === "git" && request.args[0] === "ls-tree") {
      return { ...result, stdout: `100644 blob ${"d".repeat(40)}\tpackage.json\0` };
    }
    if (request.command === "git" && request.args.join(" ") === `cat-file blob ${"d".repeat(40)}`) {
      return { ...result, stdout: "{ malformed" };
    }
    return result;
  };
  const dashboard = await startDashboard({ projectPath: repository, port: 0, open: false, deliveryRunner: runner });
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    await dashboard.close();
    await rm(root, { recursive: true, force: true });
  });

  const page = await browser.newPage({ viewport: { width: 1024, height: 800 } });
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.goto(dashboard.url, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /Show invalid release authority/ }).click();
  const tagInput = page.locator('[data-tag-for="repo:release-browser"]');
  const tagButton = page.locator('[data-delivery-action="tag_release"][data-repository-id="repo:release-browser"]');
  const help = page.locator('[data-tag-help-for="repo:release-browser"]');
  await assert.doesNotReject(() => help.getByText(/package\.json is invalid/i).waitFor());
  assert.equal(await tagInput.isDisabled(), true);
  assert.equal(await tagInput.inputValue(), "");
  assert.equal(await tagButton.isDisabled(), true);
  assert.doesNotMatch(await help.textContent(), /no authoritative release version/i);
  assert.deepEqual(consoleErrors, []);
});

test("release-unit owner UI resolves ambiguity and repaired selections without unsafe shortcuts", { timeout: 60_000 }, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharmonics-release-unit-browser-"));
  const repository = path.join(root, "fixture");
  await execFileAsync("git", ["init", "--initial-branch=main", repository], { windowsHide: true });
  await git(repository, "config", "user.email", "release-unit-browser@example.invalid");
  await git(repository, "config", "user.name", "Release Unit Browser Test");
  await writeFile(path.join(repository, "README.md"), "# Release unit fixture\n", "utf8");
  await git(repository, "add", "README.md");
  await git(repository, "commit", "-m", "Create release unit fixture");
  await initializeProject(repository);
  const config = structuredClone(defaultConfig);
  config.runPolicy.allowExternalWrites = true;
  await writeFile(path.join(devHarmonicsDirectory(repository), "config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");

  const ledger = new Ledger(path.join(devHarmonicsDirectory(repository), "devharmonics.db"));
  const runId = ledger.createRun("Choose exact release authority", repository);
  ledger.setRunStatus(runId, "running");
  ledger.setRunStatus(runId, "ready", "READY");
  ledger.upsertProduct({ id: "product:release-unit-browser", name: "Release Unit Browser", organizationUrl: "https://example.invalid/release-unit", description: "fixture", repositories: [] });
  ledger.upsertRepository({
    id: "repo:release-unit-browser", productId: "product:release-unit-browser", name: "release-unit", fullName: "fixture/release-unit",
    url: "https://example.invalid/release-unit", cloneUrl: "https://example.invalid/release-unit.git", defaultBranch: "main",
    visibility: "private", archived: false, sizeKb: 0, language: null, description: null, intelligence: {}, localPath: repository,
    role: "release_truth", expectedBranch: "main", owners: [], dependencyRepositoryIds: [], validators: {}, governanceSources: [], governanceRules: [],
  });
  ledger.prepareDeliveryRepository({
    runId,
    repositoryId: "repo:release-unit-browser",
    localPath: repository,
    baseBranch: "main",
    baseCommit: "a".repeat(40),
    headCommit: "b".repeat(40),
    branch: "devharmonics/release-unit-browser",
  });
  const blobs = new Map([
    ["c".repeat(40), JSON.stringify({ name: "a", version: "1.2.3" })],
    ["d".repeat(40), "[project]\nname = \"b\"\nversion = \"2.0.0\"\n"],
    ["e".repeat(40), JSON.stringify({ name: "private", private: true })],
    ["f".repeat(40), JSON.stringify({ name: "root", version: "9.0.0" })],
  ]);
  let rootDeclared = false;
  let releaseAuthorityReady;
  const releaseAuthorityGate = new Promise((resolve) => { releaseAuthorityReady = resolve; });
  let holdInitialAuthorityRead = true;
  const runner = async (request) => {
    const result = { stdout: "", stderr: "", exitCode: 0, durationMs: 1, timedOut: false, treeKillUnconfirmed: false };
    if (request.command === "git" && request.args[0] === "cat-file" && request.args[1] === "-t") {
      if (holdInitialAuthorityRead) {
        holdInitialAuthorityRead = false;
        await releaseAuthorityGate;
      }
      return { ...result, stdout: "commit\n" };
    }
    if (request.command === "git" && request.args[0] === "ls-tree") {
      const entries = [
        `100644 blob ${"c".repeat(40)}\tapps/<a>/package.json`,
        `100644 blob ${"d".repeat(40)}\tpackages/b/pyproject.toml`,
        `100644 blob ${"e".repeat(40)}\ttools/private/package.json`,
        ...(rootDeclared ? [`100644 blob ${"f".repeat(40)}\tpackage.json`] : []),
      ];
      return { ...result, stdout: `${entries.join("\0")}\0` };
    }
    if (request.command === "git" && request.args[0] === "cat-file" && request.args[1] === "blob") {
      return { ...result, stdout: blobs.get(request.args[2]) };
    }
    return result;
  };
  const dashboard = await startDashboard({ projectPath: repository, port: 0, open: false, deliveryRunner: runner });
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    releaseAuthorityReady();
    await browser.close();
    await dashboard.close();
    ledger.close();
    await rm(root, { recursive: true, force: true });
  });
  const page = await browser.newPage({ viewport: { width: 1024, height: 900 } });
  const consoleErrors = [], pageErrors = [], errorResponses = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => { if (response.status() >= 400) errorResponses.push({ status: response.status(), url: response.url() }); });
  const selectorRequests = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/release-unit")) selectorRequests.push(request.postDataJSON());
  });

  await page.goto(dashboard.url, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /Choose exact release authority/ }).click();
  const card = page.locator('.delivery-repository-card:has([data-repository-id="repo:release-unit-browser"])');
  const completeDelivery = card.getByRole("button", { name: /Do everything at once/ });
  await completeDelivery.waitFor();
  assert.equal(await completeDelivery.isDisabled(), true, "delivery fails closed while immutable authority is still loading");
  releaseAuthorityReady();
  await card.getByRole("button", { name: "Select release unit apps/<a>" }).waitFor();
  assert.match(await card.textContent(), /Expected revision 0/);
  assert.match(await card.textContent(), /private package/);
  assert.equal(await card.locator("a").count(), 0, "authority values render as text, never hostile markup");
  assert.equal(await completeDelivery.isDisabled(), true);
  await card.getByRole("button", { name: "Select release unit apps/<a>" }).click();
  await card.getByText("Selected unit apps/<a>", { exact: true }).waitFor();
  assert.deepEqual(selectorRequests[0], { cwd: "apps/<a>", expectedRevision: 0, expectedHeadCommit: "b".repeat(40) });
  assert.match(await card.textContent(), /Source apps\/<a>\/package\.json/);
  assert.match(await card.textContent(), /Reason public static package version/);
  assert.match(await card.textContent(), /Excluded packages\/b: static PEP 621 version/);
  assert.equal(await completeDelivery.isDisabled(), false);

  ledger.invalidateReleaseUnitSelection("repo:release-unit-browser", 1, "selected release unit was repaired");
  await page.getByRole("button", { name: /Choose exact release authority/ }).click();
  await card.getByText(/Expected revision 2/).waitFor();
  await card.getByRole("button", { name: "Select release unit apps/<a>" }).click();
  await card.getByText("Selected unit apps/<a>", { exact: true }).waitFor();
  assert.deepEqual(selectorRequests[1], { cwd: "apps/<a>", expectedRevision: 2, expectedHeadCommit: "b".repeat(40) });

  rootDeclared = true;
  await page.getByRole("button", { name: /Choose exact release authority/ }).click();
  await card.getByText(/Repair required/).waitFor();
  assert.equal(await card.locator("[data-release-unit]").count(), 0);
  assert.equal(await card.getByRole("button", { name: /delete|clear selection/i }).count(), 0);
  assert.equal(await completeDelivery.isDisabled(), true);

  ledger.database.prepare("UPDATE repositories SET intelligence_json = ? WHERE id = ?")
    .run(JSON.stringify({ releaseUnitSelection: { version: 99, cwd: "apps/<a>" } }), "repo:release-unit-browser");
  rootDeclared = false;
  await page.getByRole("button", { name: /Choose exact release authority/ }).click();
  await card.getByText(/Repair required/).waitFor();
  assert.equal(await card.locator("[data-release-unit]").count(), 0);
  assert.equal(await card.getByRole("button", { name: /delete|clear selection/i }).count(), 0);
  assert.deepEqual(errorResponses, [{ status: 404, url: `${dashboard.url}/api/products/product%3Arelease-unit-browser/intelligence` }]);
  assert.deepEqual(consoleErrors, ["Failed to load resource: the server responded with a status of 404 (Not Found)"]);
  assert.deepEqual(pageErrors, []);
});
