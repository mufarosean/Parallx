# M58 — Final Integrated UX Guardian Report

**Date:** 2026-04-22
**Branch:** `milestone-58`
**Scope:** Cross-domain UX integration pass after W0/W1/W2/W4/W5/W6 closure
**Auditor:** Parity UX Guardian
**Verdict:** 🟢 **GREEN — merge-ready**

---

## 0. TL;DR

All 6 surfaces pass. All 7 integration scenarios pass. 3 LOW observational
findings, all deferrable to M59. No RED, no HIGH, no MEDIUM.

M58 is cleared to merge to `master`.

### Blocking findings

**None.**

### Non-blocking observations (deferred)

| # | Severity | Surface | Summary |
|---|----------|---------|---------|
| O1 | LOW | AI Settings + Heartbeat | `onDidChangeConfig` is broad → any setting edit stop/starts the heartbeat timer |
| O2 | LOW | Status bar + Chat input | Cron fire emits 3 deliveries; the notification toast may be transient during mid-turn typing |
| O3 | LOW | Chat list | Followup turns render with generic "Continue processing" user bubbles (already logged in W1) |

---

## 1. Commits under review

| Domain | Capability | Commit |
|---|---|---|
| W0 | Shim delete | `257e1b2` |
| W1 | FollowupRunner self-continuation | `713ad2e` |
| W2 | HeartbeatRunner (thin executor) | `3f901a9` |
| W4 | CronService (thin executor) | `2a620d3` |
| W5 | SubagentSpawner + ephemeral substrate | `cc91368` |
| W6 | SurfaceRouter + 5 surface plugins | `fcb7110` |

Context respected:

- **Ship-thin (§6.5, `/memories/repo/m58-ship-thin-decision.md`)**:
  W2 and W4 executors emit origin-stamped status/notification deliveries
  only. That is **by design**. Findings that would amount to "heartbeat
  doesn't run a real turn" are not raised.
- **M59 deferral list (W5 gap map)**: `seed.toolsEnabled` not consumed,
  shared depth counter per-turn, canvas write path — not re-raised.
- **Prior per-domain UX passes** (W1/W2/W4/W5/W6 trackers) are treated
  as closed.

---

## 2. Per-surface assessment

### 2.1 Chat input — **PASS**

**Evidence**

- `src/built-in/chat/widgets/chatWidget.ts` (not touched by any M58 domain)
- SurfaceRouter registration of the chat surface (`ChatSurfacePlugin`) is
  a trace-only logger (`src/built-in/chat/surfaces/chatSurface.ts`). It
  does not intercept transcript rendering.
- No new placeholder strings, no new toast on focus, no focus-stealing
  handler introduced in M58.

Chat input behaves identically to pre-M58.

### 2.2 Chat list — **PASS**

**Evidence**

