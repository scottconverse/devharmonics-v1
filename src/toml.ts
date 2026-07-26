import { parse } from "toml";

export type TomlRecord = Record<string, unknown>;

export class TomlParseFailure extends Error {
  constructor(
    public readonly source: string,
    public readonly line: number | null,
    public readonly column: number | null,
    detail: string,
  ) {
    const location = line === null ? "" : ` at line ${line}${column === null ? "" : `, column ${column}`}`;
    super(`${source} is not valid TOML${location}: ${detail}`);
    this.name = "TomlParseFailure";
  }
}

export function isTomlRecord(value: unknown): value is TomlRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function ownTomlValue(record: TomlRecord, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

function safeParseDetail(error: unknown): { line: number | null; column: number | null; detail: string } {
  const candidate = error && typeof error === "object" ? error as {
    message?: unknown;
    location?: { start?: { line?: unknown; column?: unknown } };
  } : {};
  const line = Number.isSafeInteger(candidate.location?.start?.line) ? Number(candidate.location!.start!.line) : null;
  const column = Number.isSafeInteger(candidate.location?.start?.column) ? Number(candidate.location!.start!.column) : null;
  const raw = typeof candidate.message === "string" ? candidate.message : "parser rejected the document";
  const detail = raw.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 200)
    || "parser rejected the document";
  return { line, column, detail };
}

export function parseTomlRecord(source: string, text: string): TomlRecord {
  try {
    const parsed = parse(text, { maxDepth: 100 }) as unknown;
    if (!isTomlRecord(parsed)) {
      throw new TomlParseFailure(source, null, null, "document root must be a table");
    }
    return parsed;
  } catch (error) {
    if (error instanceof TomlParseFailure) throw error;
    const detail = safeParseDetail(error);
    throw new TomlParseFailure(source, detail.line, detail.column, detail.detail);
  }
}
