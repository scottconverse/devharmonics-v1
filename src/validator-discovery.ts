import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, opendir, realpath } from "node:fs/promises";
import path from "node:path";
import { parseDocument } from "yaml";
import type { ValidatorConfig } from "./types.js";
import { isTomlRecord, ownTomlValue, parseTomlRecord } from "./toml.js";
import { inventoryManifestsAtCommit, type ProcessRunner } from "./release-units.js";
import { runProcess, type ProcessResult } from "./process.js";

const MANIFEST_LIMIT = 1024 * 1024;
const WORKFLOW_FILE_LIMIT = 512 * 1024;
const WORKFLOW_TOTAL_LIMIT = 4 * 1024 * 1024;
const WORKFLOW_COUNT_LIMIT = 64;
const WORKFLOW_DIRECTORY_ENTRY_LIMIT = 256;
const RELEASE_SCRIPT_LIMIT = 4 * 1024 * 1024;
const GENERATED_VALUE_LIMIT = 2_000;
const NPM_SCRIPTS = ["build", "lint", "test", "typecheck"] as const;

export type ValidatorRecipe =
  | { id: "npm-script"; script: (typeof NPM_SCRIPTS)[number] }
  | { id: "pytest" }
  | { id: "ruff" }
  | { id: "verify-release" };

export interface ValidatorDetectionSource {
  kind: "package_json_script" | "pyproject_table" | "release_script" | "workflow_recipe";
  path: string;
  evidence: string;
}

export interface DiscoveredValidator {
  name: string;
  recipe: ValidatorRecipe;
  config: ValidatorConfig;
  sources: ValidatorDetectionSource[];
}

export interface ValidatorDiscoverySignal {
  kind: "compose_test_evidence" | "workflow_setup_dependent";
  path: string;
  reason: string;
}

export interface ValidatorDiscoveryDiagnostic {
  source: string;
  code: "malformed" | "oversized" | "unsafe_path" | "limit_reached";
}

export interface ValidatorDiscoveryResult {
  validators: DiscoveredValidator[];
  signals: ValidatorDiscoverySignal[];
  diagnostics: ValidatorDiscoveryDiagnostic[];
  fingerprint: string;
}

export interface PersistedValidatorDiscovery {
  version: 1 | 2;
  headSha: string;
  scannedAt: string;
  fingerprint: string;
  validators: Record<string, { recipe: ValidatorRecipe; cwd?: string; sources: ValidatorDetectionSource[] }>;
  signals: ValidatorDiscoverySignal[];
  diagnostics: ValidatorDiscoveryDiagnostic[];
}
export type PersistedValidatorDiscoveryV1 = Omit<PersistedValidatorDiscovery, "version" | "validators">
  & { version: 1; validators: Record<string, { recipe: ValidatorRecipe; sources: ValidatorDetectionSource[] }> };
export type PersistedValidatorDiscoveryV2 = Omit<PersistedValidatorDiscovery, "version"> & { version: 2 };

export interface EffectiveValidatorEntry {
  name: string;
  discovered: PersistedValidatorDiscovery["validators"][string] | null;
  localConfig: ValidatorConfig | null;
  override: ValidatorConfig | null;
  suppressed: boolean;
  effectiveOrigin: "discovered" | "local_config" | "manual_override" | null;
  effectiveConfig: ValidatorConfig | null;
}

type Candidate = Omit<DiscoveredValidator, "sources"> & { source: ValidatorDetectionSource };

export function materializeValidatorRecipe(recipe: ValidatorRecipe, cwd?: string): ValidatorConfig {
  const location = cwd === undefined ? {} : { cwd };
  switch (recipe.id) {
    case "npm-script":
      return {
        command: "npm",
        args: ["run", recipe.script],
        timeoutMs: recipe.script === "test" ? 900_000 : 600_000,
        ...location,
      };
    case "pytest":
      return { command: "python", args: ["-m", "pytest"], timeoutMs: 900_000, ...location };
    case "ruff":
      return { command: "python", args: ["-m", "ruff", "check", "."], timeoutMs: 600_000, ...location };
    case "verify-release":
      return { command: "bash", args: ["scripts/verify-release.sh"], timeoutMs: 3_600_000, ...location };
  }
}

