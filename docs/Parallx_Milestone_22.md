# Milestone 22 — AI Cleanup Audit & Dead Code Removal

> **Authoritative Scope Notice**
>
> This document is the single source of truth for Milestone 22.
> All implementation must conform to the structures and boundaries defined here.
> Milestones 9–21 established the local AI chat system, RAG pipeline, prompt
> layering, AI settings, unified configuration, memory, retrieval hardening,
> and intelligent document ingestion. This milestone does **not** add new AI
> features. It performs a **conservative cleanup audit** of the AI stack,
> removes code proven unnecessary at runtime, shrinks stale compatibility
> surfaces where safe, and fixes known AI-side inefficiencies without changing
> user-visible behavior.

---

## Table of Contents

1. [Problem Statement](#problem-statement)
2. [Audit Methodology](#audit-methodology)
3. [Vision](#vision)
4. [Scope](#scope)
5. [Architecture Impact](#architecture-impact)
6. [Phase A — Safe Runtime Removals](#phase-a--safe-runtime-removals)
7. [Phase B — Conditional Legacy Surface Reduction](#phase-b--conditional-legacy-surface-reduction)
8. [Phase C — Performance & Efficiency Fixes](#phase-c--performance--efficiency-fixes)
9. [Deferred Removals / Explicit Non-Goals](#deferred-removals--explicit-non-goals)
10. [Migration & Backward Compatibility](#migration--backward-compatibility)
11. [Task Tracker](#task-tracker)
12. [Verification Checklist](#verification-checklist)
13. [Risk Register](#risk-register)

---

## Problem Statement

The AI subsystem has reached the point where **migration code, abandoned
experiments, and compatibility scaffolding now compete with the real runtime
path**.

That creates four problems:

1. **Duplicate initialization work**
   - Legacy and unified AI settings services are both initialized during
     startup even though only the unified service remains active in runtime DI.

2. **Runtime-orphaned UI and planner code**
   - Some AI UI components and retrieval-planner helpers remain in the tree even
     though the current product path no longer uses them.

3. **Stale interfaces obscure the real architecture**
   - Compatibility methods remain exposed even when no production caller uses
     them.

4. **Avoidable AI-side inefficiencies remain in hot paths**
   - The workspace digest builder and rich-document indexing path both perform
     extra work that scales poorly or duplicates extraction.

The result is slower startup, extra maintenance burden, misleading interfaces,
more fragile tests, and a harder-to-understand AI codebase.

This milestone fixes that by performing a **proof-driven cleanup**:

- only remove code when usage analysis shows it is not needed by the current
  runtime path;
- explicitly separate **safe removals** from **deferred migration holds**;
- keep compatibility only where the production app still depends on it.

---

## Audit Methodology

This milestone is based on a full-code audit of the AI implementation under:

- `src/built-in/chat/**`
- `src/services/**` (AI-related services)
- `src/aiSettings/**`
- `src/workbench/**` AI registration/wiring
- relevant unit tests under `tests/unit/**`

### Inclusion standard

A cleanup candidate is only included when at least one of these is true:

1. **No runtime src callsite exists** and remaining references are tests,
   interfaces, docs, or deprecated adapters.
2. The code is **duplicated by a newer runtime path** and the old path does no
   real work for production behavior.
3. The code is still executed but is **provably wasteful**, redundant, or
   structurally misleading.

### Exclusion standard

A candidate is **not** considered safe to remove if any of the following are
true:

- active runtime services still resolve it from DI;
- workspace migration or backward compatibility still depends on it;
- fallback behavior is still required for degraded but supported environments;
- removal would silently change feature behavior rather than just simplifying
  implementation.

### Audit rule

If the code is merely old but still on a real runtime path, it belongs in
**Deferred Removals / Explicit Non-Goals**, not in a safe-removal task.

---

## Vision

### Before M22

> The AI stack works, but parts of it still carry old milestones inside the
> runtime: legacy settings bootstrapping, modal tool UI that is no longer the
> product path, planner remnants that are not part of the live retrieval flow,
> and performance costs hidden inside prompt assembly and document indexing.
>
> A contributor reading the code cannot easily tell which path is authoritative.

### After M22

> The AI stack has one clearly authoritative runtime path. Legacy migration
> remains only where production still needs it. Dead UI and planner remnants are
> either removed or explicitly quarantined behind a documented hold. Startup is
> leaner, interfaces better match real usage, and AI-side hot paths stop doing
> unnecessary work.

---

## Scope

### In scope

- Remove runtime-orphaned AI code with verified non-usage.
- Remove or shrink stale compatibility surfaces where production does not rely
  on them.
- Fix AI-side inefficiencies that do not change feature semantics.
- Update tests and docs that still reference removed paths.
- Document explicit migration holds that must **not** be removed yet.

### Out of scope

- Re-architecting the AI product surface.
- Replacing prompt layering, retrieval, or memory behavior.
- Removing compatibility code that still supports workspace migration.
- Removing document-extraction fallback while Docling remains optional.
- Any feature redesign of the AI Hub, chat panel, or indexing log.

---

## Architecture Impact

### The intended steady-state runtime path

```text
Workbench startup
    ↓
UnifiedAIConfigService initializes
    ↓
IAISettingsService compatibility alias resolves to unified service
    ↓
Chat / AI Settings / Suggestions consume unified-backed compatibility surface
    ↓
Prompt building + retrieval + tools run through current live path only
```

### The cleanup principle

The codebase should contain:

- **one authoritative runtime path**, and
- **only the minimum compatibility layer still required by production**.

Everything else should either be removed or explicitly documented as deferred.

---

## Phase A — Safe Runtime Removals

These items are approved for cleanup because current runtime analysis shows they
are not needed by production behavior.

### A.1 Stop bootstrapping legacy `AISettingsService` during startup

**Finding**

The app still initializes the legacy M15 `AISettingsService`, then immediately
initializes `UnifiedAIConfigService` and overwrites `IAISettingsService` with
that unified instance.

**Evidence**

- `workbench.ts` calls both registrations in sequence.
- `registerAISettingsService()` constructs and initializes the legacy service.
- `registerUnifiedAIConfigService()` then re-registers `IAISettingsService` to
  the unified service.
- `UnifiedAIConfigService` already migrates the old `ai-settings.*` storage
  keys directly.

**Why this is safe**

The unified service already handles legacy-profile migration itself. Runtime
consumers resolve `IAISettingsService` **after** the unified registration, so
production behavior does not depend on the legacy service instance surviving.

**Cleanup action**

- Remove the normal-startup call to `registerAISettingsService()`.
- Keep legacy-storage migration inside `UnifiedAIConfigService`.
- Preserve targeted migration tests if needed, but stop paying the runtime
  initialization cost.

**Risk**: Medium

---

### A.2 Remove the deprecated `ChatToolPicker` modal runtime path

**Finding**

The chat input still constructs `ChatToolPicker`, but the wrench button no
longer opens it. The UI now routes to AI Hub → Tools instead.

**Evidence**

- `ChatToolPicker` is explicitly marked deprecated.
- `ChatInputPart` still creates `new ChatToolPicker()`.
- The toolbar click handler fires `onDidRequestOpenToolSettings` rather than
  opening the picker.
- Chat main wiring routes the tools/settings flow to the AI Settings surface.

**Why this is safe**

The production tools button no longer uses the modal. Remaining runtime usage is
construction plus service wiring, not actual product behavior.

**Cleanup action**

- Remove `ChatToolPicker` construction from `ChatInputPart`.
- Remove `setToolPickerServices()` plumbing if it exists only for the modal.
- Remove the deprecated modal implementation and update any tests that still
  exercise it.

**Risk**: Medium

---

### A.3 Remove orphaned `ChatHeaderPart` and `IChatHeaderAction`

**Finding**

`ChatHeaderPart` exists in source and tests, but no production chat view uses
it.

**Evidence**

- `ChatHeaderPart` is defined as a standalone widget.
- `IChatHeaderAction` exists in chat types.
- No non-test production usage was found.
- Existing references are test-only.

**Why this is safe**

A component with no production callsite is dead code. Its tests only prove the
component itself works, not that the product needs it.

**Cleanup action**

- Remove `ChatHeaderPart`.
- Remove `IChatHeaderAction`.
- Delete or replace unit tests that only validate the orphaned widget.

**Risk**: Low

---

### A.4 Remove `resetLegacySection()` from `UnifiedAIConfigService`

**Finding**

`resetLegacySection()` exists as an adapter method, but no production or test
usage was found.

**Evidence**

- Method exists on `UnifiedAIConfigService`.
- No callsite exists in `src/**` or `tests/**`.

**Why this is safe**

Unreferenced adapter methods add API surface without behavior value.

**Cleanup action**

- Remove `resetLegacySection()`.
- Keep the real `resetSection()` implementation as the authoritative path.

**Risk**: Low

---

### A.5 Remove dormant planner bridge surface if planner re-enablement is formally closed

**Finding**

The production retrieval flow no longer uses a planner. `planAndRetrieve()`
remains defined and re-exposed, but current runtime code does not call it.

**Evidence**

- `defaultParticipant.ts` uses direct `retrieveContext(...)` for RAG assembly.
- `ChatDataService.planAndRetrieve()` is documented as a fall-through leftover.
- `planAndRetrieve` remains only in chat service types and `ChatDataService`
  wiring.
- No production callsite was found.

**Why this is conditional**

This is safe only if M22 formally declares the planner path abandoned rather
than merely paused.

**Cleanup action**

If planner re-enablement is cancelled:
- remove `planAndRetrieve()` from `IDefaultParticipantServices` / chat types;
- remove the fallback method from `ChatDataService`;
- delete planner-era test scaffolding that assumes the method exists.

If planner re-enablement remains a real roadmap item:
- do **not** remove it in M22; move it to Deferred Removals.

**Risk**: Medium

---

### A.6 Remove `buildPlannerPrompt()` if planner re-enablement is cancelled

**Finding**

`buildPlannerPrompt()` exists in `chatSystemPrompts.ts`, but observed usage is
currently test-only.

**Evidence**

- Helper is defined in `chatSystemPrompts.ts`.
- Observed callsites are unit tests only.
- No production caller was found.

**Why this is conditional**

This helper is only dead code if the planner path is officially retired.

**Cleanup action**

If planner is cancelled:
- remove `buildPlannerPrompt()` and its dedicated tests.

If planner remains a future option:
- move it to a quarantined internal/planned section and document why it still
  exists.

**Risk**: Low

---

## Phase B — Conditional Legacy Surface Reduction

These items are not automatically removable, but they should be reduced once
M22 confirms the compatibility story.

### B.1 Shrink stale `IAISettingsService` surface to the actually used compatibility API

**Finding**

Several legacy M15-shaped methods appear to be interface- or test-only:

- `getGlobalProfile()`
- `getProfile(id)`
- `generateSystemPrompt(...)`

**Evidence**

- They remain declared on `IAISettingsService`.
- Unified service still implements them for compatibility.
- `getProfile()` and `generateSystemPrompt()` appear to be test-only.
- `getGlobalProfile()` appears interface-only under the current UI/runtime path.

**Why this is conditional**

The alias `IAISettingsService` is still used at runtime. The goal is not to
remove the alias yet, only to trim methods that no real caller needs.

**Cleanup action**

- First, verify no UI section, service, or command depends on these methods.
- Then deprecate and remove them from the compatibility surface.
- Prefer `getActiveProfile()` or unified config APIs as the surviving runtime
  path.

**Risk**: Medium

---

### B.2 Update planner-era docs and tests when planner remnants are removed

**Finding**

Planner-era docs and tests still describe a flow that no longer exists in
runtime.

**Evidence**

- Planner tests still exist.
- Milestone 12 and related research documents still describe `planAndRetrieve`
  and `buildPlannerPrompt()` as part of the architecture.

**Cleanup action**

- If planner cleanup proceeds, update milestone and research docs so they no
  longer imply a live planner path.
- Keep historical documents historical, but remove claims that suggest the
  planner is still active runtime infrastructure.

**Risk**: Low

---

## Phase C — Performance & Efficiency Fixes

These are not dead-code removals. They are targeted AI-side efficiency fixes.

### C.1 Remove repeated `treeLines.join('\n')` work in workspace digest construction

**Finding**

The workspace digest builder repeatedly joins the entire accumulated tree during
breadth-first traversal in order to estimate current size.

**Why it matters**

That turns the directory-walk budget check into a growing repeated-string-build
operation and scales poorly on larger workspaces.

**Current pattern**

Inside the loop, the code recomputes the current tree size using a full
`join('\n')` over all previously collected entries.

**Cleanup action**

- Maintain an incremental character counter instead of repeatedly joining the
  entire array.
- Preserve exact prompt semantics while reducing repeated allocation work.

**Risk**: Low

---

### C.2 Avoid duplicate extraction work in PDF scan detection

**Finding**

For some PDFs, indexing first performs a lightweight legacy extraction to guess
text density, then performs full document extraction again.

**Why it matters**

This duplicates expensive file parsing on large documents and slows indexing.

**Cleanup action**

- Refactor scan detection so classification does not require a second full
  content extraction for the same file when avoidable.
- Reuse extracted metadata/text where possible.
- Do not reduce extraction quality or fallback coverage.

**Risk**: Medium

---

## Deferred Removals / Explicit Non-Goals

These items were audited and are **not safe to remove in M22**.

### D.1 Do not remove the `IAISettingsService` compatibility alias yet

**Why keep it**

Production runtime still resolves `IAISettingsService` from DI.

**Current live users include**

- AI Settings built-in wiring
- AI Settings panel sections
- `ProactiveSuggestionsService`
- chat/runtime compatibility paths

**Rule**

M22 may shrink the method surface, but it must not remove the compatibility
alias until runtime consumers have been migrated off it.

---

### D.2 Do not remove legacy `.parallx/config.json` import yet

**Why keep it**

The unified config service still imports legacy workspace config into the new
workspace override model. That is active migration infrastructure.

**Rule**

Keep until there is an explicit migration-close milestone and user-visible
communication that the import path has ended.

---

### D.3 Do not remove legacy document extraction fallback yet

**Why keep it**

Parallx still supports environments where Docling is unavailable or extraction
fails. The fallback path is active runtime functionality, not dead code.

**Rule**

Only remove when Docling becomes mandatory and startup/install UX guarantees it.

---

## Migration & Backward Compatibility

M22 is allowed to remove dead code, but it must preserve:

1. **Legacy profile migration** into `UnifiedAIConfigService`.
2. **Current DI compatibility** where runtime still resolves
   `IAISettingsService`.
3. **Legacy workspace config import** from `.parallx/config.json`.
4. **Legacy document extraction fallback** while Docling remains optional.

### Compatibility rule

When a compatibility surface is removed, one of these must already be true:

- no production caller remains; or
- the caller has been migrated to the unified path in the same change.

---

## Task Tracker

### Phase A — Safe runtime removals

- [x] A1. Stop normal-startup initialization of legacy `AISettingsService`
- [x] A2. Remove deprecated `ChatToolPicker` runtime path
- [x] A3. Remove orphaned `ChatHeaderPart` and `IChatHeaderAction`
- [x] A4. Remove unreferenced `resetLegacySection()`
- [x] A5. Decide planner status: cancelled vs deferred
- [x] A6. Remove `planAndRetrieve()` compatibility bridge
- [x] A7. Remove `buildPlannerPrompt()` and planner-only tests

### Phase B — Conditional legacy surface reduction

- [x] B1. Audit live use of `getGlobalProfile()`, `getProfile()`, and
  `generateSystemPrompt()`
- [x] B2. Remove stale `IAISettingsService` methods proven unused
- [x] B3. Update tests and docs to match the post-cleanup contract

### Phase C — Performance & efficiency fixes

- [x] C1. Replace repeated digest `join()` budget checks with incremental size tracking
- [ ] C2. Remove duplicate PDF extraction work in scan detection/classification path

---

## Verification Checklist

Every cleanup in M22 must satisfy all applicable checks.

### Usage verification

- [ ] Search the workspace for every symbol scheduled for removal.
- [ ] Confirm no production runtime caller remains in `src/**`.
- [ ] If references remain, classify them as runtime, tests, docs, or migration.
- [ ] Do not remove a symbol merely because it is marked deprecated.

### Runtime verification

- [ ] `tsc --noEmit`
- [ ] `npx vitest run`
- [ ] Run targeted AI/chat tests for affected surfaces.
- [ ] Verify chat opens, sends messages, and opens AI Settings correctly.
- [ ] Verify AI Hub still loads and edits settings after cleanup.
- [ ] Verify retrieval still injects context correctly.
- [ ] Verify indexing still handles rich documents and fallback behavior.

### Behavioral verification

- [ ] No user-visible regression in tools/settings entry points.
- [ ] No regression in default model seeding from unified config.
- [ ] No regression in memory/suggestions settings access.
- [ ] No regression in workspace config import.
- [ ] No regression in non-Docling document indexing.

### Documentation verification

- [ ] Remove or update planner-era docs if planner code is removed.
- [ ] Update tests that only validate removed dead components.
- [ ] Keep historical docs historical; do not let them imply a live runtime path.

---

## Risk Register

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Removing legacy settings boot too early breaks migration assumptions | High | Medium | Keep migration inside `UnifiedAIConfigService`; verify legacy storage import with tests |
| Removing ChatToolPicker misses a hidden command or path | Medium | Medium | Search for `open()` / command wiring before deletion; verify tools button still routes to AI Hub |
| Planner cleanup conflicts with future roadmap | Medium | Medium | Make planner removal conditional on an explicit M22 decision |
| Trimming `IAISettingsService` removes methods still needed by runtime | High | Low | Require zero-runtime-caller proof before interface shrink |
| Digest performance fix changes prompt content | Medium | Low | Preserve exact output; change only accounting strategy |
| PDF efficiency fix accidentally changes extraction quality | High | Medium | Reuse extraction data rather than skipping needed steps; compare indexing outputs before/after |

---

## Final Rule for M22

**If a piece of AI code cannot be proven necessary to the current runtime path,
it should be removed. If it can be proven necessary, it stays — even if it is
old.**

That proof-first rule is the entire purpose of this milestone.
