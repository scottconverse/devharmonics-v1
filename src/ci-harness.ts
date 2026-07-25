import ts from "typescript";
import { parseDocument } from "yaml";
import type { ProcessResult } from "./process.js";

export const REVIEWED_ACTION_SHAS = {
  "actions/checkout": "d23441a48e516b6c34aea4fa41551a30e30af803",
  "actions/setup-node": "249970729cb0ef3589644e2896645e5dc5ba9c38",
} as const;

function bindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((element) => (ts.isOmittedExpression(element) ? [] : bindingNames(element.name)));
}

function directlyDeclaredNames(node: ts.SourceFile | ts.Block): Set<string> {
  const names = new Set<string>();
  for (const statement of node.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        bindingNames(declaration.name).forEach((name) => names.add(name));
      }
    } else if (
      (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
      statement.name
    ) {
      names.add(statement.name.text);
    }
  }
  return names;
}

function isShadowed(identifier: ts.Identifier, importedName: string, sourceFile: ts.SourceFile): boolean {
  let current: ts.Node | undefined = identifier.parent;
  while (current && current !== sourceFile) {
    if (ts.isFunctionLike(current)) {
      if (current.parameters.some((parameter) => bindingNames(parameter.name).includes(importedName))) return true;
      if (
        (ts.isFunctionDeclaration(current) || ts.isFunctionExpression(current)) &&
        current.name?.text === importedName
      ) {
        return true;
      }
    }
    if (ts.isBlock(current) && directlyDeclaredNames(current).has(importedName)) return true;
    if (ts.isCatchClause(current) && current.variableDeclaration) {
      if (bindingNames(current.variableDeclaration.name).includes(importedName)) return true;
    }
    if (
      (ts.isForStatement(current) && current.initializer && ts.isVariableDeclarationList(current.initializer)) ||
      ((ts.isForInStatement(current) || ts.isForOfStatement(current)) && ts.isVariableDeclarationList(current.initializer))
    ) {
      const declarations = current.initializer.declarations;
      if (declarations.some((declaration) => bindingNames(declaration.name).includes(importedName))) return true;
    }
    current = current.parent;
  }
  return false;
}

export function countDeclaredNodeTests(source: string, fileName: string): number {
  const syntax = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const diagnostics = (syntax as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
  if (diagnostics.length > 0) {
    const detail = diagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")).join("; ");
    throw new Error(`${fileName}: cannot count node:test declarations because the source is malformed: ${detail}`);
  }
  const testBindings = new Set<string>();
  const namespaceBindings = new Set<string>();
  for (const statement of syntax.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== "node:test" ||
      !statement.importClause
    ) {
      continue;
    }
    if (statement.importClause.name) testBindings.add(statement.importClause.name.text);
    const bindings = statement.importClause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) {
      namespaceBindings.add(bindings.name.text);
    } else if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        if ((element.propertyName?.text ?? element.name.text) === "test") testBindings.add(element.name.text);
      }
    }
  }

  let count = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      const isDirectTest =
        ts.isIdentifier(expression) &&
        testBindings.has(expression.text) &&
        !isShadowed(expression, expression.text, syntax);
      const isQualifiedTest =
        ts.isPropertyAccessExpression(expression) &&
        ts.isIdentifier(expression.expression) &&
        testBindings.has(expression.expression.text) &&
        !isShadowed(expression.expression, expression.expression.text, syntax) &&
        ["only", "skip", "todo"].includes(expression.name.text);
      const isNamespaceTest =
        ts.isPropertyAccessExpression(expression) &&
        ts.isIdentifier(expression.expression) &&
        namespaceBindings.has(expression.expression.text) &&
        !isShadowed(expression.expression, expression.expression.text, syntax) &&
        expression.name.text === "test";
      const isQualifiedNamespaceTest =
        ts.isPropertyAccessExpression(expression) &&
        ts.isPropertyAccessExpression(expression.expression) &&
        ts.isIdentifier(expression.expression.expression) &&
        namespaceBindings.has(expression.expression.expression.text) &&
        !isShadowed(expression.expression.expression, expression.expression.expression.text, syntax) &&
        expression.expression.name.text === "test" &&
        ["only", "skip", "todo"].includes(expression.name.text);
      if (isDirectTest || isQualifiedTest || isNamespaceTest || isQualifiedNamespaceTest) count++;
    }
    ts.forEachChild(node, visit);
  };
  visit(syntax);
  return count;
}

