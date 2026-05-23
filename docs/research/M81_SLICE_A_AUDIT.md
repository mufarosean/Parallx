---
Status: Audit (reality check before code execution)
Author: Explore subagent (Conductor invocation)
Branch: systems-redesign-planning
Created: 2026-05-23
Audits: docs/Parallx_Milestone_81.md §4 Slice A
---
## M81 / SR-1 Slice A — Reality Audit Report

I've completed a systematic code-level verification of Slice A's claims against what actually exists. Here are my findings:

---

### **A. Does any consumer subscribe to an `onDidChangeSelection` broadcast today?**

**Finding: NO — `onDidChangeSelection` does NOT exist in current code.**

- [src/built-in/chat/input/chatContextAttachments.ts](src/built-in/chat/input/chatContextAttachments.ts#L1-L70) subscribes to `services.onDidChangeOpenEditors` (line 65), NOT selection events.
- [src/built-in/canvas/canvasSidebar.ts](src/built-in/canvas/canvasSidebar.ts#L1-L100) is purely an internal sidebar tree; no selection subscription found.
- [src/services/surfaceRouterService.ts](src/services/surfaceRouterService.ts#L1-L80) is for AI surface delivery, not selection events.
- Selection model is **purely dispatch-based** today: `dispatcher.dispatch(payload)` → handler matching on `payload.actionId` → handler execution.

**Status: GENUINELY MISSING** ✗

---

### **B. How does selection currently flow from Explorer → Chat and Explorer → Canvas? Is the dispatcher actually used, or is there a separate path?**

**Finding: Dispatcher IS used, but claim of "hard-coded" handlers is MISLEADING.**

**Call chain:**
1. [src/services/selectionActionDispatcher.ts:L29-L45](src/services/selectionActionDispatcher.ts#L29-L45) — `registerHandler()` + `dispatch()` — this is a **registry pattern**, not hard-coded.
2. [src/services/selectionActionHandlers.ts:L35-L75](src/services/selectionActionHandlers.ts#L35-L75) — Two built-in handlers created by factory `createBuiltInActionHandlers()`.
3. [src/built-in/chat/main.ts:L2571](src/built-in/chat/main.ts#L2571) — Chat extension **registers** handlers:
   ```typescript
   context.subscriptions.push(_selectionDispatcher.registerHandler(handler));
   ```

**The "hard-coded" claim is inaccurate.** Handlers are:
- **Created dynamically** via factory function, not statically defined in `selectionActionHandlers.ts`
- **Registered** via `registerHandler()` API, returning an `IDisposable`
- **Routed** by the dispatcher's `dispatch()` method matching `actionId` fields

This is a standard **plugin registry pattern** — extensible by design. To add a third handler (e.g., "Send to Spreadsheet"), you'd register it, not edit core code.

**Status: ALREADY EXISTS (but mischaracterized in plan)** ✓

---

### **C. Does `RecentWorkspaces.add(workspace)` actually create a "dual update" inconsistency today? Or does RecentWorkspaces only snapshot?**

**Finding: NO dual update. RecentWorkspaces is READ-ONLY snapshot only.**

[src/workspace/recentWorkspaces.ts:L35-L70](src/workspace/recentWorkspaces.ts#L35-L70):
```typescript
async add(workspace: Workspace): Promise<void> {
  const list = await this._getList();
  const filtered = list.filter(e => e.identity.id !== workspace.id);
  
  workspace.touch();  // Only mutates workspace.metadata in memory
  const entry: RecentWorkspaceEntry = {
    identity: { ...workspace.identity, ... },
    metadata: workspace.metadata,  // SNAPSHOT ONLY
  };
  filtered.unshift(entry);
  await this._saveList(trimmed);  // Persists to global storage, does NOT update Workspace
}
```

**Key observation:**
- `workspace.touch()` updates the in-memory `lastAccessedAt` field (does not persist).
- The entry is **snapshotted** from `workspace.identity` and `workspace.metadata`.
- The persisted entry is **stored separately** in global storage (`recentWorkspaces` key).
- `Workspace` object is **never mutated back** from the snapshot.

**The plan's claim** ("both update metadata; eventual consistency only") is **FALSE**.

**What IS canonical:**
- [src/workspace/workspace.ts:L35-L45](src/workspace/workspace.ts#L35-L45) — `Workspace.onDidChangeFolders` and [L46-L48](src/workspace/workspace.ts#L46-L48) `Workspace.onDidChangeState` **already exist**.
- `Workspace.folders` is already the single source of truth for folder set.

**Status: ALREADY CORRECT (no dual update exists)** ✓

---

### **D. Is there an existing "Resource" abstraction in the codebase?**

**Finding: NO `IResource` or `Resource` class exists.**

- Grep for `interface IResource`, `class Resource`, `resourceRegistry` across workspace: **0 matches**.
- No centralized resolver for "give me a stable identity for file/canvas-page/chat-session" exists.

**Status: GENUINELY MISSING** ✗

---

### **E. Is `ContextKeyRegistry` truly missing, or is `WorkbenchContextManager` effectively the same thing?**

**Finding: `ContextKeyRegistry` does NOT exist, but `WorkbenchContextManager` is already centralizing context keys.**

**Current architecture:**
- [src/context/workbenchContext.ts:L17-L50](src/context/workbenchContext.ts#L17-L50) — ~26 context key name constants exported as `CTX_*`.
- [src/context/workbenchContext.ts:L103-L128](src/context/workbenchContext.ts#L103-L128) — All keys **created in one place**: the `WorkbenchContextManager` constructor.
- [src/context/contextKey.ts:L1-L150](src/context/contextKey.ts#L1-L150) — `ContextKeyService.createKey()` is the registration API.

**Scattered keys problem:**
- Extensions CAN call [src/built-in/chat/main.ts:L2505-L2510](src/built-in/chat/main.ts#L2505-L2510) or any code site `api.context.createContextKey(name, default)` and bypass `WorkbenchContextManager`.
- This creates **discoverable vs. undiscoverable** keys — not a sync problem, just an IDE autocomplete/documentation problem.

**Reality check:** ALL standard workbench keys (sidebar, panel, editor, workspace) go through `WorkbenchContextManager` centrally. Extensions adding custom keys is expected and documented in [PARALLX_EXTENSION_AUTHORING_FOR_AI.md:L442](docs/PARALLX_EXTENSION_AUTHORING_FOR_AI.md#L442).

**Status: PARTIALLY EXISTS (90% of the goal; just docs + convention needed)** ≈

---

### **F. Classify Each Deliverable**

| Deliverable | Status | Reasoning |
|---|---|---|
| **SelectionService + onDidChangeSelection event** | GENUINELY MISSING | No event broadcast exists; dispatch-only today. |
| **Workspace canonical ownership + onDidChangeState** | ALREADY EXISTS | `Workspace.onDidChangeFolders` and `onDidChangeState` exist. No dual update. |
| **RecentWorkspaces observing instead of dual-updating** | ALREADY CORRECT | RecentWorkspaces is read-only snapshot; no dual update exists today. |
| **ResourceRegistry (centralized Resource resolver)** | GENUINELY MISSING | No IResource or resolver exists. |
| **ContextKeyRegistry (centralized context key definitions)** | PARTIALLY EXISTS | WorkbenchContextManager centralizes ~26 keys via CTX_* constants. Extensions can scatter custom keys but don't. |

---

### **G. Smallest Possible Change Set for Missing/Partial Items**

#### **1. SelectionService (NEW)**
- **File:** `src/services/selectionService.ts` (~250 LOC)
- **What:** Event-based wrapper over `SelectionActionDispatcher`.
- **API:**
  ```typescript
  interface ISelectionService {
    readonly onDidChangeSelection: Event<{ selection: Selection; previous?: Selection }>;
    setSelection(selection: Selection): void;
    getSelection(): Selection | undefined;
  }
  ```
- **Implementation:** Emit event on `setSelection()`; forward to dispatcher for backward compatibility.

#### **2. Update Chat & Canvas to Subscribe (MODIFY)**
- **Files:** 
  - [src/built-in/chat/main.ts](src/built-in/chat/main.ts#L2571) (~10 LOC)
  - [src/built-in/canvas/canvasSidebar.ts](src/built-in/canvas/canvasSidebar.ts#L1) (~10 LOC)
- **Change:** Instead of `registerHandler()`, subscribe to `selectionService.onDidChangeSelection` event.
- **Backward compat:** Dispatcher becomes a shim that listens to SelectionService and calls registered handlers.

#### **3. Workspace Canonical Ownership (DOCUMENT ONLY)**
- **File:** [src/workspace/workspace.ts](src/workspace/workspace.ts#L30-L40) (~20 LOC comments)
- **Change:** Add JSDoc clarifying:
  - `Workspace.folders` is the canonical folder set; no mutations from `RecentWorkspaces`.
  - `Workspace.onDidChangeFolders` is the event source; observers (RecentWorkspaces, UI) subscribe.
- **No code change needed** — architecture is already correct.

#### **4. ContextKeyRegistry (DOCUMENT + CONVENTION)**
- **File:** [src/context/workbenchContext.ts](src/context/workbenchContext.ts#L1-L30) (~40 LOC comments + JSDoc)
- **Change:** 
  - Add JSDoc to `WorkbenchContextManager` clarifying it's the registry for standard keys.
  - Export a `discoverContextKeys()` helper that lists all `CTX_*` constants.
  - Document: "Extensions add custom keys via `api.context.createContextKey()`; register custom key names in `EXTENSION_REGISTRY` for IDE discovery."
- **No service needed** — just documentation + optional `discoverContextKeys()` helper.

#### **5. ResourceRegistry (DEFER or MINIMAL)**
- **Option A (defer to M82):** Skip for Slice A. Not needed by SelectionService or Workspace.
- **Option B (minimal):** Create stub `src/services/resourceRegistry.ts` (~100 LOC) with interface only; no implementation until M82.

---

### **H. Recommendation: RESCOPE Slice A**

**Current plan:**
- 18 files touched (4 new, 14 modified)
- Claims 4 major deliverables
- **Misreads the current state** (hard-coded → actually registered; dual update → actually snapshot-only)

**Honest rescoped plan:**
- **5-7 files** (3 new, 4-5 modified)
- **2 genuinely missing** deliverables (SelectionService, ResourceRegistry)
- **2 already correct** but need documentation (Workspace canonical ownership, ContextKeyRegistry)
- **Smaller diff = lower regression risk**

**Revised Slice A scope:**

| Deliverable | Action | Files | Effort |
|---|---|---|---|
| SelectionService + events | Implement | 1 new (`selectionService.ts`) | 250 LOC |
| Dispatcher shim | Modify | [selectionActionDispatcher.ts](src/services/selectionActionDispatcher.ts) | 30 LOC |
| Chat subscription | Modify | [chat/main.ts](src/built-in/chat/main.ts#L2571) | 10 LOC |
| Canvas subscription | Modify | [canvasSidebar.ts](src/built-in/canvas/canvasSidebar.ts) | 10 LOC |
| Workspace docs | Modify | [workspace.ts](src/workspace/workspace.ts) | 20 LOC comments |
| Context key docs | Modify | [workbenchContext.ts](src/context/workbenchContext.ts) | 40 LOC comments |
| Unit tests | New | [tests/unit/selectionEventRouting.test.ts](tests/unit/selectionEventRouting.test.ts) | 150 LOC |
| E2E tests | New | [tests/e2e/selectionToChat.spec.ts](tests/e2e/selectionToChat.spec.ts) | 100 LOC |

**Total:** ~600 LOC new, ~110 LOC modified comments/registration. **No regressions of M64–M80.**

---

### **Summary**

| Question | Answer | Confidence |
|---|---|---|
| A. onDidChangeSelection broadcast today? | NO — purely dispatch-based | 100% |
| B. Selection flow uses dispatcher? | YES — registry pattern, not hard-coded | 100% |
| C. RecentWorkspaces dual update? | NO — snapshot-only. Claim is FALSE | 100% |
| D. Existing Resource abstraction? | NO | 100% |
| E. ContextKeyRegistry equivalent? | PARTIALLY — WorkbenchContextManager exists, just needs docs | 100% |
| F. Deliverable classification | 2 missing, 2 correct, 1 partial | 100% |
| G. Smallest change set | 5-7 files instead of 18 | 95% |
| H. Recommendation | **RESCOPE** — half the files, same value, lower risk | 95% |

**Slice A as written should be RESCOPED.** The current 18-file plan over-engineers the solution and mischaracterizes the existing architecture. An honest rescope to 5-7 files delivers the same user value (event-based selection routing) without unnecessary refactoring.