function candidate(
  name: string,
  recipe: ValidatorRecipe,
  kind: ValidatorDetectionSource["kind"],
  sourcePath: string,
  evidence: string,
  cwd?: string,
): Candidate {
  return {
    name,
    recipe,
    config: materializeValidatorRecipe(recipe, cwd),
    source: { kind, path: sourcePath, evidence },
  };
}

async function boundedRegularFile(
  root: string,
  relativePath: string,
  limit: number,
): Promise<{ text: string; digest: string; bytesRead: number } | { error: ValidatorDiscoveryDiagnostic["code"] } | null> {
  const absolute = path.join(root, ...relativePath.split("/"));
  let before: string;
  try {
    if ((await lstat(absolute)).isSymbolicLink()) return { error: "unsafe_path" };
    before = await realpath(absolute);
    const relative = path.relative(root, before);
    if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return { error: "unsafe_path" };
    const noFollow = constants.O_NOFOLLOW ?? 0;
    const handle = await open(absolute, constants.O_RDONLY | noFollow);
    try {
      const beforeStat = await handle.stat();
      if (!beforeStat.isFile()) return { error: "malformed" };
      if (beforeStat.size > limit) return { error: "oversized" };
      const chunks: Buffer[] = [];
      let bytesRead = 0;
      for (;;) {
        const remaining = limit + 1 - bytesRead;
        if (remaining <= 0) return { error: "oversized" };
        const chunk = Buffer.alloc(Math.min(64 * 1024, remaining));
        const read = await handle.read(chunk, 0, chunk.length, bytesRead);
        if (read.bytesRead === 0) break;
        chunks.push(chunk.subarray(0, read.bytesRead));
        bytesRead += read.bytesRead;
      }
      const afterStat = await handle.stat();
      const after = await realpath(absolute);
      if (
        after !== before
        || bytesRead !== beforeStat.size
        || afterStat.size !== beforeStat.size
        || afterStat.dev !== beforeStat.dev
        || afterStat.ino !== beforeStat.ino
        || afterStat.mtimeMs !== beforeStat.mtimeMs
        || afterStat.ctimeMs !== beforeStat.ctimeMs
      ) return { error: "unsafe_path" };
      const bytes = Buffer.concat(chunks, bytesRead);
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        return { error: "malformed" };
      }
      return {
        text,
        digest: createHash("sha256").update(bytes).digest("hex"),
        bytesRead,
      };
    } finally {
      await handle.close();
    }
  } catch (error) {
    const code = error instanceof Error && "code" in error
      ? (error as NodeJS.ErrnoException).code
      : undefined;
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    return { error: "malformed" };
  }
}

function packageCandidates(text: string, source = "package.json", cwd?: string): Candidate[] {
  const raw = JSON.parse(text) as unknown;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const scripts = (raw as { scripts?: unknown }).scripts;
  if (!scripts || typeof scripts !== "object" || Array.isArray(scripts)) return [];
  const values = scripts as Record<string, unknown>;
  return NPM_SCRIPTS.flatMap((name) => (
    typeof values[name] === "string" && values[name]!.trim().length > 0
      ? [candidate(name, { id: "npm-script", script: name }, "package_json_script", source, `supported-script:${name}`, cwd)]
      : []
  ));
}

function pyprojectCandidates(text: string, source = "pyproject.toml", cwd?: string): Candidate[] {
  const document = parseTomlRecord(source, text);
  const tool = ownTomlValue(document, "tool");
  const pytestTable = isTomlRecord(tool) ? ownTomlValue(tool, "pytest") : undefined;
  const ruffTable = isTomlRecord(tool) ? ownTomlValue(tool, "ruff") : undefined;
  const pytest = isTomlRecord(pytestTable) && isTomlRecord(ownTomlValue(pytestTable, "ini_options"));
  const ruff = isTomlRecord(ruffTable);
  return [
    ...(pytest
      ? [candidate("pytest", { id: "pytest" }, "pyproject_table", source, "tool.pytest.ini_options", cwd)]
      : []),
    ...(ruff
      ? [candidate("ruff", { id: "ruff" }, "pyproject_table", source, "tool.ruff", cwd)]
      : []),
  ];
}

