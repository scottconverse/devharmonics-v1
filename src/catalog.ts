import type { DevHarmonicsConfig } from "./types.js";
import { loadConfig } from "./config.js";
import { inspectProviders, type ProviderStatus } from "./doctor.js";
import type { Ledger } from "./ledger.js";
import { modelQualificationFingerprint } from "./model-fingerprint.js";
import { inferModelProfile, profileMetadata } from "./model-intelligence.js";
import { syncOllamaRuntimes, type OllamaDiscovery } from "./ollama.js";
import { QUALIFICATION_FINGERPRINT_FIXTURE } from "./qualification.js";
import { syncSubscriptionConnections } from "./registry.js";
import { OpenRouterService } from "./openrouter.js";
import { acceptCompatibilityCatalog, BUNDLED_COMPATIBILITY_CATALOG, COMPATIBILITY_CATALOG_URL, type CatalogAcceptance } from "./compatibility-catalog.js";

const CLAUDE_MODELS_URL = "https://platform.claude.com/docs/en/about-claude/models/overview";
const DEFAULT_REFRESH_HOURS = 24;
const FAILED_REFRESH_RETRY_MS = 5 * 60_000;

export interface CatalogRefreshResult {
  config: DevHarmonicsConfig;
  providers: ProviderStatus[];
  ollama: OllamaDiscovery[];
  refreshedAt: string;
  compatibilityTrust: ReturnType<Ledger["compatibilityCatalogTrust"]>;
}

export interface ModelCatalogCoordinatorOptions {
  /** Test seam for deterministic catalog delivery failures and envelopes. */
  fetch?: typeof fetch;
  /** Test seam for deterministic provider/runtime discovery. */
  inspectProviders?: typeof inspectProviders;
}

export class ModelCatalogCoordinator {
  private refreshInFlight: Promise<CatalogRefreshResult> | null = null;
  private periodicTimer: NodeJS.Timeout | null = null;
  private periodicStarted = false;

  constructor(private readonly ledger: Ledger, private readonly projectPath: string, private readonly options: ModelCatalogCoordinatorOptions = {}) {}

  async refresh(force = false, source = "manual"): Promise<CatalogRefreshResult> {
    if (this.refreshInFlight) return this.refreshInFlight;
    if (!force && !this.isStale()) return this.snapshot();
    this.refreshInFlight = this.performRefresh(source).finally(() => {
      this.refreshInFlight = null;
      if (this.periodicStarted) this.schedulePeriodic();
    });
    return this.refreshInFlight;
  }

  async ensureFresh(): Promise<CatalogRefreshResult> {
    const config = await loadConfig(this.projectPath);
    const stale = this.isStale();
    const providers = await (this.options.inspectProviders ?? inspectProviders)(config, this.projectPath);
    const knownVersions = new Map(this.ledger.listConnections().map((connection) => [connection.provider, connection.runtimeVersion]));
    const versionChanged = providers.some((provider) => provider.installed && knownVersions.get(provider.name) !== (provider.version || null));
    return stale || versionChanged ? this.refresh(true, stale ? "pre_run_stale" : "pre_run_runtime_changed") : this.snapshot(config, providers);
  }

  startPeriodic(): void {
    if (this.periodicStarted) return;
    this.periodicStarted = true;
    this.schedulePeriodic();
  }

  private schedulePeriodic(): void {
    if (!this.periodicStarted) return;
    if (this.periodicTimer) clearTimeout(this.periodicTimer);
    this.periodicTimer = setTimeout(() => {
      this.periodicTimer = null;
      void this.refresh(true, "periodic").catch((error) => {
        this.ledger.recordCatalogRefresh({ provider: "coordinator", status: "failed", source: "periodic", modelCount: 0, detail: error instanceof Error ? error.message : String(error) });
      });
    }, this.nextPeriodicDelayMs());
    this.periodicTimer.unref();
  }

  stop(): void {
    this.periodicStarted = false;
    if (this.periodicTimer) clearTimeout(this.periodicTimer);
    this.periodicTimer = null;
  }

