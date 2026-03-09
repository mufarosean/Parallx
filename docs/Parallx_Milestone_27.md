# Milestone 27 — Canvas Hardening, Structural Simplification, and Behavior Preservation

> **Authoritative Scope Notice**
>
> This document is the single source of truth for Milestone 27.
> All canvas hardening, structural simplification, gate-alignment cleanup,
> and database-surface UX cleanup for this milestone must conform to the
> evidence, boundaries, and preservation rules defined here.
>
> This milestone is based on a **code-first assessment of the live canvas
> implementation**, not on assumptions, stale notes, or broad suspicion.
> The findings below are grounded in the current code and current tests in:
>
> - `src/built-in/canvas/main.ts`
> - `src/built-in/canvas/canvasEditorProvider.ts`
> - `src/built-in/canvas/config/blockRegistry.ts`
> - `src/built-in/canvas/config/blockStateRegistry/blockStateRegistry.ts`
> - `src/built-in/canvas/config/blockStateRegistry/crossPageMovement.ts`
> - `src/built-in/canvas/plugins/columnDropPlugin.ts`
> - `src/built-in/canvas/extensions/pageBlockNode.ts`
> - `src/built-in/canvas/menus/canvasMenuRegistry.ts`
> - `src/built-in/canvas/menus/blockActionMenu.ts`
> - `src/built-in/canvas/database/properties/propertyConfig.ts`
> - `src/built-in/canvas/database/views/viewTabBar.ts`
> - `tests/unit/gateCompliance.test.ts`

---

## Table of Contents

