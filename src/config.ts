import { constants, existsSync } from "node:fs";
import { copyFile, lstat, mkdir, open, readFile, realpath, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { devHarmonicsConfigSchema, legacyDevHarmonicsConfigSchema } from "./schemas.js";
import { discoverRepositoryValidators, discoveredValidatorMap } from "./validator-discovery.js";
import { expandValidatorTokens } from "./validators.js";
import type { ProviderName, DevHarmonicsConfig, ValidatorConfig } from "./types.js";

export const defaultConfig: DevHarmonicsConfig = {
  version: 2,
  application: {
    concurrency: {
      mode: "auto",
      agents: 8,
      ceiling: null,
    },
    retry: {
      maxAttempts: 3,
      backoffMs: 1_500,
    },
    fanout: {
      maxWorkers: 200,
      windowHours: 1,
    },
  },
  connections: {
    codex: { enabled: true, command: "codex", timeoutMs: 30 * 60_000 },
    claude: { enabled: true, command: "claude", timeoutMs: 30 * 60_000 },
    gemini: { enabled: true, command: "agy", timeoutMs: 30 * 60_000 },
  },
  localRuntimes: {
    ollama: [
      { id: "system", displayName: "System Ollama", baseUrl: "http://127.0.0.1:11434", enabled: true },
    ],
  },
  openRouter: {
    enabled: false,
    allowPaidFallback: false,
    perRunLimitUsd: 0,
    monthlyLimitUsd: 0,
  },
  product: {
    architect: "claude",
    reviewer: "codex",
    workers: ["codex", "claude", "gemini"],
  },
  repository: {
    validators: {},
    generatedValidators: {},
  },
  runPolicy: {
    autonomy: "supervised",
    requirePlanApproval: false,
    allowPaidApi: false,
    allowExternalWrites: false,
  },
  reviewPolicy: {
    reviewerCountByRisk: { low: 1, medium: 1, high: 2 },
    minimumDistinctProvidersByRisk: { low: 1, medium: 1, high: 2 },
    requireImplementorIndependenceByRisk: { low: false, medium: true, high: true },
    requiredLensesByRisk: { low: ["artifact"], medium: ["artifact"], high: ["artifact", "claims"] },
    attestNoManagedClaudePolicy: false,
    maxFixRounds: 2,
  },
  routing: {
    mode: "adaptive",
    architect: { modelId: null, effort: "high", preferredTier: "auto", upgradePolicy: "pinned" },
    worker: { modelId: null, effort: "high", preferredTier: "auto", upgradePolicy: "pinned" },
    reviewer: { modelId: null, effort: "high", preferredTier: "auto", upgradePolicy: "pinned" },
    allowFallback: true,
  },
};

export function devHarmonicsDirectory(projectPath: string): string {
  return path.join(projectPath, ".devharmonics");
}

export function configPath(projectPath: string): string {
  return path.join(devHarmonicsDirectory(projectPath), "config.json");
}

export async function initializeProject(projectPath: string): Promise<string> {
  const directory = devHarmonicsDirectory(projectPath);
  await mkdir(directory, { recursive: true });
  await excludeRuntimeDirectory(projectPath);
  const destination = configPath(projectPath);

  try {
    await readFile(destination, "utf8");
  } catch {
    const config = structuredClone(defaultConfig);
    const generated = discoveredValidatorMap(await discoverRepositoryValidators(projectPath));
    config.repository.validators = generated;
    config.repository.generatedValidators = structuredClone(generated);
    await writeFile(destination, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  }

  const constitution = path.join(directory, "constitution.md");
  try {
    await readFile(constitution, "utf8");
  } catch {
    await writeFile(
      constitution,
      `# DevHarmonics constitution\n\n1. Preserve existing behavior unless the goal explicitly changes it.\n2. Never claim a check passed without an execution receipt.\n3. Add or update tests for new observable behavior.\n4. Do not weaken tests merely to make a task pass.\n5. Keep changes within the assigned task.\n6. Do not expose secrets or broaden permissions.\n7. Record assumptions and unresolved risks.\n8. A run is complete only after task checks and final integration checks pass.\n`,
      "utf8",
    );
  }

  return destination;
}

async function excludeRuntimeDirectory(projectPath: string): Promise<void> {
  const exclude = path.join(projectPath, ".git", "info", "exclude");
  try {
    const current = await readFile(exclude, "utf8");
    if (!current.split(/\r?\n/).includes(".devharmonics/")) {
      await writeFile(exclude, `${current.replace(/\s*$/, "")}\n.devharmonics/\n`, "utf8");
    }
  } catch {
    // The project may not be a Git repository yet. Worktree preflight reports that clearly.
  }
}

export async function loadConfig(projectPath: string): Promise<DevHarmonicsConfig> {
  await initializeProject(projectPath);
  const destination = configPath(projectPath);
  const contents = await readFile(destination, "utf8");
  let raw: unknown;
  try {
    raw = JSON.parse(contents);
  } catch (error) {
    throw new Error(`Invalid configuration JSON in ${destination}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const version = typeof raw === "object" && raw !== null && "version" in raw
    ? (raw as { version?: unknown }).version
    : undefined;
  if (version === 1) {
    const legacy = parseConfig(legacyDevHarmonicsConfigSchema, raw, destination);
    const migrated: DevHarmonicsConfig = {
      version: 2,
      application: { concurrency: legacy.concurrency, retry: legacy.retry, fanout: { maxWorkers: 200, windowHours: 1 } },
      connections: legacy.providers,
      localRuntimes: structuredClone(defaultConfig.localRuntimes),
      openRouter: structuredClone(defaultConfig.openRouter),
      product: {
        architect: legacy.architect,
        reviewer: legacy.reviewer,
        workers: legacy.workers,
      },
      repository: { validators: legacy.validators, generatedValidators: {} },
      runPolicy: structuredClone(defaultConfig.runPolicy),
      reviewPolicy: structuredClone(defaultConfig.reviewPolicy),
      routing: structuredClone(defaultConfig.routing),
    };
    await persistMigration(destination, contents, migrated);
    return withExpandedValidators(migrated, projectPath);
  }
  return withExpandedValidators(parseConfig(devHarmonicsConfigSchema, raw, destination), projectPath);
}

/**
 * Read only the validators already present in a repository's config.
 *
 * Repository attachment and rescan are observation operations: if a repository
 * has no DevHarmonics config, they must not create one merely to discover that
 * fact. Migration is likewise not performed here; the owner can open/save that
 * repository normally when they want its config migrated.
 */
export class ValidatorConfigSnapshotError extends Error {}

export async function loadConfiguredValidatorSnapshot(
  projectPath: string,
): Promise<Record<string, ValidatorConfig>> {
  try {
    return await loadConfiguredValidatorSnapshotUnchecked(projectPath);
  } catch (error) {
    if (error instanceof ValidatorConfigSnapshotError) throw error;
    throw new ValidatorConfigSnapshotError(error instanceof Error ? error.message : String(error));
  }
}

async function loadConfiguredValidatorSnapshotUnchecked(
  projectPath: string,
): Promise<Record<string, ValidatorConfig>> {
  const destination = configPath(projectPath);
  const contents = await readBoundedValidatorConfig(projectPath, destination);
  if (contents === null) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(contents);
  } catch (error) {
    throw new Error(`Invalid configuration JSON in ${destination}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const version = typeof raw === "object" && raw !== null && "version" in raw
    ? (raw as { version?: unknown }).version
    : undefined;
  const parsed = version === 1
    ? { validators: parseConfig(legacyDevHarmonicsConfigSchema, raw, destination).validators, generatedValidators: {} }
    : parseConfig(devHarmonicsConfigSchema, raw, destination).repository;
  const ownerValidators = Object.fromEntries(Object.entries(parsed.validators).filter(([name, validator]) => (
    JSON.stringify(validator) !== JSON.stringify(parsed.generatedValidators[name])
  )));
  return expandValidatorTokens(ownerValidators, path.resolve(projectPath));
}

const VALIDATOR_CONFIG_SNAPSHOT_LIMIT = 1024 * 1024;

async function readBoundedValidatorConfig(
  projectPath: string,
  destination: string,
): Promise<string | null> {
  const root = await realpath(projectPath);
  const directory = devHarmonicsDirectory(root);
  let destinationStat;
  try {
    destinationStat = await lstat(destination);
  } catch (error) {
    const code = error instanceof Error && "code" in error
      ? (error as NodeJS.ErrnoException).code
      : undefined;
    if (code !== "ENOENT" && code !== "ENOTDIR") {
      throw new Error(`Could not inspect validator configuration ${destination}: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      const directoryStat = await lstat(directory);
      if (directoryStat.isSymbolicLink()) {
        throw new Error(`Unsafe validator configuration path ${destination}: .devharmonics is a symbolic link`);
      }
      const resolvedDirectory = await realpath(directory);
      if (!isWithinRoot(root, resolvedDirectory)) {
        throw new Error(`Unsafe validator configuration path ${destination}: .devharmonics resolves outside the repository`);
      }
    } catch (directoryError) {
      const directoryCode = directoryError instanceof Error && "code" in directoryError
        ? (directoryError as NodeJS.ErrnoException).code
        : undefined;
      if (directoryCode === "ENOENT" || directoryCode === "ENOTDIR") return null;
      throw directoryError;
    }
    return null;
  }
  if (destinationStat.isSymbolicLink()) {
    throw new Error(`Unsafe validator configuration path ${destination}: config.json is a symbolic link`);
  }
  const beforePath = await realpath(destination);
  if (!isWithinRoot(root, beforePath)) {
    throw new Error(`Unsafe validator configuration path ${destination}: config.json resolves outside the repository`);
  }
  const handle = await open(destination, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const beforeStat = await handle.stat();
    if (!beforeStat.isFile()) {
      throw new Error(`Unsafe validator configuration ${destination}: config.json must be a regular file`);
    }
    if (beforeStat.size > VALIDATOR_CONFIG_SNAPSHOT_LIMIT) {
      throw new Error(`Validator configuration ${destination} is too large; size limit is ${VALIDATOR_CONFIG_SNAPSHOT_LIMIT} bytes`);
    }
    const chunks: Buffer[] = [];
    let bytesRead = 0;
    for (;;) {
      const remaining = VALIDATOR_CONFIG_SNAPSHOT_LIMIT + 1 - bytesRead;
      if (remaining <= 0) {
        throw new Error(`Validator configuration ${destination} is too large; size limit is ${VALIDATOR_CONFIG_SNAPSHOT_LIMIT} bytes`);
      }
      const chunk = Buffer.alloc(Math.min(64 * 1024, remaining));
      const read = await handle.read(chunk, 0, chunk.length, bytesRead);
      if (read.bytesRead === 0) break;
      chunks.push(chunk.subarray(0, read.bytesRead));
      bytesRead += read.bytesRead;
    }
    const afterStat = await handle.stat();
    const afterPath = await realpath(destination);
    if (
      afterPath !== beforePath
      || bytesRead !== beforeStat.size
      || afterStat.size !== beforeStat.size
      || afterStat.dev !== beforeStat.dev
      || afterStat.ino !== beforeStat.ino
      || afterStat.mtimeMs !== beforeStat.mtimeMs
      || afterStat.ctimeMs !== beforeStat.ctimeMs
    ) {
      throw new Error(`Validator configuration ${destination} changed while it was being read`);
    }
    return Buffer.concat(chunks, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}

function isWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

/**
 * `${repoRoot}` in a project's own validator commands means this project's root.
 * Expanded here, at the one place every consumer loads configuration through, so
 * a validator that needs the repository's own toolchain can be written portably
 * in .devharmonics/config.json. Registered per-repository validators from the
 * ledger are expanded separately against that repository's local path.
 */
function withExpandedValidators(config: DevHarmonicsConfig, projectPath: string): DevHarmonicsConfig {
  return {
    ...config,
    repository: {
      validators: expandValidatorTokens(config.repository.validators, path.resolve(projectPath)),
      generatedValidators: config.repository.generatedValidators,
    },
  };
}

export async function saveConfig(projectPath: string, value: unknown): Promise<DevHarmonicsConfig> {
  await initializeProject(projectPath);
  const destination = configPath(projectPath);
  const config = parseConfig(devHarmonicsConfigSchema, value, destination);
  const temporary = `${destination}.saving`;
  await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  await rename(temporary, destination);
  return config;
}

function parseConfig<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false; error: { issues: Array<{ path: PropertyKey[]; message: string }> } } }, raw: unknown, destination: string): T {
  const parsed = schema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const details = parsed.error.issues
    .map((issue) => `${issue.path.map(String).join(".") || "configuration"}: ${issue.message}`)
    .join("; ");
  throw new Error(`Invalid DevHarmonics configuration in ${destination}: ${details}`);
}

async function persistMigration(destination: string, original: string, migrated: DevHarmonicsConfig): Promise<void> {
  const backup = `${destination}.v1.backup`;
  try {
    await copyFile(destination, backup, 1);
  } catch (error) {
    const code = error instanceof Error && "code" in error ? (error as NodeJS.ErrnoException).code : undefined;
    if (code !== "EEXIST") throw error;
  }
  const temporary = `${destination}.migrating`;
  await writeFile(temporary, `${JSON.stringify(migrated, null, 2)}\n`, "utf8");
  try {
    await rename(temporary, destination);
  } catch (error) {
    await writeFile(destination, original, "utf8");
    throw error;
  }
}

export function resolveProviderCommand(name: ProviderName, configuredCommand: string): string {
  if (process.platform !== "win32" || name !== "gemini" || configuredCommand !== "agy") {
    return configuredCommand;
  }
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return configuredCommand;
  const installedCommand = path.join(localAppData, "agy", "bin", "agy.exe");
  return existsSync(installedCommand) ? installedCommand : configuredCommand;
}

export async function loadConstitution(projectPath: string): Promise<string> {
  await initializeProject(projectPath);
  return readFile(path.join(devHarmonicsDirectory(projectPath), "constitution.md"), "utf8");
}
