import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { chromium } from "playwright";

import { startDashboard } from "../dist/src/server.js";

const execFileAsync = promisify(execFile);

async function git(repository, ...args) {
  await execFileAsync("git", ["-C", repository, ...args], { windowsHide: true });
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
  await page.getByRole("button", { name: "Products", exact: true }).click();
  const allowlist = page.locator(".validator-allowlist");
  const productList = page.locator("#product-list");
  const renderVersion = async () => Number(await productList.getAttribute("data-render-version") || 0);
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
  await assert.doesNotReject(() => allowlist.waitFor({ state: "visible" }));
  await openAllowlist();
  await assert.doesNotReject(() => page.getByText("test", { exact: true }).waitFor());
  await assert.doesNotReject(() => page.getByText("Detected from package.json").waitFor());

  let beforeRender = await renderVersion();
  await page.getByRole("button", { name: "Add manual validator" }).click();
  await waitForCompletedRender(beforeRender, "save-editor");
  let manualEditor = page.locator("[data-validator-editor]");
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
  manualEditor = page.locator("[data-validator-editor]");
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
  manualEditor = page.locator("[data-validator-editor]");
  await manualEditor.locator("[data-validator-editor-command]").fill("node");
  await manualEditor.locator("[data-validator-argument]").nth(0).fill("manual-updated.js");
  await manualEditor.locator("[data-validator-editor-timeout]").fill("45");
  beforeRender = await renderVersion();
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/manual-check/override") && response.request().method() === "PUT"),
    manualEditor.getByRole("button", { name: "Save manual validator" }).click(),
  ]);
  await waitForCompletedRender(beforeRender, "edit-override", "manual-check");
  const afterEdit = await (await context.request.get(validatorUrl)).json();
  assert.deepEqual(afterEdit.effectiveValidators["manual-check"], {
    command: "node",
    args: ["manual-updated.js"],
    timeoutMs: 45_000,
    cwd: "tools",
  });

  await page.getByRole("button", { name: "Override validator test" }).click();
  const editor = page.locator("[data-validator-editor]");
  await assert.doesNotReject(() => editor.waitFor({ state: "visible" }));
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

  await writeFile(
    path.join(repository, "package.json"),
    `${JSON.stringify({ name: "validator-browser-fixture", private: true, scripts: { build: "tsc", test: "node --test" } }, null, 2)}\n`,
    "utf8",
  );
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/rescan-preview") && response.request().method() === "POST"),
    page.getByRole("button", { name: "Preview validator rescan" }).click(),
  ]);
  const apply = page.getByRole("button", { name: "Apply these validator changes" });
  await assert.doesNotReject(() => apply.waitFor({ state: "visible" }));
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
  const rescanApply = validatorRequests.find((request) => request.method === "POST" && request.url.endsWith("/rescan-apply"));
  assert.match(rescanApply?.body?.previewToken ?? "", /^[a-f0-9-]{36}$/);
  assert.match(rescanApply?.body?.baseStateFingerprint ?? "", /^[a-f0-9]{64}$/);

  await writeFile(
    path.join(repository, "package.json"),
    `${JSON.stringify({ name: "validator-browser-fixture", private: true, scripts: { build: "tsc", lint: "eslint .", test: "node --test" } }, null, 2)}\n`,
    "utf8",
  );
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
