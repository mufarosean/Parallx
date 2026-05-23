# Systems Thinking for Parallx

> Research date: May 23, 2026
> Status: Actionable redesign brief
> Scope: Apply systems thinking to Parallx's app shell, canvas, persistence, IPC, lifecycle, extensions, background work, and reliability checks.

---

## 1. Scope

Systems thinking means improving the structures that repeatedly produce behavior. For Parallx, this document is not a philosophy note; it is a work queue for making the app more reliable without losing current functionality.

Out of scope: AI chat, OpenClaw, Claude-backed behavior, prompts, planning, retrieval, and agent runtime redesign. Those areas already have their own architecture lineage. This document focuses on the surrounding Parallx application system.

In scope:

- Workbench startup, readiness, shutdown, and restore.
- Canvas structural consistency and interaction safety.
- Workspace state, SQLite, settings, migrations, and recovery.
- Renderer-main IPC contracts and performance.
- Extension activation, capabilities, isolation, and failure handling.
- Background work scheduling and backpressure.
- System-level observability and fitness tests.

Companion operating model: [SYSTEMS_REDESIGN_AGENTS_AND_SKILLS.md](./SYSTEMS_REDESIGN_AGENTS_AND_SKILLS.md) defines the custom agents, prompts, skills, handoffs, and proof gates for doing this work surgically.

---

## 2. Decision Rule

When Parallx has a recurring reliability problem, do not start with "where can we add a guard?" Start with these questions:

1. What flow produced the problem?
2. Which state changed, and who owns that state?
3. Which boundary allowed the problem to cross into another subsystem?
4. Was there a feedback signal that should have caught it earlier?
5. Can we add a gate, state machine, invariant, queue, contract, or metric that prevents the whole class of problem?

This is the practical systems-thinking rule for Parallx.

### 2.1 Proof Standard: Better Must Be Demonstrated

The goal is not to redesign Parallx because a new structure looks cleaner. The goal is to prove that the new structure is better.

Before any redesign work starts, define:

1. Baseline: how the current system behaves today.
2. Hypothesis: what the redesign should improve.
3. Measurement: how we will know it improved.
4. Preservation: what existing behavior must stay unchanged.
5. Stop rule: what result means we keep, revise, or roll back the redesign.

Use this scorecard for every major redesign:

| Better means | Example metric | Required proof |
|---|---|---|
| Easier to debug | Fewer files touched to trace a failure; clearer error owner; richer diagnostic event | A failure scenario points to one owner and one log/metric path. |
| Faster startup | Time to interactive, slowest startup task, IPC count during restore | Before/after startup measurements on the same workspace. |
| Better runtime performance | Renderer long tasks, DB query count, IPC p95 duration, blocked input time | Before/after measurements under the same workload. |
| Fewer bugs | Regression count, failing test category, duplicate bug class removed | A new invariant or contract test catches the old bug class. |
| Better recovery | Interrupted save/switch/activation recovery success | Simulated interruption test proves consistent recovery. |
| Safer extension behavior | Activation timeout, failure isolation, capability violations | Broken/slow extension test proves workbench continues. |
| Lower change risk | Smaller call surface, fewer illegal imports, clearer ownership | Dependency or gate test enforces the new boundary. |

No redesign should be considered complete until it has a before/after result or a clear reason why the measurement is not yet available. If a redesign preserves behavior but does not improve the agreed scorecard, it is not automatically a win.

---

## 3. First 10 Work Items

These are ordered to create feedback before major refactors. Each item should land as a small PR.

