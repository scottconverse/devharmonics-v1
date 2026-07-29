import { createRequire } from "node:module";
import { validRange as validPep440Range } from "@renovatebot/pep440";
import {
  parsePipRequirementsLine,
  type EnvironmentMarker,
  type Requirement,
  VersionOperator,
} from "pip-requirements-js";
import {
  inventoryManifestsAtCommit,
  type ManifestInventory,
  type ManifestInventoryEntry,
  type ProcessRunner,
} from "./release-units.js";
import { isTomlRecord, ownTomlValue, parseTomlRecord, TomlParseFailure } from "./toml.js";

export type DependencyEvidenceState =
  | "detected"
  | "absent"
  | "unsupported"
  | "malformed"
  | "unavailable"
  | "wrong_shape"
  | "dynamic";

export type DependencyEcosystem = "npm" | "pypi";
export type DependencyGroup = "runtime" | "development" | "optional" | "peer" | "build";
export type DependencyConstraintKind =
  | "exact"
  | "range"
  | "direct"
  | "workspace"
  | "file"
  | "alias"
  | "tag"
  | "unversioned";

export interface DependencyProvenance {
  commit: string;
  blobOid: string;
  path: string;
  cwd: string;
  locator: string;
}

export interface DependencyConstraint {
  kind: DependencyConstraintKind;
  assessment: "exact_pin" | "unassessed";
  exactVersion?: string;
  extras: string[];
  marker: string | null;
  directReference: string | null;
}

export interface DependencyFact {
  ecosystem: DependencyEcosystem;
  packageName: string;
  scope: string | null;
  group: DependencyGroup;
  rawDeclaration: string;
  constraint: DependencyConstraint;
  provenance: DependencyProvenance;
}

export interface DependencyPackageIdentity {
  ecosystem: DependencyEcosystem;
  packageName: string;
  provenance: DependencyProvenance;
}

export interface DependencyManifestEvidence {
  state: DependencyEvidenceState;
  ecosystem: DependencyEcosystem;
  commit: string;
  blobOid: string;
  path: string;
  cwd: string;
  factCount: number;
}

export interface DependencyDiagnostic {
  state: Exclude<DependencyEvidenceState, "detected" | "absent">;
  commit: string;
  blobOid?: string;
  path?: string;
  cwd?: string;
  locator?: string;
  detail: string;
}

export interface DependencyExtraction {
  state: DependencyEvidenceState;
  commit: string;
  facts: DependencyFact[];
  identities: DependencyPackageIdentity[];
  manifests: DependencyManifestEvidence[];
  diagnostics: DependencyDiagnostic[];
}

interface ParsedManifest {
  evidence: DependencyManifestEvidence;
  facts: DependencyFact[];
  diagnostics: DependencyDiagnostic[];
}

interface PythonDeclaration {
  raw: string;
  group: DependencyGroup;
  scope: string | null;
  locator: string;
}

type NpmPackageSpecType = "version" | "range" | "tag" | "alias" | "file" | "directory" | "git" | "remote";

interface NpmPackageSpec {
  type: NpmPackageSpecType;
  rawSpec: string;
}

interface NpmPackageArgParser {
  resolve(name: string, spec: string, where?: string): NpmPackageSpec;
}

type NpmConstraintResult =
  | { constraint: DependencyConstraint }
  | { state: "malformed" | "unsupported"; detail: string };

const npmPackageArg = createRequire(import.meta.url)("npm-package-arg") as NpmPackageArgParser;

const NPM_GROUPS: ReadonlyArray<{
  key: "dependencies" | "devDependencies" | "optionalDependencies" | "peerDependencies";
  group: DependencyGroup;
}> = [
  { key: "dependencies", group: "runtime" },
  { key: "devDependencies", group: "development" },
  { key: "optionalDependencies", group: "optional" },
  { key: "peerDependencies", group: "peer" },
];

