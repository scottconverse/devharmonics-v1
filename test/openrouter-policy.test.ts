import assert from "node:assert/strict";
import test from "node:test";
import { OpenRouterService } from "../src/openrouter.js";
import type { DevHarmonicsConfig } from "../src/types.js";

type ScopeType = "run" | "workbench";

class FakePaidSpendLedger {
  readonly activeReservations = new Set<string>();
  readonly reserveInputs: Array<{ scopeType: ScopeType; scopeId: string; estimatedCostUsd: number }> = [];
  releaseCount = 0;
  markInvokedCount = 0;
  markInvokedError: Error | null = null;
  private nextId = 1;

  reservePaidSpend(input: { scopeType: ScopeType; scopeId: string; estimatedCostUsd: number }): string {
    const id = `reservation-${this.nextId++}`;
    this.reserveInputs.push(input);
    this.activeReservations.add(id);
    return id;
  }

  releasePaidSpendReservation(id: string): void {
    if (this.activeReservations.delete(id)) this.releaseCount += 1;
  }

  markPaidSpendInvoked(_id: string): void {
    this.markInvokedCount += 1;
    if (this.markInvokedError) throw this.markInvokedError;
  }

  settlePaidSpendReservation(id: string): boolean {
    return this.activeReservations.delete(id);
  }
}

function paidConfig(): DevHarmonicsConfig {
  return {
    openRouter: {
      enabled: true,
      allowPaidFallback: true,
      perRunLimitUsd: 1,
      monthlyLimitUsd: 10,
    },
    runPolicy: { allowPaidApi: true },
  } as DevHarmonicsConfig;
}

function serviceWithBalance(balance: unknown): {
  ledger: FakePaidSpendLedger;
  service: OpenRouterService;
  statusCalls: () => number;
} {
  const ledger = new FakePaidSpendLedger();
  const service = new OpenRouterService(ledger as never, {} as never);
  let calls = 0;
  (service as unknown as { status(): Promise<{ connected: boolean; key: Record<string, unknown> }> }).status = async () => {
    calls += 1;
    return {
      connected: true,
      key: balance === undefined ? {} : { limit_remaining: balance },
    };
  };
  return { ledger, service, statusCalls: () => calls };
}

const invalidRemainingCreditCases: Array<{ name: string; value: unknown }> = [
  { name: "missing", value: undefined },
  { name: "null", value: null },
  { name: "non-numeric", value: "not-a-number" },
  { name: "non-finite", value: Number.POSITIVE_INFINITY },
  { name: "negative", value: -1 },
  { name: "zero", value: 0 },
];

test("paid routing rejects every invalid live-credit balance and releases its reservation", async () => {
  const observed = [];
  for (const invalid of invalidRemainingCreditCases) {
    const { ledger, service } = serviceWithBalance(invalid.value);
    let rejected = false;
    try {
      await service.acquirePaidRouting(paidConfig(), "run-1", 0);
    } catch {
      rejected = true;
    }
    observed.push({
      name: invalid.name,
      rejected,
      reservationsCreated: ledger.reserveInputs.length,
      reservationsReleased: ledger.releaseCount,
      activeReservations: ledger.activeReservations.size,
    });
  }
  assert.deepEqual(observed, invalidRemainingCreditCases.map(({ name }) => ({
    name,
    rejected: true,
    reservationsCreated: 1,
    reservationsReleased: 1,
    activeReservations: 0,
  })));
});

test("Workbench admission rejects every invalid live-credit balance and releases its reservation", async () => {
  const observed = [];
  for (const invalid of invalidRemainingCreditCases) {
    const { ledger, service } = serviceWithBalance(invalid.value);
    let rejected = false;
    try {
      await service.acquirePaidWorkbench(paidConfig(), "session-1", 0);
    } catch {
      rejected = true;
    }
    observed.push({
      name: invalid.name,
      rejected,
      reservationsCreated: ledger.reserveInputs.length,
      reservationsReleased: ledger.releaseCount,
      activeReservations: ledger.activeReservations.size,
    });
  }
  assert.deepEqual(observed, invalidRemainingCreditCases.map(({ name }) => ({
    name,
    rejected: true,
    reservationsCreated: 1,
    reservationsReleased: 1,
    activeReservations: 0,
  })));
});

test("qualification rejects every invalid live-credit balance", async () => {
  const observed = [];
  for (const invalid of invalidRemainingCreditCases) {
    const { service } = serviceWithBalance(invalid.value);
    let rejected = false;
    try {
      await service.assertQualificationCredit(0.25);
    } catch {
      rejected = true;
    }
    observed.push({ name: invalid.name, rejected });
  }
  assert.deepEqual(observed, invalidRemainingCreditCases.map(({ name }) => ({ name, rejected: true })));
});

test("qualification fails closed when its estimated cost is unknown", async () => {
  const { service } = serviceWithBalance(10);
  await assert.rejects(
    () => service.assertQualificationCredit(null),
    /estimated qualification cost could not be verified/i,
  );
});

test("routing and Workbench fail closed before reservation when estimated cost is unknown", async () => {
  for (const scope of ["routing", "workbench"] as const) {
    const { ledger, service, statusCalls } = serviceWithBalance(10);
    const admission = scope === "routing"
      ? service.acquirePaidRouting(paidConfig(), "run-1", Number.NaN)
      : service.acquirePaidWorkbench(paidConfig(), "session-1", Number.NaN);
    await assert.rejects(() => admission, /estimated cost could not be verified/i, scope);
    assert.equal(ledger.reserveInputs.length, 0, scope);
    assert.equal(statusCalls(), 0, scope);
  }
});

