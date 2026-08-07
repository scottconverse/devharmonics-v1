import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  countDeclaredNodeTests,
  validateReadmeReleaseScope,
  validateRollbackGuide,
  validateSupportingDocumentReleaseScope,
  validateWorkflowPolicy,
} from "../dist/src/ci-harness.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const packageLock = JSON.parse(await readFile(path.join(root, "package-lock.json"), "utf8"));
const version = packageJson.version;
const releaseMode = process.argv.includes("--release");

const expectations = [
  ["src/product.ts", `VERSION = "${version}"`],
  ["README.md", `Latest tagged release: **v${version}**`],
  ["docs/USER_MANUAL.md", `Latest tagged release: **v${version}**`],
  ["docs/index.html", `data-product-version="${version}"`],
  ["docs/index.html", `href="USER_MANUAL.html">Manual`],
  ["docs/index.html", `href="USER_MANUAL.html">Read the user manual`],
  ["docs/USER_MANUAL.md", `](https://github.com/scottconverse/devharmonics-v1/blob/main/SECURITY.md)`],
  ["src/ui/index.html", `v${version}`],
  ["src/ui/index.html", `/app.css?v=${version}`],
  ["src/ui/index.html", `/app.js?v=${version}`],
  ["CHANGELOG.md", `## [${version}]`],
  ["docs/ARCHITECTURE.md", `Latest tagged release: **v${version}**`],
  ["docs/PRODUCT_SPEC.md", `Latest tagged implementation baseline: **DevHarmonics v${version}**`],
  ["docs/IMPLEMENTATION_PLAN.md", `Latest tagged implementation baseline: **DevHarmonics v${version}**`],
  ["CONTRIBUTING.md", `The latest tagged DevHarmonics release is **v${version}**.`],
  ["SECURITY.md", `latest tagged release, **v${version}**`],
  ["README.md", `[Contributing](CONTRIBUTING.md)`],
  // Release-truth guards added at the v0.6.0 gate: the rollback recipe's
  // from-schema pair and the README suite count drifted unnoticed because
  // this gate did not reach them. The pair below must be updated together
  // with any release that changes the prior tag or the ledger schema.
  ["docs/ROLLBACK.md", `backup-v26-to-v33`],
  ["docs/ROLLBACK.md", `Ledger schema 26 → 33`],
  // Release-truth guard added at the v0.6.1 gate (R4-001): the 0.6-line
  // "v0.6.1 -> v0.6.0" rollback section went stale the same way the v0.5.1
  // one did, claiming a no-restore downgrade across an actual 34->33 schema
  // change. This pair must be updated together with any release that moves
  // LEDGER_SCHEMA_VERSION or renames the prior-tag rollback target.
  ["docs/ROLLBACK.md", `backup-v33-to-v34`],
  ["docs/ROLLBACK.md", `Ledger schema 33 → 34`],
  // Development-line rollback truth after Slices B/C: a direct opening by
  // the schema-37 build creates one v34-to-v37 backup even though migrations
  // 35, 36, and 37 apply in order. Keep both the pairwise history and the
  // actual direct-upgrade backup name visible.
  ["docs/ROLLBACK.md", `Ledger schema 34 → 35`],
  ["docs/ROLLBACK.md", `Ledger schema 35 → 36`],
  ["docs/ROLLBACK.md", `Ledger schema 36 → 37`],
  ["docs/ROLLBACK.md", `Ledger schema 37 → 38`],
  ["docs/ROLLBACK.md", `backup-v34-to-v38`],
];

/**
 * The list above is a fixed history: each entry was added by hand at the
 * release that introduced it. That is why it silently stopped enforcing
 * anything — it reached "37 → 38" while LEDGER_SCHEMA_VERSION moved on to 40,
 * so migrations 39 and 40 shipped with no rollback instructions and this gate
 * still passed. A guard that looks like an invariant but is really a frozen
 * list is worse than no guard.
 *
 * This derives the requirement from the live constant instead: whatever the
 * current schema version is, ROLLBACK.md must document the step that arrives
 * at it. Bump the schema without documenting the step and the gate fails, this
 * release and every future one.
 */
async function requireCurrentSchemaDocumented(readSource) {
  const ledger = await readSource("src/ledger.ts");
  const declared = ledger.match(/export const LEDGER_SCHEMA_VERSION = (\d+);/);
  if (!declared) return ["src/ledger.ts: LEDGER_SCHEMA_VERSION could not be read, so rollback truth cannot be checked"];
  const current = Number(declared[1]);
  const rollback = await readSource("docs/ROLLBACK.md");
  // Accept either arrow form so the doc's existing style is not forced to change.
  const documented = new RegExp(`Ledger schema \\d+ (?:→|->) ${current}\\b`).test(rollback);
  return documented
    ? []
    : [`docs/ROLLBACK.md: no rollback step documented for ledger schema ${current}. `
      + `Add a "Ledger schema ${current - 1} → ${current}" entry describing what that migration changes `
      + `and what a downgrade loses.`];
}

const failures = [];
let checks = 1;

failures.push(...await requireCurrentSchemaDocumented((file) => readFile(path.join(root, file), "utf8")));
checks += 1;

for (const [file, marker] of expectations) {
  const contents = await readFile(path.join(root, file), "utf8");
  if (!contents.includes(marker)) failures.push(`${file}: missing ${JSON.stringify(marker)}`);
  checks += 1;
}

const lockVersion = packageLock.packages?.[""]?.version;
if (packageLock.version !== version || lockVersion !== version) {
  failures.push(`package-lock.json: expected root and package versions to both equal ${version}`);
}
checks += 1;