| # | Work item | Code/docs anchor | Output | Acceptance criteria |
|---|---|---|---|---|
| 1 | Define baseline scorecard | This document + System Atlas | Before/after metrics template | Every redesign track lists baseline, hypothesis, measurement, preservation rules, and stop rule. |
| 2 | Create the System Atlas skeleton | `docs/architecture/SYSTEM_ATLAS.md` | New canonical architecture map | Contains startup, workspace switch, persistence, IPC, extension, canvas, and background-work sections with owners and code links. |
| 3 | Add startup task inventory | [src/workbench/workbench.ts](../../src/workbench/workbench.ts) | Table of Phase 1-5 tasks, required vs deferrable | Each startup task has owner, dependency, failure mode, "blocks interactive?" flag, and baseline duration if measurable. |
| 4 | Define readiness states | [src/workbench/lifecycle.ts](../../src/workbench/lifecycle.ts), [src/services/serviceTypes.ts](../../src/services/serviceTypes.ts) | `interactive`, `background-ready`, `fully-settled` readiness contract | Callers can wait for explicit readiness instead of inferring from Phase 5. Unit test covers ordering. |
| 5 | Instrument startup timings | [src/workbench/workbench.ts](../../src/workbench/workbench.ts), [src/services/observabilityService.ts](../../src/services/observabilityService.ts) | Startup timing events | Startup report shows duration for services, layout, parts, restore, DB open, tool activation, editor restore. |
| 6 | Create persistence ownership table | New section in System Atlas | Canonical/derived state map | Every durable domain has one canonical store, derived stores, rebuild rules, and recovery notes. |
| 7 | Create IPC contract table | [electron/preload.cjs](../../electron/preload.cjs), [electron/main.cjs](../../electron/main.cjs) | Channel inventory | Every exposed IPC channel has owner, params, return shape, timeout expectation, workspace requirement, and error shape. |
| 8 | Add extension activation timeout policy | [src/tools/toolActivator.ts](../../src/tools/toolActivator.ts) | Activation budget and failure state | A slow extension cannot block startup indefinitely; test covers timeout and workbench continuation. |
| 9 | Add canvas mixed-operation fitness tests | [tests/unit](../../tests/unit), [docs/canvas/CANVAS_STRUCTURAL_MODEL.md](../canvas/CANVAS_STRUCTURAL_MODEL.md) | Regression tests | Repeated drag, resize, duplicate, delete, save, reopen keeps structural invariants valid. |
| 10 | Add `test:system-fitness` script | [package.json](../../package.json) | Named CI/local command | Runs dependency, lifecycle, persistence, extension, canvas, and performance-smoke checks. |

---

## 4. Workstream A: System Atlas

Goal: make the real Parallx system visible before changing it.

Create `docs/architecture/SYSTEM_ATLAS.md` with these sections:

| Section | What to document | Source anchors |
|---|---|---|
| System boundary | What is inside/outside Parallx app reliability work | `ARCHITECTURE.md`, this document |
| Startup flow | Phase 1-5 tasks, blockers, deferrable tasks | `src/workbench/workbench.ts` around `_registerLifecycleHooks`, `_initializeServices`, `_restoreWorkspace`, `_initializeToolLifecycle` |
| Workspace switch flow | prepare, save, reload, restore, stale guards | `src/workspace/*`, `src/workbench/workbench.ts` workspace switch methods |
| Persistence map | canonical stores, caches, migrations, recovery | `src/workspace/*`, `src/services/databaseService.ts`, `electron/database.cjs`, `electron/storageHandlers.cjs` |
| IPC map | channels, owners, error formats, timeouts | `electron/preload.cjs`, `electron/main.cjs`, `electron/database.cjs`, `electron/storageHandlers.cjs` |
| Extension lifecycle | scan, validate, register, activate, deactivate, fail | `src/tools/*`, `src/contributions/*`, `src/api/apiFactory.ts` |
| Canvas interaction system | gates, invariants, structural model | `ARCHITECTURE.md`, `docs/canvas/*`, `src/built-in/canvas/*` |
| Background work | scans, extraction, cache refresh, maintenance | services and extensions that run delayed/idle work |

Definition of done:

- A new engineer can follow each major flow without reading the whole repo.
- Every section has "known risks" and "tests that protect this."
- Every future architecture change can link to one atlas section.

---

## 5. Workstream B: Startup and Lifecycle

Problem: startup currently combines required shell work, workspace restore, DB open, built-in activation, extension scan, editor restore, and background work. Many steps are individually reasonable but can combine into a slow or fragile startup.

Code anchors:

- [src/workbench/workbench.ts](../../src/workbench/workbench.ts): lifecycle hooks, `_initializeServices`, `_restoreWorkspace`, `_initializeToolLifecycle`, `_restoreEditors`, `_openDatabaseForWorkspace`, `_registerAndActivateBuiltinTools`, `_discoverAndRegisterExternalTools`.
- [src/workbench/lifecycle.ts](../../src/workbench/lifecycle.ts): lifecycle phase service.
- [src/workbench/workbenchServices.ts](../../src/workbench/workbenchServices.ts): service registration.

Tasks:

