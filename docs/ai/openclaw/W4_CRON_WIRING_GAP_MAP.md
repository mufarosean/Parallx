# W4 — Cron Wiring Gap Map (M58)

**Domain**: D4 CronService
**Milestone**: M58 W4
**Source audit**: `W4_CRON_WIRING_AUDIT.md`
**Template**: W2 HeartbeatRunner wiring (commit `3f901a9`)

---

## 1. Files touched

| # | File | Kind | Reason |
|---|------|------|--------|
| 1 | `src/openclaw/openclawCronExecutor.ts` | NEW | Factory for `CronTurnExecutor`, `ContextLineFetcher`, `HeartbeatWaker` delegates. Thin surface-only executor per §6.5. |
| 2 | `src/openclaw/openclawToolPolicy.ts` | MODIFIED | Adds `APPROVAL_REQUIRED_CRON_ACTIONS` set + `cronToolRequiresApproval()` + `cronToolPermissionLevel()`. Mirrors surface/memory policy style. |
| 3 | `src/built-in/chat/tools/cronTools.ts` | NEW | Eight `cron_*` tools backed by `ICronToolHost`. Registered with explicit `permissionLevel` from policy. |
| 4 | `src/built-in/chat/tools/builtInTools.ts` | MODIFIED | Accepts optional `cronHost?: ICronToolHost`; registers `createCronTools(cronHost)` after surface tools. |
| 5 | `src/built-in/chat/main.ts` | MODIFIED | Instantiates `CronService` + `createCronTurnExecutor`; wires `cronHost` into `registerBuiltInTools`; starts + disposes; bridges to `HeartbeatRunner` via lazy module-scope ref. |
| 6 | `src/aiSettings/ui/sections/cronSection.ts` | NEW | Informational "Scheduled jobs" subsection (intro + approval posture + `data-role="cron-job-list"` placeholder for M59). |
| 7 | `src/aiSettings/ui/aiSettingsPanel.ts` | MODIFIED | Inserts CronSection between HeartbeatSection and ToolsSection. |
| 8 | `tests/unit/openclawCronWiring.test.ts` | NEW | 13 wiring tests: origin-stamping, agentTurn preservation, wake modes, heartbeat forwarding, missed-job catchup, fetcher empty+N, 8 tool names, approval gating, tool E2E, undefined host error, ship-thin guarantee. |
| 9 | `tests/unit/builtInTools.test.ts` | MODIFIED | Update tool-count assertion 24 → 32; sorted names list updated. |
| 10 | `tests/unit/chatGateCompliance.test.ts` | MODIFIED | Add `tools/cronTools.ts` to `FOLDER_RULES` (no imports allowed — matches `surfaceTools.ts`). |
| 11 | `tests/unit/aiSettingsPanel.test.ts` | MODIFIED | 8 → 9 sections; assert `'cron'` sits between `'heartbeat'` and `'tools'`. |

**No changes** to: `runtime/chatRuntime.ts`, `services/chatService.ts`,
`providers/chatParticipantsService.ts`, any widget, `workbench.ts`,
`openclawCronService.ts`, or any 77 existing cron tests.

---

## 2. Plan deviation: instantiate in `chat/main.ts`, not `workbench.ts`

Planned location per M58 §6 was `src/workbench/workbench.ts`. Actual
location matches the **W2 HeartbeatRunner precedent**:
`src/built-in/chat/main.ts`.

### Rationale

1. **`SurfaceRouterService` lifecycle** — the router is created inside the
   chat extension's `activate()` body and is not yet hoisted to the
   workbench. Cron has the same dependency HeartbeatRunner had, so the
   same resolution (local instantiation) applies. Re-routing to
   `workbench.ts` would require moving the router first, which M58
   Worker-4 scope forbids.
2. **Precedent consistency** — W2 established this pattern and closed
   CLEAN. Diverging here would fragment autonomy-module placement.
3. **Reversibility** — the wiring is a 40-line block in one `activate()`
   function. When the isolated-turn substrate lands in M59 and the
   router moves to the workbench, migration is mechanical.

Plan deviation logged here; no other plan items were modified.

---

## 3. Capability → change map

