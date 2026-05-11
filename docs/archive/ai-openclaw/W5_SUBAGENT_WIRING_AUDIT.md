# W5 — SubagentSpawner Wiring Audit

**Milestone:** M58 (Wake Parallx)
**Domain:** W5 — SubagentSpawner (keystone)
**Branch:** `milestone-58`
**Date:** 2026-04-22
**Baseline upstream:** `github.com/openclaw/openclaw@e635cedb`

---

## 1. Scope

This audit re-verifies the gap between Parallx's in-process subagent
capabilities and upstream OpenClaw's `subagent-spawn.ts` +
`sessions-spawn-tool.ts` in the context of M58 wiring, and documents the
single unsolved substrate problem (isolated session management).

Unlike W2 / W4, **W5 is the exception to the §6.5 "ship thin" rule** — W5
BUILDS the ephemeral-session substrate AND the first real isolated-turn
consumer on top of it. The rationale: the subagent executor is the
minimum viable proof that the substrate works.

## 2. Upstream inventory

| Upstream artefact | Lines | Parity landing (Parallx) |
|--|--|--|
| `src/agents/subagent-spawn.ts::spawnSubagentDirect` | 1-847 | `SubagentSpawner.spawn` (D5 CLOSED 15/15 ALIGNED) |
| `src/agents/subagent-registry.types.ts::SubagentRunRecord` | — | `ISubagentRun` (fields trimmed per D5.4 deviation) |
| `src/tools/sessions-spawn-tool.ts` | 1-212 | NEW: `subagentTools.ts::createSessionsSpawnTool` |
| Isolated-session fork | — | NEW: `chatService.createEphemeralSession` + `isEphemeralSessionId` |
| Completion announcement | — | NEW: `createSubagentAnnouncer` via SurfaceRouter |

## 3. Pre-wiring re-audit (per milestone §5 W5 questions)

**Q1. Does upstream still use `"run"` vs `"session"` modes?**
**A:** Yes. Parallx only implements `"run"` (D5.3 deviation — no persistent
sub-sessions on desktop). No drift.

**Q2. Has depth tracking moved from `callerDepth` param to runtime ambient?**
**A:** Still `callerDepth` param-based upstream. Parallx matches. The
M58-W5 wiring ALSO adds a shared module-level `_subagentDepth` counter
(`openclawSubagentExecutor.ts`) so the `sessions_spawn` tool handler can
reject recursion WITHOUT consuming a registry slot — belt-and-braces with
the spawner's structural gate.

**Q3. Is the `announce` step still a post-completion callback?**
**A:** Yes. Parallx routes the announcement through `SurfaceRouter.
sendWithOrigin(ORIGIN_SUBAGENT, ...)` on the chat surface with
`metadata.subagentResult = true`.

## 4. Parallx pre-state (as of 2026-04-22)

- `SubagentSpawner` / `SubagentRegistry` — audit CLOSED 15/15 ALIGNED
  (D5), 34 unit tests, **0 production imports** before W5.
- `createEphemeralSession` / `purgeEphemeralSession` — **did not exist**.
- `sessions_spawn` chat tool — **did not exist**.
- Always-approval policy for subagent — **not documented**.
- Tool-side depth counter — **did not exist**.
- Integration tests — **none**.

## 5. Capability scorecard (15 capabilities — Iteration 1)

| # | Capability | Upstream evidence | Status |
|--:|--|--|:--:|
| 1 | Ephemeral (scratch) session creation | isolated session fork | ✅ ALIGNED |
| 2 | Ephemeral session excluded from list UI | session-list filter | ✅ ALIGNED |
| 3 | Ephemeral session excluded from persistence | no SQL writes | ✅ ALIGNED |
| 4 | Ephemeral session purge on completion | cleanup step | ✅ ALIGNED |
| 5 | Isolated turn on ephemeral session (real LLM turn) | spawnSubagentDirect step 4 | ✅ ALIGNED |
| 6 | Final-response capture from isolated turn | completion collection | ✅ ALIGNED |
| 7 | Announcement delivery via SurfaceRouter (ORIGIN_SUBAGENT) | announce step | ✅ ALIGNED |
| 8 | `sessions_spawn` tool (run mode) | sessions-spawn-tool.ts | ✅ ALIGNED |
| 9 | Always-approval gating (no exemption) | privileged-tool policy | ✅ ALIGNED |
| 10 | Hard depth cap of 1 (M58) — tool-side guard | callerDepth gate | ✅ ALIGNED |
| 11 | Hard depth cap of 1 (M58) — spawner-side guard | callerDepth gate | ✅ ALIGNED |
| 12 | Timeout handling (runTimeoutSeconds) | timeout branch | ✅ ALIGNED |
| 13 | Failure handling (executor error → failed status) | failure branch | ✅ ALIGNED |
| 14 | Origin tagging of subagent deliveries | origin metadata | ✅ ALIGNED |
| 15 | Parent `messages[]` untouched during subagent turn | isolation invariant | ✅ ALIGNED |

**Score:** 15 / 15 ALIGNED.

## 6. Anti-pattern audit (M41)

- ❌ Preservation bias — none (new code; spawner reused verbatim).
- ❌ Patch-thinking — none (substrate is a clean facility, not a patch).
- ❌ Wrapper framing — none (runtime native).
- ❌ Subtractive framing — none.
- ❌ Output repair — none (we return raw subagent text; no post-processing).
- ❌ Pre-classification — none.
- ❌ Eval-driven patchwork — none (no case-specific code paths).

## 7. Risks carried from milestone

| Risk | Mitigation |
|--|--|
| Ephemeral session leaks into persistence | Double guard: `_schedulePersist` + `saveSession` early-return on ephemeral ids |
| Ephemeral session leaks into list UI | `getSessions()` filter on prefix |
| Recursive spawns explode loop | Tool-side `currentSubagentDepth()` guard + SubagentSpawner's `callerDepth >= maxDepth` |
| Tool runs without approval | `subagentToolPermissionLevel` is a constant `requires-approval` |
| Concurrent subagents saturate local Ollama | `MAX_CONCURRENT_RUNS = 5` inherited from SubagentSpawner |
