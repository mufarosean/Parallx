# Parallx OpenClaw Turn Identity Parity Plan

**Status:** Implemented and validated; recorded below  
**Date:** 2026-03-25  
**Purpose:** Restore and verify the end-to-end turn-identity invariant for the OpenClaw-backed default chat surface: typed input -> request object -> final model prompt -> visible thinking -> visible answer.

---

## 1. Problem Statement

The prior OpenClaw repair loop brought the benchmark suites back to green, but that did not prove that the runtime preserves the user's current turn all the way into the model request.

The newly reported live failure is stricter:

1. the user types one question,
2. the UI shows that question,
3. the visible thinking pane reasons about a different question.

That means parity is still broken at the turn-identity boundary even if retrieval, routing, and answer quality score well on the benchmark set.

---

## 2. Upstream OpenClaw Evidence

The new parity work is anchored to direct upstream OpenClaw evidence rather than to local assumptions.

### 2.1 Current-message authority is explicit upstream

Upstream `openclaw/openclaw` defines the active message boundary explicitly in `src/gateway/agent-prompt.ts`:

- it prefers the last `user` or `tool` entry as the current message,
- it reconstructs history around that boundary,
- it avoids accidentally answering the assistant's previous turn.

Relevant verified excerpt:

> Prefer the last user/tool entry as "current message" so the agent responds to the latest user input or tool output, not the assistant's previous message.

This is the core parity principle for the current bug class.

### 2.2 Upstream prompt building preserves a distinct current user turn

Upstream prompt adapters in `src/gateway/openai-http.ts` and `src/gateway/openresponses-prompt.ts` normalize conversation entries first and then call `buildAgentMessageFromConversationEntries(...)`.

That means OpenClaw has an explicit assembly boundary where the active user turn is chosen deterministically before the provider request is built.

### 2.3 Upstream session replay distinguishes user text from assistant thinking

Upstream `src/acp/translator.ts` replays transcript content using distinct update channels such as:

- `user_message_chunk`
- `agent_message_chunk`
- `agent_thought_chunk`

That separation matters here because visible reasoning is not the bug by itself. The bug is whether the reasoning belongs to the same current user turn that the runtime actually sent.

### 2.4 Upstream prompt reporting is runtime-owned

Upstream `src/agents/system-prompt-report.ts` builds a structured prompt report from the actual generated prompt and injected files. The principle is that prompt provenance is a runtime artifact, not an inferred UI story.

Parallx currently reports bootstrap/system prompt structure, but it does not yet record the per-turn user-message provenance needed to verify the live bug class.

---

## 3. Local Repo Evidence

### 3.1 Current OpenClaw default-lane send path

Verified local path:

1. `src/built-in/chat/widgets/chatWidget.ts` submits raw text through `sendRequest(...)`.
2. `src/services/chatService.ts` parses that text, creates the user message, computes `participantRequest`, and builds `turnState`.
3. `src/openclaw/participants/openclawDefaultParticipant.ts` resolves the turn, builds `promptEnvelope.userContent`, and sends `buildOpenclawSeedMessages(systemPrompt, context.history, { ...request, text: promptEnvelope.userContent })`.
4. `src/openclaw/participants/openclawParticipantRuntime.ts` streams reasoning through `response.thinking(...)` and final text through `response.markdown(...)`.

### 3.2 Queue boundary currently corrupts request shape

Verified local defect:

- `src/services/chatTypes.ts` defines `queueRequest(sessionId, message, kind, options?)`, but `IChatPendingRequest` stores only `id`, `text`, `kind`, and `timestamp`.
- `src/services/chatService.ts` creates pending requests without preserving `participantId`, `command`, `attachments`, or other send options.
- `src/services/chatService.ts` later dequeues via `this.sendRequest(sessionId, next.text)`.
- `src/built-in/chat/widgets/chatWidget.ts` requeues steering requests with only `pending.text`.
- `src/built-in/chat/utilities/chatWidgetRequestAdapter.ts` and `src/built-in/chat/chatTypes.ts` also narrow queueing to raw text only.