  private isStale(): boolean {
    const refresh = this.ledger.listCatalogRefreshes().find((item) => item.provider === "coordinator");
    return !refresh
      || refresh.status === "failed"
      || Date.now() - Date.parse(refresh.refreshedAt) >= DEFAULT_REFRESH_HOURS * 60 * 60_000
      || this.compatibilityTrustExpired();
  }

  private compatibilityTrustExpired(now = Date.now()): boolean {
    const expiresAt = this.ledger.compatibilityCatalogTrust().expiresAt;
    return Boolean(expiresAt) && Date.parse(expiresAt!) <= now;
  }

  private nextPeriodicDelayMs(now = Date.now()): number {
    const defaultDelay = DEFAULT_REFRESH_HOURS * 60 * 60_000;
    const trust = this.ledger.compatibilityCatalogTrust();
    const expiresAt = trust.expiresAt ? Date.parse(trust.expiresAt) : Number.NaN;
    if (!Number.isFinite(expiresAt)) return defaultDelay;
    const untilExpiry = expiresAt - now;
    return untilExpiry > 0 ? Math.min(defaultDelay, untilExpiry) : FAILED_REFRESH_RETRY_MS;
  }

  private async snapshot(config?: DevHarmonicsConfig, providers?: ProviderStatus[]): Promise<CatalogRefreshResult> {
    const resolvedConfig = config ?? await loadConfig(this.projectPath);
    return {
      config: resolvedConfig,
      providers: providers ?? await (this.options.inspectProviders ?? inspectProviders)(resolvedConfig, this.projectPath),
      ollama: [],
      refreshedAt: newestRefresh(this.ledger) ?? new Date(0).toISOString(),
      compatibilityTrust: this.ledger.compatibilityCatalogTrust(),
    };
  }

  private async performRefresh(source: string): Promise<CatalogRefreshResult> {
    const config = await loadConfig(this.projectPath);
    const openRouter = new OpenRouterService(this.ledger);
    await openRouter.syncConnection(config.openRouter.enabled);
    const providers = await (this.options.inspectProviders ?? inspectProviders)(config, this.projectPath);
    syncSubscriptionConnections(this.ledger, providers);
    const compatibility = await this.refreshCompatibilityCatalog(providers);
    this.ledger.reconcileLegacyAntigravityQuotaHealth();
    for (const provider of providers) {
      this.ledger.recordCatalogRefresh({
        provider: provider.name,
        status: provider.installed ? "success" : "failed",
        source: provider.name === "claude" ? "Claude CLI control plane" : `${provider.name} runtime catalog`,
        modelCount: provider.visibleModels.length,
        detail: provider.summary,
      });
    }

    const claudeOfficialSucceeded = await this.refreshClaudeOfficialCatalog();
    let openRouterFailed = false;
    try {
      await openRouter.syncCatalog();
    } catch (error) {
      openRouterFailed = true;
      this.ledger.recordCatalogRefresh({ provider: "openrouter", status: "failed", source: "https://openrouter.ai/api/v1/models", modelCount: 0, detail: error instanceof Error ? error.message : String(error) });
    }
    const ollama = await syncOllamaRuntimes(this.ledger, config.localRuntimes.ollama);
    this.ledger.recordCatalogRefresh({
      provider: "ollama",
      status: ollama.some((runtime) => runtime.available) ? "success" : "failed",
      source: "Ollama runtime discovery",
      modelCount: ollama.reduce((total, runtime) => total + runtime.models.length, 0),
      detail: ollama.some((runtime) => runtime.available) ? "Local runtime catalogs refreshed" : "No configured Ollama runtime was reachable",
    });
    this.refreshFingerprints();
    const failedProviders = providers.filter((provider) => provider.enabled && provider.installed && !provider.healthy).map((provider) => provider.name);
    const failedRequired = [
      ...failedProviders,
      ...(!compatibility.liveSucceeded ? ["compatibility-live"] : []),
      ...(this.ledger.compatibilityCatalogTrust().trustState === "invalid" ? ["compatibility"] : []),
      ...(!claudeOfficialSucceeded ? ["claude-official"] : []),
      ...(config.openRouter.enabled && openRouterFailed ? ["openrouter"] : []),
    ];
    this.ledger.recordCatalogRefresh({
      provider: "coordinator",
      status: failedRequired.length ? "failed" : "success",
      source,
      modelCount: this.ledger.listModels().filter((model) => !model.retired).length,
      detail: failedRequired.length ? `Catalog refresh incomplete; failed required components: ${failedRequired.join(", ")}` : "All configured provider and local-runtime catalogs were checked",
    });
    return { config, providers, ollama, refreshedAt: newestRefresh(this.ledger) ?? new Date().toISOString(), compatibilityTrust: this.ledger.compatibilityCatalogTrust() };
  }

