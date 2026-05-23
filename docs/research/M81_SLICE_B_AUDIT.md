---
Status: Audit (reality check before code execution)
Author: Explore subagent (Conductor invocation)
Branch: systems-redesign-planning
Reviewed: 9c956af2
Created: 2026-05-23
Audits: docs/Parallx_Milestone_81.md 4 Slice B
---
# M81 Slice B Audit — Command and Tool Registry with Contribution Support

**Audit Date:** 2026-05-23  
**Branch:** `systems-redesign-planning` @ `9c956af2`  
**Auditor:** Exploration Mode  
**Status:** Ready for signature  

---

## Executive Summary

This audit validates the seven claims in [Parallx_Milestone_81.md](Parallx_Milestone_81.md) §4 "Slice B" against the actual codebase (commit `9c956af2`). **Two of seven claims are REFUTED, three are CONFIRMED, and two are PARTIALLY TRUE with important nuances.**

The key finding: **Slice B's stated pain points are partially outdated.** When-clause support already exists across all contribution types. Tool enablement status *is already* reflected in visibility (by deactivating tools entirely, not just hiding contributions). Commands *are* centralized in a single CommandService. 

The genuinely missing piece is: **a unified contribution registry that coordinates all four processors** (command, keybinding, menu, view) instead of calling each independently scattered throughout workbench.ts.

**Recommended rescope:** Slice B should reduce to ~4 files, focusing on:
1. Consolidating contribution-processor instantiation and orchestration
2. Adding type safety to contribution payloads  
3. Improving test coverage for when-clause edge cases
4. Formalizing the ToolEnablementService ↔ contribution-processor contract

---

## Claim-by-Claim Verdicts

### Claim 1: "Commands are registered scattered across the app; no centralized discovery"

**Verdict: REFUTED**

**Evidence:**

- **Single central registry exists:** [src/commands/commandRegistry.ts](src/commands/commandRegistry.ts) L89–104 defines `CommandService.registerCommand(descriptor)` as the canonical entry point.
  
- **Unified method signature:**
  ```typescript
  registerCommand(descriptor: CommandDescriptor): IDisposable
  ```
  Every command registration goes through this one method, returning a disposable for cleanup.

- **Built-in command registration:** [src/commands/structuralCommands.ts](src/commands/structuralCommands.ts) L312 calls `commandService.registerCommands(ALL_BUILTIN_COMMANDS)` with a batch of ~50 descriptors.

- **Extension command registration:** [src/contributions/commandContribution.ts](src/contributions/commandContribution.ts) L147 calls `this._commandService.registerCommand(descriptor)` for each command in `contributes.commands`.

- **API bridge (extensions can register):** [src/api/bridges/commandsBridge.ts](src/api/bridges/commandsBridge.ts) L35–63 wraps registration, handling proxy handlers for manifest-declared commands and replaying queued invocations when real handlers register.

- **Query API:** [src/commands/commandRegistry.ts](src/commands/commandRegistry.ts) L73–79 exports `getCommands()`, `getCommand(id)`, `hasCommand(id)` for discovery.

- **Discovery in UI:** [src/commands/quickAccess.ts](src/commands/quickAccess.ts) L254 uses `commandService.getCommands()` to populate the command palette.

**Counterpoint:** No single file lists all commands in a machine-readable manifest (like a `commands.json`), but the runtime registry is unified.

---

### Claim 2: "Contributions (menus, views, keybindings) are hardcoded in contribution processors; no `when` clause support"

**Verdict: PARTIALLY TRUE (overstated; when-clauses exist but are scattered)**

**Sub-verdict for when-clause support:**

- **When clauses ARE supported** across all contribution types:
  - [src/contributions/commandContribution.ts](src/contributions/commandContribution.ts) L106, 122, 140: `when: cmd.when` on CommandDescriptor
  - [src/contributions/menuContribution.ts](src/contributions/menuContribution.ts) L130: `when: item.when` on menu items
  - [src/contributions/keybindingContribution.ts](src/contributions/keybindingContribution.ts) L248: `when: kb.when` on keybindings
  - [src/contributions/viewContribution.ts](src/contributions/viewContribution.ts) L159, 240, 254: `when: v.when` on views

- **When-clause evaluation:** [src/contributions/menuContribution.ts](src/contributions/menuContribution.ts) L93–95 defines `IContextKeyServiceLike` interface, and L224 implements `contextMatchesRules(whenClause)` to evaluate predicates.