if (packageLock.packages?.[""]?.license !== packageJson.license) {
  failures.push(`package-lock.json: root package license must match package.json (${packageJson.license})`);
}
checks += 1;

const productSpec = await readFile(path.join(root, "docs/PRODUCT_SPEC.md"), "utf8");
const implementationPlan = await readFile(path.join(root, "docs/IMPLEMENTATION_PLAN.md"), "utf8");
const changelog = await readFile(path.join(root, "CHANGELOG.md"), "utf8");
const specificationVersion = productSpec.match(/Specification version: \*\*([^*]+)\*\*/)?.[1];
if (!specificationVersion) {
  failures.push("docs/PRODUCT_SPEC.md: missing canonical specification version");
} else if (!implementationPlan.includes(`Product specification baseline: **DevHarmonics Product Specification v${specificationVersion}**`)) {
  failures.push(`docs/IMPLEMENTATION_PLAN.md: product specification baseline must be v${specificationVersion}`);
}
checks += 1;

if (!changelog.includes(`[${version}]: https://github.com/scottconverse/devharmonics-v1/releases/tag/v${version}`)) {
  failures.push(`CHANGELOG.md: missing release link for v${version}`);
}
const unreleasedIndex = changelog.indexOf("## [Unreleased]");
const releaseIndex = changelog.indexOf(`## [${version}]`);
if (unreleasedIndex < 0 || releaseIndex < 0 || unreleasedIndex > releaseIndex) {
  failures.push(`CHANGELOG.md: Unreleased must precede the v${version} release section`);
}
checks += 1;

const expectedRepository = "git+https://github.com/scottconverse/devharmonics-v1.git";
if (
  packageJson.private !== true ||
  packageJson.license !== "Apache-2.0" ||
  packageJson.repository?.url !== expectedRepository ||
  packageJson.homepage !== "https://scottconverse.github.io/devharmonics-v1/" ||
  packageJson.bugs?.url !== "https://github.com/scottconverse/devharmonics-v1/issues"
) {
  failures.push("package.json: public repository coordinates or Apache-2.0 licensing metadata are inconsistent");
}
checks += 1;

if (!existsSync(path.join(root, "LICENSE"))) {
  failures.push("LICENSE: the Apache-2.0 license file is missing");
}
checks += 1;

if (process.argv.includes("--release")) {
  try {
    const tag = execFileSync("git", ["describe", "--tags", "--exact-match", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    if (tag !== `v${version}`) failures.push(`Git: expected exact release tag v${version}, found ${tag || "none"}`);
  } catch {
    failures.push(`Git: HEAD is not tagged v${version}`);
  }
  checks += 1;
}

// Truth-sourced declared-test census (R4-003 / UNIT1-AUD-001). Runtime totals
// differ by OS because the process-tree regressions deliberately declare
// mutually exclusive Windows and POSIX cases. Count every syntactic test,
// test.only, test.skip, and test.todo call across the source instead: the AST
// ignores comments/string examples and includes indented/conditional cases.
// README labels this number as declarations and explicitly explains the
// per-platform subset, so it cannot be mistaken for one run's TAP total.
{
  const testDir = path.join(root, "test");
  const testFiles = (await readdir(testDir)).filter((name) => name.endsWith(".test.ts"));
  let declared = 0;
  for (const file of testFiles) {
    const contents = await readFile(path.join(testDir, file), "utf8");
    declared += countDeclaredNodeTests(contents, file);
  }
  const readme = await readFile(path.join(root, "README.md"), "utf8");
  const claimed = readme.match(/(\d+) declared cross-platform test cases/);
  if (!claimed) {
    failures.push("README.md: missing the declared cross-platform test-case census");
  } else if (Number(claimed[1]) !== declared) {
    failures.push(`README.md: claims ${claimed[1]} declared cross-platform test cases, but the syntax-aware test/*.test.ts census is ${declared}`);
  }
  checks += 1;
}

{
  const [workflow, readme, userManual, architecture, rollback] = await Promise.all([
    readFile(path.join(root, ".github/workflows/ci.yml"), "utf8"),
    readFile(path.join(root, "README.md"), "utf8"),
    readFile(path.join(root, "docs/USER_MANUAL.md"), "utf8"),
    readFile(path.join(root, "docs/ARCHITECTURE.md"), "utf8"),
    readFile(path.join(root, "docs/ROLLBACK.md"), "utf8"),
  ]);
  failures.push(...validateWorkflowPolicy(workflow).map((failure) => `.github/workflows/ci.yml: ${failure}`));
  failures.push(...validateReadmeReleaseScope(readme, version, releaseMode ? "release" : "development").map((failure) => `README.md: ${failure}`));
  failures.push(
    ...validateSupportingDocumentReleaseScope(
      userManual,
      version,
      "Manual target",
      releaseMode ? "release" : "development",
    ).map((failure) => `docs/USER_MANUAL.md: ${failure}`),
  );
  failures.push(
    ...validateSupportingDocumentReleaseScope(
      architecture,
      version,
      "Architecture snapshot",
      releaseMode ? "release" : "development",
    ).map((failure) => `docs/ARCHITECTURE.md: ${failure}`),
  );
  failures.push(...validateRollbackGuide(rollback).map((failure) => `docs/ROLLBACK.md: ${failure}`));
  checks += 5;
}

if (failures.length) {
  console.error(`Version ${version} is inconsistent:\n${failures.join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(`Version ${version} is consistent across ${checks} release surfaces.`);
}