  private async refreshCompatibilityCatalog(providers: ProviderStatus[]): Promise<{ acceptance: CatalogAcceptance; liveSucceeded: boolean }> {
    const priorTrust = this.ledger.compatibilityCatalogTrust();
    let liveAcceptance: CatalogAcceptance | null = null;
    let liveFailure: string | null = null;
    try {
      const response = await (this.options.fetch ?? fetch)(COMPATIBILITY_CATALOG_URL, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`DevHarmonics returned HTTP ${response.status}`);
      liveAcceptance = acceptCompatibilityCatalog(await response.json(), undefined, priorTrust.acceptedVersion, new Date(), undefined, priorTrust.catalogDigest);
      if (liveAcceptance.status === "invalid"
        || liveAcceptance.status === "rejected" && liveAcceptance.catalog?.catalogVersion !== priorTrust.acceptedVersion) {
        liveFailure = liveAcceptance.reason;
      }
    } catch (error) {
      liveFailure = error instanceof Error ? error.message : String(error);
    }
    if (!liveFailure && liveAcceptance) {
      this.applyVerifiedCompatibilityCatalog(liveAcceptance, providers, "accepted", liveAcceptance.reason);
      this.ledger.recordCatalogRefresh({ provider: "compatibility-live", status: "success", source: COMPATIBILITY_CATALOG_URL, modelCount: liveAcceptance.catalog?.models.length ?? 0, detail: liveAcceptance.reason });
      this.ledger.recordCatalogRefresh({ provider: "compatibility", status: "success", source: COMPATIBILITY_CATALOG_URL, modelCount: liveAcceptance.catalog?.models.length ?? 0, detail: liveAcceptance.reason });
      return { acceptance: liveAcceptance, liveSucceeded: true };
    }
    const fallback = acceptCompatibilityCatalog(BUNDLED_COMPATIBILITY_CATALOG, undefined, priorTrust.acceptedVersion, new Date(), undefined, priorTrust.catalogDigest);
    const fallbackIsCurrent = fallback.status === "accepted"
      || fallback.status === "rejected" && fallback.catalog?.catalogVersion === priorTrust.acceptedVersion;
    const retained = !fallbackIsCurrent
      && priorTrust.trustState !== "invalid"
      && Boolean(priorTrust.expiresAt)
      && Date.parse(priorTrust.expiresAt!) > Date.now();
    const detail = `Live delivery failed: ${liveFailure}; ${fallbackIsCurrent ? "bundled signed catalog retained" : fallback.reason}`;
    if (fallbackIsCurrent) {
      this.applyVerifiedCompatibilityCatalog(fallback, providers, "stale", detail);
      this.ledger.staleCompatibilityQualifications(detail);
    } else if (retained) {
      this.ledger.recordCompatibilityCatalogTrust({ ...priorTrust, lastAttemptAt: new Date().toISOString(), trustState: "stale", failureReason: `${detail}; retained last valid snapshot` });
      this.ledger.staleCompatibilityQualifications(detail);
    } else {
      this.ledger.staleCompatibilityQualifications(detail);
      this.ledger.recordCompatibilityCatalogTrust({ ...priorTrust, lastAttemptAt: new Date().toISOString(), trustState: "invalid", failureReason: detail });
    }
    this.ledger.recordCatalogRefresh({ provider: "compatibility-live", status: "failed", source: COMPATIBILITY_CATALOG_URL, modelCount: 0, detail });
    this.ledger.recordCatalogRefresh({ provider: "compatibility", status: fallbackIsCurrent || retained ? "success" : "failed", source: "bundled signed DevHarmonics compatibility catalog", modelCount: fallback.catalog?.models.length ?? 0, detail });
    return { acceptance: fallback, liveSucceeded: false };
  }

