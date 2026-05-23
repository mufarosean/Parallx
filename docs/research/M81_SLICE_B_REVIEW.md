---
Status: Fitness review (KEEP verdict)
Reviewer: Verification Agent
Branch: systems-redesign-planning
Reviews: 01e261fe
Created: 2026-05-23
---
# M81 Slice B — Fitness Review

**Commit:** 01e261fe
**Reviewer:** Verification Agent
**Date:** 2026-05-23
**Verdict:** KEEP

## Scope adherence

The diff touches exactly four files: [src/contributions/contributionRegistry.ts](src/contributions/contributionRegistry.ts) (new, 98 lines), [src/contributions/contributionTypes.ts](src/contributions/contributionTypes.ts) (+15 lines additive), [src/workbench/workbench.ts](src/workbench/workbench.ts) (+19/−16), and [tests/unit/contributionRegistry.test.ts](tests/unit/contributionRegistry.test.ts) (new). None of the §4 anti-list files appear: `git show 01e261fe --stat` shows no entries under `src/commands/`, `src/tools/`, `src/api/bridges/`, `src/contributions/commandContribution.ts|keybindingContribution.ts|menuContribution.ts|viewContribution.ts`, `electron/`, `ext/`, or the canvas/chat/explorer preservation paths. The four existing contribution processor files are imported via `type` only (lines 19–22 of [src/contributions/contributionRegistry.ts](src/contributions/contributionRegistry.ts)) — zero source modification to them. Slice B contract honored.

## Behavior parity

Four call sites in [src/workbench/workbench.ts](src/workbench/workbench.ts) were replaced (executor's "four" matches the diff; the §4 brief's "three" undercounted the loop on line ~2306):

1. **Initial replay loop (lines 2316–2318)** — Before: four sequential `processContributions(entry.description)` calls in command → keybinding → menu → view order inside `for (const entry of registry.getAll())`. After: single `this._contributionRegistry.processContributions(entry.description)`. Registry fans out in the identical order (lines 33–53 of [src/contributions/contributionRegistry.ts](src/contributions/contributionRegistry.ts)). No surrounding state touched.
2. **`onDidRegister` callback (line 2329)** — Before: same four calls inside `this._register(registry.onDidRegister(({ description: desc }) => { … })`, gated by the `isBuiltin && !isEnabled` early-return. After: same gate, single registry call. The gate is preserved (line 2326), so the disabled-external-tool skip is unchanged.
3. **`onDidDeactivate` callback (line 2479)** — Before: four `removeContributions(event.toolId)` calls. After: single `this._contributionRegistry.removeContributions(event.toolId)`. Registry's `removeContributions` (lines 60–80 of [src/contributions/contributionRegistry.ts](src/contributions/contributionRegistry.ts)) fans out in the same command → keybinding → menu → view order.
4. **Enable transition (line 2491)** — Before: four `processContributions(entry.description)` calls inside the `if (newState === 'EnabledGlobally')` branch. After: single registry call. The surrounding `console.log` (line 2490), `activationEvents.registerToolEvents` (line 2494, unchanged), and other branch logic are untouched.

No intermediate variables, awaits, or logging existed at any of the four sites; the old code was strictly the four sequential synchronous calls. Parity is byte-equivalent in observable order and arguments.

## Error isolation correctness

Per-processor try/catch, not a single outer try. Lines 37–40, 42–45, 47–50, 52–55 of [src/contributions/contributionRegistry.ts](src/contributions/contributionRegistry.ts) wrap each of the four `processContributions` calls individually; lines 64–67, 69–72, 74–77, 79–82 do the same for `removeContributions`. Each catch logs via `console.error('[ContributionRegistry] … failed for tool', toolId, err)` — matches the established contribution-code logging style (string prefix + structured tail) and does not rethrow, so workbench.ts sees a clean return. Contract satisfied: a thrown error in any one processor cannot prevent the subsequent three from running.

## Disposal semantics

