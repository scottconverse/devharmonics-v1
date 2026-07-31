import { createHash, createPublicKey, verify } from "node:crypto";
import { z } from "zod";

const timestamp = z.string().datetime({ offset: true });
const catalogSchema = z.object({
  schemaVersion: z.literal(1),
  catalogVersion: z.number().int().positive(),
  generatedAt: timestamp,
  expiresAt: timestamp,
  models: z.array(z.object({
    provider: z.string().min(1),
    canonicalName: z.string().min(1),
    displayName: z.string().min(1),
    tier: z.enum(["economy", "standard", "premium"]).optional(),
    family: z.string().min(1).optional(),
    capabilities: z.array(z.string().min(1)).optional(),
    officialSource: z.string().url().optional(),
  }).strict()),
}).strict();

export type CompatibilityCatalog = z.infer<typeof catalogSchema>;
export interface SignedCompatibilityCatalog { keyId: string; catalog: CompatibilityCatalog; signature: string; }
export interface CatalogAcceptance {
  status: "accepted" | "rejected" | "invalid";
  reason: string;
  catalog?: CompatibilityCatalog;
  /** SHA-256 of the verified canonical catalog payload. */
  digest?: string;
  /** Present only after the envelope signature has verified against an app-shipped root. */
  keyId?: string;
}

// This root is shipped with the application. Future keys and revocations must
// arrive in an app release; catalog delivery never establishes new trust.
export const COMPATIBILITY_ROOTS: Readonly<Record<string, string>> = {
  "dh-root-2026-v2": "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAlXMYhPUhN5E/Pbrgq6rzNq+2omgkzZvzGEcyKxEqIrc=\n-----END PUBLIC KEY-----\n",
};
export const REVOKED_COMPATIBILITY_KEYS = new Set<string>(["dh-root-2026"]);
/** Transport endpoint only: roots and revocations remain application-shipped. */
export const COMPATIBILITY_CATALOG_URL = "https://raw.githubusercontent.com/scottconverse/DevHarmonics/main/catalog/compatibility-catalog.v1.json";
export const BUNDLED_COMPATIBILITY_CATALOG: SignedCompatibilityCatalog = {
  keyId: "dh-root-2026-v2",
  catalog: {
    schemaVersion: 1,
    catalogVersion: 1,
    generatedAt: "2026-07-29T00:00:00.000Z",
    expiresAt: "2027-07-01T00:00:00.000Z",
    models: [
      { provider: "codex", canonicalName: "gpt-5.6-sol", displayName: "GPT-5.6-Sol", tier: "premium", family: "openai-sol", capabilities: ["text", "analysis", "code", "tools"], officialSource: "https://openai.com/index/gpt-5-6/" },
      { provider: "codex", canonicalName: "gpt-5.6-terra", displayName: "GPT-5.6-Terra", tier: "standard", family: "openai-terra", capabilities: ["text", "analysis", "code", "tools"], officialSource: "https://openai.com/index/gpt-5-6/" },
      { provider: "codex", canonicalName: "gpt-5.6-luna", displayName: "GPT-5.6-Luna", tier: "economy", family: "openai-luna", capabilities: ["text", "analysis", "code", "tools"], officialSource: "https://openai.com/index/gpt-5-6/" },
      { provider: "claude", canonicalName: "claude-fable-5", displayName: "Claude Fable 5", tier: "premium", family: "claude-fable", capabilities: ["text", "analysis", "code", "tools", "vision", "cyber-restricted"], officialSource: "https://support.claude.com/en/articles/11940350-claude-code-model-configuration" },
      { provider: "claude", canonicalName: "claude-opus-4-8", displayName: "Claude Opus 4.8", tier: "premium", family: "claude-opus", capabilities: ["text", "analysis", "code", "tools", "vision"], officialSource: "https://support.claude.com/en/articles/11940350-claude-code-model-configuration" },
      { provider: "claude", canonicalName: "claude-sonnet-5", displayName: "Claude Sonnet 5", tier: "standard", family: "claude-sonnet", capabilities: ["text", "analysis", "code", "tools", "vision"], officialSource: "https://support.claude.com/en/articles/11940350-claude-code-model-configuration" },
      { provider: "claude", canonicalName: "claude-haiku-4-5-20251001", displayName: "Claude Haiku 4.5", tier: "economy", family: "claude-haiku", capabilities: ["text", "analysis", "code", "tools", "vision"], officialSource: "https://support.claude.com/en/articles/11940350-claude-code-model-configuration" },
      { provider: "claude", canonicalName: "claude-opus-4-7", displayName: "Claude Opus 4.7", tier: "premium", family: "claude-opus", capabilities: ["text", "analysis", "code", "tools", "vision"], officialSource: "https://support.claude.com/en/articles/11940350-claude-code-model-configuration" },
      { provider: "claude", canonicalName: "claude-sonnet-4-6", displayName: "Claude Sonnet 4.6", tier: "standard", family: "claude-sonnet", capabilities: ["text", "analysis", "code", "tools", "vision"], officialSource: "https://support.claude.com/en/articles/11940350-claude-code-model-configuration" },
      { provider: "claude", canonicalName: "claude-opus-4-6", displayName: "Claude Opus 4.6", tier: "premium", family: "claude-opus", capabilities: ["text", "analysis", "code", "tools", "vision"], officialSource: "https://support.claude.com/en/articles/11940350-claude-code-model-configuration" },
      { provider: "claude", canonicalName: "claude-opus-4-5-20251101", displayName: "Claude Opus 4.5", tier: "premium", family: "claude-opus", capabilities: ["text", "analysis", "code", "tools", "vision"], officialSource: "https://support.claude.com/en/articles/11940350-claude-code-model-configuration" },
      { provider: "claude", canonicalName: "claude-sonnet-4-5-20250929", displayName: "Claude Sonnet 4.5", tier: "standard", family: "claude-sonnet", capabilities: ["text", "analysis", "code", "tools", "vision"], officialSource: "https://support.claude.com/en/articles/11940350-claude-code-model-configuration" },
    ],
  },
  signature: "+JwGom4zzbPh3AIKP8QJ58PpuZQ7JCce2pIK9jSBMA+HCbs2lRwLOb3NpCTLzH0sxgu53cnGpAo5Rbtz/U19DA==",
};