const STATE_RANK: Record<DependencyEvidenceState, number> = {
  absent: 0,
  detected: 1,
  dynamic: 2,
  unsupported: 3,
  wrong_shape: 4,
  malformed: 5,
  unavailable: 6,
};

function pointerSegment(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function normalizePythonName(value: string): string {
  return value.trim().toLowerCase().replace(/[-_.]+/g, "-");
}

function normalizeNpmName(value: string): string {
  return value.trim().toLowerCase();
}

function npmScope(value: string): string | null {
  return value.startsWith("@") && value.includes("/") ? value.slice(0, value.indexOf("/")) : null;
}

function pythonScope(value: string): string {
  return normalizePythonName(value);
}

function provenance(entry: ManifestInventoryEntry, commit: string, locator: string): DependencyProvenance {
  return {
    commit,
    blobOid: entry.oid,
    path: entry.path,
    cwd: entry.cwd,
    locator,
  };
}

function evidence(
  entry: ManifestInventoryEntry,
  commit: string,
  state: DependencyEvidenceState,
  factCount: number,
): DependencyManifestEvidence {
  return {
    state,
    ecosystem: entry.kind === "package.json" ? "npm" : "pypi",
    commit,
    blobOid: entry.oid,
    path: entry.path,
    cwd: entry.cwd,
    factCount,
  };
}

function diagnostic(
  entry: ManifestInventoryEntry,
  commit: string,
  state: DependencyDiagnostic["state"],
  detail: string,
  locator?: string,
): DependencyDiagnostic {
  return {
    state,
    commit,
    blobOid: entry.oid,
    path: entry.path,
    cwd: entry.cwd,
    ...(locator === undefined ? {} : { locator }),
    detail,
  };
}

function safeDetail(value: unknown, fallback: string): string {
  const raw = value instanceof Error ? value.message : typeof value === "string" ? value : fallback;
  return raw.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 300) || fallback;
}

function npmConstraint(packageName: string, raw: string): NpmConstraintResult {
  const value = raw.trim();
  try {
    npmPackageArg.resolve(packageName, "*", ".");
  } catch (error) {
    return {
      state: "malformed",
      detail: safeDetail(error, "npm package-spec parser rejected the package name"),
    };
  }
  const alternateProtocol = /^(workspace|link):(.*)$/i.exec(value);
  if (alternateProtocol) {
    const protocol = alternateProtocol[1]!.toLowerCase();
    const target = alternateProtocol[2]!.trim();
    if (!target) {
      return { state: "malformed", detail: `'${alternateProtocol[1]!.toLowerCase()}:' requires a target` };
    }
    if (protocol === "workspace" && target !== "^" && target !== "~" && target !== "*") {
      let targetType: NpmPackageSpec["type"];
      try {
        targetType = npmPackageArg.resolve(packageName, target, ".").type;
      } catch (error) {
        return {
          state: "malformed",
          detail: safeDetail(error, "workspace protocol requires a semantic-version range or relative path"),
        };
      }
      const relativeDirectory = (target.startsWith("./") || target.startsWith("../")) && targetType === "directory";
      if (targetType !== "version" && targetType !== "range" && !relativeDirectory) {
        return {
          state: "malformed",
          detail: "workspace protocol requires a semantic-version range, ^/~/* token, or relative path",
        };
      }
    }
    if (protocol === "link") {
      let targetType: NpmPackageSpec["type"];
      try {
        targetType = npmPackageArg.resolve(packageName, target, ".").type;
      } catch (error) {
        return {
          state: "malformed",
          detail: safeDetail(error, "link protocol requires a relative directory path"),
        };
      }
      const relativeDirectory = (target.startsWith("./") || target.startsWith("../")) && targetType === "directory";
      if (!relativeDirectory) {
        return {
          state: "malformed",
          detail: "link protocol requires a relative directory path",
        };
      }
    }
    const kind: DependencyConstraintKind = protocol === "workspace" ? "workspace" : "file";
    return {
      constraint: {
        kind,
        assessment: "unassessed",
        extras: [],
        marker: null,
        directReference: value,
      },
    };
  }

  let parsed: NpmPackageSpec;
  try {
    parsed = npmPackageArg.resolve(packageName, value, ".");
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
    return {
      state: code === "EUNSUPPORTEDPROTOCOL" ? "unsupported" : "malformed",
      detail: safeDetail(error, "npm package-spec parser rejected the declaration"),
    };
  }

  const common = {
    assessment: "unassessed" as const,
    extras: [],
    marker: null,
    directReference: null,
  };
  switch (parsed.type) {
    case "version":
      {
        const exactVersion = parsed.rawSpec.trim().replace(/^=\s*/, "").replace(/^v(?=\d)/i, "");
        return {
          constraint: {
            ...common,
            kind: "exact",
            assessment: "exact_pin",
            exactVersion,
          },
        };
      }
    case "range":
      return { constraint: { ...common, kind: "range" } };
    case "tag":
      return { constraint: { ...common, kind: "tag" } };
    case "alias":
      return { constraint: { ...common, kind: "alias", directReference: value } };
    case "file":
    case "directory":
      return { constraint: { ...common, kind: "file", directReference: value } };
    case "git":
    case "remote":
      return { constraint: { ...common, kind: "direct", directReference: value } };
    default:
      return { state: "unsupported", detail: `npm package-spec parser returned unsupported type '${String(parsed.type)}'` };
  }
}

