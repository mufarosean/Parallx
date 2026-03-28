# D4 Runtime Hooks — Parity Audit (M47 Iteration 1: Structural)

**Auditor:** AI Parity Auditor  
**Date:** 2026-03-28  
**Scope:** Runtime hooks for tool call lifecycle and message processing  
**Goal:** Extensible hook system for observing/intercepting tool executions and message processing in the AI runtime

**Key source files:**
- `src/services/chatRuntimeTypes.ts` — `IChatRuntimeToolInvocationObserver`, `IChatRuntimeAutonomyMirror`
- `src/openclaw/openclawAttempt.ts` — `executeOpenclawAttempt` tool execution loop
- `src/openclaw/openclawReadOnlyTurnRunner.ts` — readonly participant tool loop
- `src/openclaw/openclawTypes.ts` — participant service contracts
- `src/openclaw/openclawParticipantServices.ts` — service adapter builders
- `src/built-in/chat/main.ts` — claw runtime skill-aware tool invocation
- `src/services/languageModelToolsService.ts` — platform tool invocation with observer callbacks
- `src/built-in/chat/data/chatDataService.ts` — `invokeToolWithRuntimeControl` bridge

---

## Summary Matrix

| # | Capability | Classification | Evidence |
|---|-----------|---------------|----------|
| D4-1 | Tool Observer Wiring | ⚠️ PARTIAL | Interface + downstream handler exist; OpenClaw pipeline never passes observer |
| D4-2 | Before-Tool Hook | ⚠️ PARTIAL | `onValidated` fires in service layer; never triggered from OpenClaw |
| D4-3 | After-Tool Hook | ⚠️ PARTIAL | `onExecuted` fires in service layer; never triggered from OpenClaw |
| D4-4 | Hook Registration | ❌ MISSING | No registry, subscribe/unsubscribe, or dynamic registration mechanism |
| D4-5 | Message Hook | ❌ MISSING | No before/after model call hooks exist anywhere |
| D4-6 | Hook Composition | ⚠️ PARTIAL | Autonomy mirror's `downstream` param enables one layer; no general composition |
| D4-7 | Hook Error Isolation | ❌ MISSING | Observer callbacks use `?.` but no try/catch — throws crash the turn |
| D4-8 | Hook Integration with Participants | ⚠️ PARTIAL | Interfaces accept observer param; no participant actually passes one |

| Metric | Count |
|--------|-------|
| Capabilities audited | 8 |
| **ALIGNED** ✅ | 0 |
| **PARTIAL** ⚠️ | 5 |
| **MISSING** ❌ | 3 |

