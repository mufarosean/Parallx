# Milestone 22 — PDF Engine Reliability & Rendering Fidelity

> **Authoritative Scope Notice**
>
> This document is the single source of truth for Milestone 22.
> All implementation must conform to the structures and boundaries defined here.
> Milestones 1–21 established the Parallx shell, editor system, local AI stack,
> document ingestion pipeline, and custom PDF editor. This milestone hardens the
> **PDF viewing engine itself** so that Parallx's custom PDF experience achieves
> native-grade rendering stability, sharpness, and text selection fidelity while
> preserving the custom toolbar, sidebars, and workbench integration.

---

## Table of Contents

1. [Problem Statement](#problem-statement)
2. [Current State Research](#current-state-research)
3. [Root Cause Model](#root-cause-model)
4. [Vision](#vision)
5. [Architecture](#architecture)
6. [Design Principles](#design-principles)
7. [Phase A — Diagnostic Hardening](#phase-a--diagnostic-hardening)
8. [Phase B — Render Pipeline Control](#phase-b--render-pipeline-control)
9. [Phase C — Selection Geometry Fidelity](#phase-c--selection-geometry-fidelity)
10. [Phase D — Sharpness Policy & Fallbacks](#phase-d--sharpness-policy--fallbacks)
11. [Phase E — Regression Coverage](#phase-e--regression-coverage)
12. [Migration & Compatibility](#migration--compatibility)
13. [Task Tracker](#task-tracker)
14. [Verification Checklist](#verification-checklist)
15. [Risk Register](#risk-register)

---

## Problem Statement

### What the user experiences today

Parallx ships a custom PDF editor pane implemented with `pdfjs-dist` in
`src/built-in/editor/pdfEditorPane.ts`. It preserves the custom workbench shell,
toolbar, outline, thumbnails, and selection actions. However, the rendering and
selection quality are not reliable enough.

Current failures observed in the live Electron app:

1. **Blur after zoom changes**
   - At 100% and other scales, the displayed page can remain blurry even though
     the page frame visibly resized.
   - In diagnostic runs, the page wrapper expands to the new scale while the
     underlying canvas remains at the old bitmap size until a later scroll.

2. **Mixed sharp and blurry regions on the same page**
   - Some page regions appear crisp while others remain soft.
   - This is especially visible after zoom changes and scroll interactions.

3. **Text selection drift / fragmentation**
   - Text selection geometry can feel misaligned, ugly, or fragmented.
   - This happens when the text layer and the rendered page are not using the
     same effective geometry at the same moment.

4. **Non-deterministic behavior**
   - The same page can look different before and after scrolling, resizing, or
     waiting, which indicates a render-pipeline synchronization problem rather
     than a static asset problem.

### What this milestone fixes

Milestone 22 turns the PDF pane into a **reliable rendering engine integration**.
The goal is not cosmetic tuning. The goal is to enforce the following invariant:

> For every visible PDF page, the page box, canvas backing store, detail canvas
> policy, and text layer geometry must represent the same viewport scale and
> visible region before the page is considered visually ready.

This milestone fixes the root causes behind blur, partial sharpness, and broken
selection while keeping the custom Parallx PDF UI.

---

## Current State Research

### Parallx implementation today

Current PDF implementation facts from the codebase:

- `src/built-in/editor/pdfEditorPane.ts`
  - Instantiates `PDFViewer`, `PDFLinkService`, and `PDFFindController` directly.
  - Uses `currentScaleValue` for preset zoom and `currentScale` for numeric zoom.
  - Re-applies scale in `layoutPaneContent()` via a delayed assignment.
  - Maintains a custom toolbar, search bar, outline, thumbnail sidebar, and
    selection context menu.

- `src/built-in/editor/pdfEditorPane.css`
  - Uses an absolutely positioned `.pdf-viewer-container` inside a flex wrapper.
  - Overrides PDF.js styling locally.
  - Fences `.textLayer` subtree to `box-sizing: content-box` to protect against
    the global workbench `border-box` reset.

- `tests/e2e/19-pdf-diagnostics.spec.ts`
  - Opens a generated PDF through the real Electron workbench.
  - Captures screenshots and JSON runtime diagnostics.
  - Uses a test-only `window.__parallxPdfDebug` hook to capture viewer state.

### Proven findings from live diagnostics

Automated Electron diagnostics already established the following:

1. At initial `page-fit`, rendering completes normally.
2. After a direct 100% scale change, the page wrapper expands immediately.
3. In that stale state, the backing canvas remains at the old bitmap size.
4. The text layer can temporarily collapse or diverge from page geometry.
5. A real scroll-position change causes PDF.js to rerender and reconcile the
   canvas and text layer.
6. Blob-backed PDF.js runtime fonts are loading after the CSP/font MIME fixes,
   so the remaining issue is not explained by blocked font faces.

### PDF.js behavior that matters

Research against upstream PDF.js behavior shows:

1. `PDFViewer` updates scale via `#setScaleUpdatePages(...)`, which:
   - updates `--scale-factor`
   - refreshes page views
   - dispatches `scalechanging`
   - then calls `update()` on the rendering queue

2. `PDFPageView.update(...)` can follow multiple paths:
   - full rerender
   - CSS transform path
   - postponed drawing path
   - detail canvas / restricted-scaling path

3. PDF.js supports a **detail canvas** strategy for restricted/high zoom cases:
   - visible regions can be rerendered sharply while other regions remain on the
     lower-resolution backing canvas temporarily.
   - this improves responsiveness, but it creates mixed sharp/blurry regions if
     the visible-area bookkeeping is wrong or late.

4. Stock PDF.js app wiring explicitly calls `pdfViewer.update()` on scale change
   and on resize, but its full app shell also owns the viewer lifecycle more
   tightly than Parallx does.

### Synthesis

The rendering failures in Parallx are not best described as “wrong PDF
resolution.” PDFs are primarily vector documents. The engine must choose an
output bitmap per page from:

- page viewport dimensions in PDF space
- current zoom
- display device pixel ratio
- restricted-scaling/detail-canvas policy

The current bug class is **state divergence**, not bad source resolution.

---

## Root Cause Model

Milestone 22 treats the current failures as two connected but distinct defects.

### Defect 1: stale backing canvas after scale transition

Observed behavior:

- page frame resizes to the new scale
- canvas bitmap stays at the previous scale
- blur remains until scroll causes rerender

Interpretation:

- Parallx is allowing the page to appear visually updated before PDF.js finishes
  reconciling the new render state for the visible page.
- The render queue is being advanced reliably by real scroll movement, but not
  reliably by the current Parallx zoom/layout handoff.

### Defect 2: partial sharpness from detail-canvas / visible-area mismatch

Observed behavior:

- some page regions are crisp while other regions are blurred
- behavior changes with scroll / zoom / viewport changes

Interpretation:

- PDF.js detail-canvas behavior and/or restricted scaling is active for some
  view states, but Parallx is not guaranteeing that visible-area updates,
  container metrics, and page-ready state stay synchronized.
- The user sees an intermediate state that stock PDF.js normally hides or
  reconciles faster.

### Defect 3: text layer not sharing the exact same ready-state contract

Observed behavior:

- text selection is fragmented, offset, or ugly

Interpretation:

- The text layer is sensitive to inherited CSS and viewport transform changes.
- Even after the `content-box` fix, the pane still needs a stronger invariant:
  the page is not “ready” until the text layer geometry matches the active page
  viewport for the visible page.

### Defect 4: native selection paint exposes fragmented Chromium text boxes

Observed behavior:

- the selected text is correct, but the blue highlight can appear as overlapping
  blocks at word boundaries and list bullets
- the effect is strongest on real-world PDFs where the text layer is split into
  many absolutely positioned spans

Interpretation:

- PDF.js uses a Chromium-specific `.endOfContent` helper and native
  `Range.getClientRects()` selection painting to make drag selection behave.
- That behavior is functionally correct for copy/search, but it can expose a
  noisy visual result when adjacent text spans slightly overlap or when the
  browser paints each span boundary independently.
- Parallx should preserve the real browser selection for copy/search while
  owning the visible highlight paint so the user sees merged, stable selection
  geometry instead of fragmented native rectangles.

---

## Vision

### Before M22

> You open a PDF in Parallx. The custom toolbar and sidebars work, but after
> zooming the page can be soft or partially soft. Text selection may feel wrong.
> Scrolling sometimes makes the page look better, which means the visual output
> is not deterministic.

### After M22

> You open the same PDF in Parallx. Zoom changes settle into a sharp, stable
> page without needing manual scroll “fixes.” If detail rendering is used, it is
> invisible to the user and never exposes a mixed sharp/blurry state. Text
> selection tracks the rendered page geometry correctly. Playwright diagnostics
> and unit coverage prove that visible-page render state is coherent across load,
> zoom, resize, and scroll transitions.

---

## Architecture

### Rendering Readiness Contract

Milestone 22 introduces a stricter page-ready model in the Parallx PDF pane.

For the active visible page, the pane must treat a zoom/layout transition as
complete only when all of the following are true:

1. `PDFPageView` is no longer in an intermediate stale state.
2. Canvas backing-store dimensions match the effective viewport scale policy.
3. Any detail-canvas policy has either:
   - fully rendered the visible region, or
   - been disabled / bypassed by policy.
4. Text layer geometry reflects the same viewport dimensions as the rendered
   page.

### Diagnostic Layers

The PDF diagnostics system must capture, at minimum:

- page render state
- canvas bitmap size
- canvas CSS rect
- page rect
- text-layer rect
- visible-region / detail-canvas indicators where available
- device pixel ratio
- zoom mode and numeric scale

### Policy Layers

Milestone 22 allows the PDF pane to make an explicit policy choice instead of
leaving everything to implicit PDF.js defaults:

1. **Preferred path**
   - keep PDF.js optimized rendering
   - enforce correct visible-page reconciliation timing

2. **Fallback path**
   - selectively disable problematic detail-canvas behavior or other
     optimization paths if they are the direct source of visible defects
   - prioritize stable sharpness and correct selection over theoretical scroll
     performance wins

---

## Design Principles

1. **Stable sharpness beats clever partial rendering.**
   - If an optimization makes visible quality worse, Parallx must not use it.

2. **A page is not ready just because its box resized.**
   - Visual readiness requires coherent geometry across canvas and text layers.

3. **No guesswork after this milestone begins.**
   - Every rendering change must be validated by diagnostics or tests.

4. **Preserve the custom Parallx PDF shell.**
   - The toolbar, outline, thumbnails, and workbench integration remain intact.

5. **Prefer engine-correct fixes over CSS masking.**
   - CSS corrections are valid only when the issue is actually CSS geometry.

---

## Phase A — Diagnostic Hardening

Goal: make the rendering state machine observable enough that fixes are provable.

### Deliverables

- Extend the PDF debug hook to expose:
  - current page render state
  - detail-canvas presence/state if accessible
  - visible-area and restricted-scaling indicators if accessible
  - page-ready readiness checks used by Parallx
- Expand Playwright diagnostics to cover:
  - initial load
  - zoom-in
  - zoom-out
  - exact 100%
  - resize-driven relayout
  - selection geometry after each relevant state change

### Non-goals

- No speculative rendering hacks in this phase.

---

## Phase B — Render Pipeline Control

Goal: ensure scale changes and relayout transitions drive PDF.js in a way that
produces an immediate, deterministic visible-page rerender.

### Scope

- Audit all current calls to:
  - `currentScaleValue`
  - `currentScale`
  - `increaseScale()` / `decreaseScale()`
  - relayout-time scale reapplication
- Replace any scale path that leaves the page in a stale CSS-scaled state.
- Align Parallx event handling more closely with stock PDF.js viewer behavior
  where appropriate.
- Add a Parallx-side readiness barrier so the page is not treated as visually
  settled until the visible page is actually rerendered.

### Decision gates

- If PDF.js optimized behavior can be made stable, keep it.
- If not, explicitly disable the optimization path that causes visible blur.

---

## Phase C — Selection Geometry Fidelity

Goal: guarantee that text selection overlays share the same viewport geometry as
the rendered page.

### Scope

- Preserve the existing `.textLayer` box-model fencing.
- Audit page rect, canvas rect, and text-layer rect for consistent dimensions.
- Eliminate any Parallx CSS or layout behavior that causes layer drift.
- Restore the PDF.js selection special-cases for helper nodes and non-text
  descendants.
- Add a Parallx-owned merged selection overlay so visible selection paint is
  stable even when native Chromium rectangles are fragmented.
- Add automated geometry assertions for text selection against known sample PDFs.

### Output

- Selection ranges align with text spans after load, zoom, and resize.
- Visible selection highlight no longer shows overlapping native blocks for
  multi-span text selections.

---

## Phase D — Sharpness Policy & Fallbacks

Goal: make the PDF pane explicitly choose a rendering policy that favors stable
quality.

### Scope

- Evaluate PDF.js detail-canvas behavior in Parallx specifically.
- If mixed sharp/blurred regions are caused by detail rendering:
  - either synchronize visible-area updates correctly, or
  - disable the problematic path for Parallx’s pane.
- Audit restricted-scaling thresholds and any max-canvas policy that makes the
  visible page look degraded under normal use.

### Acceptance rule

- The user must not see partially sharpened pages during normal zoom/scroll use.

---

## Phase E — Regression Coverage

Goal: prevent future regressions and make PDF fidelity a permanent test surface.

### Unit coverage

- Add focused unit tests for Parallx PDF pane state helpers introduced in M22.
- Test any new page-ready / geometry-normalization logic in isolation.

### E2E coverage

- Extend Playwright coverage to assert:
  - crisp rerender after 100% transition without manual scroll repair
  - consistent behavior across multiple zoom levels
  - no text-layer collapse on numeric zoom
  - stable selection geometry after zoom and resize

### Artifact coverage

- Persist JSON diagnostics and screenshots for PDF regression failures.

---

## Migration & Compatibility

- No migration is required for user data.
- Existing PDF editor commands and toolbar actions remain intact.
- Existing diagnostic hooks may be expanded but remain test-only.
- If an optimization path is disabled, the behavior change is internal only.

---

## Task Tracker

### A. Diagnostics

- [ ] A1. Expand the PDF debug hook to expose visible-page render policy state.
- [x] A2. Extend `tests/e2e/19-pdf-diagnostics.spec.ts` to cover more zoom and resize transitions.
- [x] A3. Add assertions that distinguish stale-canvas blur from detail-canvas partial rendering.

### B. Render pipeline

- [ ] B1. Audit every Parallx-controlled zoom path and remove inconsistent scale application.
- [ ] B2. Implement a deterministic visible-page rerender handshake after zoom and relayout.
- [ ] B3. Ensure resize-driven scale reapplication matches PDF.js stock expectations.

### C. Selection fidelity

- [x] C1. Add geometry checks for page rect, canvas rect, text-layer rect, and selection-overlay boxes.
- [x] C2. Fix any remaining layer drift caused by Parallx CSS/layout.
- [x] C3. Restore PDF.js selection helper special-cases and replace fragmented native paint with a merged Parallx overlay.
- [x] C4. Validate text selection on generated multi-span PDFs with automated overlap assertions.

### D. Sharpness policy

- [ ] D1. Determine whether detail canvas can remain enabled safely in Parallx.
- [ ] D2. If not, disable or constrain the offending optimization path.
- [ ] D3. Validate that no mixed sharp/blurry visible region remains during normal use.

### E. Verification

- [ ] E1. Add unit tests for new PDF pane helper logic.
- [x] E2. Make Playwright diagnostics assert the fixed behavior, not just record it.
- [x] E3. Run `tsc --noEmit`, `npx vitest run`, and targeted Playwright PDF diagnostics before closure.

---

## Verification Checklist

- [ ] Opening a PDF produces a fully rendered first page without text-layer collapse.
- [ ] Switching from `page-fit` to 100% produces a sharp visible page without requiring scroll.
- [ ] Zooming at multiple levels does not leave stale low-resolution canvases visible.
- [ ] The user never sees mixed sharp/blurry regions on the same visible viewport area.
- [x] Text selection boxes align with the rendered text after load, zoom, resize, and scroll.
- [x] Text selection no longer shows overlapping block artifacts for multi-span lines.
- [ ] No CSP/font-load regressions occur for runtime PDF.js fonts.
- [x] `npm run build` passes.
- [x] `npx vitest run` passes.
- [x] Targeted Playwright PDF diagnostics pass and encode the new invariants.

---

## Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| PDF.js internal behavior differs from stock app integration assumptions | High | Compare Parallx event flow to stock PDF.js app behavior and validate with runtime diagnostics |
| Disabling detail-canvas optimization harms scroll performance | Medium | Prefer synchronization fix first; only disable optimization if it is the direct visible defect source |
| Text-layer fixes accidentally regress search highlighting or annotations | Medium | Keep selection tests, search tests, and annotation visibility checks in Playwright |
| Fixing numeric zoom only leaves preset zoom paths inconsistent | High | Audit all zoom paths together in Phase B |
| Renderer changes appear correct on generated PDFs but fail on real-world PDFs | High | Validate against both generated fixtures and at least one real PDF sample in the workspace or test assets |
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