1. Add readiness states: `shell-created`, `workspace-known`, `layout-restored`, `interactive`, `background-ready`, `fully-settled`.
2. Mark every startup task as one of: `blocks-shell`, `blocks-workspace`, `blocks-interactive`, `deferrable`, `background`.
3. Restore the visible editor group first; hydrate non-visible tabs after `interactive`.
4. Move extension-heavy and maintenance-heavy work after `interactive` unless a contribution is needed to restore a visible editor.
5. Emit startup timing events for each task.
6. Add a failed-task policy: startup continues unless the task is explicitly marked `fatal`.

Acceptance criteria:

- The app reaches `interactive` even when a non-critical extension fails.
- Startup timing output shows the slowest tasks.
- Tests prove readiness ordering.
- Existing workspace restore, layout restore, settings, commands, canvas, and extension behavior remain intact.

Suggested tests:

- `tests/unit/workbenchLifecycleReadiness.test.ts`
- `tests/unit/workbenchStartupTaskPolicy.test.ts`
- E2E smoke: startup with one intentionally failing extension still opens the workbench.

---

## 6. Workstream C: Persistence Ownership and Recovery

Problem: Parallx has several durable stores. That is fine, but each durable domain needs one canonical owner and explicit derived/cache behavior.

Code anchors:

- [src/workspace](../../src/workspace)
- [src/services/databaseService.ts](../../src/services/databaseService.ts)
- [electron/database.cjs](../../electron/database.cjs)
- [electron/storageHandlers.cjs](../../electron/storageHandlers.cjs)
- [src/services/settingsRegistryService.ts](../../src/services/settingsRegistryService.ts)
- [src/built-in/canvas/migrations](../../src/built-in/canvas/migrations)

Create this table in the System Atlas:

| Domain | Canonical store | Derived/cache stores | Owner | Recovery rule |
|---|---|---|---|---|
| Workspace identity | TBD | TBD | TBD | TBD |
| Layout state | TBD | TBD | TBD | TBD |
| Canvas pages/block graph | TBD | TBD | TBD | TBD |
| Settings | TBD | TBD | TBD | TBD |
| Extension state | TBD | TBD | TBD | TBD |
| File watcher state | TBD | TBD | TBD | TBD |
| Diagnostics/logs | TBD | TBD | TBD | TBD |

Tasks:

1. Fill the ownership table from current code.
2. Add a rule: no subsystem writes durable state unless it owns that domain or goes through the owner.
3. Add migration invariant checks after every migration directory run.
4. Add workspace switch fences so old-workspace writes cannot land after switch.
5. Define backup/recovery rules for `.parallx` files and workspace DB.

Acceptance criteria:

- Every durable domain has exactly one canonical owner.
- Derived state can be rebuilt or explicitly marked non-rebuildable.
- Interrupted workspace switch restores old or new workspace, never a hybrid.
- Migration tests verify schema invariants, not just "migration did not throw."

Suggested tests:

- `tests/unit/persistenceOwnership.test.ts`
- `tests/unit/workspaceSwitchRecovery.test.ts`
- `tests/unit/databaseMigrationInvariants.test.ts`

---

## 7. Workstream D: IPC Contract and Pressure

Problem: renderer-main IPC is a hidden system. Many small calls can combine into startup latency, UI contention, or unclear failure behavior.

Code anchors:

- [electron/preload.cjs](../../electron/preload.cjs)
- [electron/main.cjs](../../electron/main.cjs)
- [electron/database.cjs](../../electron/database.cjs)
- [electron/storageHandlers.cjs](../../electron/storageHandlers.cjs)
- [src/services/fileService.ts](../../src/services/fileService.ts)
- [src/services/databaseService.ts](../../src/services/databaseService.ts)

Tasks:

1. Build an IPC channel inventory from `preload.cjs` and `ipcMain.handle/on` registrations.
2. Define a shared result/error shape for new IPC calls.
3. Add measured invocation wrappers in renderer services, not at every call site.
4. Add timeouts for calls that can block startup or workspace switch.
5. Batch high-volume startup reads where the same service issues multiple storage or file calls.
6. Track IPC count and p95 duration during startup and workspace switch.

Acceptance criteria:

- The System Atlas lists every public IPC channel.
- Startup metrics include IPC count and slowest channels.
- IPC errors are normalized before reaching feature code.
- No feature code imports Electron APIs directly.

Suggested tests:

- `tests/unit/ipcContractInventory.test.ts`
- `tests/unit/databaseServiceErrorShape.test.ts`
- `tests/unit/fileServiceErrorShape.test.ts`

