# W1 — FollowupRunner Wiring: Audit

**Date:** 2026-04-22
**Domain:** W1 (M58)
**Module:** `src/openclaw/openclawFollowupRunner.ts` (dead — zero production imports)
**Upstream target:** `github.com/openclaw/openclaw` — `src/auto-reply/reply/followup-runner.ts`
**M46 baseline:** commit `e635cedb` — 8/8 ALIGNED (`docs/archive/audits/D1_FOLLOWUP_RUNNER_TRACKER.md`)
**Auditor:** AI Parity Auditor (re-audit driven by Parity Orchestrator)

---

## 1. Re-audit vs current upstream head

Upstream `followup-runner.ts` has evolved significantly since `e635cedb`. The
signature is now:

```ts
export function createFollowupRunner(params: {
  opts?: GetReplyOptions;
  typing: TypingController;
  typingMode: TypingMode;
  sessionEntry?: SessionEntry;
  sessionStore?: Record<string, SessionEntry>;
  sessionKey?: string;
  storePath?: string;
  defaultModel: string;
  agentCfgContextTokens?: number;
}): (queued: FollowupRun) => Promise<void>
```
(upstream lines 37–412)

### What changed upstream since `e635cedb`

| # | Change upstream | Applies to Parallx? | Disposition |
|---|-----------------|---------------------|-------------|
| 1 | Richer `GetReplyOptions` — `onBlockReply`, `abortSignal`, `isHeartbeat`, `suppressToolErrorWarnings` | No — desktop has no block-reply router, no heartbeat pathway yet (W2 target) | **Out of scope** — W1 is evaluation+dispatch only |
| 2 | `TypingController` / `TypingMode` / `createTypingSignaler` — multi-channel typing indicators (Telegram, Slack, WhatsApp) | No — desktop has no cross-channel typing indicator | **N/A** |
| 3 | `SessionEntry` / `sessionStore` / `storePath` — JSONL session accounting | No — Parallx uses `chatSessionPersistence` (SQLite) | **Different substrate** |
| 4 | `runPreflightCompactionIfNeeded` invoked per followup | Partially — Parallx compaction runs inside the attempt loop already | **Already covered at different layer** |
| 5 | `runWithModelFallback` wrapping `runEmbeddedPiAgent` | Yes at concept — but already implemented in `openclawTurnRunner.ts` (L1 retry) | **Already covered** |
| 6 | `resolveFollowupDeliveryPayloads` + `routeReply` for origin-channel routing | No — single chat surface | **N/A** |
| 7 | `incrementRunCompactionCount` / `persistRunSessionUsage` / `refreshQueuedFollowupSession` — usage + session rotation accounting | No — desktop uses different persistence | **N/A** |
| 8 | `finalizeWithFollowup(value, queueKey, runFollowupTurn) → scheduleFollowupDrain(...)` in `agent-runner-helpers.ts:55-58` | **Yes — conceptually**. This is still the post-turn hook that queues the next followup. Parallx maps this to `chatService.queueRequest(sessionId, msg, ChatRequestQueueKind.Queued)`. | **Mapped** |
| 9 | `enqueueFollowupRun(key, run, settings, dedupe, runFollowup, restartIfIdle)` — queue with dedupe + debounce + drop-policy | Partial — Parallx relies on `chatService` pending-request queue which already dedup+serializes | **Equivalent at chat-service layer** |
| 10 | Continued use of `shouldSteer` / `shouldFollowup` gates | Yes — Parallx Gate 2 (`isSteeringTurn`) and Gate 5 (`continuationRequested`) still map 1:1 | **Aligned** |

### Conclusion

No upstream changes invalidate Parallx's evaluation-vs-execution architectural
split. The 5-gate evaluator and `FollowupTurnSender` delegate design are still
the correct desktop adaptation. **M46's 8/8 ALIGNED status holds.** No drift
requires rewrites to `openclawFollowupRunner.ts`.

The only remaining gap is **runtime wiring** — the module has zero production
imports. Closing that gap is the entirety of W1.

---

## 2. Runtime wiring capability scorecard

| # | Capability | Status | Evidence |
|---|-----------|--------|----------|
| W1.1 | `createFollowupRunner` is instantiated in the default participant lifecycle | **MISSING** | `grep createFollowupRunner src/` returns only the module and tests |
| W1.2 | `evaluateFollowup` is called after every turn with the turn result | **MISSING** | `runOpenclawDefaultTurn` returns without invoking the evaluator |
| W1.3 | Per-session followup depth is tracked | **MISSING** | No depth map in the participant |
| W1.4 | `MAX_FOLLOWUP_DEPTH = 5` is enforced end-to-end in the running system | **MISSING (untested in situ)** | Enforced inside `evaluateFollowup`, but `evaluateFollowup` is never called |
| W1.5 | Followup depth resets once a chain ends | **MISSING** | No state to reset |
| W1.6 | `FollowupTurnSender` delegate bridges to `chatService.queueRequest` | **MISSING** | No bridge exists |
| W1.7 | Followup turns get mirrored into the autonomy task rail | **TO VERIFY** | Autonomy mirror (`chatTurnSynthesis.ts`) fires per-request on all turns. A queued followup goes through the same `sendRequest → participant handler` pipeline, so it should be mirrored transparently. **Integration test required to confirm.** |
| W1.8 | Steering turns suppress followup (D3 contract) | **ALIGNED in module** / **UNTESTED in situ** | Gate 2 is correct; needs integration test proving the wired path honors it |
| W1.9 | Integration test: tool-continuation → second turn runs → third turn gates at depth | **MISSING** | No integration-level test exists |
| W1.10 | UX: followup turns end cleanly without visible defects | **TO VERIFY** | UX Guardian pass required post-wiring |