function parseNpm(entry: ManifestInventoryEntry, commit: string): ParsedManifest {
  if (entry.diagnostic) {
    return {
      evidence: evidence(entry, commit, "unavailable", 0),
      facts: [],
      diagnostics: [diagnostic(entry, commit, "unavailable", entry.diagnostic)],
    };
  }
  let value: unknown;
  try {
    const text = entry.text!.charCodeAt(0) === 0xfeff ? entry.text!.slice(1) : entry.text!;
    value = JSON.parse(text);
  } catch (error) {
    return {
      evidence: evidence(entry, commit, "malformed", 0),
      facts: [],
      diagnostics: [diagnostic(entry, commit, "malformed", safeDetail(error, "JSON parser rejected the document"))],
    };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      evidence: evidence(entry, commit, "wrong_shape", 0),
      facts: [],
      diagnostics: [diagnostic(entry, commit, "wrong_shape", "document root must be an object", "")],
    };
  }
  const record = value as Record<string, unknown>;
  const facts: DependencyFact[] = [];
  const diagnostics: DependencyDiagnostic[] = [];
  for (const { key, group } of NPM_GROUPS) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
    const declarations = record[key];
    if (!declarations || typeof declarations !== "object" || Array.isArray(declarations)) {
      diagnostics.push(diagnostic(entry, commit, "wrong_shape", `'${key}' must be an object`, `/${key}`));
      continue;
    }
    for (const [name, raw] of Object.entries(declarations as Record<string, unknown>)) {
      const locator = `/${key}/${pointerSegment(name)}`;
      if (!name.trim() || typeof raw !== "string") {
        diagnostics.push(diagnostic(
          entry,
          commit,
          "wrong_shape",
          `'${key}' entries must map non-empty package names to strings`,
          locator,
        ));
        continue;
      }
      const parsed = npmConstraint(name, raw);
      if ("state" in parsed) {
        diagnostics.push(diagnostic(entry, commit, parsed.state, parsed.detail, locator));
        continue;
      }
      const packageName = normalizeNpmName(name);
      facts.push({
        ecosystem: "npm",
        packageName,
        scope: npmScope(packageName),
        group,
        rawDeclaration: raw,
        constraint: parsed.constraint,
        provenance: provenance(entry, commit, locator),
      });
    }
  }
  const state = diagnostics.reduce<DependencyEvidenceState>(
    (current, item) => STATE_RANK[item.state] > STATE_RANK[current] ? item.state : current,
    facts.length ? "detected" : "absent",
  );
  return { evidence: evidence(entry, commit, state, facts.length), facts, diagnostics };
}