---

## 8. Workstream E: Extension Isolation

Problem: extensions are powerful enough to affect startup, UI, storage, database, shell, and external integrations. They need explicit capability and activation boundaries.

Code anchors:

- [src/tools/toolManifest.ts](../../src/tools/toolManifest.ts)
- [src/tools/toolValidator.ts](../../src/tools/toolValidator.ts)
- [src/tools/toolActivator.ts](../../src/tools/toolActivator.ts)
- [src/tools/toolErrorIsolation.ts](../../src/tools/toolErrorIsolation.ts)
- [src/tools/parallx-manifest.schema.json](../../src/tools/parallx-manifest.schema.json)
- [src/api/bridges](../../src/api/bridges)

Tasks:

1. Audit existing manifest `capabilities` support and document current behavior.
2. Add an activation timeout and record timeout as an extension failure state.
3. Add per-extension activation duration telemetry.
4. Gate privileged bridge access by declared capabilities, starting in warn-only mode.
5. Add a compatibility window before hard enforcement.
6. Add docs for extension authors explaining required capabilities.

Acceptance criteria:

- One broken or slow extension cannot block workbench startup.
- Extension failures are visible and isolated.
- Privileged APIs have capability checks.
- Existing extensions continue working during warn-only rollout.

Suggested tests:

- `tests/unit/toolActivationTimeout.test.ts`
- `tests/unit/toolCapabilityGate.test.ts`
- `tests/unit/toolFailureIsolation.test.ts`

---

## 9. Workstream F: Canvas Structural Reliability

Problem: Canvas is already the best example of systems thinking in Parallx. Future changes should protect the "Everything is a Page" model and registry gates instead of adding local exceptions.

Code/docs anchors:

- [ARCHITECTURE.md](../../ARCHITECTURE.md)
- [docs/canvas/CANVAS_STRUCTURAL_MODEL.md](../canvas/CANVAS_STRUCTURAL_MODEL.md)
- [src/built-in/canvas](../../src/built-in/canvas)
- [tests/unit/canvasStructuralInvariants.test.ts](../../tests/unit/canvasStructuralInvariants.test.ts)
- [tests/unit/gateCompliance.test.ts](../../tests/unit/gateCompliance.test.ts)

Tasks:

1. Add a canvas interaction fitness checklist to the System Atlas.
2. For every new block/container behavior, require tests for top-level page, column, callout/toggle/quote where applicable.
3. Add mixed-operation tests: drag, resize, duplicate, delete, undo, save, reopen.
4. Keep registry-gate import rules enforced.
5. Add tests before relaxing any structural constraint.

Acceptance criteria:

- A block behaves consistently across valid page variants.
- Gate compliance tests remain mandatory.
- Save/reopen preserves structure after repeated mixed operations.

Suggested tests:

- `tests/unit/canvasMixedOperationFitness.test.ts`
- `tests/e2e/canvas-structural-fitness.spec.ts`

---

## 10. Workstream G: Background Work and Backpressure

Problem: scans, extraction, cache refresh, media maintenance, and other delayed jobs can compete with foreground interaction.

Code anchors:

- Existing services that start scans or maintenance jobs.
- Extensions with startup/idle work, especially large extensions in [ext](../../ext).
- Workbench startup code that triggers background or deferred work.

Tasks:

1. Inventory all delayed, idle, startup, scan, and maintenance jobs.
2. Add a `BackgroundWorkGate` design: job id, workspace id, priority, cancellation, timeout, retry policy.
3. Pause or slow background work when user interaction, renderer long tasks, or IPC pressure is high.
4. Coalesce repeated jobs for the same resource.
5. Ensure workspace switch cancels old-workspace jobs.

Acceptance criteria:

- Background work cannot write into the wrong workspace after switch.
- Foreground typing/opening remains responsive during large scans.
- Queue metrics show active, queued, cancelled, failed, and completed jobs.

Suggested tests:

- `tests/unit/backgroundWorkWorkspaceFence.test.ts`
- `tests/unit/backgroundWorkCoalescing.test.ts`
- E2E smoke: large background scan does not block opening a page.

---

## 11. Workstream H: System Fitness Suite

Goal: turn reliability into a repeatable feedback loop.

Add a script:

```json
"test:system-fitness": "npx vitest run tests/unit/gateCompliance.test.ts tests/unit/canvasStructuralInvariants.test.ts tests/unit/workspaceSwitchFreeze.test.ts tests/unit/sessionGuards.test.ts"
```

Then expand it as new tests land.

Fitness categories:

| Category | Required checks |
|---|---|
| Dependency | No illegal imports, no cycles, registry gates hold. |
| Lifecycle | Startup states, teardown, workspace switch, cancellation. |
| Persistence | Migrations, recovery, ownership, workspace fences. |
| IPC | Contract inventory, error normalization, call count metrics. |
| Extension | Activation isolation, capabilities, API compatibility. |
| Canvas | Structural invariants, save/reopen, mixed operations. |
| UX/performance | Long task budget, startup timing, no blocked typing under background load. |

Acceptance criteria:

- `npm run test:system-fitness` exists.
- It starts with existing tests, then grows with each workstream.
- It is the required check before landing architecture changes.
- Every architecture PR includes the baseline/hypothesis/result note for the metric it claims to improve.

---

## 12. Redesign Review Template

Use this template in the System Atlas, PR descriptions, or milestone docs:

```md
## Redesign Claim

Flow:
Current pain:
Hypothesis:

Baseline:
- Startup / runtime / recovery / debug metric:
- Current test coverage:
- Current failure example:

Preservation requirements:
- Behavior that must not change:
- Compatibility adapter needed:
- Migration needed:

Implementation:
- Gate/contract/state machine/queue/invariant being added:
- Feature flag:
- Rollback path:

Result:
- Before:
- After:
- Tests added:
- Decision: keep / revise / roll back
```

---

## 13. Preservation Rules

Do not break:

- Existing workspaces.
- Canvas page content.
- Extension manifests and common APIs.
- Settings.
- Keyboard commands.
- Layout restoration.
- File and folder behavior.

Migration rule:

1. Characterize current behavior with tests.
2. Add the new gate/contract behind current APIs.
3. Route one caller or flow at a time.
4. Keep compatibility adapters until parity is proven.
5. Delete legacy paths only after tests and real sample workspaces pass.

---

## 14. Source Notes

- Donella Meadows Project, ["Leverage Points: Places to Intervene in a System"](https://donellameadows.org/archives/leverage-points-places-to-intervene-in-a-system/). Used for leverage points, information flows, rules, goals, stocks, flows, and intervention hierarchy.
- SEBoK, ["Systems Thinking"](https://sebokwiki.org/wiki/Systems_Thinking), ["Principles of Systems Thinking"](https://sebokwiki.org/wiki/Principles_of_Systems_Thinking), and ["Overview of the Systems Approach"](https://sebokwiki.org/wiki/Overview_of_the_Systems_Approach). Used for boundaries, encapsulation, modularity, abstraction, lifecycle, and representation-based reasoning.
- MIT Sloan Executive Education, ["What is Systems Thinking in Business?"](https://executive.mit.edu/blog/what-is-systems-thinking-in-business.html) and ["What is Business Dynamics?"](https://executive.mit.edu/blog/what-is-business-dynamics-a-system-thinking-guide.html). Used for interconnectedness, feedback loops, patterns over events, delays, leverage points, stocks/flows, and cross-functional mapping.
- Google SRE, ["Embracing Risk"](https://sre.google/sre-book/embracing-risk/). Used for SLO/error-budget framing and reliability as a shared control loop.
- AWS Well-Architected Framework, ["Reliability Design Principles"](https://docs.aws.amazon.com/wellarchitected/2023-10-03/framework/rel-dp.html). Used for recovery testing, meaningful KPIs, automated recovery, and capacity awareness.
- NIST SP 800-160 Vol. 1 Rev. 1, ["Engineering Trustworthy Secure Systems"](https://csrc.nist.gov/pubs/sp/800/160/v1/r1/final). Used for trustworthiness, resilience, lifecycle, risk, verification, and validation framing.
- Carnegie Mellon Software Engineering Institute, ["Quality Attributes"](https://www.sei.cmu.edu/library/quality-attributes/) and ["Reasoning About Software Quality Attributes"](https://www.sei.cmu.edu/library/reasoning-about-software-quality-attributes/). Used for quality attribute scenarios and architecture tradeoff reasoning.
- Thoughtworks, ["Fitness function-driven development"](https://www.thoughtworks.com/insights/articles/fitness-function-driven-development). Used for continuous architectural feedback and fitness functions.