### Summary

- Module-internal parity (from M46): **8/8 ALIGNED** — holds against current upstream.
- **Wiring parity**: 0/10 (pre-work) — this is what W1 implements.

---

## 3. Findings

### F-W1.A — `createFollowupRunner` is a dead symbol

`src/openclaw/openclawFollowupRunner.ts:153` defines the factory. Search:

```
grep -r "createFollowupRunner" src/
→ src/openclaw/openclawFollowupRunner.ts  (declaration)
(no other hits in src/)
```

### F-W1.B — `continuationRequested` is already plumbed

`IOpenclawAttemptResult` and `IOpenclawTurnResult` both expose
`continuationRequested: boolean`
(`src/openclaw/openclawAttempt.ts:102`,
`src/openclaw/openclawTurnRunner.ts:74`). The signal flows from the tool
loop's iteration-cap path. **No model changes needed.**

### F-W1.C — Chat service already supports queued followups

`IChatService.queueRequest(sessionId, message, ChatRequestQueueKind.Queued, options?)`
(`src/services/chatTypes.ts:1063`) plus `_processNextPending` in
`chatService.ts:1194-1225` drain the queue automatically after the current
turn completes. Parallx's chat-service queue already provides the substrate
that upstream's `scheduleFollowupDrain`/`enqueueFollowupRun` provides.
**No core change to the chat service required.**

### F-W1.D — `isSteeringTurn` flag flows through

`IChatSendRequestOptions.isSteeringTurn` (`chatTypes.ts:1098`) →
`IChatParticipantRequest.isSteeringTurn` (`chatTypes.ts:707`) →
`turnContext.isSteeringTurn` (`openclawDefaultParticipant.ts:206`) →
`turnResult.isSteeringTurn` (`openclawTurnRunner.ts:201, 293`). Gate 2
of `evaluateFollowup` consumes this correctly.

### F-W1.E — Autonomy mirror will apply automatically

`services.createAutonomyMirror` is invoked per turn inside
`chatTurnSynthesis.ts` (confirmed in M58 plan §2.2). A followup turn routed
back through `chatService.sendRequest` triggers the normal participant
dispatch path, which includes the autonomy mirror. **No extra wiring
needed for W1.5.** Integration test must assert it.

### F-W1.F — Need to avoid requiring a new `IChatSendRequestOptions` flag

Resetting depth on "new user turn" does not require distinguishing
user-initiated from followup-initiated turns at the options level. Simpler
invariant: **reset depth when a turn completes without triggering
continuation.** Any user turn arriving after a chain ended therefore starts
at depth 0. Any user turn arriving mid-chain is a `Steering` turn (gate 2
suppresses followup) which will also end the chain at that turn. This
removes the need for a core-file change to `IChatSendRequestOptions` /
`IChatParticipantRequest`.

---

## 4. Constraints observed

- **M41-P1 Framework, not fixes** — wiring adds zero heuristics; it delegates to the existing evaluator.
- **M41-P6 Don't invent when upstream has a proven approach** — queuing via `chatService.queueRequest` mirrors upstream's `scheduleFollowupDrain` pattern: post-turn hook that queues, then the queue drains.
- **No anti-patterns triggered** — no output repair, no pre-classification, no eval-driven branches.

---

## 5. Upstream citations

| Upstream | Parallx mapping |
|----------|-----------------|
| `followup-runner.ts:1-412` `createFollowupRunner` | `openclawFollowupRunner.ts:153` (evaluation subset) |
| `agent-runner-helpers.ts:55-58` `finalizeWithFollowup` | `openclawDefaultParticipant.ts` post-turn hook (to be added in W1) |
| `queue/drain.ts:67-273` `scheduleFollowupDrain` | `chatService._processNextPending` (`chatService.ts:1194-1225`) |
| `queue/enqueue.ts:44-119` `enqueueFollowupRun` | `chatService.queueRequest` (`chatService.ts:1134-1170`) |
| `agent-runner.ts` gates `shouldSteer` / `shouldFollowup` | `evaluateFollowup` gates 2 & 5 (`openclawFollowupRunner.ts:107-138`) |

---

## 6. Ready for gap mapping

All preconditions for the Gap Mapper are satisfied. Proceed to W1 gap map.
