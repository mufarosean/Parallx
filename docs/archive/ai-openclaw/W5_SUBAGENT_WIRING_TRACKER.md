# W5 — SubagentSpawner Wiring Tracker

**Milestone:** M58 (Wake Parallx)
**Domain:** W5 (keystone)
**Branch:** `milestone-58`
**Status:** ✅ **CLOSED** — Iteration 1
**Iterations:** 1
**Audit:** `W5_SUBAGENT_WIRING_AUDIT.md`
**Gap map:** `W5_SUBAGENT_WIRING_GAP_MAP.md`

---

## Scorecard (Iteration 1 — CLOSED)

| # | Capability | Status |
|--:|--|:--:|
| 1 | Ephemeral session creation | ✅ ALIGNED |
| 2 | Ephemeral excluded from session list | ✅ ALIGNED |
| 3 | Ephemeral excluded from persistence | ✅ ALIGNED |
| 4 | Ephemeral session purge | ✅ ALIGNED |
| 5 | Isolated real LLM turn on ephemeral | ✅ ALIGNED |
| 6 | Final response capture | ✅ ALIGNED |
| 7 | Announcement via SurfaceRouter (ORIGIN_SUBAGENT) | ✅ ALIGNED |
| 8 | `sessions_spawn` tool (run mode) | ✅ ALIGNED |
| 9 | Always-approval gating | ✅ ALIGNED |
| 10 | Depth cap 1 — tool-side guard | ✅ ALIGNED |
| 11 | Depth cap 1 — spawner-side guard | ✅ ALIGNED |
| 12 | Timeout handling | ✅ ALIGNED |
| 13 | Failure handling | ✅ ALIGNED |
| 14 | Origin tagging of deliveries | ✅ ALIGNED |
| 15 | Parent messages[] untouched during turn | ✅ ALIGNED |

**Totals:** 15 / 15 ALIGNED.

## Key files

| File | Role | State |
|--|--|--|
| `src/services/chatSessionPersistence.ts` | ephemeral sentinel + persistence guards | MODIFIED |
| `src/services/chatService.ts` | `createEphemeralSession` / `purgeEphemeralSession` + list filter + persist guard | MODIFIED |
| `src/openclaw/openclawToolPolicy.ts` | always-approval constants | MODIFIED |
| `src/openclaw/openclawSubagentExecutor.ts` | SubagentTurnExecutor + SubagentAnnouncer + depth counter | NEW |
| `src/built-in/chat/tools/subagentTools.ts` | `sessions_spawn` tool | NEW |
| `src/built-in/chat/tools/builtInTools.ts` | registers `sessions_spawn` | MODIFIED |
| `src/built-in/chat/main.ts` | activation-time wiring of SubagentSpawner | MODIFIED |
| `tests/unit/ephemeralSessionSubstrate.test.ts` | 14 tests | NEW |
| `tests/unit/openclawSubagentWiring.test.ts` | 17 tests | NEW |
| `tests/unit/builtInTools.test.ts` | tool count 32 → 33 | MODIFIED |
| `tests/unit/chatGateCompliance.test.ts` | whitelist `tools/subagentTools.ts` | MODIFIED |

## Upstream references (spot-checkable)

- `github.com/openclaw/openclaw@e635cedb`
  - `src/agents/subagent-spawn.ts` (spawnSubagentDirect, announce)
  - `src/agents/subagent-registry.types.ts` (SubagentRunRecord shape)
  - `src/tools/sessions-spawn-tool.ts` (run mode handler)

## Iteration 1 — CLOSED

### Changes applied
Everything in the gap map Changes 1-8c.

### Verification
- `npx tsc --noEmit` — exit 0 clean.
- `npx vitest run tests/unit/ephemeralSessionSubstrate.test.ts` —
  14 / 14 passed.
- `npx vitest run tests/unit/openclawSubagentWiring.test.ts` —
  17 / 17 passed.
- `npm run test:unit` (FULL suite) — **134 files / 2394 tests, 0 failed**.

### UX Guardian
No user-facing surfaces changed. `sessions_spawn` is surfaced only
through the existing approval dialogue (privileged tool). No settings,
no command-palette entries, no chat UI changes. Passes.

### Anti-pattern audit
All 7 M41 anti-patterns avoided — see `W5_SUBAGENT_WIRING_AUDIT.md §6`.

### Deferred (explicit, documented in gap map "Non-goals")
- M59: `tools[]` allowlist enforcement on `sessions_spawn`.
- M59: Seed `systemMessage` / `toolsEnabled` / `loopSafetyContext`
  consumption.
- M59: Shared ChatToolLoopSafety counter across parent + subagent.
- Never-port: `"session"` mode (persistent sub-sessions) — D5.3
  deviation.

### Status
✅ **CLOSED** — all 15 capabilities ALIGNED, substrate is real, real
isolated turns proven end-to-end, zero regressions.
