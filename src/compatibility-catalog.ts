import { createPublicKey, verify } from "node:crypto";
import { z } from "zod";

const timestamp = z.string().datetime({ offset: true });
const catalogSchema = z.object({
  schemaVersion: z.literal(1),
  catalogVersion: z.number().int().positive(),
  generatedAt: timestamp,
  expiresAt: timestamp,
  models: z.array(z.object({ provider: z.string().min(1), canonicalName: z.string().min(1), displayName: z.string().min(1) }).passthrough()),
}).strict();

export type CompatibilityCatalog = z.infer<typeof catalogSchema>;
export interface SignedCompatibilityCatalog { keyId: string; catalog: CompatibilityCatalog; signature: string; }
export interface CatalogAcceptance {
  status: "accepted" | "rejected" | "invalid";
  reason: string;
  catalog?: CompatibilityCatalog;
  /** Present only after the envelope signature has verified against an app-shipped root. */
  keyId?: string;
}

// This root is shipped with the application. Future keys and revocations must
// arrive in an app release; catalog delivery never establishes new trust.
export const COMPATIBILITY_ROOTS: Readonly<Record<string, string>> = {
  "dh-root-2026": "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAv9Z0Xj7HhoxivBqkck49hRSAnhgNuududVnomIs2upM=\n-----END PUBLIC KEY-----\n",
};
export const REVOKED_COMPATIBILITY_KEYS = new Set<string>();
/** Transport endpoint only: roots and revocations remain application-shipped. */
export const COMPATIBILITY_CATALOG_URL = "https://raw.githubusercontent.com/scottconverse/DevHarmonics/main/catalog/compatibility-catalog.v1.json";
export const BUNDLED_COMPATIBILITY_CATALOG: SignedCompatibilityCatalog = {
  keyId: "dh-root-2026",
  catalog: { schemaVersion: 1, catalogVersion: 1, generatedAt: "2026-07-29T00:00:00.000Z", expiresAt: "2027-07-01T00:00:00.000Z", models: [{ provider: "codex", canonicalName: "gpt-5.6", displayName: "GPT-5.6" }] },
  signature: "rkgP9kt6IpgjlXe78W7HO1nzzdREFA0zlvqu+jcpYcGL7dx3wctj0N7Y2rwHCBihPeggvHOe3/idX9jVFoTsCA==",
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

export function acceptCompatibilityCatalog(input: unknown, roots: Readonly<Record<string, string>> = COMPATIBILITY_ROOTS, acceptedVersion = 0, now = new Date(), revokedKeys: ReadonlySet<string> = REVOKED_COMPATIBILITY_KEYS): CatalogAcceptance {
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
  const generatedAt = Date.parse(catalog.generatedAt);
  const expiresAt = Date.parse(catalog.expiresAt);
  if (!Number.isFinite(generatedAt) || !Number.isFinite(expiresAt) || generatedAt > now.getTime() || expiresAt <= now.getTime()) return { status: "invalid", reason: "Catalog timestamps are not currently valid" };
  if (catalog.catalogVersion < acceptedVersion) return { status: "rejected", reason: "Catalog version is older than the accepted version", catalog, keyId };
  if (catalog.catalogVersion === acceptedVersion) return { status: "rejected", reason: "Catalog version matches the accepted version", catalog, keyId };
  return { status: "accepted", reason: "Signature, schema, timestamps, and version accepted", catalog, keyId };
}