| Wiring cap | Upstream / Parallx ref | Change |
|------------|------------------------|--------|
| W4.1 ThinExecutor w/ ORIGIN_CRON | `ISurfaceRouterService.sendWithOrigin` (W6) | `createCronTurnExecutor(router)` emits 3 deliveries per fire; every one carries `ORIGIN_CRON`; cron event frame carries `payload.agentTurn` verbatim |
| W4.2 ContextLineFetcher | `cron/service.ts::ContextLineFetcher` | `createCronContextLineFetcher({getActiveSession})` reads last-N `IChatMessagePair` from active session, extracts markdown parts via `extractAssistantText()` (handles `parts[]` vs non-existent `rawText`) |
| W4.3 HeartbeatWaker | `heartbeat-runner.ts::wake(reason)` | `createCronHeartbeatWaker(runnerRef)` → `runnerRef.wake('cron')`; reason already in allowlist from W2 |
| W4.4 Instantiation + lifecycle | W2 HeartbeatRunner precedent | `chat/main.ts`: hoist `let cronService, cronHeartbeatRunnerRef` + `const cronHeartbeatWaker` to activate-scope; construct `new CronService({turnExecutor, contextLineFetcher, heartbeatWaker, logger})`; guarded on `surfaceRouter`; `cronService.start()` + disposable adds to extension disposables; `_activeWidget?.getSession()?.id` → `chatService.getSession(id)` |
| W4.5 8 tool definitions | `cron-tool.ts` action switch | `cronTools.ts` exports `createCronTools(host)` returning 8 tools with full parameter schemas matching `ICronJobCreateParams`, `ICronJobUpdateParams`, etc. |
| W4.6 Registration | `registerBuiltInTools` extension pattern | `builtInTools.ts` spreads `createCronTools(cronHost)` after surface tools; optional `cronHost` means no cron tools when `languageModelToolsService` is absent |
| W4.7 Approval gating | Upstream tool-policy approval precedent | `APPROVAL_REQUIRED_CRON_ACTIONS = Set(['cron_add','cron_update','cron_remove'])`; `cronToolPermissionLevel()` returns `'requires-approval'` for those, `'always-allowed'` for observe/trigger actions (status, list, runs, run, wake). **Critical: jobs only exist via approved `cron_add`, so default posture = no autonomous scheduled fires without user consent.** |
| W4.9 Wiring tests | — | 13 new tests in `openclawCronWiring.test.ts` covering all above capabilities + ship-thin spy |
| W4.10 UI surface | W2 HeartbeatSection precedent | `cronSection.ts` is informational only: intro, approval posture table, placeholder slot (`data-role="cron-job-list"`) marked for M59 live binding; `update()` is a no-op. |

### W4.8 persistence — intentionally deferred

Per audit §4 and plan §6.5, persistence is NOT in W4 scope. In-memory
jobs is correct for ship-thin — it prevents a persisted job from firing
with no real-turn substrate after a future Parallx restart. M59 will
pair persistence with the real-turn swap.

---

## 4. Risks

| Risk | Mitigation |
|------|-----------|
| Cron tool lets the model schedule autonomous work without user awareness | `cron_add`/`cron_update`/`cron_remove` require approval; surface deliveries on every fire ensure the user always sees the job's effect |
| Missed-job catchup replays stale work | `_runMissedJobs` uses `lastRunAt` → only catches missed *once*; ship-thin fires only emit a surface notification, not a real turn, so replay is visible not destructive |
| HeartbeatRunner reference races (cron built before heartbeat) | `cronHeartbeatRunnerRef` is a lazy `let` in module scope; `cronHeartbeatWaker` is a closure that reads the ref at call time — safe against construction order |
| "next-heartbeat" wake mode fires before the runner exists | Waker checks `if (!cronHeartbeatRunnerRef) return` — cron falls back silently; tested in wiring suite |
| Scheduler instantiation when `surfaceRouter` is absent | `chat/main.ts` guards on `if (surfaceRouter) { /* instantiate cron */ }`; without a router, cron is simply not created — matches ship-thin default-off posture |

---

## 5. Non-goals (documented, enforced)

- ❌ Real LLM turn on fire — deferred to M59 W5 isolated-turn substrate
- ❌ Persistence to disk — deferred to M59
- ❌ UI job editor / live job list — placeholder slot present, bind in M59
- ❌ Cross-session job ownership — single-workspace scope for now
- ❌ Timezone handling — uses system local time matching upstream

---

## 6. Decision gate

All 11 file changes are surgical and match the W2 precedent. No
core-runtime files touched outside the approved list (`main.ts`,
`builtInTools.ts`, `openclawToolPolicy.ts`). Proceed to CODE EXECUTE
(already complete — implementation landed during this iteration).
