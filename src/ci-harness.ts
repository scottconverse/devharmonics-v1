import ts from "typescript";
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
  if (workflow.includes("\t")) failures.push("workflow must not contain ambiguous tab indentation");
  const lines = workflow.split(/\r?\n/);
  const jobsHeaders = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => /^jobs:\s*(?:#.*)?$/.test(line));
  const jobs: Array<{ name: string; lineIndex: number }> = [];
  if (jobsHeaders.length !== 1) {
    failures.push("workflow must expose at least one top-level job");
  } else {
    const start = jobsHeaders[0]!.index + 1;
    let end = lines.length;
    for (let index = start; index < lines.length; index += 1) {
      const line = lines[index]!;
      if (line.trim() && !line.trim().startsWith("#") && !/^\s/.test(line)) {
        end = index;
        break;
      }
    }
    const seenJobs = new Set<string>();
    for (let index = start; index < end; index += 1) {
      const line = lines[index]!;
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const indent = line.match(/^\s*/)?.[0].length ?? 0;
      if (indent !== 2) continue;
      const match = line.match(/^  (?:"([A-Za-z0-9_-]+)"|'([A-Za-z0-9_-]+)'|([A-Za-z0-9_-]+)):\s*(?:#.*)?$/);
      if (!match) {
        failures.push(`line ${index + 1}: unrecognized job declaration must not bypass policy: ${trimmed}`);
        continue;
      }
      const name = (match[1] ?? match[2] ?? match[3])!;
      if (seenJobs.has(name)) failures.push(`line ${index + 1}: duplicate job declaration is not allowed: ${name}`);
      seenJobs.add(name);
      jobs.push({ name, lineIndex: index });
    }
    if (jobs.length === 0) failures.push("workflow must expose at least one top-level job");

    for (const [index, job] of jobs.entries()) {
      const blockEnd = index + 1 < jobs.length ? jobs[index + 1]!.lineIndex : end;
      const block = lines.slice(job.lineIndex, blockEnd).join("\n");
      const timeouts = [...block.matchAll(/^\s{4}(?:"timeout-minutes"|'timeout-minutes'|timeout-minutes)\s*:\s*(\d+)\s*$/gm)];
      if (
        timeouts.length !== 1 ||
        Number(timeouts[0]?.[1]) < 1 ||
        Number(timeouts[0]?.[1]) > 30
      ) {
        failures.push(`${job.name}: expected exactly one timeout-minutes value in the range 1..30`);
      }
      if (/^\s{4}(?:"permissions"|'permissions'|permissions)\s*:/m.test(block)) {
        failures.push(`${job.name}: job-level permissions are not allowed; workflow permissions must remain contents: read`);
      }
    }
  }

  const permissionHeaders = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => /^(?:"permissions"|'permissions'|permissions)\s*:/.test(line));
  let permissionsAreReadOnly =
    permissionHeaders.length === 1 &&
    /^(?:"permissions"|'permissions'|permissions)\s*:\s*$/.test(permissionHeaders[0]!.line);
  if (permissionsAreReadOnly) {
    const start = permissionHeaders[0]!.index + 1;
    const block: string[] = [];
    for (let index = start; index < lines.length; index += 1) {
      const line = lines[index]!;
      if (line && !/^\s/.test(line)) break;
      if (line.trim() && !line.trim().startsWith("#")) block.push(line.trim());
    }
    permissionsAreReadOnly =
      block.length === 1 &&
      /^(?:"contents"|'contents'|contents)\s*:\s*read\s*$/.test(block[0]!);
  }
  if (!permissionsAreReadOnly) {
    failures.push("workflow permissions must remain contents: read");
  }

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const usesMatch = trimmed.match(/^(?:-\s*)?(?:"uses"|'uses'|uses)\s*:\s*(.+?)\s*$/);
    if (!usesMatch) {
      if (
        /(?:^|[\s{,])(?:"uses"|'uses'|uses)\s*:/.test(trimmed) ||
        /^(?:-\s*)?\?\s*(?:"uses"|'uses'|uses)\s*$/.test(trimmed)
      ) {
        failures.push(`line ${index + 1}: ambiguous uses syntax is not allowed: ${trimmed}`);
      }
      return;
    }
    let reference = usesMatch[1]!.replace(/\s+#.*$/, "").trim();
    if (
      (reference.startsWith('"') && reference.endsWith('"')) ||
      (reference.startsWith("'") && reference.endsWith("'"))
    ) {
      reference = reference.slice(1, -1);
    }
    if (reference.startsWith("./")) return;
    const match = reference.match(/^([^@\s]+)@([0-9a-fA-F]{40})$/);
    if (!match) {
      failures.push(`line ${index + 1}: remote action must use an immutable 40-hex SHA: ${trimmed}`);
      return;
    }
    const action = match[1]!;
    const sha = match[2]!;
    if (action in REVIEWED_ACTION_SHAS) {
      const expected = REVIEWED_ACTION_SHAS[action as keyof typeof REVIEWED_ACTION_SHAS];
      if (sha.toLowerCase() !== expected) failures.push(`line ${index + 1}: ${action} must use reviewed SHA ${expected}`);
      if (!/\s+#\s*v6\s*$/.test(trimmed)) failures.push(`line ${index + 1}: ${action} must retain the readable # v6 comment`);
      if (action === "actions/checkout") {
        const stepIndent = line.match(/^\s*/)?.[0].length ?? 0;
        const usesKeyIndent = stepIndent + (trimmed.match(/^-\s*/)?.[0].length ?? 0);
        const following = lines.slice(index + 1).findIndex((candidate) => {
          const indent = candidate.match(/^\s*/)?.[0].length ?? 0;
          return candidate.trim().startsWith("- ") && indent <= stepIndent;
        });
        const end = following < 0 ? lines.length : index + 1 + following;
        const stepLines = lines.slice(index + 1, end);
        const withHeaders = stepLines
          .map((candidate, stepIndex) => ({
            line: candidate,
            stepIndex,
            indent: candidate.match(/^\s*/)?.[0].length ?? 0,
          }))
          .filter(({ line: candidate, indent }) =>
            indent === usesKeyIndent &&
            /^(?:"with"|'with'|with)\s*:\s*(?:#.*)?$/.test(candidate.trim()),
          );
        let persistsNoCredentials = false;
        if (withHeaders.length === 1) {
          const withHeader = withHeaders[0]!;
          const withBody: string[] = [];
          for (let stepIndex = withHeader.stepIndex + 1; stepIndex < stepLines.length; stepIndex += 1) {
            const candidate = stepLines[stepIndex]!;
            const indent = candidate.match(/^\s*/)?.[0].length ?? 0;
            if (candidate.trim() && indent <= withHeader.indent) break;
            if (candidate.trim() && !candidate.trim().startsWith("#")) withBody.push(candidate);
          }
          persistsNoCredentials = withBody.some((candidate) => {
            const indent = candidate.match(/^\s*/)?.[0].length ?? 0;
            return (
              indent > withHeader.indent &&
              /^(?:"persist-credentials"|'persist-credentials'|persist-credentials)\s*:\s*(?:false|"false"|'false')\s*(?:#.*)?$/.test(
                candidate.trim(),
              )
            );
          });
        }
        if (!persistsNoCredentials) {
          failures.push(`line ${index + 1}: actions/checkout must set persist-credentials: false`);
        }
      }
    }
  });
  return failures;
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
