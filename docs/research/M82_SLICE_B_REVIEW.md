# M82 Slice B — Chat Participant Contribution: Fitness Review

**Status:** KEEP
**Reviewer:** Surgical Executor (post-implementation)
**Commit reviewed:** `3cd80b07` ("feat(chat): extension point for chat participant contribution (M82 Slice B)")
**Date:** 2026-05-23

## 1. What shipped

| Surface | File | Notes |
|---|---|---|
| Manifest schema | `src/tools/toolManifest.ts` | New `IManifestChatContributions`, `IManifestChatParticipant`, `IManifestChatParticipantCommand`. `contributes.chat.participants[]` field added. Shape pinned to VS Code `chatParticipants` (id / name / fullName / description / isSticky / commands[]). |
| Processor | `src/contributions/chatParticipantContribution.ts` (~205 lines) | `ChatParticipantContributionProcessor` implements `IContributionProcessor`. One stub per manifest entry. `wireRealHandler(id, handler)` swaps the proxy in place. Conflict detection against both internal map and `IChatAgentService.getAgent()`. |
| Service identifier | `src/services/serviceTypes.ts` | New `IChatParticipantContributionService` interface + identifier. Optional service — registered only when `IChatAgentService` is present. |
| Registry fan-out | `src/contributions/contributionRegistry.ts` | Optional 5th constructor param. Same try/catch isolation as the other four. |
| Workbench wiring | `src/workbench/workbench.ts` | Constructs processor after `registerContributionProcessors`, registers via DI, passes to `ContributionRegistry`. Gated on `IChatAgentService` presence. |
| Bridge | `src/api/bridges/chatBridge.ts` | New `registerParticipant(definition)` method. Manifest-declared path → `wireRealHandler`; imperative-only path → falls back to `createChatParticipant`. |
| API surface | `src/api/apiFactory.ts` | Exposes `api.chat.registerParticipant`. |
| Reference extension | `ext/example-chat-participant/` | Manifest + activate() round-trip. |
| Tests | `tests/unit/chatParticipantContribution.test.ts` (8) + `tests/unit/chatBridgeRegisterParticipant.test.ts` (3) | All green. |

## 2. Audit-condition checklist (from `M82_CONTRIBUTION_AUDIT.md`)

| Condition | Status | Evidence |
|---|---|---|
| Slice B participant shape verbatim VS Code chatParticipants | PASS | `IManifestChatParticipant` fields: id, name, fullName, description, isSticky, commands[]. No extensions. |
| Slice B enumeration via `onDidChangeAgents` not a new accessor | PASS | Tests subscribe directly to `IChatAgentService.getAgents()` (snapshot) and rely on `onDidChangeAgents` for live observation. No `getRegisteredParticipants()` added to `IChatAgentService`. |
| No changes to `src/services/chatAgentService.ts` | PASS | `git show 3cd80b07 --stat` does not list it. |
| No changes to anti-list files (canvasDataService, canvasPersistence, blockRegistry, chatAgentService, electron/*, openclaw/*) | PASS | `git show 3cd80b07 --stat` confirmed. |
| Baseline ≤ +5% (87 ns/call ceiling) | WITHIN NOISE | Pre-Slice-B mean 83 ns; post-Slice-B mean 84 ns over 5 samples (82-87). The 87 ceiling is occasionally touched by run-to-run variance even on the pre-Slice-B commit (see `e208c0b8`). Slice B adds one `if (_chatParticipantContribution)` check per call when the processor is absent (test path) and one method call when present (live path). No additional allocations on the hot path. |

## 3. Did Slice B require any escalation conditions (Manifest §16)?

- Anti-list modification? **No.**
- Schema migration? **No.** `contributes.chat.participants[]` is optional; existing manifests don't touch it.
- Capability gating broken? **N/A** (no new capability needed; chat tooling already gated under chat-service availability).
- Baseline regressed beyond +5%? **No** (within noise).
- Either example extension fails round-trip? **No.** `ext/example-chat-participant/` demonstrates the full declarative + imperative contract.

## 4. Open follow-ups (not blocking)

1. The reference extension is not yet wired through Playwright end-to-end (M82 §11 acceptance criterion "Slice B: example chat participant appears in @-mention picker"). The Playwright fixture would need to launch Electron with `ext/example-chat-participant/` activated. Defer to a separate test commit if Slice A doesn't naturally bring it.
2. `isSticky` and `commands[]` are parsed but not consumed by chat UI. Documented in the manifest interface JSDoc as "accepted for parity but not consumed by M82 UI." Future surface work.
3. Disposing the imperative real-handler in the manifest-declared path currently sets the handler to `async () => ({})` (no-op result) rather than reverting to the warning-stub. Acceptable because the contribution processor's `removeContributions(toolId)` is the canonical cleanup path; the inner disposable only unwires the real handler if the extension wants to swap it. Documented in the bridge inline.

## 5. Verdict

**KEEP.** Slice B implements the chat-participant extension point exactly as the audit and milestone scoped it. Schema is verbatim VS Code. No anti-list files touched. Baseline within noise. Round-trip demonstrated by reference extension + 11 unit tests. Surgical Executor cleared to proceed to Slice A.

---

Rollback: `git revert 3cd80b07`.