**Overall assessment:** Strong observer *interface* design exists but is completely unwired in the OpenClaw execution pipeline. The `IChatRuntimeToolInvocationObserver` interface with 4 lifecycle callbacks (`onValidated`, `onApprovalRequested`, `onApprovalResolved`, `onExecuted`) is well-designed and fully implemented in the downstream service layer (`languageModelToolsService.ts` and claw runtime's `invokeRuntimeToolWithSkillSupport`). However, the OpenClaw pipeline calls `invokeToolWithRuntimeControl` without passing the observer parameter (openclawAttempt.ts:307, openclawReadOnlyTurnRunner.ts:240). No hook registration mechanism, message-level hooks, general-purpose composition, or error isolation exists.

---

## Per-Capability Findings

### D4-1: Tool Observer Wiring
- **Classification:** ⚠️ PARTIAL
- **What exists:**
  - `IChatRuntimeToolInvocationObserver` interface at `src/services/chatRuntimeTypes.ts:174-179` with 4 lifecycle hooks: `onValidated`, `onApprovalRequested`, `onApprovalResolved`, `onExecuted`
  - `IOpenclawTurnContext.invokeToolWithRuntimeControl` at `src/openclaw/openclawAttempt.ts:120-125` accepts optional `observer` parameter as 4th argument
  - All three participant service interfaces (`IDefaultParticipantServices`, `IWorkspaceParticipantServices`, `ICanvasParticipantServices`) include `observer?: IChatRuntimeToolInvocationObserver` on `invokeToolWithRuntimeControl`
  - `languageModelToolsService.ts:210-280` fully implements all 4 observer callbacks during tool invocation
  - `main.ts:593-646` (claw runtime) fully calls all 4 observer callbacks in `invokeRuntimeToolWithSkillSupport`
- **What's broken:**
  - `openclawAttempt.ts:307-310`: calls `context.invokeToolWithRuntimeControl(toolCall.function.name, toolCall.function.arguments, token)` — **no observer passed** (4th arg omitted)
  - `openclawReadOnlyTurnRunner.ts:240`: calls `options.invokeToolWithRuntimeControl(toolName, toolCall.function.arguments, token)` — **no observer passed**
  - No site in the OpenClaw pipeline constructs or forwards an observer
- **Gap:** The plumbing to carry an observer through the call chain is in every interface, but the actual execution sites skip it. The downstream handlers are ready — only the call sites need the 4th argument.

### D4-2: Before-Tool Hook
- **Classification:** ⚠️ PARTIAL
- **What exists:**
  - `observer?.onValidated?.(metadata)` fires at `languageModelToolsService.ts:233` immediately after metadata construction, before permission checks and tool execution
  - `observer?.onValidated?.(metadata)` fires at `main.ts:617` in the claw runtime's skill-aware invocation path
  - The `metadata` object (`IChatRuntimeToolMetadata`) provides tool name, permission level, enabled state, approval requirements, and source — comprehensive context for a before-hook
- **What's broken:**
  - Since D4-1 shows no observer is passed from OpenClaw, `onValidated` never fires for OpenClaw tool calls
  - There is also no `onApprovalRequested` callback that fires during approval flow in OpenClaw (same unwired issue)
- **Gap:** Zero code changes needed in the service layer. Only the observer pass-through in D4-1 needs fixing.

### D4-3: After-Tool Hook
- **Classification:** ⚠️ PARTIAL
- **What exists:**
  - `observer?.onExecuted?.(metadata, result)` fires at `languageModelToolsService.ts:274` on success and at `:279` on error — result is always reported
  - `observer?.onExecuted?.(metadata, result)` fires at `main.ts:646` in the claw runtime
  - The `result` parameter is `IToolResult` containing `content: string` and `isError: boolean`
- **What's broken:**
  - Same as D4-2 — observer never passed from OpenClaw execution pipeline
- **Gap:** Same as D4-2 — fixing D4-1 wiring unblocks both D4-2 and D4-3.

### D4-4: Hook Registration
- **Classification:** ❌ MISSING
- **What exists:**
  - `IChatRuntimeAutonomyMirror.createToolObserver` at `chatRuntimeTypes.ts:215-219` creates observers for the autonomy system, but this is:
    - Scoped to autonomy tasks only
    - A factory method on a specific mirror instance, not a general registration API
    - Not discoverable or subscribable from external consumers
  - The observer is a parameter passed through the call chain — purely injection-based, no pub/sub or registry
- **What's needed:**
  - A `registerToolHook(hook)` / `deregisterToolHook(hook)` API on a service (e.g., a new `IRuntimeHookRegistry` or added to an existing service)
  - Enables observability, diagnostics, agent task tracking, and extension hooks to register without coupling to the call site
  - Could be event-emitter style, or a simple array of observers aggregated into a composite

### D4-5: Message Hook
- **Classification:** ❌ MISSING
- **What exists:**
  - Nothing. The model call in `executeModelStream` (called at `openclawAttempt.ts:266`) is a direct call with no hook points before or after
  - No `onBeforeModelCall`, `onAfterModelCall`, `onMessageSent`, `onMessageReceived` anywhere in the codebase
- **What's needed:**
  - Before-model hook: fires before `sendChatRequest` with the messages/options — enables logging, message injection, token budget observation
  - After-model hook: fires after model response with the result — enables response logging, quality metrics, observability
  - These would complement the token usage reporting already done via `response.reportTokenUsage`

### D4-6: Hook Composition
- **Classification:** ⚠️ PARTIAL
- **What exists:**
  - `IChatRuntimeAutonomyMirror.createToolObserver` at `chatRuntimeTypes.ts:215-219` accepts `downstream?: IChatRuntimeToolInvocationObserver` — this enables wrapping/chaining one observer around another
  - This is the right shape for composition — the autonomy observer can delegate to a downstream observer after its own processing
- **What's broken:**
  - Only one layer of composition is possible (autonomy→downstream)
  - No general purpose `composeObservers(...observers)` utility
  - No chain-of-responsibility pattern for N hooks
- **What's needed:**
  - A `composeToolObservers(observers: IChatRuntimeToolInvocationObserver[]): IChatRuntimeToolInvocationObserver` utility that fans out each callback to all registered observers
  - This pairs naturally with D4-4 (registration) — the registry returns a composite observer

### D4-7: Hook Error Isolation
- **Classification:** ❌ MISSING
- **What exists:**
  - Observer callbacks use optional chaining (`observer?.onValidated?.(metadata)`) so missing observers/callbacks don't crash
- **What's broken:**
  - No try/catch around any observer callback invocation in `languageModelToolsService.ts:233-279` or `main.ts:617-646`
  - If any observer callback throws, the exception propagates into the tool invocation flow and crashes the turn
  - Example: `observer?.onExecuted?.(metadata, result)` at `languageModelToolsService.ts:274` — a thrown error here would prevent the tool result from being returned to the model
- **What's needed:**
  - Wrap each observer callback in try/catch with `console.warn` (at minimum)
  - Or implement error isolation in the composition layer (D4-6): the composite observer catches per-hook errors

### D4-8: Hook Integration with Participants
- **Classification:** ⚠️ PARTIAL
- **What exists:**
  - All three participant service interfaces declare `observer?: IChatRuntimeToolInvocationObserver` on `invokeToolWithRuntimeControl`:
    - `IDefaultParticipantServices` at `openclawTypes.ts:196`
    - `IWorkspaceParticipantServices` at `openclawTypes.ts:295`
    - `ICanvasParticipantServices` at `openclawTypes.ts:335`
  - The service adapter builders (`openclawParticipantServices.ts`) pass through `invokeToolWithRuntimeControl` from deps, preserving the observer signature
  - `createAutonomyMirror` is available on `IDefaultParticipantServices` at `openclawTypes.ts:253`
- **What's broken:**
  - No participant handler actually constructs or passes an observer
  - The default participant `openclawAttempt.ts` execution path calls without observer
  - The readonly participants `openclawReadOnlyTurnRunner.ts` call without observer
  - No participant has opt-in logic for hook participation
- **What's needed:**
  - The participant or turn runner should construct an observer (either from the hook registry, autonomy mirror, or a composed set) and pass it to `invokeToolWithRuntimeControl`

---

## Dependency Graph

```
D4-4 (Hook Registration)     ← foundation — must exist before hooks can be consumed
  ↓
D4-6 (Hook Composition)      ← registry returns composite observer from N registered hooks
  ↓
D4-7 (Hook Error Isolation)  ← composite observer wraps each callback in try/catch
  ↓
D4-1 (Observer Wiring)       ← pass composite observer to invokeToolWithRuntimeControl calls
  ↓
D4-2 (Before-Tool Hook)      ← automatically works once D4-1 is wired
D4-3 (After-Tool Hook)       ← automatically works once D4-1 is wired
  ↓
D4-8 (Participant Integration) ← participants opt in / construct observer from registry
  ↓
D4-5 (Message Hook)          ← new hook points in executeModelStream (independent of tool observer)
```

## Recommended Implementation Order

| Priority | Capability | Effort | Rationale |
|----------|-----------|--------|-----------|
| 1 | D4-4: Hook Registration | Medium | Foundation — `IRuntimeHookRegistry` service with register/deregister |
| 2 | D4-6: Hook Composition | Small | `composeToolObservers()` utility + registry returns composite |
| 3 | D4-7: Hook Error Isolation | Small | try/catch in composite observer or at each call site |
| 4 | D4-1: Observer Wiring | Small | Add 4th argument to 2 call sites (openclawAttempt.ts:307, readOnlyTurnRunner.ts:240) |
| 5 | D4-2 + D4-3: Before/After Tool Hooks | Zero | Automatically work once D4-1 is wired — no new code needed |
| 6 | D4-8: Participant Integration | Small | Turn runner constructs observer from registry/mirror and passes it |
| 7 | D4-5: Message Hooks | Medium | New hook points in executeModelStream — new interface + call sites |

## Key Design Decision

The existing `IChatRuntimeToolInvocationObserver` interface is well-shaped and does not need modification. The implementation strategy should be:

1. **Registry service** (`IRuntimeHookRegistry`) that holds registered `IChatRuntimeToolInvocationObserver` instances
2. **Composite utility** that merges N observers into one, with error isolation per callback
3. **Wiring** at the turn runner level: before starting the tool loop, construct the composite observer from the registry + any participant-specific observer (e.g., autonomy mirror) and pass it through
4. **Message hooks** as a new parallel interface (`IChatRuntimeMessageObserver` with `onBeforeModelCall` / `onAfterModelCall`) following the same registry + composition pattern

This preserves backward compatibility — all existing call sites use `observer?` optional parameter, so adding the observer is additive with zero breakage risk.

---

## Iteration 2 — Refinement Audit (2026-03-28)

### Updated Summary Matrix

| # | Capability | Classification | Evidence |
|---|-----------|---------------|----------|
| D4-1 | Tool Observer Wiring | ✅ ALIGNED | Observer forwarded through all participant wrappers |
| D4-2 | Before-Tool Hook | ✅ ALIGNED | `onValidated` fires at both call sites |
| D4-3 | After-Tool Hook | ✅ ALIGNED | `onExecuted` fires at both call sites |
| D4-4 | Hook Registration | ✅ ALIGNED | `RuntimeHookRegistry` — register/deregister with IDisposable |
| D4-5 | Message Hook | ✅ ALIGNED | `onBeforeModelCall`/`onAfterModelCall` at both runners |
| D4-6 | Hook Composition | ✅ ALIGNED | Composite pattern via `getCompositeToolObserver()`/`getCompositeMessageObserver()` |
| D4-7 | Hook Error Isolation | ✅ ALIGNED | try/catch per callback + console.warn logging |
| D4-8 | Participant Integration | ✅ ALIGNED | All 3 participants wire registry through DI |

### Refinement Findings

| ID | Severity | Finding | Resolution |
|----|----------|---------|------------|
| R1 | **HIGH** | `invokeToolWithRuntimeControl` wrapper dropped 4th observer arg in default participant | Fixed — wrapper now forwards observer |
| R2 | LOW | `getComposite*()` creates new object per call | No action — intentionally uncached, delegates to live Set |
| R3 | MEDIUM | Readonly runner hardcodes tool metadata | Added INVARIANT comment documenting assumption |
| R4 | MEDIUM | Silent `catch { }` at call sites | Added `console.warn('[D4]...')` logging to all catch blocks |
| R5 | MEDIUM | Message `.map()` allocates twice per iteration | Reuse before-call snapshot for after-call hook; lazy allocation only when observer present |
| R6 | LOW | `IChatRuntimeMessageObserver` lacks `onError` | Deferred — no current consumer needs it |
| R7 | LOW | Missing test: dispose-then-getComposite | Deferred — trivially correct by design |
| R8 | LOW | Missing test: observer registration during iteration | Deferred — Set iteration semantics guarantee correctness |
| R9 | LOW | Readonly runner fires 2/4 hooks (no approval) | Added explanatory comment — intentional for readonly tools |