function markerText(marker: EnvironmentMarker): string {
  if ("left" in marker && "right" in marker && (marker.operator === "and" || marker.operator === "or")) {
    return `(${markerText(marker.left)} ${marker.operator} ${markerText(marker.right)})`;
  }
  return `${marker.left} ${marker.operator} ${marker.right}`;
}

interface ParsedPythonRequirement {
  requirement: Requirement | null;
  markerOverride: string | null;
}

function replaceArbitraryEqualityOperators(value: string): { text: string; count: number } {
  let quote: "'" | '"' | null = null;
  let text = "";
  let count = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (quote !== null) {
      text += character;
      if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      text += character;
      continue;
    }
    if (value.startsWith("===", index)) {
      text += "==";
      count += 1;
      index += 2;
      continue;
    }
    text += character;
  }
  return { text, count };
}

function markerSeparatorIndex(value: string): number {
  let quote: "'" | '"' | null = null;
  let separator = -1;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (quote !== null) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === ";") separator = index;
  }
  return separator;
}

function manifestPackageIdentities(entry: ManifestInventoryEntry, commit: string): DependencyPackageIdentity[] {
  if (entry.diagnostic || entry.text === undefined) return [];
  try {
    if (entry.kind === "package.json") {
      const value = JSON.parse(entry.text) as unknown;
      if (!value || typeof value !== "object" || Array.isArray(value)) return [];
      const name = (value as Record<string, unknown>).name;
      return typeof name === "string" && name.trim()
        ? [{ ecosystem: "npm", packageName: normalizeNpmName(name), provenance: provenance(entry, commit, "/name") }]
        : [];
    }
    const document = parseTomlRecord(entry.path, entry.text);
    const project = ownTomlValue(document, "project");
    const name = isTomlRecord(project) ? ownTomlValue(project, "name") : undefined;
    return typeof name === "string" && name.trim()
      ? [{ ecosystem: "pypi", packageName: normalizePythonName(name), provenance: provenance(entry, commit, "/project/name") }]
      : [];
  } catch {
    return [];
  }
}

function withoutTrailingVersionComma(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.endsWith(",")) return trimmed.slice(0, -1).trim();
  if (/,\s*\)$/.test(trimmed)) return trimmed.replace(/,\s*\)$/, ")");
  return null;
}

interface ArbitraryEqualityRewrite {
  text: string;
  specs: Array<{ operator: string; version: string }>;
}

function rewriteArbitraryEqualityRequirement(value: string): ArbitraryEqualityRewrite | null {
  const operators = ["===", "~=", "==", "!=", "<=", ">=", "<", ">"];
  let bracketDepth = 0;
  let specifierIndex = -1;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (character === "[") {
      bracketDepth += 1;
      continue;
    }
    if (character === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      continue;
    }
    if (bracketDepth === 0 && operators.some((operator) => value.startsWith(operator, index))) {
      specifierIndex = index;
      break;
    }
  }
  if (specifierIndex < 0) return null;

  let prefix = value.slice(0, specifierIndex).trim();
  let specifierText = value.slice(specifierIndex).trim();
  const parenthesized = prefix.endsWith("(");
  if (parenthesized) {
    prefix = prefix.slice(0, -1).trim();
    if (!specifierText.endsWith(")")) return null;
    specifierText = specifierText.slice(0, -1).trim();
  }
  if (specifierText.endsWith(",")) specifierText = specifierText.slice(0, -1).trim();
  const specs = specifierText.split(",").map((clause) => {
    const match = /^(===|~=|==|!=|<=|>=|<|>)\s*(.*)$/.exec(clause.trim());
    return match ? { operator: match[1]!, version: match[2]!.trim() } : null;
  });
  if (
    !prefix
    || specs.some((item) => item === null)
    || !specs.some((item) => item?.operator === "===")
    || specs.some((item) => item?.operator === "===" && /\s/.test(item.version))
  ) {
    return null;
  }
  const complete = specs as Array<{ operator: string; version: string }>;
  const rewrittenSpecs = complete.map((item) => (
    item.operator === "===" ? "==0" : `${item.operator}${item.version}`
  )).join(",");
  return {
    text: parenthesized ? `${prefix} (${rewrittenSpecs})` : `${prefix}${rewrittenSpecs}`,
    specs: complete,
  };
}