export function validateWorkflowPolicy(workflow: string): string[] {
  const failures: string[] = [];
  let root: unknown;
  try {
    const document = parseDocument(workflow, {
      version: "1.2",
      strict: true,
      uniqueKeys: true,
      merge: true,
    });
    failures.push(
      ...document.errors.map(
        (error) => `workflow YAML must reject every duplicate or non-unique key: ${error.message}`,
      ),
    );
    root = document.toJS({ maxAliasCount: 100 });
  } catch (error) {
    return [`workflow YAML must parse safely: ${error instanceof Error ? error.message : String(error)}`];
  }

  if (!isStringRecord(root)) return ["workflow root must be a YAML mapping"];

  const permissions = root.permissions;
  if (
    !isStringRecord(permissions) ||
    Object.keys(permissions).length !== 1 ||
    permissions.contents !== "read"
  ) {
    failures.push("workflow permissions must remain contents: read");
  }

  const jobs = root.jobs;
  if (!isStringRecord(jobs) || Object.keys(jobs).length === 0) {
    failures.push("workflow must expose at least one top-level job");
    return failures;
  }

  const reviewedActions = new Set<keyof typeof REVIEWED_ACTION_SHAS>();
  const validateUses = (value: unknown, location: string, step?: Record<string, unknown>): void => {
    if (typeof value !== "string") {
      failures.push(`${location}: uses must resolve to a string`);
      return;
    }
    if (value.startsWith("./")) return;
    const match = value.match(/^([^@\s]+)@([0-9a-fA-F]{40})$/);
    if (!match) {
      failures.push(`${location}: remote action must use an immutable 40-hex SHA: ${value}`);
      return;
    }
    const action = match[1]!;
    const sha = match[2]!.toLowerCase();
    const normalizedAction = action.toLowerCase();
    if (!(normalizedAction in REVIEWED_ACTION_SHAS)) return;
    const reviewed = normalizedAction as keyof typeof REVIEWED_ACTION_SHAS;
    reviewedActions.add(reviewed);
    const expected = REVIEWED_ACTION_SHAS[reviewed];
    if (sha !== expected) failures.push(`${location}: ${action} must use reviewed SHA ${expected}`);
    if (reviewed === "actions/checkout" && step) {
      const withValue = step.with;
      const persistCredentials = isStringRecord(withValue) ? withValue["persist-credentials"] : undefined;
      if (persistCredentials !== false && persistCredentials !== "false") {
        failures.push(`${location}: actions/checkout must set persist-credentials: false`);
      }
    }
  };

  for (const [jobName, jobValue] of Object.entries(jobs)) {
    if (!/^[A-Za-z0-9_-]+$/.test(jobName) || !isStringRecord(jobValue)) {
      failures.push(`${jobName || "<empty>"}: every job must be a named YAML mapping`);
      continue;
    }
    const timeout = jobValue["timeout-minutes"];
    if (!Number.isInteger(timeout) || (timeout as number) < 1 || (timeout as number) > 30) {
      failures.push(`${jobName}: expected exactly one timeout-minutes value in the range 1..30`);
    }
    if (Object.hasOwn(jobValue, "permissions")) {
      failures.push(`${jobName}: job-level permissions are not allowed; workflow permissions must remain contents: read`);
    }
    if (Object.hasOwn(jobValue, "uses")) validateUses(jobValue.uses, `${jobName} job`);
    if (Object.hasOwn(jobValue, "steps")) {
      if (!Array.isArray(jobValue.steps)) {
        failures.push(`${jobName}: steps must resolve to a YAML sequence`);
      } else {
        jobValue.steps.forEach((step, index) => {
          if (!isStringRecord(step)) {
            failures.push(`${jobName} step ${index + 1}: every step must resolve to a YAML mapping`);
          } else if (Object.hasOwn(step, "uses")) {
            validateUses(step.uses, `${jobName} step ${index + 1}`, step);
          }
        });
      }
    }
  }

  for (const action of reviewedActions) {
    const expected = REVIEWED_ACTION_SHAS[action];
    const escapedAction = action.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const readablePin = new RegExp(
      `\\b${escapedAction}@${expected}\\b[^\\r\\n]*#\\s*v6\\s*$`,
      "mi",
    );
    if (!readablePin.test(workflow)) failures.push(`${action} must retain the readable # v6 comment`);
  }
  return failures;
}

function isStringRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateReadmeReleaseScope(
  readme: string,
  version: string,
  mode: "development" | "release" = "development",
): string[] {
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const failures: string[] = [];
  if (!new RegExp(`Latest tagged release:\\s*\\*\\*v${escapedVersion}\\*\\*`, "i").test(readme)) {
    failures.push(`Latest tagged release: **v${version}**`);
  }
  const unreleasedMain = new RegExp(`unreleased\\s+(?:\`?main\`?)\\s+after\\s+v${escapedVersion}`, "i");
  if (mode === "development") {
    if (!unreleasedMain.test(readme)) failures.push(`This branch: **unreleased main after v${version}**`);
  } else {
    if (!new RegExp(`This checkout:\\s*\\*\\*tagged release v${escapedVersion}\\*\\*`, "i").test(readme)) {
      failures.push(`This checkout: **tagged release v${version}**`);
    }
    if (unreleasedMain.test(readme)) failures.push("tagged release checkout must not claim to be unreleased main");
  }
  if (mode === "development" && !/Project status[\s\S]*describes\s+`?main`?/i.test(readme)) {
    failures.push("the project-status section must explicitly describe main");
  }
  if (
    mode === "release" &&
    !new RegExp(`Project status[\\s\\S]*describes\\s+(?:the\\s+)?tagged release v${escapedVersion}`, "i").test(readme)
  ) {
    failures.push(`the project-status section must explicitly describe tagged release v${version}`);
  }
  if (!new RegExp(`git checkout v${escapedVersion}`, "i").test(readme)) {
    failures.push(`source-install guidance must include git checkout v${version}`);
  }
  if (!/continuously verified on Windows and Ubuntu; macOS verification is currently manual/i.test(readme)) {
    failures.push("continuous verification is limited to Windows and Ubuntu, with macOS identified as manual");
  }
  return failures;
}

export function validateSupportingDocumentReleaseScope(
  document: string,
  version: string,
  label: "Manual target" | "Architecture snapshot",
  mode: "development" | "release",
): string[] {
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const developmentMarker = new RegExp(
    `${escapedLabel}:\\s*\\*\\*unreleased\\s+\`?main\`?\\s+after\\s+v${escapedVersion}\\*\\*`,
    "i",
  );
  const releaseMarker = new RegExp(
    `${escapedLabel}:\\s*\\*\\*tagged\\s+release\\s+v${escapedVersion}\\*\\*`,
    "i",
  );
  const failures: string[] = [];
  if (mode === "development") {
    if (!developmentMarker.test(document)) failures.push(`${label}: **unreleased main after v${version}**`);
    if (releaseMarker.test(document)) failures.push(`${label} on development main must not claim to be a tagged release`);
  } else {
    if (!releaseMarker.test(document)) failures.push(`${label}: **tagged release v${version}**`);
    if (developmentMarker.test(document)) failures.push(`${label} in a tagged release must not claim to be unreleased main`);
  }
  return failures;
}

