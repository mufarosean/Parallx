# Milestone 87 — The Useful Heartbeat

**Status: S1 SHIPPED 2026-07-19 (deterministic core + UC1–UC3). S2–S4 pending.**
**Decisions (Mufaro):** thresholds = plan defaults (stall 4d, review-queue 5,
overdue 1d); follow-up findings create review-queue TASKS (digests/alerts are
notifications); **UC5 is a MORNING digest** (07:00–09:00 local: "Today: N
events, M tasks due"), not evening.
**Verdict driving this milestone (Mufaro, 2026-07-11 + 2026-07-19):** "the heartbeat
has honestly not been very useful… I have not found good use cases… it never
works as intended."

---

## 1. Why the current heartbeat is useless (diagnosis, code-verified)

The machinery built in the awareness redesign (see
`HEARTBEAT_AWARENESS_REDESIGN.md`) works as coded. What was coded cannot
produce value, for three structural reasons:

1. **No stated purpose.** Every beat asks the model to "look at what the user
   has been doing and decide whether you can genuinely help — otherwise NOOP,
   and when in doubt NOOP." That is an unanswerable brief; a local model
   correctly answers NOOP essentially always. Upstream OpenClaw heartbeats
   work because the user states purposes in a `HEARTBEAT.md` checklist the
   beat reads. We never ported the purpose file, so **use cases have no home**.
2. **Senses are developer-plumbing.** Diagnostics failures and extension
   signals feed the beat. The life-data the product exists for — overdue
   planner tasks, the review queue, stalled session plans, failed Google
   syncs — is invisible to it. The water-leak story (the canonical Parallx
   loop) cannot happen through the current senses.
3. **Output lands where the user never looks.** ACT deliveries go into the
   most-recent chat session; NOTEs go to the autonomy log. Even a correct
   observation is invisible.

## 2. Design principles

- **Deterministic core, LLM at the edges.** Senses are pure collectors of
  facts. Triggers are pure threshold/cooldown rules evaluated WITHOUT a
  model. The LLM only (a) evaluates free-text watch rules against collected
  facts and (b) composes digest prose. A finding must be reproducible in a
  unit test with zero model calls.
- **Purposes are stated, never divined.** Built-in rules cover the standard
  life-loop; everything else lives in `.parallx/HEARTBEAT.md`, written by the
  user or appended by the agent.
- **Deliver where the user lives, quietly.** Follow-up-shaped findings become
  planner review-queue tasks; time-sensitive digests become in-app
  notifications; everything is mirrored to the autonomy log for audit. No new
  UI surface.
- **Everything testable headlessly.** Senses/triggers/dedup are pure; the
  executor path is covered with mocked model turns (existing pattern in
  `openclawHeartbeatExecutorRealTurn.test.ts`); time-window rules use fake
  timers. No visible app launches required for any acceptance test.

## 3. Architecture

```
                       ┌────────────────────────────────────────┐
 beat (interval/event) │ SENSES (pure, no LLM)                  │
──────────────────────►│  planner · plans · sync · workspace ·  │
                       │  agents-staleness                      │
                       └───────────────┬────────────────────────┘
                                       │ IHeartbeatFacts
                       ┌───────────────▼────────────────────────┐
                       │ TRIGGER ENGINE (pure, no LLM)          │
                       │  built-in rules + HEARTBEAT.md rules   │
                       │  thresholds · rising edges · daily     │
                       │  windows · per-key cooldowns           │
                       └───────┬───────────────────┬────────────┘
                       findings│                   │free-text watches + facts
                       ┌───────▼────────┐  ┌───────▼────────────┐
                       │ DELIVERY       │  │ LLM LANE (existing │
                       │ review-queue   │  │ NOOP/NOTE/ACT turn)│
                       │ task · notif · │  └───────┬────────────┘
                       │ autonomy log   │◄─────────┘
                       └────────────────┘
```

New modules (all in `src/openclaw/` unless noted):
- `heartbeatSenses.ts` — `collectHeartbeatFacts(deps): IHeartbeatFacts`.
  Pure given injected reader functions (planner data service, chat service
  plans, sync controller, fs for AGENTS.md mtime).
- `heartbeatTriggers.ts` — `evaluateTriggers(facts, rules, state, nowMs):
  { findings, nextState }`. Pure. State = per-finding-key cooldown ledger
  (persisted via workspace storage, same pattern as the output-dedup ledger).
- `heartbeatPurpose.ts` — load/parse `.parallx/HEARTBEAT.md` (structured
  `## Watch` bullets split into deterministic rules it can parse vs
  free-text lines for the LLM lane); scaffold template; wired into `/init`
  scaffolding next to SOUL.md/TOOLS.md.
- Delivery adapters in `built-in/chat/main.ts` wiring: review-queue task via
  the planner data service (`status='reviewing'`, tagged `heartbeat`),
  notification via `INotificationService`, always the autonomy log.
- `heartbeat_watch` tool (chat): append/remove a watch line in HEARTBEAT.md —
  "watch this for me" becomes a real gesture.

## 4. Use cases — the acceptance suite

Every use case is a deterministic Given/When/Then with a named headless test.
UC6 additionally gets an offline-tolerant eval case for the LLM lane.

| # | Use case | Given | When beat fires | Then | Test (all vitest, headless) |
|---|----------|-------|-----------------|------|------------------------------|
| UC1 | **Stalled plan nudge** | A session plan has an `active` step and `updatedAt` older than `stallDays` (default 4d) | interval beat | ONE review-queue task "Plan stalled: <goal> — step '<step>'", tagged `heartbeat`; no duplicate within cooldown (7d per plan) | `heartbeatTriggers.test.ts` (pure) + delivery in `heartbeatDelivery.test.ts` |
| UC2 | **Review-queue triage** | ≥ `reviewThreshold` (default 5) tasks in `status='reviewing'`, oldest > 3d | interval beat | ONE notification "N captured tasks await review (oldest: X)"; cooldown 3d | same files |
| UC3 | **Overdue follow-up** (water-leak canonical) | A `planned` task is > 1d overdue | interval beat | Review-queue task "Follow up: <title> (due D, still open)"; cooldown 3d per task; resolves silently if task completed | same files |
| UC4 | **Sync failure surfacing** | Google sync `lastResults` contains an error where the previous run succeeded (rising edge) | any beat | ONE notification with the error summary; no repeat until a success→failure edge again | pure trigger test (edge logic) |
| UC5 | **Morning preview** | Local time in [07:00, 09:00), not yet delivered today, today has ≥1 event or due task | interval beat | ONE notification digest "Today: 2 events, 3 tasks due"; never fires on empty days; never twice a day | fake-timer test across a simulated day |
| UC6 | **Custom watch (HEARTBEAT.md)** | User line: `- warn me if I have more than 3 pages I edited but never linked` | interval beat | Line + collected facts included verbatim in the LLM-lane prompt; NOOP contract unchanged | prompt-inclusion unit test; model behavior via `autonomyEvalRunner` case (skipped offline) |
| UC7 | **AGENTS.md staleness** | AGENTS.md mtime > 30d old AND ≥ `churnThreshold` workspace changes since | interval beat | ONE notification "AGENTS.md hasn't been refreshed in N weeks — run /init"; cooldown 30d | pure trigger test |

Global invariants (their own tests):
- **Zero findings ⇒ zero deliveries** — quiet day stays quiet (the current
  behavior is preserved, but now silence means "checked N things, all fine",
  and the status board says so).
- **Cooldown ledger survives restart** (storage round-trip test).
- **Kill switch + heartbeat.enabled still gate everything** (extend
  `autonomyKillSwitch.test.ts`).
- **A finding never fires the LLM lane** — deterministic deliveries bypass
  the model entirely (assert `sendRequest` NOT called for UC1–UC5/UC7).

## 5. Test strategy

- **All acceptance tests are unit/headless** (vitest + jsdom where DOM is
  touched, fake timers for windows/cooldowns, injected fakes for planner /
  chat / sync / storage — the same doubles already used by
  `openclawHeartbeatExecutorRealTurn.test.ts` and `plannerChatTools.test.ts`).
- **No visible app launches.** Nothing in the acceptance suite starts
  Electron.
- **LLM-lane quality** (UC6 free-text watches) goes through the existing
  `autonomyEvalRunner` as an eval case — advisory, not gating, and skipped
  when no local model is reachable.
- Suite target: every UC test added in the same commit as its slice; full
  `npm run test:unit` + `tsc --noEmit` green per slice.

## 6. Slices (each ships complete: code + wiring + settings + tests)

- **S1 — Deterministic core + the three life use cases.**
  `heartbeatSenses` (planner + plans) + `heartbeatTriggers` + cooldown
  ledger + review-queue/notification/log delivery + UC1, UC2, UC3 tests +
  invariants. This alone makes the heartbeat useful.
- **S2 — The purpose file.** `heartbeatPurpose.ts`, `/init` scaffolding,
  `heartbeat_watch` tool, LLM-lane prompt inclusion + UC6.
- **S3 — Remaining senses.** Sync rising-edge (UC4), evening preview window
  (UC5), AGENTS.md staleness (UC7).
- **S4 — Controls + visibility.** Settings via schema registry (stallDays,
  reviewThreshold, quiet hours, per-sense toggles, digest window) + status
  board shows last beat's findings ("checked 5 senses · 1 finding · 2
  suppressed by cooldown") so silence is legible.

## 7. Non-goals

- No persistent headless heartbeat session (Phase-4 deferral stands; the
  deterministic lane doesn't need a session at all — that's the point).
- No new UI panel; delivery reuses review queue, notifications, autonomy
  log, status board.
- No cron/scheduling changes (cron got its local-time fixes in M-current).

## 8. Decisions needed from Mufaro before S1

1. Default thresholds: stallDays=4, reviewThreshold=5, overdue>1d — adjust?
2. UC1/UC3 create review-queue TASKS (visible in planner) vs notifications
   only — plan assumes tasks for follow-up-shaped findings. OK?
3. Evening preview window 20:00–22:00 local — right slot for a study
   schedule, or morning instead/also?
