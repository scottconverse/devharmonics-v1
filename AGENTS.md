# DevHarmonics — instructions for coding agents

Read this before planning any change in this repository.

## What this product is

A **local-first, single-owner developer tool**. One person, one machine. No tenants, no
untrusted clients, no public endpoint, never cloud-hosted. The owner is a technical PM,
not an engineer.

## Scope brake (hard)

- **Do not build defenses for scale or adversaries that do not exist.** No rate limiting,
  no quotas, no abuse mitigation, no multi-tenant isolation, no auth layers, no
  DoS hardening. If a limit protects against a client only a hostile stranger would
  send, delete it.
- **Concurrency work is justified only for processes that genuinely coexist on this
  machine** — the cockpit server, the CLI, and orchestrated worker processes. Name the
  two real processes that race in PLAN, or do not write the guard.
- **Fix the defect in front of you at the smallest scope that makes it provably false.**
  Adjacent hardening that "seems prudent" is out of scope; report it, don't build it.
- **Production-code budget:** if a fix exceeds roughly 300 lines of production code,
  STOP and report the design question before continuing.
- **Verification may not outgrow the thing it verifies.** Test and harness code that
  exceeds the production code it protects is a design smell, not thoroughness.

## Verification style

- **No hand-rolled parsers.** Not YAML, not shell, not any grammar. If a check requires
  writing a parser, the check is wrong — find an executional equivalent.
- **Prefer executing a command and asserting its result** over statically proving
  properties about text. Execution cannot false-positive and needs no grammar.
- **Never re-implement a check the platform already enforces** (OS behavior, GitHub
  Actions limits, filesystem semantics). Local approximations have infinite bypasses.
- **Two-strike rule:** two failed attempts at the same check means STOP and report the
  design question. Do not attempt a third.
- **A worker that errors, times out, or returns an empty package has not run.** Fail the
  unit loudly and immediately; never silently continue, and never pay for it twice.
- Evidence is the command, its verbatim output, and the commit SHA. Mass checksumming of
  thousands of payloads proves nothing extra.

## Non-negotiables

- Never claim a check passed without an execution receipt. This tool exists to catch AI
  gaming its own gates; verification theater inside it is the worst possible defect.
- A repository with nothing detectable reports **zero** of that thing — never a
  placeholder that reads as present.
- Never merge red checks and never use admin override. Tags and releases are the owner's
  decision, every time.