function workflowCandidates(
  workflowPath: string,
  text: string,
): { candidates: Candidate[]; signals: ValidatorDiscoverySignal[] } {
  const document = parseDocument(text, {
    schema: "core",
    uniqueKeys: true,
  });
  if (document.errors.length > 0 || document.warnings.length > 0) {
    throw new Error("workflow must parse without errors or warnings");
  }
  const value = document.toJS({ maxAliasCount: 0 }) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) return { candidates: [], signals: [] };
  const jobs = (value as Record<string, unknown>).jobs;
  if (!jobs || typeof jobs !== "object" || Array.isArray(jobs)) return { candidates: [], signals: [] };
  const workingDirectory = (scope: unknown): string | null => {
    if (!scope || typeof scope !== "object" || Array.isArray(scope)) return null;
    const defaults = (scope as Record<string, unknown>).defaults;
    if (!defaults || typeof defaults !== "object" || Array.isArray(defaults)) return null;
    const run = (defaults as Record<string, unknown>).run;
    if (!run || typeof run !== "object" || Array.isArray(run)) return null;
    const directory = (run as Record<string, unknown>)["working-directory"];
    return typeof directory === "string" ? directory.trim() : null;
  };
  const isRootDirectory = (directory: string | null): boolean => (
    directory === null || directory === "." || directory === "./"
  );
  const workflowDirectory = workingDirectory(value);
  const runs: string[] = [];
  for (const job of Object.values(jobs as Record<string, unknown>)) {
    if (!job || typeof job !== "object" || Array.isArray(job)) continue;
    const jobDirectory = workingDirectory(job) ?? workflowDirectory;
    const steps = (job as Record<string, unknown>).steps;
    if (!Array.isArray(steps)) continue;
    for (const step of steps) {
      if (!step || typeof step !== "object" || Array.isArray(step)) continue;
      const explicitStepDirectory = (step as Record<string, unknown>)["working-directory"];
      const stepDirectory = typeof explicitStepDirectory === "string"
        ? explicitStepDirectory.trim()
        : jobDirectory;
      if (!isRootDirectory(stepDirectory)) continue;
      const run = (step as Record<string, unknown>).run;
      if (typeof run === "string") runs.push(run);
    }
  }
  const candidates: Candidate[] = [];
  const signals: ValidatorDiscoverySignal[] = [];
  for (const run of runs) {
    const exact = run.trim();
    if (exact === "python -m pytest") {
      candidates.push(candidate("pytest", { id: "pytest" }, "workflow_recipe", workflowPath, "fixed-recipe:pytest"));
    } else if (exact === "python -m ruff check .") {
      candidates.push(candidate("ruff", { id: "ruff" }, "workflow_recipe", workflowPath, "fixed-recipe:ruff"));
    } else if (exact === "bash scripts/verify-release.sh") {
      candidates.push(candidate("verify-release", { id: "verify-release" }, "workflow_recipe", workflowPath, "fixed-recipe:verify-release"));
    } else {
      const npm = /^npm run (test|lint|build|typecheck)$/.exec(exact);
      if (npm) {
        const script = npm[1] as (typeof NPM_SCRIPTS)[number];
        candidates.push(candidate(script, { id: "npm-script", script }, "workflow_recipe", workflowPath, `fixed-recipe:npm-${script}`));
      } else if (
        run.includes("\n")
        && /\b(?:docker compose|docker-compose)\b[\s\S]*\b(?:python -m pytest|ruff check)\b/.test(run)
      ) {
        signals.push({
          kind: "compose_test_evidence",
          path: workflowPath,
          reason: "Setup-dependent Compose validation evidence; no standalone validator recipe.",
        });
      }
    }
  }
  return { candidates, signals };
}

function mergeCandidates(candidates: Candidate[]): DiscoveredValidator[] {
  const locations = new Map<string, Set<string>>();
  for (const item of candidates) {
    const cwd = item.config.cwd ?? ".";
    locations.set(item.name, new Set([...(locations.get(item.name) ?? []), cwd]));
  }
  const merged = new Map<string, DiscoveredValidator>();
  for (const item of candidates) {
    const cwd = item.config.cwd;
    const name = locations.get(item.name)!.size === 1 || cwd === undefined
      ? item.name
      : `${cwd}:${item.name}`;
    const existing = merged.get(name);
    if (existing) {
      if (JSON.stringify(existing.recipe) !== JSON.stringify(item.recipe)) {
        throw new Error(`Conflicting fixed validator recipes for '${name}'`);
      }
      if (!existing.sources.some((source) => JSON.stringify(source) === JSON.stringify(item.source))) {
        existing.sources.push(item.source);
      }
    } else {
      merged.set(name, {
        name,
        recipe: item.recipe,
        config: item.config,
        sources: [item.source],
      });
    }
  }
  return [...merged.values()]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => ({
      ...entry,
      sources: [...entry.sources].sort((left, right) => (
        `${left.kind}\0${left.path}\0${left.evidence}`.localeCompare(`${right.kind}\0${right.path}\0${right.evidence}`)
      )),
    }));
}