This is direct request-identity loss. It is already a real parity defect even before proving whether it explains the exact reported live symptom.

### 3.3 Prompt reporting is insufficient for turn-identity debugging

Verified local gap:

- `src/openclaw/participants/openclawContextReport.ts` records system-prompt and bootstrap structure only.
- `src/built-in/chat/data/chatDataService.ts` stores `systemPromptReport` in the debug snapshot.
- no runtime-owned artifact records the final user payload for the run,
- no debug artifact records raw input text vs parsed request text vs final `promptEnvelope.userContent`,
- no `/context` output currently exposes that boundary.

That means Parallx cannot yet prove the typed-input-to-prompt identity invariant directly from runtime artifacts.

---

## 4. Required Invariant

For every OpenClaw default-lane run, the runtime must be able to prove:

1. what text the user typed,
2. what text the request object carried after parsing,
3. what participant/command/attachment state was preserved,
4. what final current-user payload was placed in the provider prompt,
5. that the visible thinking and final answer belong to that same run.

If any boundary can silently substitute stale or narrowed input, parity is not achieved.

---

## 5. Execution Plan

### Step 1. Preserve full request identity across the queue boundary

Implement first because it is an already verified defect.

Required changes:

- extend pending-request storage to retain the original send options,
- thread those options through widget adapters and queue operations,
- process dequeued requests with the preserved options instead of raw text only,
- preserve steering requeue options as well as ordinary queued options.

Validation:

- unit coverage for queued requests preserving participant, command, and attachments,
- unit coverage for steering requeue preserving the same options.

### Step 2. Introduce runtime-owned prompt provenance for OpenClaw runs

Required changes:

- add a new per-run provenance artifact for the OpenClaw default lane,
- record at minimum:
  - raw user input,
  - parsed request text,
  - participant id,
  - command,
  - attachment counts,
  - history turn count used for seeding,
  - final `promptEnvelope.userContent`,
  - final last user message actually sent to the model,
  - message count in the model request,
- store that artifact in the debug snapshot alongside the system prompt report.

Validation:

- unit test proving the recorded current-user prompt content contains the actual user turn for follow-up requests,
- unit test proving the recorded model-bound current-user payload matches the sent message array.

### Step 3. Expose provenance through existing debug surfaces

Required changes:

- surface the new provenance artifact in `getTestDebugSnapshot()`,
- extend `/context detail` and `/context json` so the current-turn boundary is inspectable from the live product,
- keep the report runtime-owned rather than reconstructed from UI state.

Validation:

- unit coverage for `/context json` including per-turn provenance on a real run-built report.

### Step 4. Add parity checks for the turn-identity invariant

Required changes:

- add targeted unit tests around queue preservation and prompt provenance,
- add or extend AI-eval/debug assertions so the benchmark harness can inspect the recorded per-turn prompt provenance when needed.

### Step 5. Rebuild and rerun AI Playwright evaluation

After implementation is complete:

1. rebuild renderer,
2. rerun all AI-related Playwright suites,
3. record individual scores/results in the persistent repair ledger,
4. stop only after the before/after state is documented.

---

## 6. Completion Criteria

This plan is complete only when all of the following are true:

1. queued and steering requests preserve full request identity,
2. OpenClaw records per-run prompt provenance for the current user turn,
3. the debug surfaces expose that provenance clearly enough to inspect live failures,
4. targeted unit coverage proves the boundary behavior,
5. the AI Playwright suites are rerun and individually scored,
6. the results are written back to the persistent docs ledger.

Until then, benchmark green is treated as insufficient evidence.

---

## 7. Implemented Fixes

### 7.1 Queue-boundary request identity is now preserved

Implemented in the verified OpenClaw/default chat path:

- `src/services/chatTypes.ts`
  - `IChatPendingRequest` now stores the original send options.
