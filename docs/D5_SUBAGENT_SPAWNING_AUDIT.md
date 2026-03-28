# Audit Report: D5 — Sub-Agent Spawning

**Auditor:** AI Parity Auditor  
**Date:** 2026-03-28  
**Parallx file:** `src/openclaw/openclawSubagentSpawn.ts`  
**Upstream references:**  
- `src/agents/subagent-spawn.ts` (~847 lines) — `spawnSubagentDirect()`, `SpawnSubagentParams`, spawn lifecycle  
- `src/agents/tools/sessions-spawn-tool.ts` (~212 lines) — `sessions_spawn` tool definition  
- `src/agents/subagent-registry.ts` (~731 lines) — `registerSubagentRun`, run tracking, lifecycle  
- `src/agents/subagent-registry-run-manager.ts` — run registration, termination, release  
- `src/agents/subagent-registry-lifecycle.ts` — lifecycle controller, announce flow  
- `src/agents/subagent-announce.ts` — `buildSubagentSystemPrompt`, announce delivery  

---

## Summary

| Metric | Count |
|--------|-------|
| Capabilities audited | 15 |
| **ALIGNED** | **10** |
| **MISALIGNED** | **3** |
| **HEURISTIC** | **0** |
| **MISSING** | **0** |
| **N/A** | **2** |

**Overall assessment:** This is one of the best-aligned D-domain implementations in Parallx. The core spawn lifecycle (validate → register → execute → announce → cleanup) matches the upstream `spawnSubagentDirect()` pattern. Divergences are structural (class vs function, in-memory vs disk persistence) and documented as intentional desktop adaptations. No heuristic patchwork or anti-patterns detected.

---

## Per-Capability Findings

### D5.1: SubagentSpawner class
- **Classification**: ALIGNED
- **Parallx file**: `src/openclaw/openclawSubagentSpawn.ts`, `SubagentSpawner.spawn()`
- **Upstream reference**: `src/agents/subagent-spawn.ts`, `spawnSubagentDirect()`, lines 297-846
- **Divergence**: Upstream is a standalone async function; Parallx wraps it in a class with injected delegates (`SubagentTurnExecutor`, `SubagentAnnouncer`). This is a valid desktop adaptation — upstream calls `callGateway()` for execution while Parallx uses a delegate pattern since there's no gateway.
- **Evidence**: The `spawn()` method follows the exact upstream lifecycle:
  1. Validate depth limit (upstream L370-378)
  2. Check concurrency limit (upstream L383-389)
  3. Register run (upstream L742-762)
  4. Execute (upstream L656-667 via `callGateway({method:"agent"})`)
  5. Announce completion (upstream L790-816 via `hookRunner.runSubagentSpawned`)
  6. Cleanup on failure (upstream L687-735)
- **Severity**: N/A — aligned

### D5.2: SubagentRegistry
- **Classification**: MISALIGNED
- **Parallx file**: `src/openclaw/openclawSubagentSpawn.ts`, `SubagentRegistry` class
- **Upstream reference**: `src/agents/subagent-registry.ts` (731 lines), `src/agents/subagent-registry-run-manager.ts`, `src/agents/subagent-registry-lifecycle.ts`
- **Divergence**: Parallx has a minimal in-memory `Map<string, ISubagentRun>` with basic CRUD. Upstream has a far more complex system:
  - **Missing**: Disk persistence (`subagent-registry-state.ts`, `subagent-registry.store.ts`)
  - **Missing**: Lifecycle controller with announce flow (`subagent-registry-lifecycle.ts`)
  - **Missing**: Sweep/archive timer for old runs (`sweepSubagentRuns()`)
  - **Missing**: Descendant tracking (`countPendingDescendantRuns`, `countActiveDescendantRuns`)
  - **Missing**: Orphan recovery (`subagent-orphan-recovery.ts`)
  - **Missing**: Steer/restart support (`replaceSubagentRunAfterSteer`)
- **Evidence**: Parallx registry is ~60 lines vs upstream's ~731+ lines across multiple files
- **Severity**: MEDIUM — acceptable for MVP desktop workbench. Most missing features (persistence, descendant tracking, orphan recovery) are needed for multi-agent server reliability but are not critical for single-user desktop where runs are short-lived. Should be incrementally added as Parallx matures.