export async function discoverRepositoryValidators(rootPath: string): Promise<ValidatorDiscoveryResult> {
  const root = await realpath(rootPath);
  const candidates: Candidate[] = [];
  const signals: ValidatorDiscoverySignal[] = [];
  const diagnostics: ValidatorDiscoveryDiagnostic[] = [];
  const sourceDigests: Array<[string, string]> = [];

  const readSource = async (
    source: string,
    limit: number,
    parse: (text: string) => Candidate[],
  ): Promise<void> => {
    const result = await boundedRegularFile(root, source, limit);
    if (!result) return;
    if ("error" in result) {
      diagnostics.push({ source, code: result.error });
      return;
    }
    sourceDigests.push([source, result.digest]);
    try {
      candidates.push(...parse(result.text));
    } catch {
      diagnostics.push({ source, code: "malformed" });
    }
  };

  await readSource("package.json", MANIFEST_LIMIT, packageCandidates);
  await readSource("pyproject.toml", MANIFEST_LIMIT, pyprojectCandidates);

  const release = await boundedRegularFile(root, "scripts/verify-release.sh", RELEASE_SCRIPT_LIMIT);
  if (release && !("error" in release)) {
    sourceDigests.push(["scripts/verify-release.sh", release.digest]);
    candidates.push(candidate(
      "verify-release",
      { id: "verify-release" },
      "release_script",
      "scripts/verify-release.sh",
      "regular-file",
    ));
  } else if (release && "error" in release) {
    diagnostics.push({ source: "scripts/verify-release.sh", code: release.error });
  }

  const workflowsDirectory = path.join(root, ".github", "workflows");
  let workflowNames: string[] = [];
  let workflowDirectoryLimited = false;
  try {
    const directory = await opendir(workflowsDirectory);
    let entryCount = 0;
    try {
      for await (const entry of directory) {
        entryCount += 1;
        if (entryCount > WORKFLOW_DIRECTORY_ENTRY_LIMIT) {
          workflowDirectoryLimited = true;
          break;
        }
        if (entry.isFile() && /\.ya?ml$/i.test(entry.name)) {
          workflowNames.push(entry.name);
          if (workflowNames.length > WORKFLOW_COUNT_LIMIT) {
            workflowDirectoryLimited = true;
            break;
          }
        }
      }
    } finally {
      await directory.close().catch(() => undefined);
    }
    workflowNames.sort((left, right) => left.localeCompare(right));
  } catch (error) {
    const code = error instanceof Error && "code" in error
      ? (error as NodeJS.ErrnoException).code
      : undefined;
    if (code !== "ENOENT" && code !== "ENOTDIR") {
      diagnostics.push({ source: ".github/workflows", code: "malformed" });
    }
  }
  if (workflowDirectoryLimited) {
    diagnostics.push({ source: ".github/workflows", code: "limit_reached" });
    workflowNames = [];
  }
  let workflowBytes = 0;
  let workflowAggregateLimited = false;
  const workflowFoundCandidates: Candidate[] = [];
  const workflowFoundSignals: ValidatorDiscoverySignal[] = [];
  const workflowSourceDigests: Array<[string, string]> = [];
  for (const name of workflowNames) {
    const source = `.github/workflows/${name}`;
    const result = await boundedRegularFile(root, source, WORKFLOW_FILE_LIMIT);
    if (!result) continue;
    if ("error" in result) {
      diagnostics.push({ source, code: result.error });
      continue;
    }
    workflowSourceDigests.push([source, result.digest]);
    workflowBytes += result.bytesRead;
    if (workflowBytes > WORKFLOW_TOTAL_LIMIT) {
      diagnostics.push({ source: ".github/workflows", code: "limit_reached" });
      workflowAggregateLimited = true;
      break;
    }
    try {
      const found = workflowCandidates(source, result.text);
      workflowFoundCandidates.push(...found.candidates);
      workflowFoundSignals.push(...found.signals);
    } catch {
      diagnostics.push({ source, code: "malformed" });
    }
  }
  if (!workflowAggregateLimited) {
    candidates.push(...workflowFoundCandidates);
    signals.push(...workflowFoundSignals);
    sourceDigests.push(...workflowSourceDigests);
  }

  // A workflow may corroborate a root-level npm/release recipe, but it cannot
  // invent one whose fixed template would run in the wrong directory or refer
  // to a missing script. This deliberately prevents nested frontend commands
  // and raw workflow shell text from becoming root validators.
  const rootBackedNames = new Set(candidates
    .filter((item) => item.source.kind === "package_json_script" || item.source.kind === "release_script")
    .map((item) => item.name));
  const validators = mergeCandidates(candidates.filter((item) => (
    item.source.kind !== "workflow_recipe"
    || (item.recipe.id !== "npm-script" && item.recipe.id !== "verify-release")
    || rootBackedNames.has(item.name)
  )));
  const sortedSignals = signals.sort((left, right) => (
    `${left.kind}\0${left.path}`.localeCompare(`${right.kind}\0${right.path}`)
  ));
  const sortedDiagnostics = diagnostics.sort((left, right) => (
    `${left.source}\0${left.code}`.localeCompare(`${right.source}\0${right.code}`)
  ));
  const canonical = JSON.stringify({
    validators: validators.map(({ name, recipe, config, sources }) => ({ name, recipe, config, sources })),
    signals: sortedSignals,
    diagnostics: sortedDiagnostics,
    sourceDigests: sourceDigests.sort(([left], [right]) => left.localeCompare(right)),
  });
  return {
    validators,
    signals: sortedSignals,
    diagnostics: sortedDiagnostics,
    fingerprint: createHash("sha256").update(canonical).digest("hex"),
  };
}