function parsePythonRequirement(raw: string): ParsedPythonRequirement {
  try {
    return { requirement: parsePipRequirementsLine(raw), markerOverride: null };
  } catch (strictError) {
    const markerIndex = markerSeparatorIndex(raw);
    const requirementText = markerIndex < 0 ? raw : raw.slice(0, markerIndex);
    const markerTextOriginal = markerIndex < 0 ? "" : raw.slice(markerIndex + 1).trim();
    const transformedMarker = replaceArbitraryEqualityOperators(markerTextOriginal);

    let requirementOnly: Requirement | null = null;
    let trailingComma = false;
    try {
      requirementOnly = parsePipRequirementsLine(requirementText.trim());
    } catch {
      const trimmedRequirement = requirementText.trim();
      const withoutTrailingComma = withoutTrailingVersionComma(trimmedRequirement);
      if (withoutTrailingComma !== null) {
        try {
          requirementOnly = parsePipRequirementsLine(withoutTrailingComma);
          trailingComma = requirementOnly !== null;
        } catch {
          // The maintained strict parser also does not currently accept
          // PEP 440's arbitrary-equality operator; validate that below.
        }
      }
    }

    if (requirementOnly !== null) {
      if (markerIndex < 0) {
        if (trailingComma) {
          return { requirement: requirementOnly, markerOverride: null };
        }
        throw strictError;
      }
      if (requirementOnly.type !== "ProjectName" && requirementOnly.type !== "ProjectURL") throw strictError;
      const markerCarrier = parsePipRequirementsLine(`devharmonics-marker ; ${transformedMarker.text}`);
      if (
        markerCarrier?.type !== "ProjectName"
        || markerCarrier.environmentMarkerTree === undefined
      ) {
        throw strictError;
      }
      return {
        requirement: {
          ...requirementOnly,
          environmentMarkerTree: markerCarrier.environmentMarkerTree,
        },
        markerOverride: transformedMarker.count > 0 ? markerTextOriginal : null,
      };
    }

    const rewritten = rewriteArbitraryEqualityRequirement(requirementText);
    if (rewritten === null) throw strictError;
    const markerSuffix = markerIndex < 0 ? "" : ` ; ${transformedMarker.text}`;
    const parsed = parsePipRequirementsLine(`${rewritten.text}${markerSuffix}`);
    if (
      !parsed
      || parsed.type !== "ProjectName"
      || (parsed.versionSpec ?? []).length !== rewritten.specs.length
    ) {
      throw strictError;
    }
    parsed.versionSpec = parsed.versionSpec!.map((spec, index) => {
      const original = rewritten.specs[index]!;
      const expectedVersion = original.operator === "===" ? "0" : original.version;
      if (expectedVersion !== spec.version || (original.operator !== "===" && original.operator !== spec.operator)) {
        throw strictError;
      }
      return original.operator === "==="
        ? { operator: VersionOperator.ArbitrarilyEqual, version: original.version }
        : spec;
    });
    return {
      requirement: parsed,
      markerOverride: transformedMarker.count > 0 ? markerTextOriginal : null,
    };
  }
}