The `isDisposed` early-return is enforced in **both** methods: line 36 (`processContributions`) and line 63 (`removeContributions`) of [src/contributions/contributionRegistry.ts](src/contributions/contributionRegistry.ts). The flag comes from the `Disposable` base (defined at [src/platform/lifecycle.ts](src/platform/lifecycle.ts#L151)) so the parent class manages it. The registry is correctly attached to workbench lifecycle via `this._register(new ContributionRegistry(…))` at [src/workbench/workbench.ts](src/workbench/workbench.ts#L2306), so workbench dispose tears it down once. The test at lines 144–158 of [tests/unit/contributionRegistry.test.ts](tests/unit/contributionRegistry.test.ts) exercises this: it calls `registry.dispose()`, then invokes both `processContributions` and `removeContributions`, then asserts all four processors' `processCalls` and `removeCalls` arrays remain empty — actual proof, not a tautology.

## Test rigor

Five cases in [tests/unit/contributionRegistry.test.ts](tests/unit/contributionRegistry.test.ts). All five passed locally (`npx vitest run tests/unit/contributionRegistry.test.ts` → 5 passed).

1. **`processContributions … in order` (lines 88–99)** — Asserts both that each processor received the exact `desc` object and that the cross-processor `order` array equals `['process:cmd', 'process:kb', 'process:menu', 'process:view']`. The order check is meaningful — it would fail if the registry reordered or skipped any processor.
2. **`removeContributions … in order` (lines 101–111)** — Symmetric to (1) for the remove path. Same rigor.
3. **`isolates errors: throwing processContributions` (lines 113–127)** — `kb.throwOnProcess = true`. Asserts `menu.processCalls` and `view.processCalls` both contain `desc`. The `menu`/`view` assertion is the *actual* proof of isolation (they run *after* kb's throw). The `cmd` assertion is decorative (runs before kb), as is `kb.processCalls === []`. The `errSpy` assertion confirms `console.error` was invoked. Meaningful.
4. **`isolates errors: throwing removeContributions` (lines 129–142)** — `menu.throwOnRemove = true`. The meaningful assertion is `view.removeCalls === ['delta']` (runs after menu throws); `cmd`/`kb` ran before. Meaningful.
5. **`dispose() prevents further fan-out` (lines 144–158)** — Calls `dispose()` then both methods; asserts all eight call-tracking arrays remain empty. Direct test of the `isDisposed` early-return in both methods.

No meaningless assertions. The fake processor implementation (lines 18–37) records both push order and per-processor calls, enabling both kinds of check.

## Forward risks (Slice C / Slice D)

- **None aggravated.** The commit does not register new context keys, does not touch selection wiring, does not introduce a new `selectionExists` consumer, and does not bypass `WorkbenchContextManager`. The Slice A sticky-`selectionExists` risk is orthogonal to this change.
- **Minor seam for Slice C.** The registry currently owns the iteration order in its method body; if Slice C wants pluggable processors or per-processor middleware, that order will need to move into a data structure (array of processors). This is a small, contained refactor and not a regression — flagging only because the audit listed "future extensibility" as a goal. Not a fix needed for Slice B.
- **Type interface is minimal.** `IContributionRegistry` in [src/contributions/contributionTypes.ts](src/contributions/contributionTypes.ts#L109-L114) exposes only `processContributions` / `removeContributions` / `dispose` (via `IDisposable`). No private fields leaked. If Slice C needs introspection (e.g., "which processors are registered?") it will need an additive extension — non-blocking.
- **Commit subject is 74 chars** (exceeds the conventional ≤72 by 2). Body content is otherwise correct: it cites the audit (commit `977e660`), the milestone (`§4`), explains *why* the typed-contracts/when-grammar/context-keys work is absent, and ends with the literal `Rollback: git revert HEAD.` line. Not a blocker; flagging for future commits.

## Verdict justification

KEEP. The diff is exactly the minimum surface that the rescoped Slice B contract demands: a thin composition layer with per-processor error isolation and a disposal flag. Behavior parity at all four replaced sites is verified by reading the diff in context. Error isolation is implemented with per-call try/catch (not one outer try) and exercised by tests that assert *later* processors still ran after an earlier one threw. Disposal is enforced in both methods and exercised by an end-to-end test. The anti-list is respected — no core registries, bridges, or contribution-processor source files were modified. Type changes are additive-only. `npx tsc --noEmit` exits 0; the new test file passes 5/5. The only nit is a 2-character commit-subject overrun, which is not worth a fix-up commit.