const failedProcess = (result: ProcessResult): boolean => result.exitCode !== 0 || result.timedOut
  || result.treeKillUnconfirmed || result.stdoutTruncated === true || result.stderrTruncated === true;
function normalizedNestedCwd(value: string): string | undefined | null {
  if (value === ".") return undefined;
  const safe = value.length <= GENERATED_VALUE_LIMIT && !value.startsWith("/") && !value.includes("\\") && !/^[A-Za-z]:\//.test(value)
    && !/[\u0000-\u001f\u007f]/.test(value) && value.split("/").every((part) => part !== "" && part !== "." && part !== "..");
  return safe ? value : null;
}

function exactResult(candidates: Candidate[], signals: ValidatorDiscoverySignal[], diagnostics: ValidatorDiscoveryDiagnostic[], sourceDigests: Array<[string, string]>): ValidatorDiscoveryResult {
  const validators = mergeCandidates(candidates).filter((entry) => {
    if (entry.name.length <= GENERATED_VALUE_LIMIT) return true;
    diagnostics.push({ source: entry.sources[0]?.path ?? entry.name, code: "unsafe_path" }); return false;
  });
  signals.sort((a, b) => `${a.kind}\0${a.path}`.localeCompare(`${b.kind}\0${b.path}`));
  diagnostics.sort((a, b) => `${a.source}\0${a.code}`.localeCompare(`${b.source}\0${b.code}`));
  const canonical = JSON.stringify({ validators, signals, diagnostics,
    sourceDigests: sourceDigests.sort(([a], [b]) => a.localeCompare(b)) });
  return { validators, signals, diagnostics, fingerprint: createHash("sha256").update(canonical).digest("hex") };
}