/** Stable JSON for detached signatures: object keys sort recursively, arrays retain order. */
export function canonicalCatalogJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalCatalogJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalCatalogJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function acceptCompatibilityCatalog(
  input: unknown,
  roots: Readonly<Record<string, string>> = COMPATIBILITY_ROOTS,
  acceptedVersion = 0,
  now = new Date(),
  revokedKeys: ReadonlySet<string> = REVOKED_COMPATIBILITY_KEYS,
  acceptedDigest: string | null = null,
): CatalogAcceptance {
  const envelope = z.object({ keyId: z.string().min(1), catalog: catalogSchema, signature: z.string().min(1) }).safeParse(input);
  if (!envelope.success) return { status: "invalid", reason: "Catalog schema is invalid" };
  const { keyId, catalog, signature } = envelope.data;
  if (revokedKeys.has(keyId)) return { status: "invalid", reason: `Catalog key '${keyId}' is revoked` };
  const root = roots[keyId];
  if (!root) return { status: "invalid", reason: `Catalog key '${keyId}' is not trusted` };
  try {
    if (!verify(null, Buffer.from(canonicalCatalogJson(catalog)), createPublicKey(root), Buffer.from(signature, "base64"))) {
      return { status: "invalid", reason: "Catalog signature did not verify" };
    }
  } catch {
    return { status: "invalid", reason: "Catalog signature could not be verified" };
  }
  const digest = createHash("sha256").update(canonicalCatalogJson(catalog)).digest("hex");
  const generatedAt = Date.parse(catalog.generatedAt);
  const expiresAt = Date.parse(catalog.expiresAt);
  if (!Number.isFinite(generatedAt) || !Number.isFinite(expiresAt) || generatedAt > now.getTime() || expiresAt <= now.getTime()) return { status: "invalid", reason: "Catalog timestamps are not currently valid" };
  if (catalog.catalogVersion < acceptedVersion) return { status: "rejected", reason: "Catalog version is older than the accepted version", catalog, digest, keyId };
  if (catalog.catalogVersion === acceptedVersion) {
    if (!acceptedDigest || digest !== acceptedDigest) return { status: "invalid", reason: "Catalog content changed without a version increment" };
    return { status: "rejected", reason: "Catalog version and content match the accepted catalog", catalog, digest, keyId };
  }
  return { status: "accepted", reason: "Signature, schema, timestamps, and version accepted", catalog, digest, keyId };
}