### D5.3: ISubagentSpawnParams
- **Classification**: MISALIGNED
- **Parallx file**: `src/openclaw/openclawSubagentSpawn.ts`, `ISubagentSpawnParams`
- **Upstream reference**: `src/agents/subagent-spawn.ts`, `SpawnSubagentParams`, lines 52-76
- **Divergence**: Parallx has 5 fields; upstream has 12+:
  | Field | Parallx | Upstream |
  |-------|---------|----------|
  | `task` | ✅ | ✅ |
  | `label` | ✅ | ✅ |
  | `model` | ✅ | ✅ |
  | `runTimeoutSeconds` | ✅ | ✅ |
  | `callerDepth` | ✅ | Read from session store |
  | `agentId` | ❌ | ✅ |
  | `thinking` | ❌ | ✅ |
  | `thread` | ❌ | ✅ |
  | `mode` | ❌ (always "run") | ✅ ("run"\|"session") |
  | `cleanup` | ❌ | ✅ ("delete"\|"keep") |
  | `sandbox` | ❌ | ✅ ("inherit"\|"require") |
  | `expectsCompletionMessage` | ❌ | ✅ |
  | `attachments` | ❌ | ✅ |
  | `attachMountPath` | ❌ | ✅ |
- **Evidence**: `agentId` is N/A (single agent desktop). `thinking`, `thread`, `sandbox`, `attachments` are upstream features not yet needed for desktop. `mode` is documented adaptation (only "run").
- **Severity**: LOW — missing fields are either N/A for desktop or future enhancement candidates

### D5.4: ISubagentRun interface
- **Classification**: MISALIGNED
- **Parallx file**: `src/openclaw/openclawSubagentSpawn.ts`, `ISubagentRun`
- **Upstream reference**: `src/agents/subagent-registry.types.ts`, `SubagentRunRecord`
- **Divergence**: Parallx tracks `result: string | null` and `error: string | null` inline on the run record. Upstream stores result separately (read via `readSubagentOutput`) and tracks outcome as a structured `SubagentRunOutcome`. Upstream also has many more fields: `childSessionKey`, `controllerSessionKey`, `requesterSessionKey`, `requesterOrigin`, `workspaceDir`, `createdAt`, `startedAt`, `endedAt`, `outcome`, `cleanup`, `spawnMode`, `archiveAtMs`, `announceRetryCount`, etc.
- **Evidence**: Parallx `ISubagentRun` has 11 fields; upstream `SubagentRunRecord` has 25+
- **Severity**: LOW — Parallx design is simpler because it doesn't need multi-session tracking, persistence, or announce retry state. The inline `result`/`error` pattern is appropriate for a desktop context where results are consumed immediately.

### D5.5: Spawn mode
- **Classification**: ALIGNED
- **Parallx file**: `src/openclaw/openclawSubagentSpawn.ts`, `SubagentSpawnMode`
- **Upstream reference**: `src/agents/subagent-spawn.ts`, `SUBAGENT_SPAWN_MODES = ["run", "session"]`, line 44
- **Divergence**: Parallx only supports `"run"` — explicitly documented as a Parallx adaptation. Upstream supports `"run"` (one-shot) and `"session"` (persistent, thread-bound).
- **Evidence**: Comment block at top of file: "Parallx: only 'run' mode — no persistent sub-sessions." Type definition: `export type SubagentSpawnMode = 'run';`
- **Severity**: N/A — documented adaptation, correct for single-chat-surface desktop

### D5.6: Depth limit enforcement
- **Classification**: ALIGNED
- **Parallx file**: `src/openclaw/openclawSubagentSpawn.ts`, `SubagentSpawner.spawn()` depth check
- **Upstream reference**: `src/agents/subagent-spawn.ts`, `spawnSubagentDirect()`, lines 370-378
- **Divergence**: None significant. Both check `callerDepth >= maxSpawnDepth` and reject if exceeded.
  - Upstream: `if (callerDepth >= maxSpawnDepth) { return { status: "forbidden", error: "..." }; }`
  - Parallx: `if (depth >= this._maxDepth) { return { runId: '', status: 'failed', error: "..." }; }`
- **Evidence**: Test `rejects when depth >= maxDepth` passes. Default max depth = 3 (upstream configurable 1-5).
- **Severity**: N/A — aligned

### D5.7: Concurrency limit
- **Classification**: ALIGNED
- **Parallx file**: `src/openclaw/openclawSubagentSpawn.ts`, `SubagentSpawner.spawn()` concurrency check
- **Upstream reference**: `src/agents/subagent-spawn.ts`, `spawnSubagentDirect()`, lines 383-389 — `countActiveRunsForSession()` >= `maxChildrenPerAgent` (default 5)
- **Divergence**: Parallx uses a global `MAX_CONCURRENT_RUNS = 5` constant. Upstream uses per-session `maxChildrenPerAgent` from config (default 5). For single-user desktop, global = per-session.
- **Evidence**: Test `rejects when max concurrent runs reached` passes. Both default to 5.
- **Severity**: N/A — aligned for single-user context

