# Beta requirements trace

Source specification: candidate `docs/PRODUCT_SPEC.md`, v1.17, SHA-256 `F9B1ED2E721E462F53C999C3682BE37141070647A49BCE811BBA0EFFE020D730`.
Implementation-plan status baseline: `docs/IMPLEMENTATION_PLAN.md`, v1.42.
The normative-row inventory is generated mechanically from v1.17. Implementation assessment and evidence dispositions are editorial and are never inferred by the inventory generator.

## Machine-checkable totals

- Total normative rows: **482**
- Functional requirements: **67**
- Milestone priorities: **45** (`A=14`, `B=11`, `C=13`, `D=7`)
- Decided items: **16**
- CivicSuite acceptance-ladder bullets: **18**

## Initial editorial implementation assessment

This editorial assessment translates explicit implementation-plan and README
claims into the first beta backlog. `CLAIMED` means the current repository says the
capability exists; it still needs exact-candidate beta evidence. `PARTIAL` means
some required behavior exists but the specification is not complete. `MISSING`
means no completed implementation is claimed. The exhaustive matrix below
remains `UNASSESSED` until each individual row is bound to a concrete
implementation unit and evidence; beta cannot pass with any such row remaining.

### Functional requirements

| Status | Requirements | Count | Primary implementation units |
|---|---|---:|---|
| CLAIMED | FR-001–003, FR-100–112, FR-200–205, FR-207–209, FR-300–307, FR-400–403, FR-405–407, FR-503, FR-507, FR-604–605 | 44 | DH-200–330, DH-400–470, DH-600–647, DH-700–810 |
| PARTIAL | FR-004–005, FR-206, FR-404, FR-408–409, FR-504, FR-506, FR-508, FR-511, FR-606–607 | 12 | P0-3, DH-340, DH-460–480, DH-632/635/650, DH-810 |
| MISSING | FR-500–502, FR-505, FR-509–510, FR-600–602, FR-608 | 10 | DH-340–370, DH-650/660, DH-805 |
| CONDITIONAL INVARIANT | FR-603 | 1 | No email/chat execution adapter is committed; if later added it must remain notification/approval-link only |

The four rows account for all **67** functional requirements exactly once.

### Milestone priorities

| Status | Priorities | Count | Principal remaining work |
|---|---|---:|---|
| CLAIMED | A2–A8, A10–A12, A14; B1–B6, B8, B10–B11; C1, C3–C4, C12 | 24 | Exact-candidate beta proof remains |
| PARTIAL | A1, A9, A13; B7, B9; C2, C5–C7, C9, C13; D1–D2, D7 | 14 | Recovery, installer, GitHub breadth, workflow enforcement, auditions/optimization/upgrades/replanning, tool packaging, diagnostics, analytics/evaluation, complete API budget policy |
| MISSING | C8, C10–C11; D3–D6 | 7 | ACP, learning policy, campaigns, Open Interpreter/direct OpenAI API, ecosystem packaging, triggers, portable handoffs |

The three rows account for all **45** Milestone A–D priorities exactly once.

### Dependency-ordered beta feature slices

1. Use P0-3's completed parser, persistence/planning contract, Products UI,
   and pinned 24-repository corpus evidence for dependency-aware planning and
   campaign consumers; P0-2 completed in merged PR #58 (`09209e5`).
   Continue unrelated eligible C/D work and the full-repository comprehension
   census in parallel, then close the census after feature implementation but
   before integrated proof.
2. Structurally enforce workflow and campaign-template contracts in parallel
   with P0-3 and other feature lanes they do not block.
3. Build the restart-safe campaign kernel that owns C13 and co-owns C11 with
   the DH-600 Campaign Control Room:
   campaign stages, representative pilots, promotion gates, resource-aware
   shards, diagnostic partitioning, test-integrity controls, differential
   evidence, regression accounting, restart reconciliation, and safe cleanup.
4. Complete the remaining non-runtime adaptive-workforce priorities C2,
   C5–C7, and C9: auditions, optimization, controlled
   upgrades, dynamic replanning/handoff, and the broader tool/skill registry.
5. Deliver the product-manager analytics, evaluation, governed learning, and
   policy-bounded trigger controls that own C10, D5, and D7.
6. Complete the runtime and ecosystem lane: OpenRouter completion, Open
   Interpreter followed by ACP conformance (C8), direct OpenAI, and ecosystem
   packaging (D1–D4, including D2 cost/budget completion). Milestone D is required to ship and optional to
   enable.
7. Deliver portable workflow/objective/evidence/delivery-handoff bundles (D6)
   together with basic installer and provider onboarding (A13).
8. Join every feature track, close the comprehension census and every remaining
   trace disposition, complete all CivicSuite acceptance levels, and run
   integrated real-product proofs.
9. Only after that join, reserve whole-product performance/accessibility/
   security, upgrade/clean-machine rehearsal, and
   release engineering/presentation for the final exact-candidate hardening
   pass.

## Trace matrix