function pythonConstraint(requirement: Requirement, markerOverride: string | null): DependencyConstraint | null {
  if (requirement.type === "RequirementsFile" || requirement.type === "ConstraintsFile") return null;
  const extras = [...(requirement.extras ?? [])].map((item) => normalizePythonName(item)).sort();
  const marker = markerOverride
    ?? (requirement.environmentMarkerTree ? markerText(requirement.environmentMarkerTree) : null);
  if (requirement.type === "ProjectURL") {
    return {
      kind: "direct",
      assessment: "unassessed",
      extras,
      marker,
      directReference: requirement.url,
    };
  }
  const specs = requirement.versionSpec ?? [];
  const exact = specs.length === 1 && (
    specs[0]!.operator === "===" || (specs[0]!.operator === "==" && !specs[0]!.version.includes("*"))
  ) ? specs[0]!.version : undefined;
  return {
    kind: exact !== undefined ? "exact" : specs.length ? "range" : "unversioned",
    assessment: exact !== undefined && marker === null ? "exact_pin" : "unassessed",
    ...(exact !== undefined ? { exactVersion: exact } : {}),
    extras,
    marker,
    directReference: null,
  };
}

function parsePythonDeclaration(
  entry: ManifestInventoryEntry,
  commit: string,
  declaration: PythonDeclaration,
): { fact?: DependencyFact; diagnostic?: DependencyDiagnostic } {
  let parsed: ParsedPythonRequirement;
  try {
    parsed = parsePythonRequirement(declaration.raw);
  } catch (error) {
    return {
      diagnostic: diagnostic(
        entry,
        commit,
        "malformed",
        safeDetail(error, "PEP 508 parser rejected the declaration"),
        declaration.locator,
      ),
    };
  }
  const { requirement, markerOverride } = parsed;
  if (!requirement) {
    return {
      diagnostic: diagnostic(
        entry,
        commit,
        "malformed",
        "PEP 508 declaration must identify a package",
        declaration.locator,
      ),
    };
  }
  if (requirement.type === "ProjectURL" && !requirement.url.trim()) {
    return {
      diagnostic: diagnostic(
        entry,
        commit,
        "malformed",
        "PEP 508 direct references require a non-empty URL",
        declaration.locator,
      ),
    };
  }
  if (
    requirement.type === "ProjectName"
    && (requirement.versionSpec?.length ?? 0) > 0
    && !validPep440Range(requirement.versionSpec!.map((item) => `${item.operator}${item.version}`).join(","))
  ) {
    return {
      diagnostic: diagnostic(
        entry,
        commit,
        "malformed",
        "PEP 440 validator rejected the version specifier",
        declaration.locator,
      ),
    };
  }
  const constraint = pythonConstraint(requirement, markerOverride);
  if (!constraint || !("name" in requirement)) {
    return {
      diagnostic: diagnostic(
        entry,
        commit,
        "unsupported",
        "PEP 621 dependency arrays cannot include requirements-file or constraints-file directives",
        declaration.locator,
      ),
    };
  }
  return {
    fact: {
      ecosystem: "pypi",
      packageName: normalizePythonName(requirement.name),
      scope: declaration.scope,
      group: declaration.group,
      rawDeclaration: declaration.raw,
      constraint,
      provenance: provenance(entry, commit, declaration.locator),
    },
  };
}

function stringArray(
  value: unknown,
  entry: ManifestInventoryEntry,
  commit: string,
  locator: string,
  diagnostics: DependencyDiagnostic[],
): string[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    diagnostics.push(diagnostic(entry, commit, "wrong_shape", "dependency declarations must be an array of non-empty strings", locator));
    return null;
  }
  return value as string[];
}

