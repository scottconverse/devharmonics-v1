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
  const openAllowlist = async () => {
    await allowlist.evaluate((details) => {
      details.open = true;
    });
  };
  await assert.doesNotReject(() => allowlist.waitFor({ state: "visible" }));
  await openAllowlist();
  await assert.doesNotReject(() => page.getByText("test", { exact: true }).waitFor());
  await assert.doesNotReject(() => page.getByText("Detected from package.json").waitFor());

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
  await openAllowlist();
  await assert.doesNotReject(() => page.getByText("manual override", { exact: true }).waitFor());
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
  await openAllowlist();
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
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/rescan-apply") && response.request().method() === "POST"),
    apply.click(),
  ]);
  await apply.waitFor({ state: "detached" });
  await page.getByText("build", { exact: true }).waitFor({ state: "attached" });
  await openAllowlist();
  await assert.doesNotReject(() => page.getByText("build", { exact: true }).waitFor());
  const rescanApply = validatorRequests.find((request) => request.method === "POST" && request.url.endsWith("/rescan-apply"));
  assert.match(rescanApply?.body?.previewToken ?? "", /^[a-f0-9-]{36}$/);
  assert.match(rescanApply?.body?.baseStateFingerprint ?? "", /^[a-f0-9]{64}$/);

  const staleFingerprint = (await (await context.request.get(validatorUrl)).json()).stateFingerprint;
  const externalMutation = await context.request.put(`${validatorUrl}/external/override`, {
    data: {
      baseStateFingerprint: staleFingerprint,
      validator: { command: "node", args: ["external.js"], timeoutMs: 1_000 },
    },
  });
  assert.equal(externalMutation.status(), 200, await externalMutation.text());
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/build/suppression") && response.status() === 409),
    page.getByRole("button", { name: "Remove validator build" }).click(),
  ]);
  const localAlert = page.locator(`[data-validator-error-for="${repositoryId}"]`);
  await assert.doesNotReject(() => localAlert.waitFor({ state: "attached" }));
  await assert.doesNotReject(() => localAlert.getByText(/validator allowlist changed/i).waitFor());
  assert.equal(await page.evaluate((id) => document.activeElement?.getAttribute("data-validator-error-for") === id, repositoryId), true);
  assert.ok(validatorRequests.some((request) => request.method === "PUT" && request.url.endsWith("/build/suppression")));

  await page.getByRole("button", { name: "Products", exact: true }).click();
  await openAllowlist();
  for (const name of ["build", "test"]) {
    const remove = page.getByRole("button", { name: `Remove validator ${name}` });
    await Promise.all([
      page.waitForResponse((response) => response.url().endsWith(`/${name}/suppression`) && response.status() === 200),
      remove.click(),
    ]);
    await remove.waitFor({ state: "detached" });
    await openAllowlist();
  }
  const removeExternal = page.getByRole("button", { name: "Remove manual override external" });
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/external/override") && response.request().method() === "DELETE"),
    removeExternal.click(),
  ]);
  await removeExternal.waitFor({ state: "detached" });
  await openAllowlist();
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
    || (status === 409 && url === `${validatorUrl}/build/suppression`)
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