| ID | Requirement | Normativity | Spec source | Implementation unit/status | Beta evidence |
|---|---|---|---|---|---|
| PS-HIST-000 | Prerequisites block only consuming feature lanes; ACP and direct OpenAI remain mandatory; all feature tracks join before integrated proof; only broad hardening follows feature completion. | MUST | `docs/PRODUCT_SPEC.md:10` | UNASSESSED | UNASSESSED |
| PS-HIST-001 | Every DevHarmonics-owned operation acknowledges immediately, shows truthful lifecycle/elapsed state, survives navigation/refresh, ends visibly, uses evidence-based progress, and ships complete feedback states per workflow. | MUST | `docs/PRODUCT_SPEC.md:16` | UNASSESSED | UNASSESSED |
| PS-HIST-002 | Antigravity may expose Google/Anthropic/OpenAI models; schedule Gemini vs Claude/GPT quota groups independently and never claim actual model identity without runtime verification. | MUST | `docs/PRODUCT_SPEC.md:24` | UNASSESSED | UNASSESSED |
| PS-AUTH-000 | Treat this document as the canonical source for product scope, priorities, behavior, and judgment. | DEFINED | `docs/PRODUCT_SPEC.md:36-38` | UNASSESSED | UNASSESSED |
| PS-AUTH-001 | Do not use the specification to imply that unimplemented features already ship. | MUST | `docs/PRODUCT_SPEC.md:47` | UNASSESSED | UNASSESSED |
| PS-AUTH-002 | MUST/SHOULD/MAY mean required/preferred/optional behavior. | DEFINED | `docs/PRODUCT_SPEC.md:49` | UNASSESSED | UNASSESSED |
| PS-PROD-001 | Operate as a local-first, provider-neutral software factory for product owners managing AI agents as development teams. | DEFINED | `docs/PRODUCT_SPEC.md:53-57` | UNASSESSED | UNASSESSED |
| PS-PROD-002 | Know which models and tools are actually available. | DEFINED | `docs/PRODUCT_SPEC.md:59-62` | UNASSESSED | UNASSESSED |
| PS-PROD-003 | Understand model/tool capabilities, costs, limits, health, and demonstrated strengths. | DEFINED | `docs/PRODUCT_SPEC.md:62` | UNASSESSED | UNASSESSED |
| PS-PROD-004 | Assign models independently to coordination, planning, implementation, research, review, and validation. | DEFINED | `docs/PRODUCT_SPEC.md:63` | UNASSESSED | UNASSESSED |
| PS-PROD-005 | Schedule as many agents as work, machine, and provider capacity safely support. | DEFINED | `docs/PRODUCT_SPEC.md:64` | UNASSESSED | UNASSESSED |
| PS-PROD-006 | Switch or fall back when quota, availability, or quality changes. | DEFINED | `docs/PRODUCT_SPEC.md:65` | UNASSESSED | UNASSESSED |
| PS-PROD-007 | Qualify new model releases before production trust. | DEFINED | `docs/PRODUCT_SPEC.md:66` | UNASSESSED | UNASSESSED |
| PS-PROD-008 | Record who did what, with exact model/settings, and the proving evidence. | DEFINED | `docs/PRODUCT_SPEC.md:67` | UNASSESSED | UNASSESSED |
| PS-BOUND-001 | Run the control plane, ledger, scheduler, worktrees, policy, evidence, workflows, and primary UI locally; external services are capabilities, not hosting. | DEFINED | `docs/PRODUCT_SPEC.md:92` | UNASSESSED | UNASSESSED |
| PS-BOUND-002 | Target one product owner or a very small team; do not become enterprise organization/IAM/secrets/compliance/remote-worker infrastructure. | DEFINED | `docs/PRODUCT_SPEC.md:94` | UNASSESSED | UNASSESSED |
| PS-BOUND-003 | Stop work when the computer is off and support safe local resume; do not provide hosted continuing sandboxes or active local-to-cloud migration. | DEFINED | `docs/PRODUCT_SPEC.md:96` | UNASSESSED | UNASSESSED |
| PS-CUST-001 | Permit optional paid API access without making it a prerequisite. | MAY | `docs/PRODUCT_SPEC.md:84` | UNASSESSED | UNASSESSED |
| PS-CUST-002 | Do not let secondary-user needs displace the primary owner-operator workflow before it is excellent. | MUST | `docs/PRODUCT_SPEC.md:88` | UNASSESSED | UNASSESSED |
| PS-CIVIC-001 | Support CivicSuite without requiring monorepo collapse or abandonment of repository governance. | MUST | `docs/PRODUCT_SPEC.md:113` | UNASSESSED | UNASSESSED |
| PS-CIVIC-002 | Single-module scenario: implement a bounded change, run native checks, review the diff, and produce a merge-ready branch/PR. | MUST | `docs/PRODUCT_SPEC.md:117-119` | UNASSESSED | UNASSESSED |
| PS-CIVIC-003 | Shared-platform scenario: change CivicCore, identify affected modules, test compatible consumers, and report impact before integration. | MUST | `docs/PRODUCT_SPEC.md:120` | UNASSESSED | UNASSESSED |
| PS-CIVIC-004 | Cross-repository scenario: coordinate umbrella spec, shared platform, modules, desktop shell, installer metadata, and user docs. | MUST | `docs/PRODUCT_SPEC.md:121` | UNASSESSED | UNASSESSED |
| PS-CIVIC-005 | Release-truth scenario: compare all release truth surfaces and identify contradictions with evidence. | MUST | `docs/PRODUCT_SPEC.md:122` | UNASSESSED | UNASSESSED |
| PS-CIVIC-006 | Local-model scenario: evaluate/upgrade Ollama model or serving configuration, test affected workflows, and preserve digest/settings evidence. | MUST | `docs/PRODUCT_SPEC.md:123` | UNASSESSED | UNASSESSED |
| PS-CIVIC-007 | Clean-machine gate: prepare/monitor ordered Windows-installer checks while requiring human approval for consequential actions. | MUST | `docs/PRODUCT_SPEC.md:124` | UNASSESSED | UNASSESSED |
| PS-CIVIC-008 | Long-running completion: take a module from approved specification through implementation, validation, documentation, integration, and RC evidence across resumable runs. | MUST | `docs/PRODUCT_SPEC.md:125` | UNASSESSED | UNASSESSED |
| PS-CIVIC-009 | First production milestone: safely complete a bounded CivicSuite objective, preserve evidence, survive interruption/provider exhaustion, and return a reviewable/mergeable result. | ACCEPTANCE | `docs/PRODUCT_SPEC.md:127-129` | UNASSESSED | UNASSESSED |
| PS-PRIN-001 | Human owner controls outcomes, constraints, and consequential authority; agents execute only within granted scope. | PRINCIPLE | `docs/PRODUCT_SPEC.md:133-135` | UNASSESSED | UNASSESSED |
| PS-PRIN-002 | Route by task fit, demonstrated quality, availability, privacy, latency, resources, and policy; no permanent provider role. | PRINCIPLE | `docs/PRODUCT_SPEC.md:137-139` | UNASSESSED | UNASSESSED |
| PS-PRIN-003 | Use subscriptions by default, make local models first-class, and keep APIs optional and unnecessary for core use. | PRINCIPLE | `docs/PRODUCT_SPEC.md:141-143` | UNASSESSED | UNASSESSED |
| PS-PRIN-004 | Require checks, artifact inspection, review, and durable risk-appropriate receipts; agent confidence is not proof. | PRINCIPLE | `docs/PRODUCT_SPEC.md:145-147` | UNASSESSED | UNASSESSED |
| PS-PRIN-005 | Give concurrent agents separate workspaces, explicit scopes, and integration rules; prevent uncontrolled shared-checkout edits. | PRINCIPLE | `docs/PRODUCT_SPEC.md:149-151` | UNASSESSED | UNASSESSED |
| PS-PRIN-006 | Keep goals, plans, decisions, attempts, assignments, checks, artifacts, approvals, and handoffs in a structured, reboot-durable ledger. | PRINCIPLE | `docs/PRODUCT_SPEC.md:153-155` | UNASSESSED | UNASSESSED |
| PS-PRIN-007 | Distinguish planned, attempted, passing, integrated, approved, released, and production-verified; never inflate partial evidence. | PRINCIPLE | `docs/PRODUCT_SPEC.md:157-159` | UNASSESSED | UNASSESSED |
| PS-PRIN-008 | Automate aggressively inside safe boundaries, pause at consequential boundaries, and prefer reversible branches/worktrees/drafts/proposals. | PRINCIPLE | `docs/PRODUCT_SPEC.md:161-163` | UNASSESSED | UNASSESSED |
| PS-PRIN-009 | Normalize provider transports into stable agent/model/tool/task/evidence/permission/result concepts without erasing provider capabilities. | PRINCIPLE | `docs/PRODUCT_SPEC.md:165-167` | UNASSESSED | UNASSESSED |
| PS-PRIN-010 | Prove large transformations on a representative slice before expansion; require evidence, resource measurement, and policy/human approval for promotion. | PRINCIPLE | `docs/PRODUCT_SPEC.md:169-171` | UNASSESSED | UNASSESSED |
| PS-PRIN-011 | Combine acceptance, test integrity, deterministic checks, comparison, review, repo/runtime evidence, nonfunctional gates, and human acceptance; detect weakened-evidence shortcuts. | PRINCIPLE | `docs/PRODUCT_SPEC.md:173-175` | UNASSESSED | UNASSESSED |
| PS-PRIN-012 | Keep orchestration/evidence local and use external services only as bounded capabilities; no normal feature may require DevHarmonics hosting. | PRINCIPLE | `docs/PRODUCT_SPEC.md:177-179` | UNASSESSED | UNASSESSED |
| PS-PRIN-013 | Optimize interface/workflows for a product owner directing agents, not enterprise staffing/admin; small-team handoff uses explicit portable artifacts. | PRINCIPLE | `docs/PRODUCT_SPEC.md:181-183` | UNASSESSED | UNASSESSED |
| PS-UX-001 | Organize work as Portfolio → Product/Program → Workspace → Objective → Campaign → Stage → Shard → Run → Task → Attempt → Agent/model/tools/evidence. | SHOULD | `docs/PRODUCT_SPEC.md:187-203` | UNASSESSED | UNASSESSED |
| PS-UX-002 | Portfolio surface shows products, repository health, objectives, blockers, capacity, approvals, and outcomes. | DEFINED | `docs/PRODUCT_SPEC.md:209-211` | UNASSESSED | UNASSESSED |
| PS-UX-003 | Setup/providers surface guides install, provider auth, runtime/entitlement discovery, Ollama, and troubleshooting; keep connections and models separate. | MUST | `docs/PRODUCT_SPEC.md:213-215` | UNASSESSED | UNASSESSED |
| PS-UX-004 | Product cockpit shows constitution, repositories, roadmap, risks, decisions, releases, compatibility, and execution history. | DEFINED | `docs/PRODUCT_SPEC.md:217-219` | UNASSESSED | UNASSESSED |
| PS-UX-005 | Objective composer accepts outcome plus acceptance criteria, constraints, repositories, priority/deadline, risk, and autonomy; helps refine ambiguity without agent-prompt authoring. | SHOULD | `docs/PRODUCT_SPEC.md:221-223` | UNASSESSED | UNASSESSED |
| PS-UX-006 | Plan view shows work breakdown, repo boundaries, dependencies, gates, artifacts, agent classes, and resource pressure; user can edit/approve. | DEFINED | `docs/PRODUCT_SPEC.md:225-227` | UNASSESSED | UNASSESSED |
| PS-UX-007 | Campaign control room shows gates, pilots, shards, barriers, quorums, diagnostics, resources, regressions, recovery, and promotion; distinguishes verified throughput from vanity counts. | DEFINED | `docs/PRODUCT_SPEC.md:229-231` | UNASSESSED | UNASSESSED |
| PS-UX-008 | Live run board shows task states, agents, worktrees, assignments, quota pressure, retries, and dependency consequences. | DEFINED | `docs/PRODUCT_SPEC.md:233-235` | UNASSESSED | UNASSESSED |
| PS-UX-009 | Model fleet shows all discovered subscription/local/API models with status, capabilities, qualification, capacity, runtime details, aliases, and upgrade recommendations. | DEFINED | `docs/PRODUCT_SPEC.md:237-239` | UNASSESSED | UNASSESSED |
| PS-UX-010 | Workbench is a non-mutating repository scratchpad, visibly distinct from execution and without repository-write authority. | MUST | `docs/PRODUCT_SPEC.md:241-243` | UNASSESSED | UNASSESSED |
| PS-UX-011 | Analytics/settings shows performance, fallback, workload mix, health behavior, retention, redaction, adapters, caches, and routing preferences. | DEFINED | `docs/PRODUCT_SPEC.md:245-247` | UNASSESSED | UNASSESSED |
| PS-UX-012 | Evidence/review center collects all change/check/review artifacts and ends in merge/release recommendation, not generic success. | DEFINED | `docs/PRODUCT_SPEC.md:249-251` | UNASSESSED | UNASSESSED |
| PS-UX-013 | Approval inbox contains only human-authority decisions and enough context to approve, reject, modify, or defer. | DEFINED | `docs/PRODUCT_SPEC.md:253-255` | UNASSESSED | UNASSESSED |
| PS-UX-014 | Default workflow: state outcome, inspect/adjust plan, approve scope/autonomy, watch meaningful progress, intervene only for judgment/authority, receive evidence-backed result and next actions. | MUST | `docs/PRODUCT_SPEC.md:257-266` | UNASSESSED | UNASSESSED |
| PS-UX-015 | Keep raw logs available as supporting detail, not primary interface. | DEFINED | `docs/PRODUCT_SPEC.md:268` | UNASSESSED | UNASSESSED |
| PS-UX-016 | Every owned visible operation immediately acknowledges input with stateful control, status text, and accessible busy indication. | MUST | `docs/PRODUCT_SPEC.md:270-274` | UNASSESSED | UNASSESSED |
| PS-UX-017 | Every owned visible operation exposes a truthful lifecycle including queued through cancelled states. | MUST | `docs/PRODUCT_SPEC.md:272-275` | UNASSESSED | UNASSESSED |
| PS-UX-018 | Show meaningful stage, elapsed time, latest retained activity, and responsible agent/model/provider when known. | MUST | `docs/PRODUCT_SPEC.md:276` | UNASSESSED | UNASSESSED |
| PS-UX-019 | Provide heartbeat or last-update timestamp during quiet work. | MUST | `docs/PRODUCT_SPEC.md:277` | UNASSESSED | UNASSESSED |
| PS-UX-020 | Keep operation visible in a global activity surface across navigation. | MUST | `docs/PRODUCT_SPEC.md:278` | UNASSESSED | UNASSESSED |
| PS-UX-021 | Reconstruct operation state after refresh/reconnection from durable control-plane evidence. | MUST | `docs/PRODUCT_SPEC.md:279` | UNASSESSED | UNASSESSED |
| PS-UX-022 | End with visible result, failure explanation, recovery/retry action, and retained evidence link when applicable. | MUST | `docs/PRODUCT_SPEC.md:280` | UNASSESSED | UNASSESSED |
| PS-UX-023 | Support aria-live, keyboard operation, contrast, and reduced-motion preferences. | MUST | `docs/PRODUCT_SPEC.md:281` | UNASSESSED | UNASSESSED |
| PS-UX-024 | Use spinners only for genuinely indeterminate work; percentages require real bounded evidence; never fabricate progress. | MUST | `docs/PRODUCT_SPEC.md:283` | UNASSESSED | UNASSESSED |
| PS-UX-025 | Apply feedback contract to all named and future workflows; do not claim external work outside the control plane. | MUST | `docs/PRODUCT_SPEC.md:285` | UNASSESSED | UNASSESSED |
| PS-CAP-001 | Register multiple products and local clones. | MUST | `docs/PRODUCT_SPEC.md:291-293` | UNASSESSED | UNASSESSED |
| PS-CAP-002 | Support one-or-many-repository product workspaces. | MUST | `docs/PRODUCT_SPEC.md:294` | UNASSESSED | UNASSESSED |
| PS-CAP-003 | Understand typed repository roles. | MUST | `docs/PRODUCT_SPEC.md:295` | UNASSESSED | UNASSESSED |
| PS-CAP-004 | Record repository dependency and compatibility relationships. | MUST | `docs/PRODUCT_SPEC.md:296` | IMPLEMENTED — owner-authored repository relationships remain the required-impact authority; exact manifests add deterministic package-identity resolution without overwriting them | `src/product-intelligence.ts`; `src/orchestrator.ts`; `src/ui/app.js`; `test/product-intelligence.test.ts`; dependency Chromium journey; 24-repository dependency corpus |
| PS-CAP-005 | Ingest repository instructions, contribution rules, architecture, validators, and ownership boundaries. | MUST | `docs/PRODUCT_SPEC.md:297` | UNASSESSED | UNASSESSED |
| PS-CAP-006 | Target one repository, explicit sets, or discovered impact sets. | MUST | `docs/PRODUCT_SPEC.md:298` | UNASSESSED | UNASSESSED |
| PS-CAP-007 | Preserve separate branch/review/merge boundaries for each repository. | MUST | `docs/PRODUCT_SPEC.md:299` | UNASSESSED | UNASSESSED |
| PS-CAP-008 | Provide organization view without shared-toolchain/release/permission assumptions. | MUST | `docs/PRODUCT_SPEC.md:300` | UNASSESSED | UNASSESSED |
| PS-CAP-009 | Use CivicSuite umbrella spec/compatibility to inform planning while runtime repositories remain code-authoritative. | SHOULD | `docs/PRODUCT_SPEC.md:302` | UNASSESSED | UNASSESSED |
| PS-CAP-010 | Give every workspace a versioned constitution covering purpose, invariants, security/privacy/accessibility, ownership/dependencies, technology, releases, validation, docs truth, and mandatory approvals. | SHOULD | `docs/PRODUCT_SPEC.md:304-316` | UNASSESSED | UNASSESSED |
| PS-CAP-011 | Build task-specific context packs rather than dumping full history. | MUST | `docs/PRODUCT_SPEC.md:318` | UNASSESSED | UNASSESSED |
| PS-CAP-012 | Record or reproducibly reference context packs in the ledger. | MUST | `docs/PRODUCT_SPEC.md:320` | UNASSESSED | UNASSESSED |
| PS-CAP-013 | Maintain a structured per-run shared blackboard and give agents only role-relevant projections, not unrestricted transcripts. | SHOULD | `docs/PRODUCT_SPEC.md:322` | UNASSESSED | UNASSESSED |
| PS-CAP-014 | Make context assembly token-aware, evidence-preferring, capacity-adaptive, and unable to truncate response schema/current-task ending. | MUST | `docs/PRODUCT_SPEC.md:324` | UNASSESSED | UNASSESSED |
| PS-CAP-015 | Convert objectives into typed execution graphs containing ID/outcome, scope, dependencies, artifacts, acceptance, validators, risk/permission, capabilities, context, integration target, and stop/escalation conditions. | MUST | `docs/PRODUCT_SPEC.md:326-340` | UNASSESSED | UNASSESSED |
| PS-CAP-016 | Schema-validate plans and check cycles, missing repos/validators, permission incompatibility, and impossible model needs. | MUST | `docs/PRODUCT_SPEC.md:342` | UNASSESSED | UNASSESSED |
| PS-CAP-017 | Dynamically add diagnostics, split tasks, replan blocked work, or request decisions while preserving original plan and change rationale. | SHOULD | `docs/PRODUCT_SPEC.md:344` | UNASSESSED | UNASSESSED |
| PS-CAP-018 | Support specialized coordinator, product, architecture, planning, research, implementation, test, security, accessibility, UX, docs, integration, release, and independent-review roles. | MUST | `docs/PRODUCT_SPEC.md:346-363` | UNASSESSED | UNASSESSED |
| PS-CAP-019 | Treat roles as provider-neutral templates fillable by any qualified, permitted, available model. | MAY | `docs/PRODUCT_SPEC.md:365` | UNASSESSED | UNASSESSED |
| PS-CAP-020 | Create multiple same-class implementors when independent ready tasks exist. | MUST | `docs/PRODUCT_SPEC.md:367` | UNASSESSED | UNASSESSED |
| PS-CAP-021 | Impose no arbitrary product agent cap; bound concurrency by ready work, policy, host resources, isolation, provider capacity, bottlenecks, and observed contention. | DEFINED | `docs/PRODUCT_SPEC.md:369-377` | UNASSESSED | UNASSESSED |
| PS-CAP-022 | Support subscription apps, ACP, local runtimes, and optional API gateways as four connection classes. | MUST | `docs/PRODUCT_SPEC.md:379-381` | UNASSESSED | UNASSESSED |
| PS-CAP-023 | Use official authenticated Codex, Claude Code, and Antigravity; separate transport, connection, vendor, model identity, and quota group. | MUST | `docs/PRODUCT_SPEC.md:383-385` | UNASSESSED | UNASSESSED |
| PS-CAP-024 | Reuse provider-owned sessions; never request passwords or expose tokens; detect state/capabilities; use structured modes; isolate adapter parsing. | MUST | `docs/PRODUCT_SPEC.md:385-392` | UNASSESSED | UNASSESSED |
| PS-CAP-025 | Ship ACP for beta with Open Interpreter as first conformance target; use it for other reliable providers where useful without treating ACP as the universal product/auth definition. | MUST | `docs/PRODUCT_SPEC.md:394-396` | UNASSESSED | UNASSESSED |
| PS-CAP-026 | Require Ollama first; discover models, details, digests, capabilities, running/context/resource state; normalize later local runtimes. | MUST | `docs/PRODUCT_SPEC.md:398-400` | UNASSESSED | UNASSESSED |
| PS-CAP-027 | Permit local models in read-only/mutating roles only with assigned-worktree confinement, scoped tools, no unrestricted shell, and orchestrator-controlled commit/integration. | MAY | `docs/PRODUCT_SPEC.md:402` | UNASSESSED | UNASSESSED |
| PS-CAP-028 | Track and qualify Mellum2 Instruct and Thinking separately; metadata may seed but not prove schedulability. | MUST | `docs/PRODUCT_SPEC.md:404` | UNASSESSED | UNASSESSED |
| PS-CAP-029 | Require role qualification plus current structured-output/contradiction/counting benchmark before Mellum2 assignment. | MUST | `docs/PRODUCT_SPEC.md:404` | UNASSESSED | UNASSESSED |
| PS-CAP-030 | Restrict Instruct initially to narrow low-risk economy work; permit Thinking standard reasoning only after independent qualification. | MAY | `docs/PRODUCT_SPEC.md:404` | UNASSESSED | UNASSESSED |
| PS-CAP-031 | Never promote Mellum2 to coordinator/final authority/universal default/review replacement from name/size/published benchmarks; require user action and passing evidence for download/activation/promotion. | MUST | `docs/PRODUCT_SPEC.md:404` | UNASSESSED | UNASSESSED |
| PS-CAP-032 | Keep OpenRouter disconnected/paid-disabled by default; use OAuth and OS credential storage; require policy gates, positive limits, activation, qualification, and live credit checks for paid fallback. | MUST | `docs/PRODUCT_SPEC.md:406-408` | UNASSESSED | UNASSESSED |
| PS-CAP-033 | Ship a disabled-by-default direct OpenAI API adapter for beta; allow additional direct APIs later only for material capability absent from existing transports. | MUST | `docs/PRODUCT_SPEC.md:410` | UNASSESSED | UNASSESSED |
| PS-CAP-034 | Distinguish Known, Visible, Verified, Qualified, Active, Degraded, and Retired registry states. | MUST | `docs/PRODUCT_SPEC.md:412-424` | UNASSESSED | UNASSESSED |
| PS-CAP-035 | Retain registry identity, capability, runtime, quota, qualification, performance, lifecycle, preference, and provenance fields. | SHOULD | `docs/PRODUCT_SPEC.md:426-445` | UNASSESSED | UNASSESSED |
| PS-CAP-036 | Reconcile signed-in/runtime reports, official catalogs, signed compatibility catalog, and local empirical results. | SHOULD | `docs/PRODUCT_SPEC.md:447-454` | PARTIAL — live signed/versioned compatibility metadata, runtime reports, and official catalogs are reconciled; signed omissions retire compatibility-only rows without overwriting stronger runtime/provider provenance; empirical reconciliation remains DH-250 scope | `catalog/compatibility-catalog.v1.json`; `src/compatibility-catalog.ts`; `src/catalog.ts`; catalog-refresh core tests |
| PS-CAP-037 | Do not schedule from announcements alone; require account visibility or safe probe. | MUST | `docs/PRODUCT_SPEC.md:456` | UNASSESSED | UNASSESSED |
| PS-CAP-038 | Refresh registry at startup, account/CLI changes, manual request, periodically, and after unknown/retired-model failure. | SHOULD | `docs/PRODUCT_SPEC.md:458-465` | PARTIAL — launch, CLI run, manual, periodic, stale, runtime-fingerprint, and unavailable/retired-model failure paths are present; explicit post-sign-in event coverage remains | `src/server.ts`; `src/cli.ts`; `src/catalog.ts`; unavailable-model refresh core test |
| PS-CAP-039 | Prefer structured provider mechanisms over scraping interactive UI. | MUST | `docs/PRODUCT_SPEC.md:467` | UNASSESSED | UNASSESSED |
| PS-CAP-040 | Maintain prioritized, concurrency-controlled cached health queue with retries, observations, failure classification, cooldowns, and explicit readiness states. | SHOULD | `docs/PRODUCT_SPEC.md:469-471` | UNASSESSED | UNASSESSED |
| PS-CAP-041 | Permit substantive Ollama checks; keep subscription checks inexpensive and evidence-based. | SHOULD | `docs/PRODUCT_SPEC.md:473` | UNASSESSED | UNASSESSED |
| PS-CAP-042 | Queue excess work rather than impose a global agent limit; route waiting work to qualified capacity when possible. | DEFINED | `docs/PRODUCT_SPEC.md:475` | UNASSESSED | UNASSESSED |
| PS-CAP-043 | Base model recommendations on metadata, probes, overrides, and observed performance dimensions. | SHOULD | `docs/PRODUCT_SPEC.md:477-479` | UNASSESSED | UNASSESSED |
| PS-CAP-044 | Derive role fitness from concrete run outcomes; model name/size cannot remain primary evidence after real results. | SHOULD | `docs/PRODUCT_SPEC.md:481` | UNASSESSED | UNASSESSED |
| PS-CAP-045 | Put new models through discovery, entitlement, adapter, probes, auditions, recommendation, approval, and activation lifecycle. | MUST | `docs/PRODUCT_SPEC.md:483-496` | UNASSESSED | UNASSESSED |
| PS-CAP-046 | Use small representative non-destructive auditions and permit role-specific qualification. | SHOULD | `docs/PRODUCT_SPEC.md:498` | UNASSESSED | UNASSESSED |
| PS-CAP-047 | Use machine-checked specialist tasks; retain independent bounded-tool and specialist-fidelity evidence. | MUST | `docs/PRODUCT_SPEC.md:500` | UNASSESSED | UNASSESSED |
| PS-CAP-048 | Support pinned exact-ID and family-tracking upgrade policies; require exact-ID qualification/benchmarks and prohibit variant cross-promotion. | DEFINED | `docs/PRODUCT_SPEC.md:502-505` | UNASSESSED | UNASSESSED |
| PS-CAP-049 | Do not let moving aliases silently change the model used by a run. | MUST | `docs/PRODUCT_SPEC.md:507` | UNASSESSED | UNASSESSED |
| PS-CAP-050 | Record concrete model/settings; when actual execution identity is unverified, retain request as unverified and never promote it to observed fact. | MUST | `docs/PRODUCT_SPEC.md:509` | UNASSESSED | UNASSESSED |
| PS-CAP-051 | Require only catalog update for routine model release when adapter supports it; require app/adapter update only for contract changes. | SHOULD | `docs/PRODUCT_SPEC.md:511` | UNASSESSED | UNASSESSED |
| PS-CAP-052 | Require explicit approval for local-model downloads. | MUST | `docs/PRODUCT_SPEC.md:513` | UNASSESSED | UNASSESSED |
| PS-CAP-053 | Recheck catalogs on launch, every 24 hours, forced refresh, and before stale/version-changed runs; fingerprint qualification; invalidate on fingerprint change; retire after three misses; probe only relevant candidates. | MUST | `docs/PRODUCT_SPEC.md:515` | UNASSESSED | UNASSESSED |
| PS-CAP-054 | Use Anthropic official catalog for Claude discovery and real exact-ID Claude Code invocation for entitlement. | MUST | `docs/PRODUCT_SPEC.md:517` | UNASSESSED | UNASSESSED |
| PS-CAP-055 | Select model/provider/family/effort independently for each role/task. | MUST | `docs/PRODUCT_SPEC.md:519-521` | UNASSESSED | UNASSESSED |
| PS-CAP-056 | Consider task/risk, capabilities, qualification, history, context, entitlement/quota, host capacity, latency, privacy, diversity, retries, critical path, and user preferences. | SHOULD | `docs/PRODUCT_SPEC.md:523-537` | UNASSESSED | UNASSESSED |
| PS-CAP-057 | Optimize for objective/policy rather than round-robin providers. | SHOULD | `docs/PRODUCT_SPEC.md:539` | UNASSESSED | UNASSESSED |
| PS-CAP-058 | Explain material routing decisions in plain language and machine-readable form. | MUST | `docs/PRODUCT_SPEC.md:550` | UNASSESSED | UNASSESSED |
| PS-CAP-059 | Treat entitlement, health, and capacity as independent provider-availability dimensions. | DEFINED | `docs/PRODUCT_SPEC.md:552-558` | UNASSESSED | UNASSESSED |
| PS-CAP-060 | Do not permanently mark a model unavailable from temporary subscription exhaustion. | MUST | `docs/PRODUCT_SPEC.md:560` | UNASSESSED | UNASSESSED |
| PS-CAP-061 | Cool Antigravity quota groups independently; legacy `gemini` may alias config but cannot prove model execution. | MUST | `docs/PRODUCT_SPEC.md:562` | UNASSESSED | UNASSESSED |
| PS-CAP-062 | Classify network, outage, rate/quota, concurrency, context, capability, auth, retirement, and policy failures. | SHOULD | `docs/PRODUCT_SPEC.md:564-576` | UNASSESSED | UNASSESSED |
| PS-CAP-063 | Permit fallback within subscription, across providers, to qualified local, to enabled API, or to explicit pause. | MAY | `docs/PRODUCT_SPEC.md:578-584` | UNASSESSED | UNASSESSED |
| PS-CAP-064 | Require fallback to meet capability/privacy/quality; otherwise pause or replan. | MUST | `docs/PRODUCT_SPEC.md:586` | UNASSESSED | UNASSESSED |
| PS-CAP-065 | Preserve worktree, context, attempts, and handoff reason across fallback; show model changes in timeline. | MUST | `docs/PRODUCT_SPEC.md:588` | UNASSESSED | UNASSESSED |
| PS-CAP-066 | Maintain registry of local commands, MCP/provider/browser/Git/issue tools, reusable workflows, and product scripts/gates. | MUST | `docs/PRODUCT_SPEC.md:590-601` | UNASSESSED | UNASSESSED |
| PS-CAP-067 | Record tool permissions, trust, contracts, side effects, secrets, environments, and validation expectations. | SHOULD | `docs/PRODUCT_SPEC.md:603` | UNASSESSED | UNASSESSED |
| PS-CAP-068 | Assign tools only when task and approval policy permit; treat tool output as untrusted until validated/corroborated. | MUST | `docs/PRODUCT_SPEC.md:605` | UNASSESSED | UNASSESSED |
| PS-CAP-069 | Parameterize and version reusable workflows. | SHOULD | `docs/PRODUCT_SPEC.md:607` | UNASSESSED | UNASSESSED |
| PS-CAP-070 | Run every mutating task in isolated branch/worktree/equivalent sandbox with known base, recorded commits, dirty-check protection, serialized integration, combined validation, failure retention, and no silent protected-branch merge. | MUST | `docs/PRODUCT_SPEC.md:609-620` | UNASSESSED | UNASSESSED |
| PS-CAP-071 | Create exact per-repository integration sets for multi-repo objectives and judge readiness against them. | MUST | `docs/PRODUCT_SPEC.md:622` | UNASSESSED | UNASSESSED |
| PS-CAP-072 | Permit bounded separately validated conflict repair; require human review for unbounded/ambiguous conflict resolution. | MAY | `docs/PRODUCT_SPEC.md:624` | UNASSESSED | UNASSESSED |
| PS-CAP-073 | Verify through acceptance, native validators, changed-area checks, combined integration, artifact inspection, independent review, risk gates, and human consequential approval. | MUST | `docs/PRODUCT_SPEC.md:626-637` | UNASSESSED | UNASSESSED |
| PS-CAP-074 | Select validators only from trusted configuration or approved workflow; do not auto-trust agent-generated shell commands. | MUST | `docs/PRODUCT_SPEC.md:639` | UNASSESSED | UNASSESSED |
| PS-CAP-075 | Normally use a different provider/model family for final review; permit adversarial/consensus review for high risk. | SHOULD | `docs/PRODUCT_SPEC.md:641` | UNASSESSED | UNASSESSED |
| PS-CAP-076 | Verify test integrity and detect missing/weakened tests and prohibited shortcuts where practical, reporting findings without replacing judgment. | MUST | `docs/PRODUCT_SPEC.md:643` | UNASSESSED | UNASSESSED |
| PS-CAP-077 | Use baseline behavior as oracle for equivalence-sensitive work and turn unexplained mismatches into bounded repair tasks. | SHOULD | `docs/PRODUCT_SPEC.md:645` | UNASSESSED | UNASSESSED |
| PS-CAP-078 | Check receipts include tool/config, cwd/commit, timing, exit status, outputs/artifacts, environment, classification, and missing/truncated-evidence warnings. | SHOULD | `docs/PRODUCT_SPEC.md:647-656` | UNASSESSED | UNASSESSED |
| PS-CAP-079 | Persist all product, objective, plan, execution, model/tool, context, evidence, approval, risk, quota/cost, outcome, and follow-up records. | MUST | `docs/PRODUCT_SPEC.md:658-676` | UNASSESSED | UNASSESSED |
| PS-CAP-080 | Support restart/resume; reconcile ledger with processes/worktrees/branches/repos and offer safe resume/retry/archive/abandon. | MUST | `docs/PRODUCT_SPEC.md:678` | UNASSESSED | UNASSESSED |
| PS-CAP-081 | Generated summaries never replace underlying evidence. | MUST | `docs/PRODUCT_SPEC.md:680` | UNASSESSED | UNASSESSED |
| PS-CAP-082 | Provide Observe, Prepare, Implement, Integrate, Propose externally, and explicit Consequential-action autonomy levels. | SHOULD | `docs/PRODUCT_SPEC.md:682-691` | UNASSESSED | UNASSESSED |
| PS-CAP-083 | Permit policy narrowing by repository, path, command, tool, provider, model, data class, or action. | MAY | `docs/PRODUCT_SPEC.md:693` | UNASSESSED | UNASSESSED |
| PS-CAP-084 | Explain why approval is required, what happens, supporting evidence, and reversibility. | MUST | `docs/PRODUCT_SPEC.md:695` | UNASSESSED | UNASSESSED |
| PS-CAP-085 | Connect GitHub/Linear/local triggers and work items without requiring migration; preserve traceability, dedupe/allowlist triggers, and keep optional integrations optional. | SHOULD | `docs/PRODUCT_SPEC.md:697-712` | UNASSESSED | UNASSESSED |
| PS-CAP-086 | External writes require autonomy/approval; arbitrary email/chat messages must not start mutating work by default. | MUST | `docs/PRODUCT_SPEC.md:712` | UNASSESSED | UNASSESSED |
| PS-CAP-087 | Provide a friendly Windows local app/launcher with install, dependency detection, provider sign-in guidance, discovery verification, service control, persistence, diagnostics/export/uninstall, and provider-signout distinction. | SHOULD | `docs/PRODUCT_SPEC.md:714-730` | UNASSESSED | UNASSESSED |
| PS-CAP-088 | Recommend compatible provider/local updates; automatic updates are opt-in and recoverable. | MUST | `docs/PRODUCT_SPEC.md:732` | UNASSESSED | UNASSESSED |
| PS-CAP-089 | Return typed role-specific result envelopes with summary, changes, assumptions/issues, needed input/checks, failures, next action, and state. | SHOULD | `docs/PRODUCT_SPEC.md:734-745` | UNASSESSED | UNASSESSED |
| PS-CAP-090 | Never use self-confidence as correctness/readiness authority. | MUST | `docs/PRODUCT_SPEC.md:747` | UNASSESSED | UNASSESSED |
| PS-CAP-091 | Use a read-only Run Reporter to summarize structured evidence without changing verdict/evidence/repository. | SHOULD | `docs/PRODUCT_SPEC.md:749` | UNASSESSED | UNASSESSED |
| PS-CAP-092 | Use persisted resumable event stream with durable cursors; browser close does not cancel; cancellation is explicit and ledgered. | SHOULD | `docs/PRODUCT_SPEC.md:751-753` | UNASSESSED | UNASSESSED |
| PS-CAP-093 | Allow owner to pause admission, reprioritize/redirect, clarify at safe boundary, interrupt-and-continue, reassign, disposition review findings, and see steering state. | MUST | `docs/PRODUCT_SPEC.md:755-765` | UNASSESSED | UNASSESSED |
| PS-CAP-094 | Do not fake provider mid-response steering; interrupt/retain/restart when needed; steering cannot silently widen scope, permissions, spending, deployment, or acceptance. | MUST | `docs/PRODUCT_SPEC.md:767` | UNASSESSED | UNASSESSED |
| PS-CAP-095 | Derive analytics from retained evidence and label estimates; compute ROI only from explicit user assumptions. | SHOULD | `docs/PRODUCT_SPEC.md:769-771` | UNASSESSED | UNASSESSED |
| PS-CAP-096 | Retain comparable evaluation/workflow/routing/prompt/skill/benchmark revisions; require evaluated, versioned, reviewable, reversible promotion; never silently rewrite authority/evidence. | MUST | `docs/PRODUCT_SPEC.md:773` | UNASSESSED | UNASSESSED |
| PS-CAP-097 | Represent large objectives as governed campaigns rather than a single prompt/task list. | MUST | `docs/PRODUCT_SPEC.md:775-777` | UNASSESSED | UNASSESSED |
| PS-CAP-098 | Give campaign stages explicit entry, work, topology, resource, sync, exit, and promotion contracts. | DEFINED | `docs/PRODUCT_SPEC.md:779` | UNASSESSED | UNASSESSED |
| PS-CAP-099 | Run a representative complete-loop pilot before broad fan-out; retain quality/resource/failure evidence; revise failed pilots and gate reusable-template promotion. | SHOULD | `docs/PRODUCT_SPEC.md:781` | UNASSESSED | UNASSESSED |
| PS-CAP-100 | Support configurable implement/review/adjudicate/fix/re-review/validate topologies with risk-based diverse reviewers and visible disagreement. | MUST | `docs/PRODUCT_SPEC.md:783` | UNASSESSED | UNASSESSED |
| PS-CAP-101 | Enforce command/tool restrictions in runtime, with policy decisions and receipts for attempted/executed commands. | MUST | `docs/PRODUCT_SPEC.md:785` | UNASSESSED | UNASSESSED |
| PS-CAP-102 | Centralize expensive diagnostics at barriers, retain/classify them, create non-overlapping shards, and revalidate at controlled barriers. | SHOULD | `docs/PRODUCT_SPEC.md:787` | UNASSESSED | UNASSESSED |
| PS-CAP-103 | Plan shards against overlap/dependencies/resources/capacity/exclusive commands; broker pressure safely; make checkpoints restart-safe. | MUST | `docs/PRODUCT_SPEC.md:789` | UNASSESSED | UNASSESSED |
| PS-CAP-104 | Version campaign transformation artifacts; separate faithful equivalence from idiomatic cleanup unless objective combines them. | MUST | `docs/PRODUCT_SPEC.md:791` | UNASSESSED | UNASSESSED |
| PS-CAP-105 | Account for tests, equivalence, defects/regressions, performance, provisional code, platform coverage, review, cost/time/intervention; never use vanity counts as success. | MUST | `docs/PRODUCT_SPEC.md:793` | UNASSESSED | UNASSESSED |
| PS-CAP-106 | May recommend multiple transformation strategies but must record alternatives/evidence and never default to all-at-once or fixed agent count. | MUST | `docs/PRODUCT_SPEC.md:795` | UNASSESSED | UNASSESSED |
| PS-COORD-001 | Maintain objective, constraints, and acceptance criteria. | MUST | `docs/PRODUCT_SPEC.md:801-803` | UNASSESSED | UNASSESSED |
| PS-COORD-002 | Understand portfolio/workspace state. | MUST | `docs/PRODUCT_SPEC.md:804` | UNASSESSED | UNASSESSED |
| PS-COORD-003 | Propose/revise execution graph. | MUST | `docs/PRODUCT_SPEC.md:805` | UNASSESSED | UNASSESSED |
| PS-COORD-004 | Choose campaign strategy, stages, pilots, shards, barriers, and promotion evidence. | MUST | `docs/PRODUCT_SPEC.md:806` | UNASSESSED | UNASSESSED |
| PS-COORD-005 | Choose or delegate agent/model/tool assignments. | MUST | `docs/PRODUCT_SPEC.md:807` | UNASSESSED | UNASSESSED |
| PS-COORD-006 | Manage critical path and concurrency. | MUST | `docs/PRODUCT_SPEC.md:808` | UNASSESSED | UNASSESSED |
| PS-COORD-007 | Respond to evidence, failures, and quota changes. | MUST | `docs/PRODUCT_SPEC.md:809` | UNASSESSED | UNASSESSED |
| PS-COORD-008 | Prevent duplicate/conflicting work. | MUST | `docs/PRODUCT_SPEC.md:810` | UNASSESSED | UNASSESSED |
| PS-COORD-009 | Centralize expensive diagnostics and partition findings. | MUST | `docs/PRODUCT_SPEC.md:811` | UNASSESSED | UNASSESSED |
| PS-COORD-010 | Reduce admission/pause stages under unsafe host/provider pressure. | MUST | `docs/PRODUCT_SPEC.md:812` | UNASSESSED | UNASSESSED |
| PS-COORD-011 | Keep agents within context/permission boundaries. | MUST | `docs/PRODUCT_SPEC.md:813` | UNASSESSED | UNASSESSED |
| PS-COORD-012 | Request human judgment for ambiguous intent. | MUST | `docs/PRODUCT_SPEC.md:814` | UNASSESSED | UNASSESSED |
| PS-COORD-013 | Maintain explicit risk register. | MUST | `docs/PRODUCT_SPEC.md:815` | UNASSESSED | UNASSESSED |
| PS-COORD-014 | Ensure evidence requirements are met. | MUST | `docs/PRODUCT_SPEC.md:816` | UNASSESSED | UNASSESSED |
| PS-COORD-015 | Return concise outcome, unresolved issues, and recommended next work. | MUST | `docs/PRODUCT_SPEC.md:817` | UNASSESSED | UNASSESSED |
| PS-COORD-016 | Use ledger, not coordinator conversational memory, for continuity; coordinator may switch models. | MUST | `docs/PRODUCT_SPEC.md:819` | UNASSESSED | UNASSESSED |
| PS-DATA-001 | Expose the listed stable domain objects independently of provider transport. | SHOULD | `docs/PRODUCT_SPEC.md:821-865` | UNASSESSED | UNASSESSED |
| PS-DATA-002 | Keep all run-receipt identifiers resolvable after catalog/alias/install changes. | MUST | `docs/PRODUCT_SPEC.md:867` | UNASSESSED | UNASSESSED |
| FR-001 | The user can register and switch among multiple products. | FR | `docs/PRODUCT_SPEC.md:873` | UNASSESSED | UNASSESSED |
| FR-002 | A product can contain multiple repositories with typed relationships. | FR | `docs/PRODUCT_SPEC.md:874` | UNASSESSED | UNASSESSED |
| FR-003 | The user can define a product-level objective spanning selected repositories. | FR | `docs/PRODUCT_SPEC.md:875` | UNASSESSED | UNASSESSED |
| FR-004 | Import repository instructions and validators without silently changing them. | FR | `docs/PRODUCT_SPEC.md:876` | UNASSESSED | UNASSESSED |
| FR-005 | Objectives, plans, runs, decisions, risks, and evidence survive restarts. | FR | `docs/PRODUCT_SPEC.md:877` | UNASSESSED | UNASSESSED |
| FR-100 | Discover installed and authenticated provider connections. | FR | `docs/PRODUCT_SPEC.md:881` | UNASSESSED | UNASSESSED |
| FR-101 | Maintain live provenance-aware model registry. | FR | `docs/PRODUCT_SPEC.md:882` | UNASSESSED | UNASSESSED |
| FR-102 | Normalize subscription/local/API fleet view without hiding economics/trust differences. | FR | `docs/PRODUCT_SPEC.md:883` | UNASSESSED | UNASSESSED |
| FR-103 | User can pin, exclude, prefer, qualify, or retire models by role. | FR | `docs/PRODUCT_SPEC.md:884` | UNASSESSED | UNASSESSED |
| FR-104 | New models enter audition before production unless explicit policy says otherwise. | FR | `docs/PRODUCT_SPEC.md:885` | UNASSESSED | UNASSESSED |
| FR-105 | Record concrete provider/model/settings for every attempt when obtainable. | FR | `docs/PRODUCT_SPEC.md:886` | UNASSESSED | UNASSESSED |
| FR-106 | Select different models for coordinator, architect, implementor, reviewer, and specialist. | FR | `docs/PRODUCT_SPEC.md:887` | UNASSESSED | UNASSESSED |
| FR-107 | Run multiple agents concurrently on same/different models. | FR | `docs/PRODUCT_SPEC.md:888` | UNASSESSED | UNASSESSED |
| FR-108 | Detect/classify quota, throttling, health, auth, and retirement failures. | FR | `docs/PRODUCT_SPEC.md:889` | UNASSESSED | UNASSESSED |
| FR-109 | Qualified fallback preserves handoff state across model/provider classes. | FR | `docs/PRODUCT_SPEC.md:890` | UNASSESSED | UNASSESSED |
| FR-110 | Local downloads/API spending require explicit enabling and policy. | FR | `docs/PRODUCT_SPEC.md:891` | UNASSESSED | UNASSESSED |
| FR-111 | Queue/cache/control health checks and apply explicit cooldown states. | FR | `docs/PRODUCT_SPEC.md:892` | UNASSESSED | UNASSESSED |
| FR-112 | Base role recommendations on empirical outcomes, not only name heuristics. | FR | `docs/PRODUCT_SPEC.md:893` | UNASSESSED | UNASSESSED |
| FR-200 | Convert objective to schema-validated dependency graph. | FR | `docs/PRODUCT_SPEC.md:897` | UNASSESSED | UNASSESSED |
| FR-201 | Tasks declare repo, scope, acceptance, validators, risk, and capability. | FR | `docs/PRODUCT_SPEC.md:898` | UNASSESSED | UNASSESSED |
| FR-202 | Launch ready tasks to safe effective concurrency without arbitrary built-in cap. | FR | `docs/PRODUCT_SPEC.md:899` | UNASSESSED | UNASSESSED |
| FR-203 | Every mutating task uses isolated workspace. | FR | `docs/PRODUCT_SPEC.md:900` | UNASSESSED | UNASSESSED |
| FR-204 | Failed work receives exact validator feedback and bounded retries. | FR | `docs/PRODUCT_SPEC.md:901` | UNASSESSED | UNASSESSED |
| FR-205 | Revise plans without losing history/rationale. | FR | `docs/PRODUCT_SPEC.md:902` | UNASSESSED | UNASSESSED |
| FR-206 | Reconcile/resume interrupted runs. | FR | `docs/PRODUCT_SPEC.md:903` | UNASSESSED | UNASSESSED |
| FR-207 | Cross-repository runs produce exact integration set. | FR | `docs/PRODUCT_SPEC.md:904` | UNASSESSED | UNASSESSED |
| FR-208 | Maintain shared blackboard and model-specific token-budgeted context packs. | FR | `docs/PRODUCT_SPEC.md:905` | UNASSESSED | UNASSESSED |
| FR-209 | Agent roles return schema-validated envelopes with issues/next actions. | FR | `docs/PRODUCT_SPEC.md:906` | UNASSESSED | UNASSESSED |
| FR-300 | Only trusted/approved validators run automatically. | FR | `docs/PRODUCT_SPEC.md:910` | UNASSESSED | UNASSESSED |
| FR-301 | Preserve check outputs/artifacts as receipts. | FR | `docs/PRODUCT_SPEC.md:911` | UNASSESSED | UNASSESSED |
| FR-302 | Integration-validate combined changes. | FR | `docs/PRODUCT_SPEC.md:912` | UNASSESSED | UNASSESSED |
| FR-303 | Final review independent of implementation when capacity permits. | FR | `docs/PRODUCT_SPEC.md:913` | UNASSESSED | UNASSESSED |
| FR-304 | Report readiness honestly; never equate commit with release. | FR | `docs/PRODUCT_SPEC.md:914` | UNASSESSED | UNASSESSED |
| FR-305 | Respect explicit approval for merge/release/sign/deploy/publish. | FR | `docs/PRODUCT_SPEC.md:915` | UNASSESSED | UNASSESSED |
| FR-306 | User can inspect/export complete evidence package. | FR | `docs/PRODUCT_SPEC.md:916` | UNASSESSED | UNASSESSED |
| FR-307 | Read-only reporter summarizes ledger without changing verdict. | FR | `docs/PRODUCT_SPEC.md:917` | UNASSESSED | UNASSESSED |
| FR-500 | Represent large objective as versioned campaign with stages/shards/barriers/gates. | FR | `docs/PRODUCT_SPEC.md:921` | UNASSESSED | UNASSESSED |
| FR-501 | Run representative pilot through complete workflow before fan-out. | FR | `docs/PRODUCT_SPEC.md:922` | UNASSESSED | UNASSESSED |
| FR-502 | Pilot-to-scale promotion requires quality/resource/failure/approval evidence. | FR | `docs/PRODUCT_SPEC.md:923` | UNASSESSED | UNASSESSED |
| FR-503 | Support reviewer quorum, structured findings, fixer, and re-review. | FR | `docs/PRODUCT_SPEC.md:924` | UNASSESSED | UNASSESSED |
| FR-504 | Enforce command policy outside prompts and record allowed/denied/attempted/executed operations. | FR | `docs/PRODUCT_SPEC.md:925` | UNASSESSED | UNASSESSED |
| FR-505 | Classify one diagnostic artifact into non-overlapping bounded repairs. | FR | `docs/PRODUCT_SPEC.md:926` | UNASSESSED | UNASSESSED |
| FR-506 | Account for repo overlap, dependencies, host resources, provider capacity, and exclusivity in shard admission. | FR | `docs/PRODUCT_SPEC.md:927` | UNASSESSED | UNASSESSED |
| FR-507 | Detect missing/skipped/deleted/filtered/weakened tests and prohibited shortcuts where practical. | FR | `docs/PRODUCT_SPEC.md:928` | UNASSESSED | UNASSESSED |
| FR-508 | Compare baseline/new behavior and retain unexplained mismatches as repair evidence. | FR | `docs/PRODUCT_SPEC.md:929` | UNASSESSED | UNASSESSED |
| FR-509 | Report regressions, provisional code, nonfunctional movement, coverage, cost, interventions, and unresolved evidence—not merely green tests. | FR | `docs/PRODUCT_SPEC.md:930` | UNASSESSED | UNASSESSED |
| FR-510 | Campaign checkpoints survive restart without repeating accepted work/consequential actions. | FR | `docs/PRODUCT_SPEC.md:931` | UNASSESSED | UNASSESSED |
| FR-511 | Promote successful procedures to versioned templates without widening authority. | FR | `docs/PRODUCT_SPEC.md:932` | UNASSESSED | UNASSESSED |
| FR-400 | Local dashboard provides portfolio/product/run/fleet/evidence/approval views. | FR | `docs/PRODUCT_SPEC.md:936` | UNASSESSED | UNASSESSED |
| FR-401 | Setup guides official provider auth without receiving credentials. | FR | `docs/PRODUCT_SPEC.md:937` | UNASSESSED | UNASSESSED |
| FR-402 | Diagnostics distinguish install/auth/entitlement/availability/capacity/compatibility. | FR | `docs/PRODUCT_SPEC.md:938` | UNASSESSED | UNASSESSED |
| FR-403 | UI explains fallback/replanning/routing. | FR | `docs/PRODUCT_SPEC.md:939` | UNASSESSED | UNASSESSED |
| FR-404 | Closing/reopening app preserves durable work state. | FR | `docs/PRODUCT_SPEC.md:940` | UNASSESSED | UNASSESSED |
| FR-405 | User safely cancels, pauses, resumes, archives, and inspects runs. | FR | `docs/PRODUCT_SPEC.md:941` | UNASSESSED | UNASSESSED |
| FR-406 | Persisted live events reconnect from cursor after navigation/refresh/disconnect. | FR | `docs/PRODUCT_SPEC.md:942` | UNASSESSED | UNASSESSED |
| FR-407 | Non-mutating Workbench converts exploration into proposed verified objectives. | FR | `docs/PRODUCT_SPEC.md:943` | UNASSESSED | UNASSESSED |
| FR-408 | Analytics expose assignments, latency, retries, malformed outputs, validators, fallback, and workload mix. | FR | `docs/PRODUCT_SPEC.md:944` | UNASSESSED | UNASSESSED |
| FR-409 | User can pause/redirect/interrupt-continue/reassign without losing attribution/evidence. | FR | `docs/PRODUCT_SPEC.md:945` | UNASSESSED | UNASSESSED |
| FR-600 | Configured GitHub/Linear events update bounded drafts without authorizing execution. | FR | `docs/PRODUCT_SPEC.md:949` | UNASSESSED | UNASSESSED |
| FR-601 | Local schedules run approved maintenance/audits only while machine/runtime available. | FR | `docs/PRODUCT_SPEC.md:950` | UNASSESSED | UNASSESSED |
| FR-602 | Monitoring produces diagnostic evidence/proposals, not production authority. | FR | `docs/PRODUCT_SPEC.md:951` | UNASSESSED | UNASSESSED |
| FR-603 | Email/chat default to notification/approval links, not message-driven code execution. | FR | `docs/PRODUCT_SPEC.md:952` | UNASSESSED | UNASSESSED |
| FR-604 | Prepare draft PR and evidence handoff under explicit external-write approval. | FR | `docs/PRODUCT_SPEC.md:953` | UNASSESSED | UNASSESSED |
| FR-605 | Keep merge/deploy/sign/publish/production approvals separate. | FR | `docs/PRODUCT_SPEC.md:954` | UNASSESSED | UNASSESSED |
| FR-606 | Version workflows/skills/fixtures/packs and retain exact historical revision. | FR | `docs/PRODUCT_SPEC.md:955` | UNASSESSED | UNASSESSED |
| FR-607 | Report verified throughput/cycle/quality/intervention/utilization and exact or labeled-estimated cost. | FR | `docs/PRODUCT_SPEC.md:956` | UNASSESSED | UNASSESSED |
| FR-608 | Improvements require retained evaluation and explicit reversible promotion. | FR | `docs/PRODUCT_SPEC.md:957` | UNASSESSED | UNASSESSED |
| PS-NFR-001 | Run product state/source orchestration locally by default. | NFR | `docs/PRODUCT_SPEC.md:963` | UNASSESSED | UNASSESSED |
| PS-NFR-002 | Bind dashboard to loopback unless deliberately configured otherwise. | NFR | `docs/PRODUCT_SPEC.md:964` | UNASSESSED | UNASSESSED |
| PS-NFR-003 | Normal use has no DevHarmonics-hosted dependency. | NFR | `docs/PRODUCT_SPEC.md:965` | UNASSESSED | UNASSESSED |
| PS-NFR-004 | No scheduled/active work continues elsewhere while computer is off. | NFR | `docs/PRODUCT_SPEC.md:966` | UNASSESSED | UNASSESSED |
| PS-NFR-005 | Source/context crosses provider boundary only when selected and policy allows. | NFR | `docs/PRODUCT_SPEC.md:967` | UNASSESSED | UNASSESSED |
| PS-NFR-006 | Minimize/redact secrets; prompt inclusion requires explicit need/permission. | NFR | `docs/PRODUCT_SPEC.md:968` | UNASSESSED | UNASSESSED |
| PS-NFR-007 | Redact at ledger boundary before persistence/display; store integration credentials in OS credential store. | NFR | `docs/PRODUCT_SPEC.md:969` | UNASSESSED | UNASSESSED |
| PS-NFR-008 | Consequential/destructive actions require explicit authority. | NFR | `docs/PRODUCT_SPEC.md:973` | UNASSESSED | UNASSESSED |
| PS-NFR-009 | Treat provider output as untrusted. | NFR | `docs/PRODUCT_SPEC.md:974` | UNASSESSED | UNASSESSED |
| PS-NFR-010 | Keep work isolated and recoverable. | NFR | `docs/PRODUCT_SPEC.md:975` | UNASSESSED | UNASSESSED |
| PS-NFR-011 | Default to reviewable branches/drafts. | NFR | `docs/PRODUCT_SPEC.md:976` | UNASSESSED | UNASSESSED |
| PS-NFR-012 | Completed run identifies exact commits, models, settings, tools, checks, artifacts, and approvals. | NFR | `docs/PRODUCT_SPEC.md:980` | UNASSESSED | UNASSESSED |
| PS-NFR-013 | Alias changes do not rewrite historical records. | NFR | `docs/PRODUCT_SPEC.md:981` | UNASSESSED | UNASSESSED |
| PS-NFR-014 | Report missing/unverifiable evidence rather than infer it. | NFR | `docs/PRODUCT_SPEC.md:982` | UNASSESSED | UNASSESSED |
| PS-NFR-015 | Runs survive app restart and machine reboot. | NFR | `docs/PRODUCT_SPEC.md:986` | UNASSESSED | UNASSESSED |
| PS-NFR-016 | Provider/model failures do not corrupt other tasks. | NFR | `docs/PRODUCT_SPEC.md:987` | UNASSESSED | UNASSESSED |
| PS-NFR-017 | Quota exhaustion supports pause/fallback/reschedule. | NFR | `docs/PRODUCT_SPEC.md:988` | UNASSESSED | UNASSESSED |
| PS-NFR-018 | Persistence provides backup, migration, and integrity checks. | NFR | `docs/PRODUCT_SPEC.md:989` | UNASSESSED | UNASSESSED |
| PS-NFR-019 | Campaign state survives/reconciles interruption without duplicate accepted work. | NFR | `docs/PRODUCT_SPEC.md:990` | UNASSESSED | UNASSESSED |
| PS-NFR-020 | Resource pressure stops admission/reduces concurrency before host destabilization. | NFR | `docs/PRODUCT_SPEC.md:991` | UNASSESSED | UNASSESSED |
| PS-NFR-021 | Control plane remains responsive with many queued tasks/agents. | NFR | `docs/PRODUCT_SPEC.md:995` | UNASSESSED | UNASSESSED |
| PS-NFR-022 | Event delivery should move beyond polling when needed. | SHOULD | `docs/PRODUCT_SPEC.md:996` | UNASSESSED | UNASSESSED |
| PS-NFR-023 | Stream/reference large logs/artifacts instead of indiscriminate loading. | NFR | `docs/PRODUCT_SPEC.md:997` | UNASSESSED | UNASSESSED |
| PS-NFR-024 | Scheduling accounts for local resource pressure. | NFR | `docs/PRODUCT_SPEC.md:998` | UNASSESSED | UNASSESSED |
| PS-NFR-025 | Run expensive shared diagnostics at barriers and partition rather than duplicate. | NFR | `docs/PRODUCT_SPEC.md:999` | UNASSESSED | UNASSESSED |
| PS-NFR-026 | Measure scale as verified throughput, not agent/commit/token/line counts. | NFR | `docs/PRODUCT_SPEC.md:1000` | UNASSESSED | UNASSESSED |
| PS-NFR-027 | Scale for owner-operator/small team, not corporate/multi-tenant service. | NFR | `docs/PRODUCT_SPEC.md:1001` | UNASSESSED | UNASSESSED |
| PS-NFR-028 | Version providers/transports/tools/validators/workflows/catalogs as explicit adapters/plugins. | NFR | `docs/PRODUCT_SPEC.md:1005` | UNASSESSED | UNASSESSED |
| PS-NFR-029 | Preserve provider-specific capabilities through typed extensions. | NFR | `docs/PRODUCT_SPEC.md:1006` | UNASSESSED | UNASSESSED |
| PS-NFR-030 | Fail closed on compatibility failures with useful diagnostics. | NFR | `docs/PRODUCT_SPEC.md:1007` | UNASSESSED | UNASSESSED |
| PS-NFR-031 | Dashboard is keyboard navigable, screen-reader understandable, responsive, and visually clear. | MUST | `docs/PRODUCT_SPEC.md:1011` | UNASSESSED | UNASSESSED |
| PS-NFR-032 | Do not communicate status by color alone. | MUST | `docs/PRODUCT_SPEC.md:1012` | UNASSESSED | UNASSESSED |
| PS-NFR-033 | Give technical evidence plain-language summaries without hiding detail. | MUST | `docs/PRODUCT_SPEC.md:1013` | UNASSESSED | UNASSESSED |
| PS-SEC-001 | Make trust boundaries visible. | MUST | `docs/PRODUCT_SPEC.md:1017` | UNASSESSED | UNASSESSED |
| PS-SEC-002 | Use provider-owned authentication. | NFR | `docs/PRODUCT_SPEC.md:1030-1032` | UNASSESSED | UNASSESSED |
| PS-SEC-003 | Scrub credentials/environment for child processes. | NFR | `docs/PRODUCT_SPEC.md:1033` | UNASSESSED | UNASSESSED |
| PS-SEC-004 | Enforce path/repository scope. | NFR | `docs/PRODUCT_SPEC.md:1034` | UNASSESSED | UNASSESSED |
| PS-SEC-005 | Use command allowlists and typed tool contracts. | NFR | `docs/PRODUCT_SPEC.md:1035` | UNASSESSED | UNASSESSED |
| PS-SEC-006 | Apply per-agent permissions. | NFR | `docs/PRODUCT_SPEC.md:1036` | UNASSESSED | UNASSESSED |
| PS-SEC-007 | Gate side effects by approval. | NFR | `docs/PRODUCT_SPEC.md:1037` | UNASSESSED | UNASSESSED |
| PS-SEC-008 | Protect local UI with same-origin and loopback controls. | NFR | `docs/PRODUCT_SPEC.md:1038` | UNASSESSED | UNASSESSED |
| PS-SEC-009 | Use tamper-evident/integrity-verifiable receipts where practical. | NFR | `docs/PRODUCT_SPEC.md:1039` | UNASSESSED | UNASSESSED |
| PS-SEC-010 | Preserve dependency/adapter provenance. | NFR | `docs/PRODUCT_SPEC.md:1040` | PARTIAL — dependency manifests, declarations, diagnostics, and identity matches retain validated exact commit/blob/path/cwd/locator provenance; adapter-wide completion remains unassessed | `src/dependency-intelligence.ts`; `src/product-intelligence.ts`; hostile-markup render falsifier; dependency Chromium journey |
| PS-SEC-011 | Treat repository/tool content as prompt-injection-capable. | NFR | `docs/PRODUCT_SPEC.md:1041` | PARTIAL — dependency evidence is bounded as untrusted planning data and every manifest-controlled Products field is HTML-escaped; broader repository/tool surfaces remain to be assessed | `src/product-intelligence.ts`; `src/prompts.ts`; `src/ui/app.js`; hostile-markup render falsifier |
| PS-SEC-012 | Provide clear incident diagnostics and revocation paths. | NFR | `docs/PRODUCT_SPEC.md:1042` | UNASSESSED | UNASSESSED |
| PS-BETA-001 | Beta is the complete specified product, not a narrow subset/preview/later-capability promise; every committed feature/function must exist, integrate through the real product, and have claim-layer evidence. | BETA | `docs/PRODUCT_SPEC.md:1105-1111` | UNASSESSED | UNASSESSED |
| PS-BETA-002 | Map every FR, Milestone A-D priority, decided capability, and required CivicSuite acceptance level to implementation and exact verification evidence. | BETA | `docs/PRODUCT_SPEC.md:1113-1117` | UNASSESSED | UNASSESSED |
| PS-BETA-003 | A placeholder, advisory-only contract, hidden developer path, or roadmap claim is not implementation. | BETA | `docs/PRODUCT_SPEC.md:1118-1119` | UNASSESSED | UNASSESSED |
| PS-BETA-004 | The full configured local repository census passes with at least 95% correct comprehension and zero silent wrong answers for version, validator, dependency, repository-role, topology, and release-truth facts. | BETA | `docs/PRODUCT_SPEC.md:1120-1123` | PARTIAL — the production dependency parser, persistence/UI proof, and pinned 24-repository dependency corpus pass; the complete configured-census threshold across every fact family remains pending | PENDING FULL CONFIGURED CENSUS |
| PS-BETA-005 | P0-1 authoritative release-version comprehension is mandatory. | BETA | `docs/PRODUCT_SPEC.md:1124` | UNASSESSED | UNASSESSED |
| PS-BETA-006 | P0-2 nested-manifest and subproject comprehension is mandatory. | BETA | `docs/PRODUCT_SPEC.md:1125` | IMPLEMENTED — merged PR #58 (`09209e5`) | PENDING EXACT-CANDIDATE BETA REPROOF |
| PS-BETA-007 | P0-3 structured dependency parsing and provenance is mandatory. | BETA | `docs/PRODUCT_SPEC.md:1126` | IMPLEMENTED — exact-commit parser, versioned persistence, deterministic resolution, bounded planning context, API round-trip, owner authority, Products evidence UI, and pinned immutable 24-repository corpus | PENDING EXACT-CANDIDATE BETA REPROOF |
| PS-BETA-008 | P0-4 real validator discovery without no-op coverage is mandatory. | BETA | `docs/PRODUCT_SPEC.md:1127` | UNASSESSED | UNASSESSED |
| PS-BETA-009 | Complete the product-manager factory loop from objective/approval through adaptive workforce, steering, campaigns, review/fix/re-review, validation/reconciliation, and evidence delivery without manual agent terminals. | BETA | `docs/PRODUCT_SPEC.md:1128-1133` | UNASSESSED | UNASSESSED |
| PS-BETA-010 | Implement campaign orchestration, evaluation/improvement, workflows/triggers, analytics, ACP, specified provider/runtime breadth, tools/skills, portable handoffs, and policy-bounded optional integrations; optional means disabled until enabled, not absent. | BETA | `docs/PRODUCT_SPEC.md:1134-1138` | UNASSESSED | UNASSESSED |
| PS-BETA-011 | Reconstruct interrupted integration sets/campaigns, reconcile retained work, continue recorded phase without repeated accepted/consequential actions, and safely clean temporary worktrees. | BETA | `docs/PRODUCT_SPEC.md:1139-1142` | UNASSESSED | UNASSESSED |
| PS-BETA-012 | Complete one single-repository delivery after relevant foundations land. | BETA | `docs/PRODUCT_SPEC.md:1143-1145` | UNASSESSED | UNASSESSED |
| PS-BETA-013 | Complete one coordinated module + CivicCore delivery after relevant foundations land. | BETA | `docs/PRODUCT_SPEC.md:1146` | UNASSESSED | UNASSESSED |
| PS-BETA-014 | Complete one delivery where divergence is honestly detected and contained. | BETA | `docs/PRODUCT_SPEC.md:1147` | UNASSESSED | UNASSESSED |
| PS-BETA-015 | Complete one governed pilot-to-campaign workflow with diagnostic partitioning, review, repair, differential validation, and regression accounting. | BETA | `docs/PRODUCT_SPEC.md:1148-1149` | UNASSESSED | UNASSESSED |
| PS-BETA-016 | Complete one policy-bounded trigger-to-objective-draft workflow. | BETA | `docs/PRODUCT_SPEC.md:1150` | UNASSESSED | UNASSESSED |
| PS-BETA-017 | Complete one evaluation-backed recommendation that can be accepted, rejected, and rolled back without silently changing authority. | BETA | `docs/PRODUCT_SPEC.md:1151-1152` | UNASSESSED | UNASSESSED |
| PS-BETA-018 | Pass the exact-candidate full beta gate with requirement evidence, affected suites, integrated runtime journeys, and fresh adversarial review finding no unresolved beta blocker. | BETA | `docs/PRODUCT_SPEC.md:1153-1155` | UNASSESSED | UNASSESSED |
| PS-BETA-019 | Beta subscription workers include Codex, Claude Code, and Google Antigravity adapters, available after provider-owned sign-in. | BETA | `docs/PRODUCT_SPEC.md:1161` | UNASSESSED | UNASSESSED |
| PS-BETA-020 | Beta local workers include Ollama and feature-flagged Open Interpreter; Open Interpreter defaults disabled until enabled. | BETA | `docs/PRODUCT_SPEC.md:1162` | UNASSESSED | UNASSESSED |
| PS-BETA-021 | Beta agent transport includes ACP with Open Interpreter as first conformance target, disabled until compatible local agent configuration. | BETA | `docs/PRODUCT_SPEC.md:1163` | UNASSESSED | UNASSESSED |
| PS-BETA-022 | Beta API workers include OpenRouter and a direct OpenAI API adapter through the provider-neutral API contract, disabled until credentials/model/privacy/spending policy configuration. | BETA | `docs/PRODUCT_SPEC.md:1164` | UNASSESSED | UNASSESSED |
| PS-BETA-023 | Beta development triggers include GitHub, Linear, local schedule, and monitoring adapters, disabled until trigger and bounded-policy configuration. | BETA | `docs/PRODUCT_SPEC.md:1165` | UNASSESSED | UNASSESSED |
| PS-BETA-024 | Beta portable operation imports/exports objective, workflow, evidence, and delivery-handoff bundles locally without transferring credentials or authority. | BETA | `docs/PRODUCT_SPEC.md:1166` | UNASSESSED | UNASSESSED |
| PS-BETA-025 | Exclude hosted execution, remote-offline workers, enterprise IAM/compliance/secrets administration, and arbitrary email/chat-driven execution. | BETA | `docs/PRODUCT_SPEC.md:1167` | UNASSESSED | UNASSESSED |
| PS-BETA-026 | Treat pre-exit development gates as integration gates; do not require broad cosmetic polish, clean-machine rehearsal, or user-ready refinement after every feature. | BETA | `docs/PRODUCT_SPEC.md:1169-1172` | UNASSESSED | UNASSESSED |
| PS-BETA-027 | Immediately fix issues causing silent wrong answers, security/privacy exposure, data loss, repeated consequential actions, corrupted integration, or broken later-feature dependencies; record other polish for post-feature beta pass. | BETA | `docs/PRODUCT_SPEC.md:1172-1175` | UNASSESSED | UNASSESSED |
| PS-BETA-028 | The four P0 correctness checks are intermediate foundations, not beta readiness; full beta also requires the concrete full-repository comprehension census. | BETA | `docs/PRODUCT_SPEC.md:1262-1265` | UNASSESSED | UNASSESSED |
| PS-REL-001 | Build immutable exact-commit inventory of recognized root/nested package.json and pyproject.toml release units keyed by normalized directory. | RELEASE | `docs/PRODUCT_SPEC.md:1177-1183` | UNASSESSED | UNASSESSED |
| PS-REL-002 | Record manifests, effective public static version, privacy/dynamic/versionless state, diagnostics, and selection rationale per release unit. | RELEASE | `docs/PRODUCT_SPEC.md:1181-1184` | UNASSESSED | UNASSESSED |
| PS-REL-003 | Private npm/versionless manifests may support validator evidence but cannot supply release authority. | RELEASE | `docs/PRODUCT_SPEC.md:1184-1185` | UNASSESSED | UNASSESSED |
| PS-REL-004 | Valid public root package version has highest automatic precedence with same-directory package-before-pyproject rules. | RELEASE | `docs/PRODUCT_SPEC.md:1189-1190` | UNASSESSED | UNASSESSED |
| PS-REL-005 | If no root authority and exactly one valid public nested unit, auto-select it, prefill tag version, and apply mismatch gate. | RELEASE | `docs/PRODUCT_SPEC.md:1191-1193` | UNASSESSED | UNASSESSED |
| PS-REL-006 | Multiple possible nested authorities fail tagging closed regardless of matching versions until one consequential owner selection. | RELEASE | `docs/PRODUCT_SPEC.md:1194-1196` | UNASSESSED | UNASSESSED |
| PS-REL-007 | Persist owner release-unit selection and reuse it across later commits/deliveries without repeated approval. | RELEASE | `docs/PRODUCT_SPEC.md:1196-1198` | UNASSESSED | UNASSESSED |
| PS-REL-008 | Persisted nested selection remains authoritative across version changes/other units; unrelated defects stay visible but do not override it. | RELEASE | `docs/PRODUCT_SPEC.md:1199-1201` | UNASSESSED | UNASSESSED |
| PS-REL-009 | Invalidate selection only on specified material topology changes; keep invalidation durable/non-reactivating; require owner re-resolution. | RELEASE | `docs/PRODUCT_SPEC.md:1202-1206` | UNASSESSED | UNASSESSED |
| PS-REL-010 | Root conflict requires topology repair before nested selection; malformed/unknown selection requires data repair and must not be silently altered. | RELEASE | `docs/PRODUCT_SPEC.md:1206-1209` | UNASSESSED | UNASSESSED |
| PS-REL-011 | Every result exposes provenance, selected unit/source, and non-selection reason for every other unit. | RELEASE | `docs/PRODUCT_SPEC.md:1210-1212` | UNASSESSED | UNASSESSED |
| PS-REL-012 | Selection record is runtime-decoded v1, active/invalidated, with positive monotonic revision; malformed/unknown fails closed. | RELEASE | `docs/PRODUCT_SPEC.md:1214-1216` | UNASSESSED | UNASSESSED |
| PS-REL-013 | Selection CAS uses expected revision: zero requires true absence; later writes require exact current revision. | RELEASE | `docs/PRODUCT_SPEC.md:1217-1219` | UNASSESSED | UNASSESSED |
| PS-REL-014 | API accepts only exact immutable-inventory candidates and rejects stale competing actions; only typed selector CAS may write reserved selection. | RELEASE | `docs/PRODUCT_SPEC.md:1219-1221` | UNASSESSED | UNASSESSED |
| PS-REL-015 | Generic repo insertion/refresh strips incoming reserved value when absent and atomically preserves any existing raw value. | RELEASE | `docs/PRODUCT_SPEC.md:1222-1224` | UNASSESSED | UNASSESSED |
| PS-REL-016 | Tag gate re-resolves exact merge commit/current selection revision and holds canonical DB+repo filesystem lock through tag/publication. | RELEASE | `docs/PRODUCT_SPEC.md:1225-1229` | UNASSESSED | UNASSESSED |
| PS-REL-017 | Refuse ledger DBs whose filesystem link count is not one. | RELEASE | `docs/PRODUCT_SPEC.md:1229-1231` | UNASSESSED | UNASSESSED |
| PS-REL-018 | Freeze lock handles and bind token to canonical key, random nonce, and exact regular file device/inode; require identity/nonce for writes/cleanup. | RELEASE | `docs/PRODUCT_SPEC.md:1231-1233` | UNASSESSED | UNASSESSED |
| PS-REL-019 | Cleanup revokes token and preserves callback result/original error; mismatch/read/stat/unlink failure emits nonthrowing DEGRADED diagnostic without deleting replacement path. | RELEASE | `docs/PRODUCT_SPEC.md:1233-1236` | UNASSESSED | UNASSESSED |
| PS-REL-020 | Never age out/steal/delete crash-stale lock; only owner may remove after independently proving no relevant active operation. | RELEASE | `docs/PRODUCT_SPEC.md:1237-1239` | UNASSESSED | UNASSESSED |
| PS-REL-021 | Delivery evidence records commit, selection state/revision, selected unit, manifest, provenance, and every unit’s reason/diagnostics. | RELEASE | `docs/PRODUCT_SPEC.md:1239-1241` | UNASSESSED | UNASSESSED |
| PS-REL-022 | After remote tag push, return truthful tagged state and never fall back to merged. | RELEASE | `docs/PRODUCT_SPEC.md:1242-1243` | UNASSESSED | UNASSESSED |
| PS-REL-023 | Give tagged-status persistence one idempotent retry; treat continued/event/unexpected reconciliation failures as nonfatal DEGRADED owner-repair conditions; never retry attempted event. | RELEASE | `docs/PRODUCT_SPEC.md:1244-1247` | UNASSESSED | UNASSESSED |
| PS-REL-024 | Pinned CivicRecords acceptance auto-selects backend 1.7.3, marks frontend private/docs versionless, and needs no per-delivery approval. | RELEASE | `docs/PRODUCT_SPEC.md:1249-1252` | UNASSESSED | UNASSESSED |
| PS-REL-025 | Run backend/frontend validators only in contained working directories. | RELEASE | `docs/PRODUCT_SPEC.md:1252-1253` | UNASSESSED | UNASSESSED |
| PS-REL-026 | Attribute manifest/workflow/release-script discovery evidence only when all comes from same immutable commit. | RELEASE | `docs/PRODUCT_SPEC.md:1253-1255` | UNASSESSED | UNASSESSED |
| PS-REL-027 | Require human approval for plan, genuine release-unit ambiguity, merge, and tag; automate routine comprehension/discovery/reuse of valid decision. | RELEASE | `docs/PRODUCT_SPEC.md:1257-1260` | UNASSESSED | UNASSESSED |
| PS-REL-029 | Beta readiness is not publication; tag, release publication, or announcement requires separate explicit owner authorization. | RELEASE | `docs/PRODUCT_SPEC.md:1267-1269` | UNASSESSED | UNASSESSED |
| PS-MS-A01 | Restart-safe run reconciliation/resume. | MILESTONE | `docs/PRODUCT_SPEC.md:1277` | UNASSESSED | UNASSESSED |
| PS-MS-A02 | Explicit per-role provider/model/effort configuration. | MILESTONE | `docs/PRODUCT_SPEC.md:1278` | UNASSESSED | UNASSESSED |
| PS-MS-A03 | Live model registry for existing subscription providers. | MILESTONE | `docs/PRODUCT_SPEC.md:1279` | UNASSESSED | UNASSESSED |
| PS-MS-A04 | Model qualification states and routing explanations. | MILESTONE | `docs/PRODUCT_SPEC.md:1280` | UNASSESSED | UNASSESSED |
| PS-MS-A05 | Quota/error classification and safe fallback. | MILESTONE | `docs/PRODUCT_SPEC.md:1281` | UNASSESSED | UNASSESSED |
| PS-MS-A06 | Ollama discovery/capability/resource inventory/local worker. | MILESTONE | `docs/PRODUCT_SPEC.md:1282` | UNASSESSED | UNASSESSED |
| PS-MS-A07 | Health queue, cooldowns, runtime capacity states. | MILESTONE | `docs/PRODUCT_SPEC.md:1283` | UNASSESSED | UNASSESSED |
| PS-MS-A08 | Shared blackboard, token-aware context, structured envelopes. | MILESTONE | `docs/PRODUCT_SPEC.md:1284` | UNASSESSED | UNASSESSED |
| PS-MS-A09 | Empirical model/role analytics and read-only reporter. | MILESTONE | `docs/PRODUCT_SPEC.md:1285` | UNASSESSED | UNASSESSED |
| PS-MS-A10 | Improved evidence/diff/approval views. | MILESTONE | `docs/PRODUCT_SPEC.md:1286` | UNASSESSED | UNASSESSED |
| PS-MS-A11 | Reusable product/workspace registration. | MILESTONE | `docs/PRODUCT_SPEC.md:1287` | UNASSESSED | UNASSESSED |
| PS-MS-A12 | Persisted live events and browser reconnection. | MILESTONE | `docs/PRODUCT_SPEC.md:1288` | UNASSESSED | UNASSESSED |
| PS-MS-A13 | Friendlier Windows launcher/installer/provider onboarding. | MILESTONE | `docs/PRODUCT_SPEC.md:1289` | UNASSESSED | UNASSESSED |
| PS-MS-A14 | Successful bounded CivicSuite single-repository pilot. | MILESTONE | `docs/PRODUCT_SPEC.md:1290` | UNASSESSED | UNASSESSED |
| PS-MS-B01 | Multi-repository workspace and typed relationships. | MILESTONE | `docs/PRODUCT_SPEC.md:1298` | UNASSESSED | UNASSESSED |
| PS-MS-B02 | Umbrella/specification/compatibility context ingestion. | MILESTONE | `docs/PRODUCT_SPEC.md:1299` | UNASSESSED | UNASSESSED |
| PS-MS-B03 | Cross-repository impact analysis/integration sets. | MILESTONE | `docs/PRODUCT_SPEC.md:1300` | UNASSESSED | UNASSESSED |
| PS-MS-B04 | Durable decisions, risks, and plan revisions. | MILESTONE | `docs/PRODUCT_SPEC.md:1301` | UNASSESSED | UNASSESSED |
| PS-MS-B05 | Product dashboard and objective history. | MILESTONE | `docs/PRODUCT_SPEC.md:1302` | UNASSESSED | UNASSESSED |
| PS-MS-B06 | Independent specialist reviews/evidence packages. | MILESTONE | `docs/PRODUCT_SPEC.md:1303` | UNASSESSED | UNASSESSED |
| PS-MS-B07 | GitHub issue/PR/CI/release read integration. | MILESTONE | `docs/PRODUCT_SPEC.md:1304` | UNASSESSED | UNASSESSED |
| PS-MS-B08 | Approved draft PR and cross-repo delivery summaries. | MILESTONE | `docs/PRODUCT_SPEC.md:1305` | UNASSESSED | UNASSESSED |
| PS-MS-B09 | CivicSuite release-truth audit workflow. | MILESTONE | `docs/PRODUCT_SPEC.md:1306` | UNASSESSED | UNASSESSED |
| PS-MS-B10 | Repository Workbench/objective refinement. | MILESTONE | `docs/PRODUCT_SPEC.md:1307` | UNASSESSED | UNASSESSED |
| PS-MS-B11 | Successful bounded cross-repository CivicSuite objective. | MILESTONE | `docs/PRODUCT_SPEC.md:1308` | UNASSESSED | UNASSESSED |
| PS-MS-C01 | Automated catalog refresh/signed compatibility metadata. | MILESTONE | `docs/PRODUCT_SPEC.md:1316` | CLAIMED — live Ed25519 metadata is acquired against application-shipped roots; launch/CLI/manual/24-hour/stale/fingerprint/unavailable-model triggers are wired; failed refresh is visible and cannot preserve catalog-dependent activation | repository envelope; catalog-refresh/trust/fingerprint/unavailable-model core tests; TypeScript build; PENDING EXACT-CANDIDATE BETA REPROOF |
| PS-MS-C02 | Role-specific auditions/historical fixtures. | MILESTONE | `docs/PRODUCT_SPEC.md:1317` | PARTIAL — DH-240 accountable; qualification fixtures exist, complete historical audition and governed upgrade coverage remain | PENDING IMPLEMENTATION |
| PS-MS-C03 | Empirical performance profiles. | MILESTONE | `docs/PRODUCT_SPEC.md:1318` | CLAIMED — DH-250 accountable | PENDING EXACT-CANDIDATE BETA REPROOF |
| PS-MS-C04 | Capacity-aware subscription/local scheduling. | MILESTONE | `docs/PRODUCT_SPEC.md:1319` | CLAIMED — DH-310 accountable | PENDING EXACT-CANDIDATE BETA REPROOF |
| PS-MS-C05 | Critical-path/quota-window optimization. | MILESTONE | `docs/PRODUCT_SPEC.md:1320` | PARTIAL — DH-310 accountable; capacity, dependency, and quota foundations exist, critical-path/quota-window optimization remains | PENDING IMPLEMENTATION |
| PS-MS-C06 | Controlled model upgrades/rollback. | MILESTONE | `docs/PRODUCT_SPEC.md:1321` | PARTIAL — DH-240 accountable; family tracking exists, governed candidate promotion and retained exact rollback remain | PENDING IMPLEMENTATION |
| PS-MS-C07 | Dynamic splitting/replanning/handoff. | MILESTONE | `docs/PRODUCT_SPEC.md:1322` | PARTIAL — DH-300 accountable; attributed handoff foundations exist, versioned replanning and dynamic splitting remain | PENDING IMPLEMENTATION |
| PS-MS-C08 | ACP where it improves interoperability. | MILESTONE | `docs/PRODUCT_SPEC.md:1323` | MISSING — DH-820 accountable; no completed transport implementation is claimed | PENDING IMPLEMENTATION |
| PS-MS-C09 | Broader MCP/tool/skill registry. | MILESTONE | `docs/PRODUCT_SPEC.md:1324` | PARTIAL — DH-440 accountable; local tool/policy foundations exist, governed MCP/skill registry breadth remains | PENDING IMPLEMENTATION |
| PS-MS-C10 | Learning coordinator policies without silent authority change. | MILESTONE | `docs/PRODUCT_SPEC.md:1325` | MISSING — DH-660 accountable; no completed governed-learning implementation is claimed | PENDING IMPLEMENTATION |
| PS-MS-C11 | Campaign stages/pilots/promotion/resource-aware shards. | MILESTONE | `docs/PRODUCT_SPEC.md:1326` | MISSING — DH-350 kernel and DH-600 Control Room accountable; no completed campaign implementation is claimed | PENDING IMPLEMENTATION |
| PS-MS-C12 | Configurable adversarial review/fix/re-review. | MILESTONE | `docs/PRODUCT_SPEC.md:1327` | CLAIMED — DH-460 accountable | PENDING EXACT-CANDIDATE BETA REPROOF |
| PS-MS-C13 | Diagnostic partitioning/test integrity/differential evidence/regression accounting. | MILESTONE | `docs/PRODUCT_SPEC.md:1328` | PARTIAL — DH-480 accountable; test-integrity and comparison foundations exist, partitioning and complete regression accounting remain | PENDING IMPLEMENTATION |
| PS-MS-D01 | Opt-in OpenRouter with OAuth/model/privacy/spending policy. | MILESTONE | `docs/PRODUCT_SPEC.md:1340` | PARTIAL — DH-830 accountable; invocation foundation exists; OAuth/no-manual-key, activation, qualification, positive limits, and live-credit controls pending | PENDING IMPLEMENTATION |
| PS-MS-D02 | Cost-aware routing/budgets. | MILESTONE | `docs/PRODUCT_SPEC.md:1341` | PARTIAL — DH-320 routing foundation; DH-650 counterfactual and complete DH-830 limit policy pending | PENDING IMPLEMENTATION |
| PS-MS-D03 | Open Interpreter worker runtime and direct OpenAI API adapter, in addition to Ollama and OpenRouter. | MILESTONE | `docs/PRODUCT_SPEC.md:1342-1343` | MISSING — DH-830 accountable with DH-825; neither required adapter has a completed implementation claim | PENDING IMPLEMENTATION |
| PS-MS-D04 | ACP/ecosystem packaging for adapters/tools/workflows/skills/qualification. | MILESTONE | `docs/PRODUCT_SPEC.md:1344` | MISSING — DH-815 accountable; no completed ecosystem-package implementation is claimed | PENDING IMPLEMENTATION |
| PS-MS-D05 | GitHub and optional Linear triggers under local policy. | MILESTONE | `docs/PRODUCT_SPEC.md:1345` | MISSING — DH-805 accountable; no completed GitHub/Linear/local-schedule/monitoring trigger implementation is claimed | PENDING IMPLEMENTATION |
| PS-MS-D06 | Portable workflow, objective, evidence, and delivery-handoff bundles for a very small team. | MILESTONE | `docs/PRODUCT_SPEC.md:1346` | MISSING — DH-840 accountable; no completed portable-handoff implementation is claimed | PENDING IMPLEMENTATION |
| PS-MS-D07 | Local analytics/evaluation-driven improvement. | MILESTONE | `docs/PRODUCT_SPEC.md:1347` | PARTIAL — DH-660 accountable; empirical and cost-analysis foundations exist, complete evaluation-driven improvement remains | PENDING IMPLEMENTATION |
| PS-MS-D08 | Exclude hosted execution, off-computer workers, enterprise admin, and mandatory team service. | NON-GOAL | `docs/PRODUCT_SPEC.md:1349` | UNASSESSED | UNASSESSED |
| PS-ACC-L1-01 | Register organization local repositories. | ACCEPTANCE | `docs/PRODUCT_SPEC.md:1357` | UNASSESSED | UNASSESSED |
| PS-ACC-L1-02 | Map repository roles/dependencies. | ACCEPTANCE | `docs/PRODUCT_SPEC.md:1358` | UNASSESSED | UNASSESSED |
| PS-ACC-L1-03 | Read umbrella status/architecture/compatibility/instructions. | ACCEPTANCE | `docs/PRODUCT_SPEC.md:1359` | UNASSESSED | UNASSESSED |
| PS-ACC-L1-04 | Produce cited no-change impact report. | ACCEPTANCE | `docs/PRODUCT_SPEC.md:1360` | UNASSESSED | UNASSESSED |
| PS-ACC-L2-01 | Complete bounded task in one module worktree. | ACCEPTANCE | `docs/PRODUCT_SPEC.md:1364` | UNASSESSED | UNASSESSED |
| PS-ACC-L2-02 | Run repository-native validation. | ACCEPTANCE | `docs/PRODUCT_SPEC.md:1365` | UNASSESSED | UNASSESSED |
| PS-ACC-L2-03 | Preserve exact agent/model/check receipts. | ACCEPTANCE | `docs/PRODUCT_SPEC.md:1366` | UNASSESSED | UNASSESSED |
| PS-ACC-L2-04 | Return reviewable integration branch. | ACCEPTANCE | `docs/PRODUCT_SPEC.md:1367` | UNASSESSED | UNASSESSED |
| PS-ACC-L3-01 | Continue after a subscription provider becomes quota-limited. | ACCEPTANCE | `docs/PRODUCT_SPEC.md:1371` | UNASSESSED | UNASSESSED |
| PS-ACC-L3-02 | Handoff to qualified subscription/local model without state loss. | ACCEPTANCE | `docs/PRODUCT_SPEC.md:1372` | UNASSESSED | UNASSESSED |
| PS-ACC-L3-03 | Record switch reason/equivalence proof. | ACCEPTANCE | `docs/PRODUCT_SPEC.md:1373` | UNASSESSED | UNASSESSED |
| PS-ACC-L4-01 | Plan/execute bounded change across at least two repos. | ACCEPTANCE | `docs/PRODUCT_SPEC.md:1377` | UNASSESSED | UNASSESSED |
| PS-ACC-L4-02 | Validate each repo and combined integration set. | ACCEPTANCE | `docs/PRODUCT_SPEC.md:1378` | UNASSESSED | UNASSESSED |
| PS-ACC-L4-03 | Identify version/compatibility/docs/release implications. | ACCEPTANCE | `docs/PRODUCT_SPEC.md:1379` | UNASSESSED | UNASSESSED |
| PS-ACC-L4-04 | Prepare reviewable branches/draft PRs without merge. | ACCEPTANCE | `docs/PRODUCT_SPEC.md:1380` | UNASSESSED | UNASSESSED |
| PS-ACC-L5-01 | Run defined release-truth/installer-readiness workflow. | ACCEPTANCE | `docs/PRODUCT_SPEC.md:1384` | UNASSESSED | UNASSESSED |
| PS-ACC-L5-02 | Correlate commits/pins/versions/artifacts/docs/tests. | ACCEPTANCE | `docs/PRODUCT_SPEC.md:1385` | UNASSESSED | UNASSESSED |
| PS-ACC-L5-03 | Report proven/unproven facts and remaining approvals. | ACCEPTANCE | `docs/PRODUCT_SPEC.md:1386` | UNASSESSED | UNASSESSED |
| PS-ACC-SEQ-01 | Full-feature beta requires Levels 1-5; earlier levels are checkpoints and none independently establishes beta readiness. | ACCEPTANCE | `docs/PRODUCT_SPEC.md:1388-1389` | UNASSESSED | UNASSESSED |
| PS-METRIC-001 | Measure outcomes that improve Scott’s work, not vanity activity. | SHOULD | `docs/PRODUCT_SPEC.md:1393` | UNASSESSED | UNASSESSED |
| PS-METRIC-002 | Time objective → approved plan. | MEASURE | `docs/PRODUCT_SPEC.md:1397` | UNASSESSED | UNASSESSED |
| PS-METRIC-003 | Time plan approval → evidence-backed result. | MEASURE | `docs/PRODUCT_SPEC.md:1398` | UNASSESSED | UNASSESSED |
| PS-METRIC-004 | First-attempt task pass percentage. | MEASURE | `docs/PRODUCT_SPEC.md:1399` | UNASSESSED | UNASSESSED |
| PS-METRIC-005 | Percentage recovered via feedback/fallback. | MEASURE | `docs/PRODUCT_SPEC.md:1400` | UNASSESSED | UNASSESSED |
| PS-METRIC-006 | Human interventions per objective. | MEASURE | `docs/PRODUCT_SPEC.md:1401` | UNASSESSED | UNASSESSED |
| PS-METRIC-007 | Critical-path scheduling idle time. | MEASURE | `docs/PRODUCT_SPEC.md:1402` | UNASSESSED | UNASSESSED |
| PS-METRIC-008 | Duplicate/conflicting work avoided. | MEASURE | `docs/PRODUCT_SPEC.md:1403` | UNASSESSED | UNASSESSED |
| PS-METRIC-009 | Provider quota wasted on unsuitable tasks. | MEASURE | `docs/PRODUCT_SPEC.md:1404` | UNASSESSED | UNASSESSED |
| PS-METRIC-010 | Work successfully offloaded to local models. | MEASURE | `docs/PRODUCT_SPEC.md:1405` | UNASSESSED | UNASSESSED |
| PS-METRIC-011 | Validator/independent-review defect catch rate. | MEASURE | `docs/PRODUCT_SPEC.md:1406` | UNASSESSED | UNASSESSED |
| PS-METRIC-012 | Steering applied without accepted-work/evidence loss. | MEASURE | `docs/PRODUCT_SPEC.md:1407` | UNASSESSED | UNASSESSED |
| PS-METRIC-013 | Resume success after interruption. | MEASURE | `docs/PRODUCT_SPEC.md:1408` | UNASSESSED | UNASSESSED |
| PS-METRIC-014 | Cross-repository defects found before release. | MEASURE | `docs/PRODUCT_SPEC.md:1409` | UNASSESSED | UNASSESSED |
| PS-METRIC-015 | Workflow/skill/routing/model experiment decisions. | MEASURE | `docs/PRODUCT_SPEC.md:1410` | UNASSESSED | UNASSESSED |
| PS-METRIC-016 | Triggered drafts becoming useful approved work. | MEASURE | `docs/PRODUCT_SPEC.md:1411` | UNASSESSED | UNASSESSED |
| PS-METRIC-017 | Model-upgrade decisions. | MEASURE | `docs/PRODUCT_SPEC.md:1412` | UNASSESSED | UNASSESSED |
| PS-METRIC-018 | Final claims with complete evidence. | MEASURE | `docs/PRODUCT_SPEC.md:1413` | UNASSESSED | UNASSESSED |
| PS-METRIC-019 | North star: useful objectives accepted with less coordination and no loss of safety, traceability, or release honesty. | MEASURE | `docs/PRODUCT_SPEC.md:1415-1417` | UNASSESSED | UNASSESSED |
| PS-NG-001 | Do not become general consumer chatbot. | NON-GOAL | `docs/PRODUCT_SPEC.md:1423` | UNASSESSED | UNASSESSED |
| PS-NG-002 | Do not become cloud hosting/control-plane/sandbox provider. | NON-GOAL | `docs/PRODUCT_SPEC.md:1424` | UNASSESSED | UNASSESSED |
| PS-NG-003 | Do not continue work on DevHarmonics infrastructure while computer is off. | NON-GOAL | `docs/PRODUCT_SPEC.md:1425` | UNASSESSED | UNASSESSED |
| PS-NG-004 | Do not manage corporate workforce or enterprise IAM/compliance/secrets. | NON-GOAL | `docs/PRODUCT_SPEC.md:1426` | UNASSESSED | UNASSESSED |
| PS-NG-005 | Do not replace Git/native tests/CI/review/release governance. | NON-GOAL | `docs/PRODUCT_SPEC.md:1427` | UNASSESSED | UNASSESSED |
| PS-NG-006 | Do not collect/centrally manage provider passwords. | NON-GOAL | `docs/PRODUCT_SPEC.md:1428` | UNASSESSED | UNASSESSED |
| PS-NG-007 | Do not require API keys/cloud hosting for normal use. | NON-GOAL | `docs/PRODUCT_SPEC.md:1429` | UNASSESSED | UNASSESSED |
| PS-NG-008 | Do not treat all models as interchangeable. | NON-GOAL | `docs/PRODUCT_SPEC.md:1430` | UNASSESSED | UNASSESSED |
| PS-NG-009 | Do not silently merge/deploy/publish/sign/spend/delete. | NON-GOAL | `docs/PRODUCT_SPEC.md:1431` | UNASSESSED | UNASSESSED |
| PS-NG-010 | Do not guarantee stable provider automation forever. | NON-GOAL | `docs/PRODUCT_SPEC.md:1432` | UNASSESSED | UNASSESSED |
| PS-NG-011 | Do not hide provider/model failures behind false success. | NON-GOAL | `docs/PRODUCT_SPEC.md:1433` | UNASSESSED | UNASSESSED |
| PS-NG-012 | Do not infer production readiness from unit tests alone. | NON-GOAL | `docs/PRODUCT_SPEC.md:1434` | UNASSESSED | UNASSESSED |
| PS-NG-013 | Do not maximize agent count when fewer are safer/faster. | NON-GOAL | `docs/PRODUCT_SPEC.md:1435` | UNASSESSED | UNASSESSED |
| PS-DEC-001 | Product name is DevHarmonics. | DECIDED | `docs/PRODUCT_SPEC.md:1441` | UNASSESSED | UNASSESSED |
| PS-DEC-002 | Primary design customer is Scott Converse. | DECIDED | `docs/PRODUCT_SPEC.md:1442` | UNASSESSED | UNASSESSED |
| PS-DEC-003 | Primary proving ground is CivicSuite. | DECIDED | `docs/PRODUCT_SPEC.md:1443` | UNASSESSED | UNASSESSED |
| PS-DEC-004 | Local-first owner/small-team control plane; no DevHarmonics cloud hosting. | DECIDED | `docs/PRODUCT_SPEC.md:1444` | UNASSESSED | UNASSESSED |
| PS-DEC-005 | Work stops when computer is off and resumes from local ledger. | DECIDED | `docs/PRODUCT_SPEC.md:1445` | UNASSESSED | UNASSESSED |
| PS-DEC-006 | Enterprise workforce/IAM/compliance/central secrets are out of scope. | DECIDED | `docs/PRODUCT_SPEC.md:1446` | UNASSESSED | UNASSESSED |
| PS-DEC-007 | Subscription Codex/Claude/Gemini are first-class. | DECIDED | `docs/PRODUCT_SPEC.md:1447` | UNASSESSED | UNASSESSED |
| PS-DEC-008 | Ollama/local models are first-class target capability. | DECIDED | `docs/PRODUCT_SPEC.md:1448` | UNASSESSED | UNASSESSED |
| PS-DEC-009 | OpenRouter/API is optional and disabled until configured. | DECIDED | `docs/PRODUCT_SPEC.md:1449` | UNASSESSED | UNASSESSED |
| PS-DEC-010 | No arbitrary built-in agent-count ceiling. | DECIDED | `docs/PRODUCT_SPEC.md:1450` | UNASSESSED | UNASSESSED |
| PS-DEC-011 | Select models independently per role/task. | DECIDED | `docs/PRODUCT_SPEC.md:1451` | UNASSESSED | UNASSESSED |
| PS-DEC-012 | Discovery/qualification/scheduling/fallback/upgrades are core differentiation. | DECIDED | `docs/PRODUCT_SPEC.md:1452` | UNASSESSED | UNASSESSED |
| PS-DEC-013 | Capacity queues, empirical scoring, blackboard/context, envelopes, reconnect, reporting, analytics, and boundary redaction are required. | DECIDED | `docs/PRODUCT_SPEC.md:1453` | UNASSESSED | UNASSESSED |
| PS-DEC-014 | Steering, GitHub/Linear triggers, approved draft PR, versioned workflows/skills, and evaluation-driven improvement are required. | DECIDED | `docs/PRODUCT_SPEC.md:1454` | UNASSESSED | UNASSESSED |
| PS-DEC-015 | Email/chat defaults to notifications/approval links, not arbitrary message-driven runs. | DECIDED | `docs/PRODUCT_SPEC.md:1455` | UNASSESSED | UNASSESSED |
| PS-DEC-016 | Git isolation, deterministic validation, durable evidence, and human approval boundaries are mandatory. | DECIDED | `docs/PRODUCT_SPEC.md:1456` | UNASSESSED | UNASSESSED |
| PS-RESULT-001 | Include objective and approved scope. | RESULT | `docs/PRODUCT_SPEC.md:1474` | UNASSESSED | UNASSESSED |
| PS-RESULT-002 | Include plan and every material revision. | RESULT | `docs/PRODUCT_SPEC.md:1475` | UNASSESSED | UNASSESSED |
| PS-RESULT-003 | Include completed/blocked/deferred/rejected tasks. | RESULT | `docs/PRODUCT_SPEC.md:1476` | UNASSESSED | UNASSESSED |
| PS-RESULT-004 | Include exact repositories/branches/worktrees/commits. | RESULT | `docs/PRODUCT_SPEC.md:1477` | UNASSESSED | UNASSESSED |
| PS-RESULT-005 | Include every provider/model/reasoning setting/role/handoff. | RESULT | `docs/PRODUCT_SPEC.md:1478` | UNASSESSED | UNASSESSED |
| PS-RESULT-006 | Include tools and permissions exercised. | RESULT | `docs/PRODUCT_SPEC.md:1479` | UNASSESSED | UNASSESSED |
| PS-RESULT-007 | Include validator/review/artifact evidence. | RESULT | `docs/PRODUCT_SPEC.md:1480` | UNASSESSED | UNASSESSED |
| PS-RESULT-008 | Include quota/fallback events. | RESULT | `docs/PRODUCT_SPEC.md:1481` | UNASSESSED | UNASSESSED |
| PS-RESULT-009 | Include unresolved risks and honest readiness. | RESULT | `docs/PRODUCT_SPEC.md:1482` | UNASSESSED | UNASSESSED |
| PS-RESULT-010 | Include concise what/why explanation. | RESULT | `docs/PRODUCT_SPEC.md:1483` | UNASSESSED | UNASSESSED |
| PS-RESULT-011 | Include explicit review/merge/follow-up/release/abandonment choices. | RESULT | `docs/PRODUCT_SPEC.md:1484` | UNASSESSED | UNASSESSED |