### D5.8: Timeout mechanism
- **Classification**: ALIGNED
- **Parallx file**: `src/openclaw/openclawSubagentSpawn.ts`, `SubagentSpawner._executeWithTimeout()`
- **Upstream reference**: `src/agents/subagent-spawn.ts`, `runTimeoutSeconds` param → passed to gateway `agent.wait`
- **Divergence**: Upstream passes `timeout` to the gateway which manages the actual abort. Parallx implements timeout locally via `setTimeout` + `Promise.race` pattern since there's no gateway. Both produce a timeout-classified error.
- **Evidence**: Test `marks run as timeout on timeout error` passes. Default 120s matches upstream's approach of config-based defaults.
- **Severity**: N/A — implementation differs but behavioral contract matches

### D5.9: Announcement delegate
- **Classification**: ALIGNED
- **Parallx file**: `src/openclaw/openclawSubagentSpawn.ts`, `SubagentAnnouncer` type, announcement in `spawn()`
- **Upstream reference**: `src/agents/subagent-announce.ts`, `runSubagentAnnounceFlow()`, `src/agents/subagent-registry-lifecycle.ts`
- **Divergence**: 
  - Upstream: Complex announce flow with retry (`MAX_ANNOUNCE_RETRY_COUNT`), idempotency keys, multiple delivery strategies (gateway, direct), announce timeout (120s)
  - Parallx: Simple delegate call with non-fatal error handling, no retry
- **Evidence**: Test `completes even if announcer fails` confirms non-fatal semantics. The `SubagentAnnouncer` delegate pattern allows future retry enhancement.
- **Severity**: LOW — missing retry/idempotency is acceptable for desktop where announcement is posting to the same local UI

### D5.10: Status lifecycle
- **Classification**: ALIGNED
- **Parallx file**: `src/openclaw/openclawSubagentSpawn.ts`, `SubagentRunStatus`
- **Upstream reference**: `src/agents/subagent-registry-read.ts`, `resolveSubagentSessionStatus()`, lines 51-79
- **Divergence**: Mapping:
  | Parallx | Upstream |
  |---------|----------|
  | `spawning` | (implicit — run registered but not started) |
  | `running` | `running` |
  | `completed` | `done` |
  | `failed` | `failed` |
  | `timeout` | `timeout` |
  | `cancelled` | `killed` |
- **Evidence**: All status transitions tested. Lifecycle matches upstream's `running → done/failed/killed/timeout`.
- **Severity**: N/A — naming differs but semantics match

### D5.11: Cancellation
- **Classification**: ALIGNED
- **Parallx file**: `src/openclaw/openclawSubagentSpawn.ts`, `SubagentSpawner.cancel()`
- **Upstream reference**: `src/agents/subagent-registry.ts`, `markSubagentRunTerminated()`, lines 620-630
- **Divergence**: Upstream marks run terminated with reason string and emits lifecycle hooks. Parallx sets status to `'cancelled'` and `completedAt`. Both check if the run is in an active state before allowing cancellation.
- **Evidence**: Tests verify: cancel works on running, returns false for unknown, returns false for completed.
- **Severity**: N/A — aligned

### D5.12: Disposal & cleanup
- **Classification**: ALIGNED
- **Parallx file**: `src/openclaw/openclawSubagentSpawn.ts`, `SubagentSpawner.dispose()`, `SubagentRegistry.dispose()`
- **Upstream reference**: `src/agents/subagent-registry.ts`, `resetSubagentRegistryForTests()`, sweep cleanup
- **Divergence**: Upstream doesn't have a single `dispose()` — it uses sweepers, listener teardown, and test-only reset. Parallx provides clean `IDisposable` implementation that cancels active runs and clears the registry.
- **Evidence**: Tests verify: dispose cancels active runs, throws on spawn after dispose.
- **Severity**: N/A — Parallx pattern is cleaner for desktop lifecycle management

### D5.13: Constants
- **Classification**: ALIGNED
- **Parallx file**: `src/openclaw/openclawSubagentSpawn.ts`, exported constants
- **Upstream reference**: `src/config/zod-schema.agent-defaults.ts` (maxSpawnDepth 1-5), `src/agents/subagent-spawn.ts` (runTimeoutSeconds defaults to 0 or config), `src/agents/subagent-spawn.ts` (maxChildrenPerAgent default 5)
- **Divergence**:
  | Constant | Parallx | Upstream |
  |----------|---------|----------|
  | `DEFAULT_MAX_SPAWN_DEPTH` | 3 | Configurable (1-5, default per-config) |
  | `DEFAULT_RUN_TIMEOUT_SECONDS` | 120 | 0 when unset (no limit), or config value |
  | `MAX_CONCURRENT_RUNS` | 5 | `maxChildrenPerAgent` default 5 |