export function validateRollbackGuide(rollback: string): string[] {
  const failures: string[] = [];
  if (!/Every rollback path below is schema-crossing/i.test(rollback)) failures.push("count-independent opening language");
  if (!/Copy-Item[^\r\n]*-LiteralPath\s+\$\w+(?:\.FullName)?[^\r\n]*-Destination\s+\$\w+/i.test(rollback)) {
    failures.push("Copy-Item with one exact -LiteralPath and explicit staged destination");
  }
  if (!/Move-Item[^\r\n]*-LiteralPath\s+\$\w+[^\r\n]*-Destination\s+\$liveLedger/i.test(rollback)) {
    failures.push("Move-Item with one exact -LiteralPath and the live-ledger destination");
  }
  if (!/PRAGMA\s+user_version/i.test(rollback)) failures.push("pre-restore PRAGMA user_version check");
  if (!/PRAGMA\s+integrity_check/i.test(rollback)) failures.push("pre-restore PRAGMA integrity_check check");
  if (/(?:Copy|Move)-Item[^\r\n]*\*/i.test(rollback)) failures.push("no wildcard Copy-Item or Move-Item restore");
  return failures;
}

export interface CiChildContext {
  operation: string;
  timeoutMs: number;
  file?: string;
  seed?: string;
  sentinelName?: string;
  phase?: string;
}

function childDiagnostic(result: ProcessResult, context: CiChildContext): string {
  const fields = [
    `operation=${context.operation}`,
    context.file ? `file=${context.file}` : undefined,
    context.seed ? `seed=${context.seed}` : undefined,
    context.sentinelName ? `sentinel=${context.sentinelName}` : undefined,
    context.phase ? `phase=${context.phase}` : undefined,
    `timeoutMs=${context.timeoutMs}`,
    `elapsedMs=${result.durationMs}`,
    `exitCode=${result.exitCode}`,
    "exitSignal=unavailable",
    `timedOut=${result.timedOut}`,
    `treeTermination=${result.treeKillUnconfirmed ? "unconfirmed" : "confirmed"}`,
    `stdoutTruncated=${result.stdoutTruncated ?? false}`,
    `stderrTruncated=${result.stderrTruncated ?? false}`,
  ].filter(Boolean);
  const output = `${result.stdout}${result.stderr}`.trim().slice(-4_000);
  return `${fields.join(" ")}${output ? `\nCaptured output:\n${output}` : ""}`;
}

export function assertCiChildResult(
  result: ProcessResult,
  context: CiChildContext,
  expected: { exit: "zero" } | { exit: "nonzero"; outputIncludes: string },
): void {
  const diagnostic = childDiagnostic(result, context);
  if (result.treeKillUnconfirmed) throw new Error(`CI child process-tree termination is unconfirmed.\n${diagnostic}`);
  if (result.timedOut) throw new Error(`CI child exceeded its configured timeout; termination confirmed.\n${diagnostic}`);
  if (expected.exit === "zero") {
    if (result.exitCode !== 0) throw new Error(`CI child exited nonzero.\n${diagnostic}`);
    return;
  }
  const output = `${result.stdout}${result.stderr}`;
  if (result.exitCode === 0) throw new Error(`CI mutation child unexpectedly stayed green.\n${diagnostic}`);
  if (!output.includes(expected.outputIncludes)) {
    throw new Error(`CI mutation child went red for an unexpected reason.\n${diagnostic}`);
  }
}

function seedToUint32(seed: string): number {
  let hash = 0x811c9dc5;
  for (const character of seed) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function nextRandom(state: number): [number, number] {
  const nextState = (state + 0x6d2b79f5) >>> 0;
  let value = nextState;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return [nextState, ((value ^ (value >>> 14)) >>> 0) / 4294967296];
}

export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const shuffled = [...items];
  let state = seedToUint32(seed);
  for (let index = shuffled.length - 1; index > 0; index--) {
    let random: number;
    [state, random] = nextRandom(state);
    const swapIndex = Math.floor(random * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex]!, shuffled[index]!];
  }
  return shuffled;
}

export function replaceExactlyOnce(source: string, target: string, replacement: string): string {
  if (!target) throw new Error("Mutation target must not be empty");
  let count = 0;
  let offset = 0;
  while ((offset = source.indexOf(target, offset)) !== -1) {
    count++;
    offset += target.length;
  }
  if (count !== 1) throw new Error(`Mutation target must occur exactly once; found ${count}`);
  return source.replace(target, replacement);
}
