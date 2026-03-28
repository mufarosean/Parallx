# Parallx OpenClaw Disentanglement Plan

**Status:** Implemented, transitive legacy coupling removed, and focused verification green on 2026-03-25  
**Date:** 2026-03-25  
**Purpose:** Remove all structural dependency between the legacy Parallx AI integration and the new OpenClaw-like AI system so the OpenClaw lane stands as an independently testable architecture.

---

## 1. Objective

Parallx currently contains two AI systems:

1. the legacy AI integration rooted under `src/built-in/chat/`, and
2. the new OpenClaw-like system rooted under `src/openclaw/`.

The target state is strict:

- the OpenClaw system must not import implementation logic from the legacy chat tree,
- the OpenClaw system must not be constructed or owned by legacy chat service-builder code,
- the OpenClaw system must expose its own structural boundaries clearly enough to be tested in isolation,
- the remaining legacy lane must survive only as an explicit comparison path.

This plan is complete only when OpenClaw can be described honestly as an independent implementation lane rather than a runtime shell wrapped around legacy chat internals.

---

## 2. Governing Principles

1. **Structural separation over convenience**  
   Any OpenClaw dependency on `src/built-in/chat/` is treated as design debt to remove, not as a tolerated shortcut.

2. **Preserve substrate, not orchestration**  
   Shared foundations such as model transport, retrieval, persistence, approval, and trace services may remain shared when they live outside the legacy chat tree. Legacy chat orchestration code is not shared substrate.

3. **One ownership boundary per system**  
   Legacy chat owns legacy participants. OpenClaw owns OpenClaw participants. Construction, helper stages, and tests must follow that ownership line.

4. **Compatibility must be explicit**  
   If a bridge remains, it must be named as a bridge. No hidden pass-through ownership from legacy into OpenClaw.

5. **Tests define truth**  
   Architectural independence is not accepted without structural gate tests and focused runtime verification.

---

## 3. Evidence Base

This disentanglement plan is grounded in the following repo artifacts and source files:

- `.github/AGENTS.md`
- `.github/instructions/parallx-instructions.instructions.md`
- `docs/Parallx_Milestone_40.md`
- `docs/clawrallx/PARALLX_OPENCLAW_REBUILD_DIRECTIVE.md`
- `docs/clawrallx/PARALLX_CLAW_DEPENDENCY_POLICY.md`
- `docs/clawrallx/PARALLX_CLAW_IMPLEMENTATION_TRACKER.md`
- `src/openclaw/participants/openclawDefaultParticipant.ts`
- `src/openclaw/participants/openclawWorkspaceParticipant.ts`
- `src/openclaw/participants/openclawCanvasParticipant.ts`
- `src/openclaw/participants/openclawParticipantRuntime.ts`
- `src/openclaw/participants/openclawContextReport.ts`
- `src/built-in/chat/chatTypes.ts`
- `src/built-in/chat/main.ts`
- `src/built-in/chat/data/chatDataService.ts`
- `tests/unit/chatGateCompliance.test.ts`
- `tests/unit/openclawDefaultParticipant.test.ts`
- `tests/unit/openclawParticipantRuntime.test.ts`
- `tests/unit/openclawScopedParticipants.test.ts`

---

## 4. Final Structural State

The migration now enforces the intended separation in these ways:

### 4.1 OpenClaw owns its runtime support path

`src/openclaw/openclawDefaultRuntimeSupport.ts` now owns the default-lane runtime support that was previously bridged through legacy chat utilities:

- slash-command parsing,
- `/init` and `/compact` handling,
- OpenClaw turn interpretation,
- OpenClaw context preparation,
- prompt-envelope assembly,
- deterministic fallback execution,
- grounded-answer repair,
- citation selection/footer behavior,
- runtime lifecycle and memory write-back coordination.

The legacy-backed `src/chatRuntime/openclawCompatibilityBackbone.ts` bridge was removed.

### 4.2 OpenClaw types and tests no longer anchor on the legacy hub

Focused OpenClaw tests now import service interfaces from `src/openclaw/openclawTypes.ts` instead of the legacy chat type hub.

### 4.3 OpenClaw service construction is no longer sourced from legacy builders

`src/built-in/chat/main.ts` now assembles OpenClaw service bundles through OpenClaw-owned builder functions instead of consuming `ChatDataService.build*ParticipantServices()` for the OpenClaw lane.

### 4.4 Reverse legacy-to-OpenClaw command coupling was removed

`src/built-in/chat/utilities/chatDefaultEarlyCommands.ts` no longer imports OpenClaw context-command code. The legacy lane now reports that `/context` diagnostics belong to the OpenClaw lane.

### 4.5 Separation is enforced at both direct and transitive levels

The repo now has:

- a direct import firewall: `tests/unit/openclawGateCompliance.test.ts`, and
- a transitive OpenClaw-owned/runtime-owned coupling gate: `tests/unit/openclawTransitiveCoupling.test.ts`.

---

## 5. Allowed Shared Substrate

The following remain valid shared dependencies because they are not legacy-chat-owned orchestration:

- `src/services/chatTypes.ts`
- `src/services/chatService.ts`
- `src/services/languageModelsService.ts`
- `src/services/retrievalService.ts`
- `src/services/chatSessionPersistence.ts`
- `src/services/serviceTypes.ts`
- `src/aiSettings/`
- `src/agent/`
- `src/platform/`