export async function discoverRepositoryValidatorsAtCommit(rootPath: string, headSha: string,
  runner: ProcessRunner = runProcess): Promise<ValidatorDiscoveryResult> {
  const candidates: Candidate[] = [], signals: ValidatorDiscoverySignal[] = [], diagnostics: ValidatorDiscoveryDiagnostic[] = [], sourceDigests: Array<[string, string]> = [];
  const inventory = await inventoryManifestsAtCommit(rootPath, headSha, runner);
  if (inventory.state === "unavailable") {
    diagnostics.push({ source: `commit:${headSha}`, code: inventory.detail.includes("unsafe") ? "unsafe_path" : "malformed" });
    return exactResult(candidates, signals, diagnostics, sourceDigests);
  }
  for (const entry of inventory.entries) {
    const cwd = normalizedNestedCwd(entry.cwd);
    if (cwd === null) { diagnostics.push({ source: entry.path, code: "unsafe_path" }); continue; }
    if (entry.diagnostic) { diagnostics.push({ source: entry.path, code: entry.diagnostic.includes("output limit") ? "oversized" : "malformed" }); continue; }
    sourceDigests.push([entry.path, entry.oid]);
    try { candidates.push(...(entry.kind === "package.json" ? packageCandidates(entry.text!, entry.path, cwd)
      : pyprojectCandidates(entry.text!, entry.path, cwd)));
    } catch { diagnostics.push({ source: entry.path, code: "malformed" }); }
  }
  let tree: ProcessResult;
  try {
    tree = await runner({ command: "git", args: ["ls-tree", "-r", "-z", "--full-tree",
      "--format=%(objectmode) %(objecttype) %(objectname)%x09%(path)", headSha, "--", ".github/workflows",
      "scripts/verify-release.sh"], cwd: rootPath, timeoutMs: 30_000, maxOutputBytes: 1024 * 1024 });
  } catch {
    diagnostics.push({ source: `commit:${headSha}`, code: "malformed" });
    return exactResult(candidates, signals, diagnostics, sourceDigests);
  }
  const records = tree.stdout === "" ? [] : tree.stdout.split("\0");
  const blobs: Array<{ path: string; oid: string; limit: number }> = [];
  if (failedProcess(tree) || tree.stdoutUtf8Valid === false || (records.length > 0 && records.pop() !== ""))
    diagnostics.push({ source: `commit:${headSha}`, code: "malformed" });
  else {
    for (const record of records) {
      const match = /^([0-9]{6}) ([a-z]+) ([0-9a-f]{40}|[0-9a-f]{64})\t(.*)$/.exec(record);
      if (!match) { diagnostics.push({ source: `commit:${headSha}`, code: "malformed" }); continue; }
      const [, mode, type, oid, pathname] = match;
      const workflow = /^\.github\/workflows\/[^/]+\.ya?ml$/i.test(pathname!);
      if (!workflow && pathname !== "scripts/verify-release.sh") continue;
      if (type !== "blob" || (mode !== "100644" && mode !== "100755"))
        diagnostics.push({ source: pathname!, code: "unsafe_path" });
      else blobs.push({ path: pathname!, oid: oid!, limit: workflow ? WORKFLOW_FILE_LIMIT : RELEASE_SCRIPT_LIMIT });
    }
  }
  const workflows = blobs.filter((item) => item.path.startsWith(".github/workflows/"));
  const selected = workflows.length > WORKFLOW_COUNT_LIMIT ? blobs.filter((item) =>
    !item.path.startsWith(".github/workflows/")) : blobs;
  if (workflows.length > WORKFLOW_COUNT_LIMIT) diagnostics.push({ source: ".github/workflows", code: "limit_reached" });
  let workflowBytes = 0; const workflowCandidatesFound: Candidate[] = [];
  for (const blob of selected.sort((left, right) => left.path.localeCompare(right.path))) {
    let result: ProcessResult;
    try {
      result = await runner({ command: "git", args: ["cat-file", "blob", blob.oid],
        cwd: rootPath, timeoutMs: 30_000, maxOutputBytes: blob.limit });
    } catch {
      diagnostics.push({ source: blob.path, code: "malformed" }); continue;
    }
    const bytes = Buffer.byteLength(result.stdout);
    if (failedProcess(result) || result.stdoutUtf8Valid === false || bytes > blob.limit) {
      diagnostics.push({ source: blob.path,
        code: result.stdoutTruncated || bytes > blob.limit ? "oversized" : "malformed" }); continue;
    }
    sourceDigests.push([blob.path, blob.oid]);
    if (blob.path === "scripts/verify-release.sh") {
      candidates.push(candidate("verify-release", { id: "verify-release" },
        "release_script", blob.path, "regular-file")); continue;
    }
    workflowBytes += bytes;
    if (workflowBytes > WORKFLOW_TOTAL_LIMIT) {
      diagnostics.push({ source: ".github/workflows", code: "limit_reached" });
      workflowCandidatesFound.length = 0; signals.length = 0; break;
    }
    try {
      const found = workflowCandidates(blob.path, result.stdout);
      workflowCandidatesFound.push(...found.candidates); signals.push(...found.signals);
    } catch { diagnostics.push({ source: blob.path, code: "malformed" }); }
  }
  const rootBacked = new Set(candidates.filter((item) => item.config.cwd === undefined)
    .map((item) => item.name));
  candidates.push(...workflowCandidatesFound.filter((item) => (item.recipe.id !== "npm-script"
    && item.recipe.id !== "verify-release") || rootBacked.has(item.name)));
  return exactResult(candidates, signals, diagnostics, sourceDigests);
}