function validPythonExtraName(value: string): boolean {
  return !/[\r\n]/.test(value) && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

function parsePyproject(entry: ManifestInventoryEntry, commit: string): ParsedManifest {
  if (entry.diagnostic) {
    return {
      evidence: evidence(entry, commit, "unavailable", 0),
      facts: [],
      diagnostics: [diagnostic(entry, commit, "unavailable", entry.diagnostic)],
    };
  }
  let document;
  try {
    document = parseTomlRecord(entry.path, entry.text!);
  } catch (error) {
    const detail = error instanceof TomlParseFailure ? error.message : safeDetail(error, "TOML parser rejected the document");
    return {
      evidence: evidence(entry, commit, "malformed", 0),
      facts: [],
      diagnostics: [diagnostic(entry, commit, "malformed", detail)],
    };
  }

  const declarations: PythonDeclaration[] = [];
  const diagnostics: DependencyDiagnostic[] = [];
  let dynamicDependencies = false;
  let dynamicOptionalDependencies = false;
  let staticDependenciesPresent = false;
  let staticOptionalDependenciesPresent = false;
  const project = ownTomlValue(document, "project");
  if (project !== undefined && !isTomlRecord(project)) {
    diagnostics.push(diagnostic(entry, commit, "wrong_shape", "'project' must be a table", "/project"));
  } else if (isTomlRecord(project)) {
    const dynamicValue = ownTomlValue(project, "dynamic");
    if (dynamicValue !== undefined) {
      if (!Array.isArray(dynamicValue) || dynamicValue.some((item) => typeof item !== "string")) {
        diagnostics.push(diagnostic(entry, commit, "wrong_shape", "'project.dynamic' must be an array of strings", "/project/dynamic"));
      } else {
        dynamicDependencies = dynamicValue.includes("dependencies");
        dynamicOptionalDependencies = dynamicValue.includes("optional-dependencies");
      }
    }
    const runtime = ownTomlValue(project, "dependencies");
    staticDependenciesPresent = runtime !== undefined;
    if (runtime !== undefined) {
      if (dynamicDependencies) {
        diagnostics.push(diagnostic(
          entry,
          commit,
          "wrong_shape",
          "'project.dependencies' cannot be both static and dynamic",
          "/project/dependencies",
        ));
      } else {
        const values = stringArray(runtime, entry, commit, "/project/dependencies", diagnostics);
        values?.forEach((raw, index) => declarations.push({
          raw,
          group: "runtime",
          scope: null,
          locator: `/project/dependencies/${index}`,
        }));
      }
    }
    const optional = ownTomlValue(project, "optional-dependencies");
    staticOptionalDependenciesPresent = optional !== undefined;
    if (optional !== undefined) {
      if (dynamicOptionalDependencies) {
        diagnostics.push(diagnostic(
          entry,
          commit,
          "wrong_shape",
          "'project.optional-dependencies' cannot be both static and dynamic",
          "/project/optional-dependencies",
        ));
      } else if (!isTomlRecord(optional)) {
        diagnostics.push(diagnostic(
          entry,
          commit,
          "wrong_shape",
          "'project.optional-dependencies' must be a table",
          "/project/optional-dependencies",
        ));
      } else {
        const groups = Object.entries(optional);
        const normalizedCounts = new Map<string, number>();
        for (const [groupName] of groups) {
          if (!validPythonExtraName(groupName)) continue;
          const normalized = pythonScope(groupName);
          normalizedCounts.set(normalized, (normalizedCounts.get(normalized) ?? 0) + 1);
        }
        for (const [groupName, groupValue] of groups) {
          const locator = `/project/optional-dependencies/${pointerSegment(groupName)}`;
          if (!validPythonExtraName(groupName)) {
            diagnostics.push(diagnostic(
              entry,
              commit,
              "wrong_shape",
              `'${groupName}' is not a valid PEP 685 extra name`,
              locator,
            ));
            continue;
          }
          const scope = pythonScope(groupName);
          if ((normalizedCounts.get(scope) ?? 0) > 1) {
            diagnostics.push(diagnostic(
              entry,
              commit,
              "wrong_shape",
              `'${groupName}' collides with another optional dependency group after PEP 685 normalization`,
              locator,
            ));
            continue;
          }
          const values = stringArray(groupValue, entry, commit, locator, diagnostics);
          values?.forEach((raw, index) => declarations.push({
            raw,
            group: "optional",
            scope,
            locator: `${locator}/${index}`,
          }));
        }
      }
    }
  }

  const buildSystem = ownTomlValue(document, "build-system");
  if (buildSystem !== undefined) {
    if (!isTomlRecord(buildSystem)) {
      diagnostics.push(diagnostic(entry, commit, "wrong_shape", "'build-system' must be a table", "/build-system"));
    } else {
      const requires = ownTomlValue(buildSystem, "requires");
      if (requires === undefined) {
        diagnostics.push(diagnostic(
          entry,
          commit,
          "wrong_shape",
          "'build-system.requires' is required when the table is present",
          "/build-system/requires",
        ));
      } else {
        const values = stringArray(requires, entry, commit, "/build-system/requires", diagnostics);
        values?.forEach((raw, index) => declarations.push({
          raw,
          group: "build",
          scope: null,
          locator: `/build-system/requires/${index}`,
        }));
      }
    }
  }

  const facts: DependencyFact[] = [];
  for (const declaration of declarations) {
    const parsed = parsePythonDeclaration(entry, commit, declaration);
    if (parsed.fact) facts.push(parsed.fact);
    if (parsed.diagnostic) diagnostics.push(parsed.diagnostic);
  }
  if (dynamicDependencies || dynamicOptionalDependencies) {
    const fields = [
      ...(dynamicDependencies && !staticDependenciesPresent ? ["dependencies"] : []),
      ...(dynamicOptionalDependencies && !staticOptionalDependenciesPresent ? ["optional-dependencies"] : []),
    ];
    if (fields.length) {
      diagnostics.push(diagnostic(
        entry,
        commit,
        "dynamic",
        `project ${fields.join(" and ")} are declared dynamically; exact declarations are unavailable`,
        "/project/dynamic",
      ));
    }
  }
  let state: DependencyEvidenceState;
  if (diagnostics.some((item) => item.state === "malformed")) state = "malformed";
  else if (diagnostics.some((item) => item.state === "wrong_shape")) state = "wrong_shape";
  else if (diagnostics.some((item) => item.state === "unsupported")) state = "unsupported";
  else if (dynamicDependencies || dynamicOptionalDependencies) state = "dynamic";
  else state = facts.length ? "detected" : "absent";
  return { evidence: evidence(entry, commit, state, facts.length), facts, diagnostics };
}

function compareDiagnostics(left: DependencyDiagnostic, right: DependencyDiagnostic): number {
  const leftKey = `${left.path ?? ""}\0${left.locator ?? ""}\0${left.state}\0${left.detail}`;
  const rightKey = `${right.path ?? ""}\0${right.locator ?? ""}\0${right.state}\0${right.detail}`;
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

export function extractDependencyDeclarations(inventory: ManifestInventory): DependencyExtraction {
  if (inventory.state === "unavailable") {
    return {
      state: "unavailable",
      commit: inventory.commit,
      facts: [],
      identities: [],
      manifests: [],
      diagnostics: [{ state: "unavailable", commit: inventory.commit, detail: inventory.detail }],
    };
  }
  const parsed = inventory.entries.map((entry) => (
    entry.kind === "package.json" ? parseNpm(entry, inventory.commit) : parsePyproject(entry, inventory.commit)
  ));
  const manifests = parsed.map((item) => item.evidence);
  const facts = parsed.flatMap((item) => item.facts);
  const identities = inventory.entries.flatMap((entry) => manifestPackageIdentities(entry, inventory.commit));
  const diagnostics = parsed.flatMap((item) => item.diagnostics).sort(compareDiagnostics);
  const state = manifests.reduce<DependencyEvidenceState>(
    (current, item) => STATE_RANK[item.state] > STATE_RANK[current] ? item.state : current,
    facts.length ? "detected" : "absent",
  );
  return { state, commit: inventory.commit, facts, identities, manifests, diagnostics };
}

export async function discoverDependenciesAtCommit(
  root: string,
  commit: string,
  runner?: ProcessRunner,
): Promise<DependencyExtraction> {
  return extractDependencyDeclarations(await inventoryManifestsAtCommit(root, commit, runner));
}