- **Evidence**: Tests validate all three constants are within reasonable bounds.
- **Severity**: N/A — Parallx defaults are sensible for desktop; upstream's 0 = no timeout default is for server contexts with their own watchdog

### D5.14: Test coverage
- **Classification**: ALIGNED
- **Parallx file**: `tests/unit/openclawSubagentSpawn.test.ts`
- **Upstream reference**: `src/agents/subagent-spawn.test.ts`, `src/agents/tools/sessions-spawn-tool.test.ts`, various registry tests
- **Divergence**: 32 tests covering:
  - Registry: 12 tests (register, update, active tracking, get, remove, dispose, edge cases)
  - Spawner happy path: 4 tests (spawn, model override, announcement, registry lifecycle)
  - Depth limit: 3 tests (reject at limit, allow below, default constant)
  - Concurrency limit: 1 test
  - Executor failure: 2 tests (error, timeout)
  - Announcer failure: 1 test (non-fatal)
  - No announcer: 1 test
  - Cancel: 3 tests (success, unknown, completed)
  - Dispose: 2 tests (cancel active, reject after dispose)
  - Constants: 3 tests (bounds validation)
- **Evidence**: All 32 tests pass. Coverage is comprehensive for the implemented surface.
- **Severity**: N/A — good coverage

### D5.15: No anti-patterns
- **Classification**: ALIGNED
- **Parallx file**: `src/openclaw/openclawSubagentSpawn.ts`
- **Upstream reference**: M41 anti-pattern checklist
- **Divergence**: None detected.
  - ✅ No regex routing or keyword detection
  - ✅ No output repair or post-processing
  - ✅ No heuristic patchwork
  - ✅ No pre-classification bypassing the model
  - ✅ No eval-driven patches
  - ✅ Clean delegate pattern (executor/announcer)
  - ✅ Proper upstream references in header comments
  - ✅ Documented Parallx adaptations with rationale
  - ✅ No dead code paths
  - ✅ Immutable return snapshots (spread operator on registry reads)
- **Severity**: N/A — M41 compliant

---

## Critical Findings

None. This is a well-implemented module with no critical gaps.

## Medium Findings

### MED-1: SubagentRegistry lacks persistence (D5.2)
The registry is purely in-memory. If Parallx restarts mid-run, all sub-agent state is lost. Upstream persists to disk (`~/.openclaw/state/subagents/runs.json`). For desktop MVP this is acceptable — sub-agent runs complete quickly and are consumed in the same session. Persistence should be added when Parallx supports long-running background agents.

### MED-2: ISubagentSpawnParams missing upstream fields (D5.3)
Missing `agentId`, `thinking`, `cleanup`, `sandbox`, `attachments`. Most are N/A for single-agent desktop. `thinking` could be useful if Parallx adds thinking-level configuration for sub-agent tasks. Low priority.

## Low Findings

### LOW-1: Announcement lacks retry (D5.9)
Upstream has `MAX_ANNOUNCE_RETRY_COUNT` with exponential backoff. Parallx fires once. Non-issue for local UI delivery but worth adding if Parallx ever has unreliable delivery paths.

### LOW-2: Run record is simpler than upstream (D5.4)
The `ISubagentRun` stores `result`/`error` inline instead of reading from session transcript. Acceptable trade-off for desktop — results are consumed immediately.

---

## N/A Capabilities (Desktop Adaptations)

| Upstream Feature | Why N/A |
|-----------------|---------|
| `"session"` spawn mode | No persistent sub-sessions on single-chat desktop |
| `agentId` targeting | Single-agent desktop — no cross-agent spawning |
| Session isolation via gateway | No gateway — delegate pattern replaces it |
| Sandbox enforcement | No sandboxed runtimes on local desktop |
| Attachment materialization | No file-mount workflow for desktop sub-tasks |
| Orphan recovery | Short-lived local runs don't orphan |
| Disk persistence | Acceptable for MVP; runs are consumed immediately |

---

## Recommendations

1. **No immediate action required.** The module is well-aligned for desktop use.
2. **Future: Add registry persistence** when Parallx supports background agents or long tasks.
3. **Future: Add `thinking` param** to `ISubagentSpawnParams` when Parallx supports thinking-level configuration.
4. **Future: Add announcement retry** if delivery becomes unreliable (e.g., cross-process UI).

---

## Test Verification

```
npx vitest run tests/unit/openclawSubagentSpawn.test.ts --reporter=verbose
Test Files  1 passed (1)
      Tests  32 passed (32)
   Duration  226ms
```

All 32 tests pass with zero failures.