1. [Problem Statement](#problem-statement)
2. [Code-First Current State Audit](#code-first-current-state-audit)
3. [Confirmed Issues](#confirmed-issues)
4. [Already-Fixed Areas To Preserve](#already-fixed-areas-to-preserve)
5. [Vision](#vision)
6. [Scope](#scope)
7. [Non-Goals](#non-goals)
8. [Guiding Principles](#guiding-principles)
9. [Target Architecture](#target-architecture)
10. [Phase Plan](#phase-plan)
11. [Implementation Sequence](#implementation-sequence)
12. [Verification Strategy](#verification-strategy)
13. [Task Tracker](#task-tracker)
14. [Risk Register](#risk-register)

---

## Problem Statement

The canvas tool is one of Parallx's primary built-ins. It already works, and
it already embodies weeks of interaction hardening. Milestone 27 does **not**
exist to redesign that behavior.

Milestone 27 exists because the live implementation still contains a small set
of **confirmed structural problems** that make future canvas work harder than
it needs to be:

1. **One drag/drop behavior is still split across multiple independent routing surfaces**
   - cross-page drop routing for `pageBlock` is currently coordinated by both
     `pageBlockNode.ts` and `columnDropPlugin.ts`.

2. **Two database-surface flows still escape the canvas UI system and fall back to blocking browser prompts**
   - option creation in database property config,
   - and database view rename in the tab bar.

3. **The canonical architecture description is no longer fully aligned with the enforced architecture**
   - repo instructions still describe a five-gate canvas architecture,
   - while the compliance test enforces six gate files including the database gate.

These are not speculative concerns. They are directly visible in the current
codebase.

The milestone goal is therefore precise:

> Simplify and harden the canvas implementation **without changing what the
> user sees or does**, except where the current code still uses browser-native
> prompt fallbacks instead of proper Parallx canvas UI.

---

## Code-First Current State Audit

### 1. Core canvas architecture is materially strong

The live code already has clear structure:

- `main.ts` activates the canvas tool and wires services, editors, sidebar,
  restore behavior, and migrations.
- `canvasEditorProvider.ts` is the editor orchestrator.
- `blockRegistry.ts` is the single source of truth for block definitions and
  block-facing editor extension wiring.
- `canvasMenuRegistry.ts` is the menu gate.
- `handleRegistry.ts` is the handle/selection gate.
- `blockStateRegistry.ts` is the mutation and movement gate.
- `gateCompliance.test.ts` enforces these boundaries automatically.

This means Milestone 27 is not a rescue mission. It is a refinement milestone
on top of a working architecture.

### 2. The Notion-parity interaction work is already real and should be preserved

The current implementation already contains behavior that should be treated as
frozen product value, not something to casually rework:

- menu mutual exclusion through `CanvasMenuRegistry`,
- stale action-position revalidation in `BlockActionMenuController`,
- stale hover invalidation in `BlockHandlesController`,
- column-aware deletion and normalization,
- multi-block selection and multi-block drag support,
- cross-page move handling delegated into `crossPageMovement.ts`,
- gate-routed registry design instead of cross-reach imports.

Milestone 27 must preserve those gains.

### 3. The remaining issues are now concentrated, not broad

The current problems are not "canvas is unstable". The current problems are:

- a split drag/drop routing contract,
- two legacy browser prompt escapes,
- and architecture-document drift.

That is a good place to be, because it allows targeted hardening.

---

## Confirmed Issues

### Confirmed Issue 1 — Cross-page pageBlock drop routing is split across two independent routing systems

#### Evidence

The current implementation encodes one gesture across two different modules:

1. `src/built-in/canvas/extensions/pageBlockNode.ts`
   - owns its own `dragover` and `drop` listeners,
   - computes interior-versus-edge routing using its own geometry model,
   - toggles the `canvas-page-block--drop-target` class,
   - calls `stopPropagation()` to prevent the general drop engine from running
     for interior drops.

2. `src/built-in/canvas/plugins/columnDropPlugin.ts`
   - owns the general block drop engine,
   - computes drop zones using a separate `getZone()` geometry model,
   - contains explicit comments that pageBlock interior drops are expected to
     be intercepted elsewhere,
   - includes a stale-indicator timer specifically because pageBlock routing can
     suppress this plugin's `dragover` events.

This is a confirmed architectural split, not an interpretation.

#### Why This Is Bad

This is bad for three concrete reasons:

1. **There is no single source of truth for pageBlock drop routing**
   - one gesture is defined by two files and two event systems.

2. **The interaction contract depends on propagation side effects**
   - `pageBlockNode` and `columnDropPlugin` are coupled by `stopPropagation()`
     behavior rather than by an explicit shared routing primitive.

3. **The geometry rules can drift independently**
   - `pageBlockNode` uses `H_EDGE` and `V_EDGE`,
   - `columnDropPlugin` uses `EDGE` and `LEFT_MARGIN`.
   Even if current behavior feels correct, the implementation is fragile because
   future edits can change one side and silently desynchronize the other.

#### Required Remedy

Milestone 27 must replace this split contract with a single shared routing
authority while preserving existing user behavior.

The acceptable remediation path is:

1. Extract shared pageBlock drop-zone classification into a block-state-owned
   primitive.
2. Make `pageBlockNode.ts` a thin shell that asks the shared primitive whether
   the gesture is an interior cross-page drop or an edge-zone block drop.
3. Make `columnDropPlugin.ts` consume the same routing primitive instead of
   maintaining its own separate pageBlock assumptions.
4. Preserve all current UX outcomes:
   - interior drop moves/copies into the linked page,
   - edge drop continues to support above/below and left/right behavior,
   - drag indicators remain visually identical.

This is a structural simplification, not a product redesign.

---

### Confirmed Issue 2 — The canvas database surface still contains blocking browser `prompt()` fallbacks

#### Evidence

Two live database UI paths still call the browser prompt directly:

1. `src/built-in/canvas/database/properties/propertyConfig.ts`
   - `_addNewOption()` calls `prompt('Option name:')`

2. `src/built-in/canvas/database/views/viewTabBar.ts`
   - `_renameView()` calls `prompt('Rename view:', view.name)`

These are confirmed current-code escapes.

#### Why This Is Bad

This is bad for four concrete reasons:

1. **It bypasses the canvas UI model**
   - the rest of the canvas uses controlled DOM surfaces, menus, overlays, and
     Parallx styling.

2. **It violates the repo's UI rules**
   - the instructions explicitly require reusable UI primitives and disallow raw
     ad hoc widget creation for standard interactions.

3. **It creates a blocking, browser-native UX inside a workbench product**
   - browser prompts are visually inconsistent, unthemed, and non-integrated.

4. **It is harder to automate and harder to evolve**
   - prompt-based flows do not compose naturally with the existing menu,
     overlay, and keyboard interaction model.

#### Required Remedy

Milestone 27 must replace both prompt flows with a shared Parallx UI surface.

The acceptable remediation path is:

1. Introduce one small reusable input overlay or lightweight rename/create
   dialog primitive.
2. Use that shared primitive for:
   - database select-option creation,
   - database view rename.
3. Preserve the current user flow semantics:
   - invoke action,
   - enter one string,
   - confirm,
   - persist,
   - no behavior change to data semantics.
4. Keep the implementation inside the existing database gate structure.

This is a real user-facing cleanup, but it is still behavior-preserving at the
product level because it replaces browser fallback UI with the equivalent
Parallx-native interaction.

---

### Confirmed Issue 3 — Canvas architecture documentation no longer matches the enforced architecture exactly

#### Evidence

The current instruction and architecture language still refers to the canvas as
having a five-registry gate architecture.

However, `tests/unit/gateCompliance.test.ts` currently enforces six gate files:

- `config/iconRegistry.ts`
- `config/blockRegistry.ts`
- `menus/canvasMenuRegistry.ts`
- `config/blockStateRegistry/blockStateRegistry.ts`
- `handles/handleRegistry.ts`
- `database/databaseRegistry.ts`

That means the live enforcement model is broader than the wording in the
instructions.

#### Why This Is Bad

This is bad because architecture docs are operational tools in this repo.
When they drift from the enforced test model:

1. future work can follow the docs and still be wrong,
2. code review gets noisier because the rule set is less clear,
3. architecture cleanup discussions waste time on terminology drift instead of
   code.

#### Required Remedy

Milestone 27 must update the canonical canvas architecture wording so the docs
match the live compliance model.

The acceptable remediation path is:

1. Update the canvas architecture wording in the relevant repo docs and
   instructions.
2. Make the distinction explicit:
   - legacy canvas core uses the original five gate families,
   - current enforced canvas architecture includes the database gate.
3. Do not change runtime code for this item unless a code/doc mismatch is also
   causing a real structural violation.

This is a documentation correctness issue, not a behavior change.

---

## Already-Fixed Areas To Preserve

Milestone 27 must not reopen problems that are already fixed in the live code.

### Preserve 1 — Stale block action menu positions are already guarded

`src/built-in/canvas/menus/blockActionMenu.ts` already revalidates the stored
action block on transaction and again at action time. That older bug is not a
current milestone target.

### Preserve 2 — Stale block handle hover state is already invalidated

`src/built-in/canvas/canvasEditorProvider.ts` and
`src/built-in/canvas/handles/blockHandles.ts` already notify handle state after
document-changing transactions. That older column/handle mismatch bug is not a
current milestone target.

### Preserve 3 — Cross-page move logic is already centralized better than before

`src/built-in/canvas/config/blockStateRegistry/crossPageMovement.ts` already
holds the async cross-page move logic. Milestone 27 should build on that fact,
not regress by pushing movement logic back into node views.

### Preserve 4 — Menu coordination is already centralized

`src/built-in/canvas/menus/canvasMenuRegistry.ts` already acts as the menu
coordination surface. Milestone 27 should not re-fragment menu lifecycle or
outside-click logic.

---

## Vision

### Before M27

> The canvas works well, but a few legacy escape hatches and split routing
> responsibilities still make the implementation more fragile than it should be.

### After M27

> The canvas preserves all of its current interaction behavior while becoming
> easier to reason about, easier to maintain safely, and more internally
> consistent with the gate architecture and Parallx UI rules.

### Product definition

Milestone 27 makes the canvas:

- structurally simpler,
- behaviorally unchanged,
- more internally coherent,
- and less vulnerable to accidental regressions during future work.

---

## Scope

In scope:

1. Consolidate pageBlock cross-page drop routing into a single shared routing
   contract.
2. Replace remaining browser prompt fallbacks in the canvas database UI.
3. Align canonical canvas architecture docs with the enforced gate model.
4. Add or update regression coverage where a refactor touches non-trivial
   interaction behavior.

---

## Non-Goals

Out of scope:

1. Rewriting canvas editor behavior that already works.
2. Changing Notion-parity decisions that were already deliberately chosen.
3. Replacing the registry architecture.
4. Large UI redesign of canvas, database, page chrome, menus, or drag handles.
5. Sneaking in unrelated cleanup because a file is open.

---

## Guiding Principles

1. **Behavior preservation is mandatory**
   - if a refactor changes user-visible behavior, it is out of scope unless the
     behavior being changed is the direct browser-prompt fallback.

2. **Simplify by consolidation, not by flattening architecture**
   - move logic toward the correct registry/gate owner,
   - do not bypass gates to make code shorter.

3. **Use the live code as authority**
   - historical docs are useful context,
   - but implementation and tests decide what is true today.

4. **Do not pay for neatness with interaction regressions**
   - a cleaner file is not a success if drag/drop, menus, or database flows feel
     worse.

5. **Preserve previous hardening work explicitly**
   - older bugs that are already fixed should stay fixed through new regression
     tests where appropriate.

---

## Target Architecture

### 1. Shared pageBlock drop classification

The pageBlock interior-versus-edge routing decision should live in one shared,
testable location owned by the block-state side of the canvas.

Consumers:

- `pageBlockNode.ts`
- `columnDropPlugin.ts`

Properties:

- same geometry thresholds as current behavior,
- same edge/interior results as current behavior,
- no duplicate routing constants.

### 2. Shared database text-entry primitive

Canvas database rename/create flows should use a single Parallx-native input
surface rather than browser prompt fallbacks.

Consumers:

- `propertyConfig.ts`
- `viewTabBar.ts`

Properties:

- same string-entry semantics,
- theme-aware,
- keyboard-safe,
- compatible with existing context menu and tab-bar flows.

### 3. Canonical gate wording aligned to test enforcement

Repo docs and instructions should describe the enforced architecture that the
tests actually protect.

---

## Phase Plan

### Phase 1 — Code-First Safeguards

1. Freeze the current routing and database UX semantics in notes/tests.
2. Identify the exact user-visible behaviors that must remain unchanged.
3. Add regression tests where feasible before structural edits.

### Phase 2 — pageBlock Drag/Drop Consolidation

1. Extract shared pageBlock drop-zone classification.
2. Rewire `pageBlockNode.ts` to use the shared classifier.
3. Rewire `columnDropPlugin.ts` to use the same classifier.
4. Confirm no change in edge versus interior behavior.

### Phase 3 — Database Prompt Removal

1. Add a small shared text-entry surface.
2. Replace select-option creation prompt.
3. Replace view rename prompt.
4. Verify persistence behavior remains unchanged.

### Phase 4 — Documentation Alignment

1. Update canonical architecture wording.
2. Make the enforced database gate explicit.
3. Ensure future canvas work references the corrected model.

---

## Implementation Sequence

1. Document the exact current behavior for pageBlock interior and edge drops.
2. Add routing regression coverage if the current tests do not already pin that
   behavior down sufficiently.
3. Extract the shared drop classifier with no behavior change.
4. Rewire both routing consumers to that shared classifier.
5. Add the shared text-entry primitive.
6. Replace both prompt call sites.
7. Update architecture docs and instructions.
8. Run build and tests after each non-trivial phase.

---

## Verification Strategy

### Required automated verification

After each non-trivial phase:

1. `npm run build`
2. `npx vitest run`

### Required manual verification

#### pageBlock drag/drop

1. Drag a block onto the center of a page block card.
   - Expected: cross-page move/copy behavior remains unchanged.
2. Drag a block onto the top or bottom edge of a page block card.
   - Expected: normal above/below drop behavior remains unchanged.
3. Drag a block onto the left or right edge of an eligible target.
   - Expected: column create/extend behavior remains unchanged.
4. Repeat with Alt-drag.
   - Expected: duplicate semantics remain unchanged.

#### database rename/create flows

1. Add a new select option from database property config.
   - Expected: option is created with the same persistence semantics as before.
2. Rename a database view from the tab bar.
   - Expected: rename persists exactly as before.
3. Verify keyboard confirm/cancel behavior.
4. Verify the new UI is themed and non-blocking.

#### gate/document alignment

1. Read the updated docs and instructions.
2. Confirm they describe the same gate model enforced by the compliance test.

---

## Task Tracker

- [x] Document exact current pageBlock drop behavior before refactor
- [x] Add routing regression coverage where needed
- [x] Extract shared pageBlock drop classifier
- [x] Rewire `pageBlockNode.ts` to the shared classifier
- [x] Rewire `columnDropPlugin.ts` to the shared classifier
- [x] Add shared canvas/database text-entry UI primitive
- [x] Replace `prompt()` in `propertyConfig.ts`
- [x] Replace `prompt()` in `viewTabBar.ts`
- [x] Update canvas architecture documentation and instructions
- [x] Run build and tests for each completed phase

---

## Risk Register

### Risk 1 — Hidden drag/drop behavior drift during consolidation

Mitigation:

- preserve the current thresholds first,
- refactor into a shared classifier before changing any math,
- verify edge and interior drops manually.

### Risk 2 — Replacing prompt flows with heavier UI than needed

Mitigation:

- build the smallest reusable input surface that matches current semantics,
- do not turn a rename/create string entry into a larger workflow.

### Risk 3 — Over-cleaning stable canvas code

Mitigation:

- restrict code changes to confirmed issues,
- do not fold in unrelated cleanup,
- preserve already-fixed interaction hardening work.

### Risk 4 — Treating historical docs as current truth

Mitigation:

- always re-check the live source and live tests before making architecture
  claims,
- update docs only to match what the code actually enforces.