  private applyVerifiedCompatibilityCatalog(
    acceptance: CatalogAcceptance,
    providers: ProviderStatus[],
    trustState: "accepted" | "stale",
    failureReason: string,
  ): void {
    if (!acceptance.catalog || !acceptance.keyId) return;
    this.ledger.recordCompatibilityCatalogTrust({
      acceptedVersion: acceptance.catalog.catalogVersion,
      catalogDigest: acceptance.digest ?? null,
      keyId: acceptance.keyId,
      generatedAt: acceptance.catalog.generatedAt,
      expiresAt: acceptance.catalog.expiresAt,
      acceptedAt: new Date().toISOString(),
      trustState,
      failureReason,
    });
    const signedIdsByProvider = new Map<string, string[]>();
    for (const entry of acceptance.catalog.models) {
      const provider = providers.find((item) => item.name === entry.provider);
      if (!provider) continue;
      const modelId = `subscription-cli:${entry.provider}:model:${normalizeModelId(entry.canonicalName)}`;
      const signedIds = signedIdsByProvider.get(entry.provider) ?? [];
      signedIds.push(modelId);
      signedIdsByProvider.set(entry.provider, signedIds);
      const existing = this.ledger.getModel(modelId);
      if (existing && existing.source !== "compatibility_catalog") {
        // Runtime/account/provider observations are independent, stronger facts.
        // The signed catalog must not overwrite their visibility or provenance.
        continue;
      }
      const inferred = inferModelProfile({ canonicalName: entry.canonicalName, displayName: entry.displayName, metadata: {} }, { provider: entry.provider, transport: "subscription_cli" });
      const signedProfile = entry.tier && entry.family && entry.capabilities
        ? { tier: entry.tier, family: entry.family, capabilities: entry.capabilities, source: "catalog" as const, reasoningEffort: null, confidence: "official" as const, evidenceUrls: entry.officialSource ? [entry.officialSource] : [] }
        : { ...inferred, source: "catalog" as const, confidence: "official" as const };
      this.ledger.upsertDiscoveredModel({ id: modelId, connectionId: `subscription-cli:${entry.provider}`, canonicalName: entry.canonicalName, displayName: entry.displayName, source: "compatibility_catalog", lifecycle: "known", visible: false, verified: false, qualified: false, active: false, metadata: { signedCatalogVersion: acceptance.catalog.catalogVersion, requiresRuntimeQualification: true, ...profileMetadata(signedProfile) } });
    }
    for (const provider of providers) {
      this.ledger.reconcileDiscoveredModels(
        `subscription-cli:${provider.name}`,
        "compatibility_catalog",
        signedIdsByProvider.get(provider.name) ?? [],
        3,
      );
    }
  }