test("every paid admission helper rejects an omitted or undefined cost before reservation", async () => {
  const admissions: Array<{
    name: string;
    invoke(service: OpenRouterService): Promise<unknown>;
  }> = [
    { name: "routing acquire omitted", invoke: (service) => service.acquirePaidRouting(paidConfig(), "run-1") },
    { name: "routing acquire undefined", invoke: (service) => service.acquirePaidRouting(paidConfig(), "run-1", undefined) },
    { name: "Workbench acquire omitted", invoke: (service) => service.acquirePaidWorkbench(paidConfig(), "session-1") },
    { name: "Workbench acquire undefined", invoke: (service) => service.acquirePaidWorkbench(paidConfig(), "session-1", undefined) },
    { name: "routing assertion omitted", invoke: (service) => service.assertPaidRoutingAllowed(paidConfig(), "run-1") },
    { name: "routing assertion undefined", invoke: (service) => service.assertPaidRoutingAllowed(paidConfig(), "run-1", undefined) },
    { name: "Workbench assertion omitted", invoke: (service) => service.assertPaidWorkbenchAllowed(paidConfig(), "session-1") },
    { name: "Workbench assertion undefined", invoke: (service) => service.assertPaidWorkbenchAllowed(paidConfig(), "session-1", undefined) },
  ];
  for (const admission of admissions) {
    const { ledger, service, statusCalls } = serviceWithBalance(10);
    await assert.rejects(() => admission.invoke(service), /estimated cost could not be verified/i, admission.name);
    assert.equal(ledger.reserveInputs.length, 0, admission.name);
    assert.equal(statusCalls(), 0, admission.name);
  }
});

test("a positive sufficient live-credit balance admits routing, Workbench, and qualification", async () => {
  const routing = serviceWithBalance(0.25);
  const routingReservation = await routing.service.acquirePaidRouting(paidConfig(), "run-1", 0.25);
  routingReservation.cancelBeforeInvocation();
  assert.equal(routing.ledger.releaseCount, 1);

  const workbench = serviceWithBalance("0.50");
  await workbench.service.assertPaidWorkbenchAllowed(paidConfig(), "session-1", 0.25);
  assert.equal(workbench.ledger.releaseCount, 1);

  const qualification = serviceWithBalance(0.25);
  await qualification.service.assertQualificationCredit(0.25);
});

test("a verified numeric zero-cost estimate remains admissible", async () => {
  const { ledger, service, statusCalls } = serviceWithBalance(0.25);
  const reservation = await service.acquirePaidRouting(paidConfig(), "run-1", 0);
  assert.equal(ledger.reserveInputs[0]?.estimatedCostUsd, 0);
  assert.equal(statusCalls(), 1);
  reservation.cancelBeforeInvocation();
  assert.equal(ledger.releaseCount, 1);
});

test("disabled and zero local paid policies fail before reservation or live-credit lookup", async () => {
  const variants: Array<{ name: string; update(config: DevHarmonicsConfig): void }> = [
    { name: "connection disabled", update: (config) => { config.openRouter.enabled = false; } },
    { name: "paid fallback disabled", update: (config) => { config.openRouter.allowPaidFallback = false; } },
    { name: "project paid API disabled", update: (config) => { config.runPolicy.allowPaidApi = false; } },
    { name: "zero per-run limit", update: (config) => { config.openRouter.perRunLimitUsd = 0; } },
    { name: "zero monthly limit", update: (config) => { config.openRouter.monthlyLimitUsd = 0; } },
  ];
  for (const variant of variants) {
    const config = paidConfig();
    variant.update(config);
    const { ledger, service, statusCalls } = serviceWithBalance(10);
    await assert.rejects(() => service.acquirePaidRouting(config, "run-1", 0.25), /disabled by policy|positive per-run and monthly/i, variant.name);
    assert.equal(ledger.reserveInputs.length, 0, variant.name);
    assert.equal(statusCalls(), 0, variant.name);
  }
});

test("paid routing never invokes the provider action after live-credit rejection", async () => {
  const { ledger, service } = serviceWithBalance(undefined);
  let providerInvocations = 0;
  await assert.rejects(
    () => service.withPaidRoutingAllowed(paidConfig(), "run-1", 0.25, async () => {
      providerInvocations += 1;
      return "unexpected";
    }),
    /remaining credit|limits and credits/i,
  );
  assert.equal(providerInvocations, 0);
  assert.equal(ledger.releaseCount, 1);
  assert.equal(ledger.activeReservations.size, 0);
});

test("a pre-provider invocation-marker failure releases the reservation exactly once", async () => {
  const { ledger, service } = serviceWithBalance(10);
  ledger.markInvokedError = new Error("fixture invocation marker failed");
  let providerInvocations = 0;
  await assert.rejects(
    () => service.withPaidRoutingAllowed(paidConfig(), "run-1", 0.25, async () => {
      providerInvocations += 1;
      return "unexpected";
    }),
    /fixture invocation marker failed/,
  );
  assert.equal(ledger.markInvokedCount, 1);
  assert.equal(providerInvocations, 0);
  assert.equal(ledger.releaseCount, 1);
  assert.equal(ledger.activeReservations.size, 0);
});

test("a post-marker provider-uncertain failure retains the reservation", async () => {
  const { ledger, service } = serviceWithBalance(10);
  let providerInvocations = 0;
  await assert.rejects(
    () => service.withPaidRoutingAllowed(paidConfig(), "run-1", 0.25, async () => {
      providerInvocations += 1;
      throw new Error("fixture provider outcome uncertain");
    }),
    /fixture provider outcome uncertain/,
  );
  assert.equal(ledger.markInvokedCount, 1);
  assert.equal(providerInvocations, 1);
  assert.equal(ledger.releaseCount, 0);
  assert.equal(ledger.activeReservations.size, 1);
});
