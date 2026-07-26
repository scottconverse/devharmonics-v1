import path from "node:path";
import { runProcess, type ProcessRequest, type ProcessResult } from "./process.js";
import { isTomlRecord, ownTomlValue, parseTomlRecord, TomlParseFailure } from "./toml.js";

const TIMEOUT_MS = 30_000;
const OUTPUT_BYTES = 1024 * 1024;
const EXACT_OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const TREE_RECORD = /^([0-9]{6}) ([a-z]+) ([0-9a-f]{40}|[0-9a-f]{64})\t(.*)$/;
export type ManifestKind = "package.json" | "pyproject.toml";
export type ProcessRunner = (request: ProcessRequest) => Promise<ProcessResult>;
export interface ManifestInventoryEntry {
  path: string; cwd: string; kind: ManifestKind; oid: string; mode: "100644" | "100755";
  text?: string; diagnostic?: string;
}
export type ManifestInventory =
  | { state: "available"; commit: string; entries: ManifestInventoryEntry[] }
  | { state: "unavailable"; commit: string; detail: string };
export type ReleaseUnitState = "declared" | "private" | "versionless" | "dynamic" | "invalid" | "unavailable";
export interface ReleaseDiagnostic { cwd: string; path: string; detail: string }
export interface ReleaseUnit {
  cwd: string; manifests: ManifestInventoryEntry[]; state: ReleaseUnitState; reason: string;
  version?: string; source?: string; diagnostics: ReleaseDiagnostic[];
}
export interface ReleaseAuthority {
  state: "declared" | "absent" | "invalid" | "unavailable"; units: ReleaseUnit[];
  diagnostics: ReleaseDiagnostic[]; detail?: string; version?: string; source?: string; cwd?: string;
  reason?: "automatic-root" | "automatic-sole-nested" | "configured-nested";
  invalidationNeeded?: true; selectorConflict?: true;
}

function request(root: string, args: string[]): ProcessRequest {
  return { command: "git", args, cwd: root, timeoutMs: TIMEOUT_MS, maxOutputBytes: OUTPUT_BYTES };
}

function failed(result: ProcessResult): boolean {
  return result.exitCode !== 0 || result.timedOut || result.treeKillUnconfirmed
    || result.stdoutTruncated === true || result.stderrTruncated === true;
}

function failure(result: ProcessResult, operation: string): string {
  if (result.timedOut) return `${operation} timed out`;
  if (result.treeKillUnconfirmed) return `${operation} could not confirm process-tree termination`;
  if (result.stdoutTruncated || result.stderrTruncated) return `${operation} exceeded its output limit`;
  return result.exitCode === 0 ? `${operation} returned malformed output` : `${operation} exited nonzero`;
}

function unavailable(commit: string, detail: string): ManifestInventory {
  return { state: "unavailable", commit, detail };
}