export function discoveredValidatorMap(
  result: ValidatorDiscoveryResult,
): Record<string, ValidatorConfig> {
  return Object.fromEntries(result.validators.map((entry) => [entry.name, entry.config]));
}

export function createValidatorDiscoverySnapshot(
  result: ValidatorDiscoveryResult,
  headSha: string,
  scannedAt = new Date().toISOString(),
): PersistedValidatorDiscovery {
  return {
    version: 2,
    headSha,
    scannedAt,
    fingerprint: result.fingerprint,
    validators: Object.fromEntries(result.validators.map((entry) => [entry.name, {
      recipe: entry.recipe,
      ...(entry.config.cwd === undefined ? {} : { cwd: entry.config.cwd }),
      sources: entry.sources,
    }])),
    signals: result.signals,
    diagnostics: result.diagnostics,
  };
}

const objectRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: string[]): boolean => JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
export function decodePersistedValidatorDiscoveryJson(raw: string): PersistedValidatorDiscovery {
  let value: unknown; try { value = JSON.parse(raw); } catch { value = null; }
  const recipe = (item: unknown): boolean => objectRecord(item) && (item.id === "npm-script" ? exactKeys(item, ["id", "script"]) && NPM_SCRIPTS.includes(item.script as typeof NPM_SCRIPTS[number])
    : exactKeys(item, ["id"]) && ["pytest", "ruff", "verify-release"].includes(String(item.id)));
  const source = (item: unknown): boolean => objectRecord(item) && exactKeys(item, ["kind", "path", "evidence"])
    && ["package_json_script", "pyproject_table", "release_script", "workflow_recipe"].includes(String(item.kind))
    && typeof item.path === "string" && typeof normalizedNestedCwd(item.path) === "string" && typeof item.evidence === "string"
    && item.evidence.length > 0 && item.evidence.length <= GENERATED_VALUE_LIMIT && !/[\u0000-\u001f\u007f]/.test(item.evidence);
  const valid = objectRecord(value) && (value.version === 1 || value.version === 2)
    && exactKeys(value, ["version", "headSha", "scannedAt", "fingerprint", "validators", "signals", "diagnostics"]) && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(String(value.headSha)) && /^[0-9a-f]{64}$/.test(String(value.fingerprint)) && typeof value.scannedAt === "string"
    && objectRecord(value.validators) && Object.entries(value.validators).every(([name, item]) =>
      name.length > 0 && name.length <= GENERATED_VALUE_LIMIT && objectRecord(item) && exactKeys(item, value.version === 1 ? ["recipe", "sources"] : ["recipe", "sources", ...(item.cwd === undefined ? [] : ["cwd"])])
      && recipe(item.recipe) && Array.isArray(item.sources) && item.sources.length > 0 && item.sources.every(source) && (value.version === 1 || item.cwd === undefined || typeof item.cwd === "string" && typeof normalizedNestedCwd(item.cwd) === "string"))
    && Array.isArray(value.signals) && value.signals.every((item) => objectRecord(item)
      && exactKeys(item, ["kind", "path", "reason"]) && ["compose_test_evidence", "workflow_setup_dependent"].includes(String(item.kind)) && typeof item.path === "string" && typeof item.reason === "string")
    && Array.isArray(value.diagnostics) && value.diagnostics.every((item) => objectRecord(item)
      && exactKeys(item, ["source", "code"]) && typeof item.source === "string" && ["malformed", "oversized", "unsafe_path", "limit_reached"].includes(String(item.code)));
  return valid ? value as PersistedValidatorDiscovery : { version: 2, headSha: "", scannedAt: "", fingerprint: createHash("sha256").update(raw).digest("hex"),
    validators: {}, signals: [], diagnostics: [{ source: "validator_discovery_json", code: "malformed" }] };
}