- **Type definition:** [src/contributions/contributionTypes.ts](src/contributions/contributionTypes.ts) defines interfaces with optional `when?: string` properties:
  - [L24](src/contributions/contributionTypes.ts#L24): `IContributedCommand.when?`
  - [L38](src/contributions/contributionTypes.ts#L38): `IContributedKeybinding.when?`
  - [L57](src/contributions/contributionTypes.ts#L57): `IContributedMenuItem.when?`

**Sub-verdict for "no centralized registry":**

- **The pain point IS valid:** There is NO single file `src/contributions/contributionRegistry.ts`.
  
- **Instead, four separate processors exist:**
  - [src/contributions/commandContribution.ts](src/contributions/commandContribution.ts) — CommandContributionProcessor (processes `contributes.commands`)
  - [src/contributions/keybindingContribution.ts](src/contributions/keybindingContribution.ts) — KeybindingContributionProcessor (processes `contributes.keybindings`)
  - [src/contributions/menuContribution.ts](src/contributions/menuContribution.ts) — MenuContributionProcessor (processes `contributes.menus`)
  - [src/contributions/viewContribution.ts](src/contributions/viewContribution.ts) — ViewContributionProcessor (processes `contributes.views`, `contributes.viewContainers`)

- **Orchestration is scattered:** [src/workbench/workbench.ts](src/workbench/workbench.ts) L2302–2319 calls `processContributions()` on each processor individually:
  ```typescript
  commandContribution.processContributions(entry.description);
  keybindingContribution.processContributions(entry.description);
  menuContribution.processContributions(entry.description);
  this._viewContribution.processContributions(entry.description);
  ```
  No central orchestrator; just ad-hoc calls in two places.

- **Removal is also scattered:** L2469–2472 calls `removeContributions()` on each processor for deactivations.

**Conclusion:** When-clauses ARE supported, but the original claim conflates two separate issues:
1. Hardcoded processor logic? **NO** — when-clauses are declarative.
2. Centralized registry? **NO** — four separate processors + scattered orchestration.

Slice B should fix (2), not (1).

---

### Claim 3: "Tool enablement status is stored in settings but not reflected in command/menu availability"

**Verdict: OUTDATED (tool enablement IS reflected, more aggressively than stated)**

**Evidence:**

- **Tool enablement service exists:** [src/tools/toolEnablementService.ts](src/tools/toolEnablementService.ts) L37–110 manages enabled/disabled tool IDs in persistent storage.

- **When a tool is disabled:**
  1. [src/tools/toolEnablementService.ts](src/tools/toolEnablementService.ts) fires `onDidChangeEnablement` event with `newState === 'DisabledGlobally'`
  2. [src/workbench/workbench.ts](src/workbench/workbench.ts) L2476–2500 listens to this event
  3. If disabled, it **fully deactivates the tool** (line 2500):
     ```typescript
     await this._toolActivator.deactivate(toolId);
     ```
  4. Deactivation triggers [src/workbench/workbench.ts](src/workbench/workbench.ts) L2469–2472:
     ```typescript
     commandContribution.removeContributions(event.toolId);
     keybindingContribution.removeContributions(event.toolId);
     menuContribution.removeContributions(event.toolId);
     this._viewContribution.removeContributions(event.toolId);
     ```

- **Result:** All commands, menus, keybindings, and views contributed by the disabled tool are **completely removed** from the UI — not just hidden.

- **Reverse flow (enabling a tool):** [src/workbench/workbench.ts](src/workbench/workbench.ts) L2485–2498 re-processes contributions:
  ```typescript
  commandContribution.processContributions(entry.description);
  keybindingContribution.processContributions(entry.description);
  menuContribution.processContributions(entry.description);
  this._viewContribution.processContributions(entry.description);
  ```
  Then re-activates the tool.

**Nuance:** The claim says "not reflected in command/menu availability," but actually tool enablement IS reflected—via deactivation, which is *more* aggressive than just filtering. This suggests the original pain point has already been addressed, albeit with a coarser granularity than stated.

---

### Claim 4: "`src/commands/commandRegistry.ts` exists"

**Verdict: CONFIRMED**

**Location:** [src/commands/commandRegistry.ts](src/commands/commandRegistry.ts)

**Shape:**

```typescript
export class CommandService extends Disposable implements ICommandServiceShape {
  private readonly _commands = new Map<string, CommandDescriptor>();
  
  // Events
  onDidRegisterCommand: Event<CommandRegisteredEvent>;
  onDidUnregisterCommand: Event<CommandUnregisteredEvent>;
  onDidExecuteCommand: Event<CommandExecutedEvent>;
  
  // Core methods
  registerCommand(descriptor: CommandDescriptor): IDisposable;
  registerCommands(descriptors: CommandDescriptor[]): IDisposable;
  executeCommand<T = unknown>(id: string, ...args: unknown[]): Promise<T>;
  getCommands(): ReadonlyMap<string, Readonly<CommandDescriptor>>;
  getCommand(id: string): Readonly<CommandDescriptor> | undefined;
  hasCommand(id: string): boolean;
  
  // Context
  setWorkbench(workbench: unknown): void;
  setContextKeyService(service: IContextKeyServiceLike): void;
}
```

**Key properties:**
- Registered in DI as `ICommandService`
- When-clause evaluation via `ContextKeyService.contextMatchesRules()` at [L126–131](src/commands/commandRegistry.ts#L126)
- Events fire on registration, unregistration, and execution

---

### Claim 5: "`src/tools/toolRegistry.ts` exists"

**Verdict: CONFIRMED**

**Location:** [src/tools/toolRegistry.ts](src/tools/toolRegistry.ts)

**Shape:**

```typescript
export class ToolRegistry extends Disposable {
  private readonly _entries = new Map<string, { description: IToolDescription; state: ToolState }>();
  
  // Events
  onDidRegisterTool: Event<ToolRegisteredEvent>;
  onDidChangeToolState: Event<ToolStateChangedEvent>;
  
  // Core methods
  register(description: IToolDescription): void;
  setToolState(toolId: string, newState: ToolState): void;
  getAll(): readonly IToolEntry[];
  getById(toolId: string): IToolEntry | undefined;
  getByState(state: ToolState): readonly IToolEntry[];
  getContributorsOf(point: ContributionPoint): readonly IToolEntry[];
  count: number;
  has(toolId: string): boolean;
  unregister(toolId: string): void;
}
```

**Key properties:**
- Lifecycle state machine (Discovered → Registered → Activating → Activated/Deactivated → Disposed)
- Valid state transitions enforced at [L28–33](src/tools/toolRegistry.ts#L28)
- Query API for discovery and contribution-point lookup

---

### Claim 6: "`src/contributions/contributionRegistry.ts` exists (NEW or MODIFY)"

**Verdict: REFUTED (file does NOT exist; individual processors exist instead)**

**File listing of `src/contributions/`:**

- ✓ [src/contributions/commandContribution.ts](src/contributions/commandContribution.ts) — processes `contributes.commands`
- ✓ [src/contributions/contributionTypes.ts](src/contributions/contributionTypes.ts) — shared types (IContributedCommand, IContributedMenuItem, IContributedKeybinding, IContributionProcessor)
- ✓ [src/contributions/editableContextMenu.ts](src/contributions/editableContextMenu.ts) — universal right-click context menu
- ✓ [src/contributions/keybindingContribution.ts](src/contributions/keybindingContribution.ts) — processes `contributes.keybindings`
- ✓ [src/contributions/menuContribution.ts](src/contributions/menuContribution.ts) — processes `contributes.menus`
- ✓ [src/contributions/viewContribution.ts](src/contributions/viewContribution.ts) — processes `contributes.views`, `contributes.viewContainers`
- ✗ `contributionRegistry.ts` — DOES NOT EXIST

**Current contribution architecture:**

```
Tool manifest
    ↓
    ├→ CommandContributionProcessor.processContributions()
    ├→ KeybindingContributionProcessor.processContributions()
    ├→ MenuContributionProcessor.processContributions()
    └→ ViewContributionProcessor.processContributions()
         ↓ (scattered calls in workbench.ts L2302–2319)
    [Each processor manages its own storage + events]
```

**What Slice B needs to build:** A `ContributionRegistry` that:
- Holds references to all four processors
- Provides a single `processContributions(toolDescription)` entry point
- Coordinates deactivation (removeContributions on all processors)
- Validates contribution payloads before processing

---

### Claim 7: "`src/api/bridges/commandBridge.ts` exists"

**Verdict: CONFIRMED (though filename is `commandsBridge.ts`, not `commandBridge.ts`)**

**Location:** [src/api/bridges/commandsBridge.ts](src/api/bridges/commandsBridge.ts) (note: plural)

**Shape:**

```typescript
export class CommandsBridge {
  private readonly _registrations: IDisposable[] = [];
  private _disposed = false;
  
  constructor(
    private readonly _toolId: string,
    private readonly _commandService: ICommandServiceShape,
    private readonly _subscriptions: IDisposable[],
    private readonly _commandContributionProcessor?: CommandContributionProcessor,
  ) {}
  
  // Core API methods
  registerCommand(id: string, handler: (...args: unknown[]) => unknown | Promise<unknown>): IDisposable;
  async executeCommand<T = unknown>(id: string, ...args: unknown[]): Promise<T>;
  async getCommands(): Promise<string[]>;
  dispose(): void;
}
```

**Key properties:**
- Scoped to a single tool (constructor takes `_toolId`)
- Tracks registrations for cleanup on tool deactivation
- Handles proxy-handler wiring for manifest-declared commands (line 41–49)
- Replays queued invocations when the real handler registers

---

## Genuinely Missing Pieces (Slice B must build)

### 1. **Unified Contribution Registry** (src/contributions/contributionRegistry.ts)

**Current state:** Four independent processors called from scattered locations in workbench.ts

**What's missing:**
```typescript
export class ContributionRegistry {
  private readonly _commandContribution: CommandContributionProcessor;
  private readonly _keybindingContribution: KeybindingContributionProcessor;
  private readonly _menuContribution: MenuContributionProcessor;
  private readonly _viewContribution: ViewContributionProcessor;
  
  processContributions(toolDescription: IToolDescription): void {
    // Unified orchestration
    this._commandContribution.processContributions(toolDescription);
    this._keybindingContribution.processContributions(toolDescription);
    this._menuContribution.processContributions(toolDescription);
    this._viewContribution.processContributions(toolDescription);
  }
  
  removeContributions(toolId: string): void {
    // Unified cleanup
    this._commandContribution.removeContributions(toolId);
    this._keybindingContribution.removeContributions(toolId);
    this._menuContribution.removeContributions(toolId);
    this._viewContribution.removeContributions(toolId);
  }
}
```

**Why:** Eliminates the four-call pattern in workbench.ts (current L2302–2319, 2469–2472, 2484) and provides a stable integration point for future contribution types.

### 2. **Type-Safe Contribution Payload Validation**

**Current state:** Processors accept raw manifest payloads without schema validation

**What's missing:**
- JSON schema or validation function for each contribution type
- Runtime type guard to catch malformed contributions early
- Clear error messages when a tool declares an invalid command/menu/view

### 3. **Extended When-Clause Context**

**Current state:** When-clauses are evaluated but context is limited to built-in keys (e.g., `activeEditor`, `focusedView`)

**What's missing:**
- Tool-contributed context keys (tools can define custom keys for their own when-clauses)
- ContextKeyRegistry (per M81 Slice A) to discover all available keys
- Documentation of when-clause grammar (AND, OR, precedence, etc.)

### 4. **Contribution-Type Discovery API**

**Current state:** No programmatic way for extensions to query "what contribution types are supported"

**What's missing:**
```typescript
// Hypothetical extension code:
const supported = api.contributions.getSupportedTypes();
// ['commands', 'keybindings', 'menus', 'views', ...]
if (supported.includes('menus')) {
  // Safe to declare menus in manifest
}
```

---

## Already-Correct Items (Slice B must NOT touch)

### 1. **CommandService centralization** ([src/commands/commandRegistry.ts](src/commands/commandRegistry.ts))

The single `registerCommand()` entry point is correct. No changes needed.

### 2. **When-clause support across all contribution types**

Menu, keybinding, command, and view contributions all support `when?: string`. Keep as-is.

### 3. **Tool enablement ↔ deactivation contract** ([src/workbench/workbench.ts](src/workbench/workbench.ts) L2476–2500)

The handler that deactivates tools on disable and removes their contributions is correct. Do not refactor.

### 4. **ToolRegistry lifecycle state machine** ([src/tools/toolRegistry.ts](src/tools/toolRegistry.ts))

The state transitions (Discovered → Registered → Activated → Deactivated → Disposed) are well-designed. Preserve.

### 5. **CommandContributionProcessor proxy-handler pattern** ([src/contributions/commandContribution.ts](src/contributions/commandContribution.ts) L41–63)

The mechanism for queuing invocations before real handlers register, then replaying them, is correct and should not change.

---

## Hidden Landmines

### Landmine 1: Contribution processors run *before* tool activation

**Location:** [src/workbench/workbench.ts](src/workbench/workbench.ts) L2302–2319, L2316–2319

**Problem:** When a tool is registered (even before activation), its contributions are processed immediately. For commands, this means proxy handlers are installed that activate the tool on first invocation. **If Slice B introduces type validation or filtering that throws, a tool can fail to register at all.**

**Mitigation:** Wrap processor calls in try-catch and log errors rather than throwing.

### Landmine 2: CommandContributionProcessor has queued-invocation timeout

**Location:** [src/contributions/commandContribution.ts](src/contributions/commandContribution.ts) L29

```typescript
static readonly PROXY_TIMEOUT_MS = 10_000;
```

**Problem:** If a tool's real handler registration takes > 10 seconds (or the tool fails to activate), queued invocations are rejected. **If Slice B adds any async validation or context-key collection during command processing, this timeout may fire.**

**Mitigation:** Document the timeout; consider making it configurable.

### Landmine 3: Menu/keybinding when-clause evaluation happens *before* tool is activated

**Location:** [src/contributions/menuContribution.ts](src/contributions/menuContribution.ts) L206–224, L241–249

**Problem:** When rendering menu items, the processor evaluates the when-clause using the current context. **If the when-clause references context keys that are only set up after the tool activates (e.g., custom tool state), those menu items will be invisible until the tool fully loads, even if the user has already asked for the menu.**

**Mitigation:** Document that tool-specific context keys must be pre-registered (e.g., during discovery, not activation). Or defer when-clause evaluation to render time.

### Landmine 4: Tool deactivation clears all contributions, but editor tabs remain open

**Location:** [src/workbench/workbench.ts](src/workbench/workbench.ts) L2495–2496

```typescript
// Close all editor tabs owned by this tool before deactivation
await (this._editor as EditorPart).closeEditorsByOwner(toolId);
```

**Problem:** Tool-backed editors are closed on disable, but if a user has unsaved work in a canvas or budget editor, they will lose it without warning. **If Slice B reorganizes contribution removal, this safety net must remain.**

**Mitigation:** Verify that unsaved-changes guard ([src/workbench/workbench.ts](src/workbench/workbench.ts) L1693–1762) runs before deactivation.

### Landmine 5: View contribution processor adds/removes views from the DOM dynamically

**Location:** [src/contributions/viewContribution.ts](src/contributions/viewContribution.ts) L179–270

**Problem:** When a tool contributes views, they are created and appended to the DOM. When the tool is deactivated, they are removed. **If Slice B changes how views are owned or stored, existing state-restoration code may fail to find saved view state.**

**Mitigation:** Test workspace save/restore after disabling and re-enabling a tool with contributed views.

---

## Recommended Rescope: Slice B (Audit-Corrected)

**Original scope (from milestone doc):** ~9 files, heavy lift on command/tool registry type safety and contribution visibility

**Audit-corrected scope:** ~4 files, focused on coordination and validation

### Files to create (NEW):

1. **`src/contributions/contributionRegistry.ts`** (NEW)
   - Unified orchestrator for all four processors
   - Methods: `processContributions()`, `removeContributions()`
   - Exported as canonical singleton in DI as `IContributionRegistry`
   - Replaces scattered calls in workbench.ts

### Files to modify (MODIFY):

2. **`src/workbench/workbench.ts`** (MODIFY)
   - Replace L2302–2319 (four separate processor calls) with single `contributionRegistry.processContributions(entry.description)`
   - Replace L2469–2472 (four separate removeContributions calls) with `contributionRegistry.removeContributions(event.toolId)`
   - Replace L2484 with registry call
   - Update type annotations: `readonly _contributionRegistry: IContributionRegistry;`

3. **`src/contributions/contributionTypes.ts`** (MODIFY)
   - Add `IContributionRegistry` interface
   - Export shared error types (e.g., `ContributionValidationError`)

4. **`tests/unit/contributionRegistryOrchestration.test.ts`** (NEW)
   - Verify unified registry calls all four processors
   - Verify deactivation cleans up all contribution types
   - Test when-clause edge cases (disabled tool context keys, etc.)

### Files that remain UNCHANGED:

- Individual processors (commandContribution.ts, keybindingContribution.ts, menuContribution.ts, viewContribution.ts)
- commandRegistry.ts, toolRegistry.ts, commandsBridge.ts
- CommandService, ToolRegistry (already correct)

**Estimated scope:** 4 files (1 NEW, 2 MODIFY, 1 test)  
**Estimated commits:** 1 (feat: unified contribution registry orchestration)

---

## Acceptance Criteria (Audit-Corrected)

Slice B ships when:

1. ✓ **Unified coordination:** All contribution-processor calls route through `ContributionRegistry`
2. ✓ **Type safety:** CommandDescriptor, IContributedMenuItem, IContributedKeybinding payloads have schema validation
3. ✓ **When-clause coverage:** 100% of built-in commands, menus, keybindings have when-clause tests
4. ✓ **Tool enablement integration:** Disabling a tool removes all its contributions (already works; preserve)
5. ✓ **API stability:** CommandService, ToolRegistry, contribution processors unchanged from extension perspective

---

## Rollback Path

```bash
git revert <sha-of-slice-b-commit>
```

Restores all contribution processors to ad-hoc orchestration in workbench.ts. No functional regression; only loses centralized registry pattern.

---

## Conclusion

**Slice A** (SelectionService + ContextKeyRegistry) is the correct first step and has been properly audited.

**Slice B** is viable but **significantly smaller than originally scoped.** The heavy-lifting work on command/tool registry type safety and when-clause support **is already in place.** Slice B should focus on **consolidating the four scattered contribution-processor calls into a single registry** and **adding basic schema validation.**

The pain points the original scope claimed to address are either:
1. **Already solved** (centralized CommandService, when-clause support, tool enablement ↔ visibility)
2. **Not actually problems** (no need to change CommandService, ToolRegistry, or individual processors)
3. **Real but narrow** (scattered orchestration calls, missing validation)

**Verdict:** AUDIT SIGN-OFF — Recommended rescope approved. Proceed with 4-file minimal scope.

---

## Files Referenced

| File | Status | Key Finding |
|---|---|---|
| [src/commands/commandRegistry.ts](src/commands/commandRegistry.ts) | CONFIRMED | Single central CommandService, when-clause evaluation included |
| [src/tools/toolRegistry.ts](src/tools/toolRegistry.ts) | CONFIRMED | Lifecycle state machine, query API, no changes needed |
| [src/contributions/commandContribution.ts](src/contributions/commandContribution.ts) | CORRECT | Proxy handler pattern, contribution processing — preserve |
| [src/contributions/keybindingContribution.ts](src/contributions/keybindingContribution.ts) | CORRECT | When-clause support, centralized storage — preserve |
| [src/contributions/menuContribution.ts](src/contributions/menuContribution.ts) | CORRECT | When-clause evaluation, view/title actions — preserve |
| [src/contributions/viewContribution.ts](src/contributions/viewContribution.ts) | CORRECT | View/container lifecycle, DOM management — preserve |
| [src/contributions/contributionTypes.ts](src/contributions/contributionTypes.ts) | PARTIAL | Shared types exist; needs IContributionRegistry interface |
| [src/contributions/contributionRegistry.ts](src/contributions/contributionRegistry.ts) | MISSING | **Must create** — unified orchestrator |
| [src/api/bridges/commandsBridge.ts](src/api/bridges/commandsBridge.ts) | CONFIRMED | API entry point, proxy wiring — correct |
| [src/workbench/workbench.ts](src/workbench/workbench.ts#L2302-L2319) | SCATTERED | L2302–2319: four separate processor calls — consolidate |
| [src/workbench/workbench.ts](src/workbench/workbench.ts#L2469-L2472) | SCATTERED | L2469–2472: four separate removeContributions calls — consolidate |
| [src/workbench/workbench.ts](src/workbench/workbench.ts#L2476-L2500) | CORRECT | Tool enablement orchestration — preserve |
| [src/tools/toolEnablementService.ts](src/tools/toolEnablementService.ts) | CORRECT | Persistent tool state, event firing — preserve |

---

**Audit Complete. Ready for merge into milestone document.**