## Verification command

Run from the repository root:

```powershell
$expectedHash='F9B1ED2E721E462F53C999C3682BE37141070647A49BCE811BBA0EFFE020D730'
$actualHash=(Get-FileHash -Algorithm SHA256 -LiteralPath 'docs/PRODUCT_SPEC.md').Hash
$spec=Get-Content -LiteralPath 'docs/PRODUCT_SPEC.md' -Encoding utf8
$trace=Get-Content -LiteralPath 'docs/BETA_REQUIREMENTS_TRACE.md' -Encoding utf8
$ids=@(foreach($line in $trace){if($line -match '^\| ((?:PS|FR)-[A-Z0-9-]+) \|'){$Matches[1]}})
$frSourceRaw=@(foreach($line in $spec){$m=[regex]::Match($line,'FR-[0-9]+');if($m.Success){$m.Value}})
$frSource=@($frSourceRaw|Sort-Object -Unique)
$frTrace=@($ids|Where-Object{$_ -match '^FR-[0-9]+$'}|Sort-Object -Unique)
$frDiff=@($frSource+$frTrace|Group-Object|Where-Object Count -eq 1|ForEach-Object Name)
$a=@($ids|Where-Object{$_ -match '^PS-MS-A\d+$'}).Count
$b=@($ids|Where-Object{$_ -match '^PS-MS-B\d+$'}).Count
$c=@($ids|Where-Object{$_ -match '^PS-MS-C\d+$'}).Count
$d=@($ids|Where-Object{$_ -match '^PS-MS-D0[1-7]$'}).Count
"Spec hash: $actualHash"
"Total rows: $($ids.Count)"
"Duplicate IDs: $(@($ids|Group-Object|Where-Object Count -gt 1).Count)"
"FR source/trace: $($frSource.Count)/$($frTrace.Count)"
"FR set differences: $(if($frDiff.Count){$frDiff -join ', '}else{'none'})"
"Milestone priorities A/B/C/D: $a/$b/$c/$d"
if($actualHash -ne $expectedHash -or $ids.Count -ne 482 -or @($ids|Group-Object|Where-Object Count -gt 1).Count -ne 0 -or $frSource.Count -ne 67 -or $frTrace.Count -ne 67 -or $frDiff.Count -ne 0 -or $a -ne 14 -or $b -ne 11 -or $c -ne 13 -or $d -ne 7){exit 1}
```