If OpenClaw needs shared runtime types or helpers that are currently trapped under `src/built-in/chat/`, they must be moved to:

- `src/openclaw/` when they are OpenClaw-owned, or
- a neutral non-legacy path when they are genuinely cross-runtime.

---

## 6. Forbidden Dependencies After This Migration

Once this migration is complete, the following must be true:

1. no file under `src/openclaw/` imports from `src/built-in/chat/`.
2. OpenClaw participants are created through OpenClaw-owned registration code.
3. OpenClaw service bundles are built through OpenClaw-owned builder code.
4. OpenClaw tests do not depend on legacy chat type hubs.
5. any remaining legacy/OpenClaw coexistence is expressed only through runtime selection and explicit comparison registration.

---

## 7. Execution Plan

### Step 1. Create the OpenClaw firewall

Add a dedicated structural test that fails if any file under `src/openclaw/` imports from `src/built-in/chat/`.

Reason:

- this turns separation into an enforceable invariant,
- it prevents another silent regression while the migration is in progress.

### Step 2. Move OpenClaw-owned types out of the legacy chat type hub

Create OpenClaw-owned type modules for:

- participant service interfaces used only by OpenClaw participants,
- OpenClaw bootstrap report types,
- OpenClaw system prompt report types,
- any OpenClaw runtime trace helpers that do not belong to the legacy lane.

Reason:

- type ownership is part of system ownership,
- a system that still depends on another system's type hub is not actually independent.

### Step 3. Move OpenClaw participant helpers under `src/openclaw/`

Relocate or recreate the helpers that OpenClaw currently imports from legacy chat utilities so that OpenClaw owns:

- its command entry logic,
- its prompt-envelope assembly,
- its context-stage preparation,
- its deterministic short-circuit logic,
- its answer repair chain,
- its runtime lifecycle helpers,
- its workspace document-list handling.

Reason:

- the OpenClaw lane must own the execution path before the first model turn,
- otherwise it is still architecturally downstream of legacy decisions.

### Step 4. Split OpenClaw service builders out of `chatDataService.ts`

Create OpenClaw-owned builder functions for:

- default OpenClaw participant services,
- workspace OpenClaw participant services,
- canvas OpenClaw participant services.

These builders may still consume shared services from the workbench, but they must not remain methods on the legacy chat data service.

### Step 5. Split OpenClaw registration out of legacy activation

Create an OpenClaw registration module that:

- creates OpenClaw participants,
- registers OpenClaw comparison surfaces,
- leaves legacy activation responsible only for the legacy lane and the runtime-selector hook-up.

### Step 6. Rewrite OpenClaw tests around the new ownership boundary

Update focused tests so they:

- import OpenClaw-owned interfaces and helpers,
- verify the firewall contract,
- continue to validate OpenClaw runtime behavior without importing legacy chat infrastructure.

### Step 7. Verify independence

Run focused unit and build verification proving:

- OpenClaw no longer imports from legacy chat,
- the OpenClaw participants still function,
- the repo still builds,
- the architectural contract is enforced by tests.

---

## 8. Validation Strategy

Minimum validation for this migration:

1. `npx vitest run tests/unit/openclawGateCompliance.test.ts`
2. `npx vitest run tests/unit/openclawParticipantRuntime.test.ts tests/unit/openclawDefaultParticipant.test.ts tests/unit/openclawScopedParticipants.test.ts`
3. `npx vitest run tests/unit/chatRuntimeSelector.test.ts`
4. `npm run build:renderer`

If any command is blocked or fails for reasons outside this migration, that blocker must be recorded in the milestone/tracker docs.

Executed verification on 2026-03-25:

1. `npx vitest run tests/unit/openclawGateCompliance.test.ts tests/unit/openclawTransitiveCoupling.test.ts tests/unit/openclawParticipantRuntime.test.ts tests/unit/openclawScopedParticipants.test.ts tests/unit/openclawDefaultParticipant.test.ts tests/unit/chatRuntimeSelector.test.ts`
   - result: `26/26` tests passed.
2. `npm run build:renderer`
   - result: passed.

---

## 9. Completion Criteria

This disentanglement effort is complete only when all of the following are true:

1. OpenClaw files do not import from `src/built-in/chat/`.
2. OpenClaw type ownership is no longer anchored in `src/built-in/chat/chatTypes.ts`.
3. OpenClaw service builders are no longer owned by `chatDataService.ts`.
4. OpenClaw registration is no longer implemented inline inside `src/built-in/chat/main.ts`.
5. an OpenClaw firewall test exists and passes.
6. the focused OpenClaw unit suite passes.
7. the milestone/tracker docs reflect the real final state.

Anything short of those seven conditions is still transitional, not complete.

Current repo-state note:

1. files under `src/openclaw/` no longer import from `src/built-in/chat/`,
2. OpenClaw-owned type, helper, builder, registration, and runtime-support modules now exist under `src/openclaw/`,
3. the legacy-backed OpenClaw compatibility backbone has been removed,
4. the legacy chat activation path now assembles OpenClaw services through OpenClaw-owned builders instead of `ChatDataService.build*ParticipantServices()`,
5. the legacy claw early-command path no longer imports OpenClaw context-command code,
6. the direct and transitive OpenClaw separation tests pass, and
7. the focused OpenClaw participant/runtime suite and renderer build are green.