export function effectiveValidatorAllowlist(
  discovery: PersistedValidatorDiscovery | null,
  localConfigValidators: Record<string, ValidatorConfig>,
  overrides: Record<string, ValidatorConfig>,
  suppressions: readonly string[],
): { effectiveValidators: Record<string, ValidatorConfig>; entries: EffectiveValidatorEntry[] } {
  const suppressed = new Set(suppressions);
  const names = new Set([
    ...Object.keys(discovery?.validators ?? {}),
    ...Object.keys(localConfigValidators),
    ...Object.keys(overrides),
    ...suppressions,
  ]);
  const entries = [...names].sort().map((name): EffectiveValidatorEntry => {
    const discovered = discovery?.validators[name] ?? null;
    const localConfig = localConfigValidators[name] ?? null;
    const override = overrides[name] ?? null;
    const isSuppressed = suppressed.has(name);
    if (override) {
      return {
        name,
        discovered,
        localConfig,
        override,
        suppressed: isSuppressed,
        effectiveOrigin: "manual_override",
        effectiveConfig: override,
      };
    }
    if (localConfig && !isSuppressed) {
      return {
        name,
        discovered,
        localConfig,
        override: null,
        suppressed: false,
        effectiveOrigin: "local_config",
        effectiveConfig: localConfig,
      };
    }
    if (discovered && !isSuppressed) {
      return {
        name,
        discovered,
        localConfig: null,
        override: null,
        suppressed: false,
        effectiveOrigin: "discovered",
        effectiveConfig: materializeValidatorRecipe(discovered.recipe, discovered.cwd),
      };
    }
    return {
      name,
      discovered,
      localConfig,
      override: null,
      suppressed: isSuppressed,
      effectiveOrigin: null,
      effectiveConfig: null,
    };
  });
  return {
    effectiveValidators: Object.fromEntries(
      entries.flatMap((entry) => entry.effectiveConfig ? [[entry.name, entry.effectiveConfig]] : []),
    ),
    entries,
  };
}

export function validatorStateFingerprint(
  discovery: PersistedValidatorDiscovery | null,
  localConfigValidators: Record<string, ValidatorConfig>,
  overrides: Record<string, ValidatorConfig>,
  suppressions: readonly string[],
): string {
  return createHash("sha256").update(JSON.stringify({
    discovery,
    localConfigValidators: Object.fromEntries(Object.entries(localConfigValidators).sort(([left], [right]) => left.localeCompare(right))),
    overrides: Object.fromEntries(Object.entries(overrides).sort(([left], [right]) => left.localeCompare(right))),
    suppressions: [...new Set(suppressions)].sort(),
  })).digest("hex");
}

export function validatorCandidateFingerprint(
  discovery: PersistedValidatorDiscovery,
  localConfigValidators: Record<string, ValidatorConfig>,
): string {
  return createHash("sha256").update(JSON.stringify({
    discoveryFingerprint: discovery.fingerprint,
    localConfigValidators: Object.fromEntries(Object.entries(localConfigValidators).sort(([left], [right]) => left.localeCompare(right))),
  })).digest("hex");
}

export function diffValidatorMaps(
  before: Record<string, ValidatorConfig>,
  after: Record<string, ValidatorConfig>,
): { added: string[]; changed: string[]; removed: string[]; unchanged: string[] } {
  const names = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  const added: string[] = [];
  const changed: string[] = [];
  const removed: string[] = [];
  const unchanged: string[] = [];
  for (const name of names) {
    const prior = before[name];
    const next = after[name];
    if (!prior) added.push(name);
    else if (!next) removed.push(name);
    else if (JSON.stringify(prior) === JSON.stringify(next)) unchanged.push(name);
    else changed.push(name);
  }
  return { added, changed, removed, unchanged };
}

export function diffValidatorDiscoveries(
  before: PersistedValidatorDiscovery | null,
  after: PersistedValidatorDiscovery,
): { added: string[]; changed: string[]; removed: string[]; unchanged: string[] } {
  const names = [...new Set([
    ...Object.keys(before?.validators ?? {}),
    ...Object.keys(after.validators),
  ])].sort();
  const added: string[] = [];
  const changed: string[] = [];
  const removed: string[] = [];
  const unchanged: string[] = [];
  for (const name of names) {
    const prior = before?.validators[name];
    const next = after.validators[name];
    if (!prior) added.push(name);
    else if (!next) removed.push(name);
    else if (JSON.stringify(prior) === JSON.stringify(next)) unchanged.push(name);
    else changed.push(name);
  }
  return { added, changed, removed, unchanged };
}