  private async refreshClaudeOfficialCatalog(): Promise<boolean> {
    try {
      const response = await (this.options.fetch ?? fetch)(CLAUDE_MODELS_URL, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`Anthropic returned HTTP ${response.status}`);
      const models = parseCurrentClaudeModels(await response.text());
      if (models.length < 4) throw new Error("Anthropic catalog did not expose all four current model families");
      const invalidExisting = this.ledger.listModels("subscription-cli:claude")
        .filter((model) => model.source === "provider_catalog" && !validClaudeModelId(model.canonicalName))
        .map((model) => model.id);
      this.ledger.retireInvalidModels(invalidExisting, "Rejected malformed Claude catalog identifier");
      const modelIds: string[] = [];
      const catalogModels: Array<{ id: string; canonicalName: string; displayName: string; metadata: Readonly<Record<string, unknown>> }> = [];
      for (const canonicalName of models) {
        const id = `subscription-cli:claude:model:${normalizeModelId(canonicalName)}`;
        modelIds.push(id);
        catalogModels.push({ id, canonicalName, displayName: displayClaudeName(canonicalName), metadata: { officialSource: CLAUDE_MODELS_URL, requiresRuntimeQualification: true } });
        const inferred = inferModelProfile({ canonicalName, displayName: displayClaudeName(canonicalName), metadata: {} }, { provider: "claude", transport: "subscription_cli" });
        this.ledger.upsertDiscoveredModel({
          id,
          connectionId: "subscription-cli:claude",
          canonicalName,
          displayName: displayClaudeName(canonicalName),
          source: "provider_catalog",
          lifecycle: "known",
          visible: false,
          verified: false,
          qualified: false,
          active: false,
          metadata: {
            officialCatalog: true,
            officialSource: CLAUDE_MODELS_URL,
            requiresRuntimeQualification: true,
            ...profileMetadata({ ...inferred, source: "catalog", confidence: "official", evidenceUrls: [CLAUDE_MODELS_URL] }),
          },
        });
      }
      this.ledger.upsertProviderCatalogModels("claude", catalogModels, 3);
      this.ledger.reconcileDiscoveredModels("subscription-cli:claude", "provider_catalog", modelIds, 3);
      this.ledger.recordCatalogRefresh({ provider: "claude-official", status: "success", source: CLAUDE_MODELS_URL, modelCount: models.length, detail: "Official Anthropic current-model catalog refreshed" });
      return true;
    } catch (error) {
      this.ledger.recordCatalogRefresh({ provider: "claude-official", status: "failed", source: CLAUDE_MODELS_URL, modelCount: 0, detail: error instanceof Error ? error.message : String(error) });
      return false;
    }
  }

  private refreshFingerprints(): void {
    const connections = new Map(this.ledger.listConnections().map((connection) => [connection.id, connection]));
    for (const model of this.ledger.listModels().filter((item) => !item.retired)) {
      const connection = connections.get(model.connectionId);
      if (!connection) continue;
      this.ledger.applyModelFingerprint(model.id, modelQualificationFingerprint(model, connection, QUALIFICATION_FINGERPRINT_FIXTURE));
    }
  }
}

export function parseCurrentClaudeModels(html: string): string[] {
  const matches = [...html.matchAll(/claude-(fable|opus|sonnet|haiku)-(\d+(?:-\d+)*(?:-\d{8})?)/gi)]
    .map((match) => match[0].toLowerCase())
    .filter(validClaudeModelId);
  const latest = new Map<string, string>();
  for (const model of new Set(matches)) {
    const family = model.split("-")[1]!;
    const existing = latest.get(family);
    if (!existing || compareModelVersions(model, existing) > 0) latest.set(family, model);
  }
  return ["fable", "opus", "sonnet", "haiku"].map((family) => latest.get(family)).filter((value): value is string => Boolean(value));
}

function validClaudeModelId(model: string): boolean {
  const segments = model.match(/\d+/g) ?? [];
  return segments.length > 0 && segments.every((segment, index) => segment.length === 1 || index === segments.length - 1 && segment.length === 8);
}

function compareModelVersions(left: string, right: string): number {
  const numbers = (value: string) => value.match(/\d+/g)?.map(Number) ?? [];
  const leftParts = numbers(left);
  const rightParts = numbers(right);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference) return difference;
  }
  return left.localeCompare(right);
}

function displayClaudeName(model: string): string {
  return model.split("-").map((part, index) => index === 0 ? "Claude" : /^\d+$/.test(part) ? part : `${part[0]?.toUpperCase()}${part.slice(1)}`).join(" ");
}

function normalizeModelId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function newestRefresh(ledger: Ledger): string | null {
  return ledger.listCatalogRefreshes().map((item) => item.refreshedAt).sort().at(-1) ?? null;
}