- `src/services/chatService.ts`
  - queue storage now retains `options`,
  - dequeue replay now calls `sendRequest(sessionId, next.text, next.options)` instead of replaying raw text only.
- `src/built-in/chat/chatTypes.ts`
  - widget-facing queue contracts now carry options.
- `src/built-in/chat/utilities/chatWidgetRequestAdapter.ts`
  - queue delegation now forwards the full options object.
- `src/built-in/chat/data/chatDataService.ts`
  - queue bridge now preserves the same request options.
- `src/built-in/chat/widgets/chatWidget.ts`
  - queued requests preserve attachments/options during active turns,
  - steering requeue now preserves the stored pending options instead of replaying text only.

This closes the concrete local defect where queued or steering turns could silently lose participant, command, attachment, or other send-option identity before the next run.

### 7.2 Runtime-owned prompt provenance is now emitted by the OpenClaw default lane

Implemented in the verified OpenClaw runtime path:

- `src/openclaw/openclawTypes.ts`
  - `IOpenclawSystemPromptReport` now includes `promptProvenance`.
- `src/openclaw/participants/openclawDefaultParticipant.ts`
  - the runtime now builds the report from the actual run-time prompt assembly boundary,
  - recorded fields include:
    - raw user input,
    - parsed user text,
    - context query text,
    - participant id,
    - command,
    - attachment count,
    - seeded history turns,
    - model message count,
    - model message roles,
    - final current-user payload sent to the model.

This makes the current-turn payload a runtime artifact rather than an inferred UI reconstruction.

### 7.3 Debug surfaces now expose the current-turn boundary

Implemented in:

- `src/openclaw/participants/openclawContextReport.ts`
  - `/context` now reports the new provenance data,
  - `/context detail` prints the final current-user payload in a code block,
  - `/context json` exposes the same fields in machine-readable form.

This gives the live product an inspectable boundary for:

1. typed input,
2. parsed request text,
3. model-bound current-user payload.

---

## 8. Validation Results

### 8.1 Targeted unit validation

Verified targeted rerun after the queue-harness race fix:

- `tests/unit/chatStreamingAndQueue.test.ts` → PASS
- `tests/unit/chatWidgetRequestAdapter.test.ts` → PASS
- `tests/unit/openclawDefaultParticipant.test.ts` → PASS
- targeted total → `42/42` passed

Important note:

- one queue replay test first failed because the harness released the slow turn before the handler had definitely started,
- the test was fixed by adding explicit synchronization around slow-turn startup,
- the final green rerun therefore validates the runtime behavior rather than a harness race.

### 8.2 Full AI Playwright rerun

Verified latest full rerun command:

- `npm run test:ai-eval:full`

Latest validated suite results from the turn-identity parity phase:

| Suite | Result | Score / count | Important notes |
|-------|--------|---------------|-----------------|
| Renderer build | PASS | n/a | renderer rebuilt successfully before Playwright execution |
| Core AI eval suites (bundled insurance demo) | PASS | `42/42`, `99.7%` | latest rerun is green; only one scored core case is sub-100 |
| Stress AI eval suite | PASS | `10/10`, `100%` | all stress cases scored `100%` |
| Books AI eval suite | PASS | `8/8`, `100.0%` | all Books cases scored `100%` |
| Exam 7 AI eval suite | SKIP | n/a | workspace missing `Exam 7 Reading List.pdf` and `Study Guide - CAS Exam 7 RF.pdf` |

### 8.3 Latest per-test score record from the full AI rerun

#### Insurance AI-quality core scores

Overall score from the latest parity rerun: `99.7%`