- [src/services/chatService.ts](src/services/chatService.ts#L810-L918):
  `saveSession(sessionId)` early-returns on `isEphemeralSessionId(sessionId)`;
  `getAllSessions()` filters out ephemeral ids. Both guarded at the
  single chokepoint for list consumers.
- Heartbeat-origin and cron-origin deliveries go to the status/notification
  surfaces — never into `chatService.sendRequest`. They cannot mutate any
  session's `messages[]`.
- Followup turns route through `chatService.queueRequest(..., Queued)`
  (per W1 tracker) which reuses the normal request-pending path — one
  queued bubble, no phantom history entries.
- Integration test `tests/unit/ephemeralSessionSubstrate.test.ts` covers
  the list-exclusion guard explicitly (14 tests).

No leak paths found.

### 2.3 Task rail — **PASS**

**Evidence**

- `openclawToolPolicy.ts` marks `cron_add|cron_update|cron_remove`,
  `sessions_spawn`, `surface_send` (for filesystem/canvas surfaces) as
  `requires-approval`. Read-only actions (`cron_list`, `cron_status`,
  `cron_runs`, `cron_wake`, `cron_run`, `surface_list`) are
  `always-allowed`.
- The approval path is the existing `IAgentApprovalService` → task rail
  card. No new rendering path introduced.
- W4 tracker verified the "Scheduled jobs" section placeholder and
  approval posture rendering.

Denial returns a clean `IToolResult` error (tested in
`openclawCronWiring.test.ts` and `openclawSubagentWiring.test.ts`).

### 2.4 Approval flow — **PASS**

**Evidence**

- [src/openclaw/openclawToolPolicy.ts](src/openclaw/openclawToolPolicy.ts):
  `subagentToolPermissionLevel()` returns `requires-approval` **uniformly**
  — no parameter-conditional exemption.
- [src/built-in/chat/main.ts](src/built-in/chat/main.ts#L1113-L1143):
  the `SubagentSpawner` is wired only when `surfaceRouter` is present;
  depth hard-capped at 1 via constructor arg **AND** inside the tool
  handler via `currentSubagentDepth()`.
- Denial path: ephemeral session is not created at all because the
  spawner never executes. Tested in `openclawSubagentWiring.test.ts`
  (17 tests).
- No approval bypass tools were added in M58. `surface_list`,
  `cron_list`, and other reads stay always-allowed; all writes gate.

### 2.5 AI settings panel — **PASS**

**Evidence**

- [src/aiSettings/ui/aiSettingsPanel.ts](src/aiSettings/ui/aiSettingsPanel.ts#L24-L92):
  `HeartbeatSection` and `CronSection` are registered as dispose-managed
  child sections of the panel.
- [src/aiSettings/ui/sections/heartbeatSection.ts](src/aiSettings/ui/sections/heartbeatSection.ts):
  Enabled toggle + interval slider, both bound to `IUnifiedAIConfigService`
  via `updateActivePreset`; `update(profile)` rehydrates on profile swap.
- `CronSection` is an informational panel (no interactive writes in M58;
  live job list deferred to M59 W5).
- `tests/unit/aiSettingsPanel.test.ts` covers section count (9) and
  ordering.

Persistence and collapse/expand are inherited from `SettingsSection` and
untouched in M58.

### 2.6 Status bar — **PASS**

**Evidence**

- `src/built-in/chat/surfaces/` registers the `status` surface via the
  W6 router. Heartbeat, cron, and subagent executors call
  `router.sendWithOrigin({surfaceId:'status', ...}, ORIGIN_*)`.
- `SurfaceRouter.sendWithOrigin` stamps `_origin` into delivery metadata
  **not** into user-visible content. The content string itself contains
  no `ORIGIN_*` constant.
- The status surface has a bounded delivery queue
  (`MAX_DELIVERY_QUEUE_SIZE=100`) per
  [src/openclaw/openclawSurfacePlugin.ts](src/openclaw/openclawSurfacePlugin.ts#L29-L404),
  so interleaved ticks from heartbeat + cron + subagent cannot starve
  one another or overflow.

No user-visible origin leak. No flicker concern under normal tick rates
(min heartbeat interval 30 s).

---

## 3. Integration scenarios

### A. Heartbeat tick + cron fire + pending `sessions_spawn` approval — **PASS**

Three independent channels:

- Heartbeat → surface router status queue
- Cron → surface router status + notifications queues
- `sessions_spawn` approval → `IAgentApprovalService` (separate from
  surface router)

Per-surface queues (cap 100) prevent starvation. Approvals are UI-modal
and don't compete with surface deliveries. No shared mutex found; each
`_deliverWithRetry` is per-surface.

### B. Subagent spawn during a heartbeat tick — **PASS**

- Ephemeral session id created via
  `chatService.createEphemeralSession(parentId, seed)` carries the
  `EPHEMERAL_SESSION_ID_PREFIX`.
- `getAllSessions()` filters that prefix.
- `saveSession()` early-returns on that prefix.
- The subagent's turn cannot create an approval card against the
  ephemeral session because all tool calls inside it still route through
  the parent approval queue (depth-1 cap on `sessions_spawn` prevents
  recursion).
- Announcement-only delivery is emitted via
  `surfaceRouter.sendWithOrigin(..., ORIGIN_SUBAGENT)` to the chat
  surface, which is trace-only (no transcript insertion).

Ephemeral session is not visible in chat list / task rail / approval
flow. Verified.

### C. Cron fire mid-turn — **PASS with LOW observation (O2)**

- Status-surface updates modify a pre-allocated status bar entry
  (`parallx.surface.status`). No focus change, no new DOM element.
- Notification-surface deliveries route through the existing
  `INotificationService`. The toast does **not** steal focus
  (inherited toast behaviour, unchanged by M58).
- The chat input is not a drop target for notifications.

**Observation O2 (LOW, non-blocking):** a cron fire emits three
deliveries (status flash, notification toast, status idle). If cron
fires during user typing, the toast may briefly overlay the notifications
container. Behaviour identical to any other non-M58 notification. Defer
to M59 if user reports find it disruptive.

### D. AI settings open during heartbeat tick — **PASS with LOW observation (O1)**

- `HeartbeatSection.update(profile)` reads
  `unifiedConfigService.getEffectiveConfig().heartbeat` synchronously and
  reflects live state.
- Toggling `heartbeat.enabled` mid-tick:
  [src/built-in/chat/main.ts](src/built-in/chat/main.ts#L1199-L1210)
  wires `unifiedConfigService.onDidChangeConfig(() => {
  heartbeatRunner.stop(); heartbeatRunner.start(); })`. The runner's
  `stop()` cancels the pending `setTimeout` and sets `_disposed=false`
  via a flag guard; `start()` is a no-op when `enabled=false`, else arms
  a fresh timer. No race because `_tick()` checks `_disposed` at entry.

**Observation O1 (LOW, non-blocking):** the `onDidChangeConfig`
subscription fires on **any** config change (e.g. a model preference
toggle), not just heartbeat-scoped edits. Effect: the heartbeat
`setTimeout` is perpetually re-armed while the user is editing any
setting. For a user who stays in AI settings for >30 s while making
rapid edits, the next tick is delayed. Harmless but wasteful. Defer
to M59; trivial fix is to scope the listener to heartbeat keys.

### E. Followup chain + heartbeat — **PASS**

- Followup depth counter lives in
  `openclawDefaultParticipant.ts::followupStates` (per-session Map).
- Heartbeat executor does **not** run a chat turn (ship-thin), so it
  cannot reach the followup code path at all.
- Even if M59 retrofits a real heartbeat turn, it would run on a
  *separate* session handle, so the per-session followup map keeps the
  depth-5 cap scoped.

No cross-contamination path exists in M58.

### F. `cron_add` denial — **PASS**

- Denial: `IToolResult` error returned to the tool loop; no state mutation
  in `CronService` (no call made until approval resolves).
- Task rail card renders once and clears on denial (inherited approval
  UI, unchanged by M58).
- Chat transcript gets the standard "denied" tool result, no extra
  surfaces fired (cron executor only fires on actual `runJob`, not on
  tool failure).

### G. `sessions_spawn` denial — **PASS**

- `subagentToolPermissionLevel()` is always `requires-approval` →
  approval dialog invoked.
- On denial: tool handler returns error without calling
  `spawner.spawn()`. No `createEphemeralSession` call. No announcement
  delivery. No state pollution.
- Parent session sees a single clean error tool result. Covered by
  `openclawSubagentWiring.test.ts`.

---

## 4. Findings table

| ID | Severity | Surface | Description | Recommendation | Blocks merge? |
|----|----------|---------|-------------|----------------|:-------------:|
| O1 | LOW | AI settings + Heartbeat | `onDidChangeConfig` is not scoped; any config write restarts heartbeat timer | Scope subscription to heartbeat keys in M59 | ❌ No |
| O2 | LOW | Status bar + Chat input | Cron fire emits a transient notification toast; may briefly overlay on mid-turn typing | Observe user reports; consider suppressing cron-origin toasts while chat is streaming in M59 | ❌ No |
| O3 | LOW | Chat list | Followup turns render as generic "Continue processing" user bubbles | Deferred UX polish (W1 already logged) | ❌ No |

No MEDIUM, HIGH, CRITICAL findings.

---

## 5. Final verdict

🟢 **GREEN — merge-ready.**

- All 6 surfaces pass.
- All 7 cross-domain scenarios pass.
- 3 LOW observations, all deferrable to M59.
- Ship-thin decision honored; no deferred-by-design items flagged as defects.

M58 is cleared to merge to `master`.
