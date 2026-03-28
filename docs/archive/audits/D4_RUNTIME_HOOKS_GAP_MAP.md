# D4 Runtime Hooks — Gap Map

**Source:** D4_RUNTIME_HOOKS_AUDIT.md  
**Date:** 2026-03-28

## Gaps by Priority

### P1 — Foundation (must exist before other gaps close)

| Gap | Capability | Current State | Target State | Files Affected |
|-----|-----------|--------------|-------------|----------------|
| G1 | D4-4: Hook Registration | No registry/subscribe/unsubscribe API | `IRuntimeHookRegistry` service with register/deregister for tool observers | New: `src/services/runtimeHookRegistry.ts` |
| G2 | D4-6: Hook Composition | Autonomy mirror has 1-layer `downstream` param | `composeToolObservers(observers[])` returns single composite observer | New: `src/services/runtimeHookComposition.ts` or inline in registry |
| G3 | D4-7: Hook Error Isolation | No try/catch around observer callbacks — throws crash turn | Each observer callback invocation wrapped in try/catch with console.warn | `src/services/runtimeHookComposition.ts` (composite layer) |

### P2 — Wiring (unblocks observer flow)

| Gap | Capability | Current State | Target State | Files Affected |
|-----|-----------|--------------|-------------|----------------|
| G4 | D4-1: Observer Wiring (OpenClaw) | `invokeToolWithRuntimeControl` called without observer at 2 call sites | Pass composite observer as 4th arg | `src/openclaw/openclawAttempt.ts:307`, `src/openclaw/openclawReadOnlyTurnRunner.ts:240` |
| G5 | D4-8: Participant Integration | No participant constructs/passes observer | Turn runner obtains observer from registry + optional autonomy mirror, passes through | `src/openclaw/openclawAttempt.ts` (turn context), `src/openclaw/openclawTurnRunner.ts` |

### P3 — Extension (new hook points)

| Gap | Capability | Current State | Target State | Files Affected |
|-----|-----------|--------------|-------------|----------------|
| G6 | D4-5: Message Hook | No before/after model call hooks | `IChatRuntimeMessageObserver` with `onBeforeModelCall`/`onAfterModelCall` | `src/services/chatRuntimeTypes.ts`, `src/openclaw/openclawAttempt.ts` (`executeModelStream` wrapper) |

### P0 — Already Working (no gap)

| Capability | Status | Notes |
|-----------|--------|-------|
| D4-2: Before-Tool Hook | ⚠️ Works in service layer | Automatically fires once G4 is closed |
| D4-3: After-Tool Hook | ⚠️ Works in service layer | Automatically fires once G4 is closed |

## Implementation Notes

- G1+G2+G3 can be implemented as a single `RuntimeHookRegistry` class that internally composes and isolates
- G4 is a 2-line change per call site (add observer as 4th arg to existing function call)
- G5 requires adding `observer` to `IOpenclawTurnContext` or having the turn runner resolve it from registry
- G6 is independent of G1-G5 and can be done in parallel or deferred to Iter 2

## Risk Assessment

- **Zero breakage risk** for G1-G5: all observer params are optional (`observer?`), adding them is purely additive
- **Low risk** for G6: message hooks require wrapping `executeModelStream` but don't change its semantics
- **No upstream behavioral change**: observer callbacks are fire-and-forget notifications