| Test | Outcome | Score | Important notes |
|------|---------|-------|-----------------|
| `T01` | PASS | `100%` | latest parity rerun stayed green |
| `T02` | PASS | `100%` | latest parity rerun stayed green |
| `T03` | PASS | `100%` | latest parity rerun stayed green |
| `T04` | PASS | `89%` | only sub-100 scored core case in the latest rerun |
| `T05` | PASS | `100%` | latest parity rerun stayed green |
| `T06` | PASS | `100%` | latest parity rerun stayed green |
| `T07` | PASS | `100%` | latest parity rerun stayed green |
| `T08` | PASS | `100%` | latest parity rerun stayed green |
| `T09` | PASS | `100%` | latest parity rerun stayed green |
| `T10` | PASS | `100%` | latest parity rerun stayed green |
| `T11` | PASS | `100%` | latest parity rerun stayed green |
| `T12` | PASS | `100%` | latest parity rerun stayed green |
| `T13` | PASS | `100%` | latest parity rerun stayed green |
| `T14` | PASS | `100%` | latest parity rerun stayed green |
| `T15` | PASS | `100%` | latest parity rerun stayed green |
| `T16` | PASS | `100%` | latest parity rerun stayed green |
| `T17` | PASS | `100%` | multi-turn accident workflow stayed green after the request-identity fix |
| `T18` | PASS | `100%` | latest parity rerun stayed green |
| `T19` | PASS | `100%` | latest parity rerun stayed green |
| `T20` | PASS | `100%` | latest parity rerun stayed green |
| `T21` | PASS | `100%` | latest parity rerun stayed green |
| `T22` | PASS | `100%` | latest parity rerun stayed green |
| `T23` | PASS | `100%` | latest parity rerun stayed green |
| `T24` | PASS | `100%` | latest parity rerun stayed green |
| `T25` | PASS | `100%` | latest parity rerun stayed green |
| `T26` | PASS | `100%` | latest parity rerun stayed green |
| `T27` | PASS | `100%` | latest parity rerun stayed green |
| `T28` | PASS | `100%` | latest parity rerun stayed green |
| `T29` | PASS | `100%` | latest parity rerun stayed green |
| `T30` | PASS | `100%` | latest parity rerun stayed green |
| `T31` | PASS | `100%` | latest parity rerun stayed green |
| `T32` | PASS | `100%` | latest parity rerun stayed green |

#### Stress AI eval scores

Overall score from the latest parity rerun: `100%`

| Test | Outcome | Score |
|------|---------|-------|
| `S-T01` | PASS | `100%` |
| `S-T02` | PASS | `100%` |
| `S-T03` | PASS | `100%` |
| `S-T04` | PASS | `100%` |
| `S-T05` | PASS | `100%` |
| `S-T06` | PASS | `100%` |
| `S-T07` | PASS | `100%` |
| `S-T08` | PASS | `100%` |
| `S-T09` | PASS | `100%` |
| `S-T10` | PASS | `100%` |

#### Books AI eval scores

Overall score from the latest parity rerun: `100.0%`

| Test | Outcome | Score |
|------|---------|-------|
| `BW01` | PASS | `100%` |
| `BW02` | PASS | `100%` |
| `BW03` | PASS | `100%` |
| `BW04` | PASS | `100%` |
| `BW05` | PASS | `100%` |
| `BW06` | PASS | `100%` |
| `BW07` | PASS | `100%` |
| `BW08` | PASS | `100%` |

### 8.4 Completion status against plan criteria

| Criterion | Status | Evidence |
|-----------|--------|----------|
| queued and steering requests preserve full request identity | COMPLETE | queue contracts and replay path now retain options end to end |
| OpenClaw records per-run prompt provenance for the current user turn | COMPLETE | runtime-owned `promptProvenance` added to `IOpenclawSystemPromptReport` |
| debug surfaces expose the provenance clearly | COMPLETE | `/context detail` and `/context json` now expose the current-turn boundary |
| targeted unit coverage proves the boundary behavior | COMPLETE | targeted rerun `42/42` passed |
| AI Playwright suites rerun and individually scored | COMPLETE | latest full rerun recorded above |
| results written back to persistent docs ledger | COMPLETE | this document and the regression ledger both updated |

The stricter turn-identity parity phase is now implemented, validated, and durably recorded.