function safePath(value: string): boolean {
  return value.length > 0 && !value.startsWith("/") && !value.includes("\\")
    && !/[\u0000-\u001f\u007f]/.test(value)
    && value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

export async function inventoryManifestsAtCommit(
  root: string,
  commit: string,
  runner: ProcessRunner = runProcess,
): Promise<ManifestInventory> {
  if (!EXACT_OID.test(commit)) return unavailable(commit, "commit must be an exact 40- or 64-hex object ID");
  let result: ProcessResult;
  try {
    result = await runner(request(root, ["cat-file", "-e", `${commit}^{commit}`]));
  } catch {
    return unavailable(commit, "commit object proof could not be started");
  }
  if (failed(result)) return unavailable(commit, failure(result, "commit object proof"));
  try {
    result = await runner(request(root, [
      "ls-tree", "-r", "-z", "--full-tree",
      "--format=%(objectmode) %(objecttype) %(objectname)%x09%(path)", commit,
    ]));
  } catch {
    return unavailable(commit, "recursive tree enumeration could not be started");
  }
  if (failed(result)) return unavailable(commit, failure(result, "recursive tree enumeration"));
  const records = result.stdout === "" ? [] : result.stdout.split("\0");
  if (records.length > 0 && records.pop() !== "") {
    return unavailable(commit, "recursive tree enumeration was not NUL-terminated");
  }
  const entries: ManifestInventoryEntry[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    const match = TREE_RECORD.exec(record);
    if (!match) return unavailable(commit, "recursive tree enumeration returned a malformed record");
    const [, mode, objectType, oid, pathname] = match;
    if (!safePath(pathname!)) return unavailable(commit, "recursive tree enumeration returned an unsafe path");
    const basename = path.posix.basename(pathname!);
    if (basename !== "package.json" && basename !== "pyproject.toml") continue;
    if (objectType !== "blob" || (mode !== "100644" && mode !== "100755")) {
      return unavailable(commit, `recognized manifest '${pathname}' is not a regular blob`);
    }
    if (seen.has(pathname!)) return unavailable(commit, `recognized manifest '${pathname}' was duplicated`);
    seen.add(pathname!);
    entries.push({
      path: pathname!,
      cwd: path.posix.dirname(pathname!),
      kind: basename,
      oid: oid!,
      mode,
    });
  }
  entries.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  for (const entry of entries) {
    try {
      result = await runner(request(root, ["cat-file", "blob", entry.oid]));
      if (failed(result)) entry.diagnostic = failure(result, "git blob read");
      else if (result.stdoutUtf8Valid === false) entry.diagnostic = "manifest is not valid UTF-8";
      else entry.text = result.stdout;
    } catch {
      entry.diagnostic = "git blob read could not be started";
    }
  }
  return { state: "available", commit, entries };
}

function makeUnit(cwd: string, manifests: ManifestInventoryEntry[], state: ReleaseUnitState, reason: string,
  source?: ManifestInventoryEntry, version?: string, detail?: string): ReleaseUnit {
  return {
    cwd, manifests, state, reason,
    ...(source && version ? { source: source.path, version } : {}),
    diagnostics: source && detail ? [{ cwd, path: source.path, detail }] : [],
  };
}

function evaluateUnit(cwd: string, manifests: ManifestInventoryEntry[]): ReleaseUnit {
  const packageJson = manifests.find((item) => item.kind === "package.json");
  const pyproject = manifests.find((item) => item.kind === "pyproject.toml");
  let packageState: "private" | "versionless" = "versionless";
  if (packageJson) {
    if (packageJson.diagnostic) {
      return makeUnit(cwd, manifests, "unavailable", "package unreadable", packageJson, undefined, packageJson.diagnostic);
    }
    let value: unknown;
    try {
      value = JSON.parse(packageJson.text!);
    } catch {
      return makeUnit(cwd, manifests, "invalid", "invalid package", packageJson, undefined, "JSON parser rejected the document");
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return makeUnit(cwd, manifests, "invalid", "invalid package", packageJson, undefined, "document root must be an object");
    }
    const record = value as Record<string, unknown>;
    if ("private" in record && typeof record.private !== "boolean") {
      return makeUnit(cwd, manifests, "invalid", "invalid package", packageJson, undefined, "'private' must be a boolean");
    }
    if ("version" in record && (typeof record.version !== "string" || !record.version.trim())) {
      return makeUnit(cwd, manifests, "invalid", "invalid package", packageJson, undefined, "'version' must be a non-empty string");
    }
    if (record.private !== true && typeof record.version === "string") {
      return makeUnit(cwd, manifests, "declared", "public static package version", packageJson, record.version.trim());
    }
    packageState = record.private === true ? "private" : "versionless";
  }
  if (!pyproject) return makeUnit(cwd, manifests, packageState, `${packageState} package`);
  if (pyproject.diagnostic) {
    return makeUnit(cwd, manifests, "unavailable", "pyproject unreadable", pyproject, undefined, pyproject.diagnostic);
  }
  let document;
  try {
    document = parseTomlRecord(pyproject.path, pyproject.text!);
  } catch (error) {
    const detail = error instanceof TomlParseFailure ? error.message : "TOML parser rejected the document";
    return makeUnit(cwd, manifests, "invalid", "invalid pyproject", pyproject, undefined, detail);
  }
  const project = ownTomlValue(document, "project");
  if (project === undefined) return makeUnit(cwd, manifests, packageState, "no static public version");
  if (!isTomlRecord(project)) {
    return makeUnit(cwd, manifests, "invalid", "invalid pyproject", pyproject, undefined, "'project' must be a table");
  }
  const version = ownTomlValue(project, "version");
  if (version !== undefined) {
    if (typeof version !== "string" || !version.trim()) {
      return makeUnit(cwd, manifests, "invalid", "invalid pyproject", pyproject, undefined, "'project.version' must be a non-empty string");
    }
    return makeUnit(cwd, manifests, "declared", "static PEP 621 version", pyproject, version.trim());
  }
  const dynamic = ownTomlValue(project, "dynamic");
  const state = Array.isArray(dynamic) && dynamic.includes("version") ? "dynamic" : packageState;
  return makeUnit(cwd, manifests, state, "no static public version");
}

function baseAuthority(state: ReleaseAuthority["state"], units: ReleaseUnit[], detail?: string): ReleaseAuthority {
  return {
    state,
    units,
    diagnostics: units.flatMap((unit) => unit.diagnostics),
    ...(detail ? { detail } : {}),
  };
}

function declared(unit: ReleaseUnit, reason: NonNullable<ReleaseAuthority["reason"]>, units: ReleaseUnit[]): ReleaseAuthority {
  return { ...baseAuthority("declared", units), version: unit.version!, source: unit.source!, cwd: unit.cwd, reason };
}

export function resolveReleaseAuthority(inventory: ManifestInventory, selectorCwd?: string): ReleaseAuthority {
  if (inventory.state === "unavailable") return baseAuthority("unavailable", [], inventory.detail);
  const grouped = new Map<string, ManifestInventoryEntry[]>();
  for (const item of inventory.entries) grouped.set(item.cwd, [...(grouped.get(item.cwd) ?? []), item]);
  const units = [...grouped].map(([cwd, manifests]) => evaluateUnit(cwd, manifests))
    .sort((left, right) => left.cwd < right.cwd ? -1 : left.cwd > right.cwd ? 1 : 0);
  const root = units.find((unit) => unit.cwd === ".");
  if (root?.state === "declared") {
    if (selectorCwd === undefined) return declared(root, "automatic-root", units);
    return { ...baseAuthority("invalid", units, "configured selector conflicts with root release authority"),
      invalidationNeeded: true, selectorConflict: true };
  }
  if (root?.state === "invalid" || root?.state === "unavailable") {
    return baseAuthority(root.state, units, root.diagnostics[0]?.detail ?? root.reason);
  }
  const nested = units.filter((unit) => unit.cwd !== ".");
  if (selectorCwd !== undefined) {
    const selected = nested.find((unit) => unit.cwd === selectorCwd);
    if (selected?.state === "declared") return declared(selected, "configured-nested", units);
    const state = selected?.state === "unavailable" ? "unavailable" : "invalid";
    const detail = selected ? `selected release unit is ${selected.state}` : "selected release unit is missing";
    return { ...baseAuthority(state, units, detail), invalidationNeeded: true };
  }
  const unreadable = nested.find((unit) => unit.state === "unavailable");
  if (unreadable) return baseAuthority("unavailable", units, unreadable.diagnostics[0]?.detail ?? unreadable.reason);
  const invalid = nested.find((unit) => unit.state === "invalid");
  if (invalid) return baseAuthority("invalid", units, invalid.diagnostics[0]?.detail ?? invalid.reason);
  const candidates = nested.filter((unit) => unit.state === "declared");
  if (candidates.length === 1) return declared(candidates[0]!, "automatic-sole-nested", units);
  if (candidates.length > 1) return baseAuthority("invalid", units, "ambiguous nested release authority");
  return baseAuthority("absent", units);
}
