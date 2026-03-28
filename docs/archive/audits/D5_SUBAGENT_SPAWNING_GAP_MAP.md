# D5 Sub-Agent Spawning — Gap Map (Change Plan)

**Source audit:** `docs/D5_SUBAGENT_SPAWNING_AUDIT.md`  
**Date:** 2026-03-28  
**Parallx file:** `src/openclaw/openclawSubagentSpawn.ts`  
**Test file:** `tests/unit/openclawSubagentSpawn.test.ts`  
**Upstream commit:** `e635cedb` (indexed 2026-03-27)

---

## Summary

| Capability | Classification | Disposition | Priority |
|-----------|---------------|-------------|----------|
| D5.2: SubagentRegistry history pruning | MISALIGNED → ALIGNED | RECOMMENDED | LOW |
| D5.2: SubagentRegistry descendant tracking | MISALIGNED | DEFERRED | — |
| D5.3: ISubagentSpawnParams missing fields | MISALIGNED | DEFERRED | — |
| D5.4: ISubagentRun missing upstream fields | MISALIGNED | DEFERRED | — |

**10/13 capabilities already ALIGNED. 2 N/A (desktop adaptations). 3 MISALIGNED — all LOW severity.**

This is one of Parallx's best-aligned domains. The core spawn lifecycle (validate → register → execute → announce → cleanup) matches upstream `spawnSubagentDirect()`. The three misalignments are structural simplifications appropriate for single-user desktop, with only history pruning warranting near-term action.

---

## Change Plan

---

### D5.2a: SubagentRegistry History Pruning — RECOMMENDED (LOW)

- **Status**: MISALIGNED → ALIGNED
- **Upstream**: `src/agents/subagent-registry.ts`, `sweepSubagentRuns()` — timer-based sweeper that archives/removes completed runs exceeding retention thresholds; `src/cron/run-log.ts` uses configurable retention cap per JSONL log
- **Parallx file**: `src/openclaw/openclawSubagentSpawn.ts`, `SubagentRegistry` class (~lines 130–195)
- **Action**:
  1. Add a `MAX_REGISTRY_HISTORY` constant (e.g., `100`). This matches the pattern established in D4.10 (`MAX_RUN_HISTORY = 200`) for bounded in-memory collections.
  2. In `SubagentRegistry.register()`, after inserting a new run, prune completed runs that exceed the cap. Only completed/failed/timeout/cancelled runs are candidates for pruning (never active runs):
     ```ts
     export const MAX_REGISTRY_HISTORY = 100;

     // In register(), after this._runs.set(id, run):
     this._pruneCompletedRuns();

     private _pruneCompletedRuns(): void {
       const completed = [...this._runs.values()]
         .filter(r => r.status !== 'spawning' && r.status !== 'running');
       if (completed.length <= MAX_REGISTRY_HISTORY) return;
       // Sort oldest-first by completedAt (null → spawnedAt fallback)
       completed.sort((a, b) => (a.completedAt ?? a.spawnedAt) - (b.completedAt ?? b.spawnedAt));
       const excess = completed.length - MAX_REGISTRY_HISTORY;
       for (let i = 0; i < excess; i++) {
         this._runs.delete(completed[i].id);
       }
     }
     ```
  3. Export the constant so tests can reference it.
- **Remove**: Nothing — this is additive. The existing `_runs` Map stays, we just bound its growth.
- **Verify**:
  - Register `MAX_REGISTRY_HISTORY + 10` runs, complete all of them, register one more → total completed ≤ `MAX_REGISTRY_HISTORY`
  - Active (running/spawning) runs are never pruned regardless of count
  - Oldest completed runs are pruned first (FIFO)
  - Existing 32 tests continue to pass (none depend on unbounded accumulation)
- **Risk**: Minimal. This is the same pattern as D4.10 `MAX_RUN_HISTORY`. No behavioral change for normal usage — pruning only triggers after 100+ completed runs. Desktop sub-agent sessions rarely exceed single digits.

---

### D5.2b: SubagentRegistry Descendant Tracking — DEFERRED

- **Status**: MISALIGNED (remains MISALIGNED, deferred)
- **Upstream**: `src/agents/subagent-registry.ts`, `countPendingDescendantRuns()`, `countActiveDescendantRuns()` — traverse parent→child run tree for aggregate queries; `SubagentRunRecord.parentRunId`, `childRunIds` fields
- **Parallx file**: `src/openclaw/openclawSubagentSpawn.ts`, `SubagentRegistry`
- **Rationale for deferral**: Descendant tracking enables multi-agent tree queries (e.g., "how many sub-tasks are pending across the entire spawn tree?"). Parallx is single-agent desktop with `DEFAULT_MAX_SPAWN_DEPTH = 3` — spawn trees are shallow and short-lived. There are no consumers of tree queries in the current codebase.
- **Action (deferred)**:
  1. Add `parentRunId: string | null` and `childRunIds: string[]` to `ISubagentRun`
  2. Wire `parentRunId` from caller context during `register()`
  3. Update parent's `childRunIds` when a child is registered
  4. Add `getDescendantRuns(rootId: string): ISubagentRun[]` to registry
- **Deviation marker**: Add JSDoc `@deviation` tag on `ISubagentRun`:
  ```ts
  /**
   * @deviation D5.2b — Upstream tracks parentRunId/childRunIds for tree queries.
   * Deferred: single-agent desktop has shallow spawn trees with no tree-query consumers.
   */
  ```
- **Trigger for implementation**: When Parallx adds multi-agent support or spawn depth > 3.

---

### D5.3: ISubagentSpawnParams Missing Upstream Fields — DEFERRED

- **Status**: MISALIGNED (remains MISALIGNED, deferred)
- **Upstream**: `src/agents/subagent-spawn.ts`, `SpawnSubagentParams`, lines 52-76 — defines `agentId`, `thinking`, `thread`, `mode`, `cleanup`, `sandbox`, `expectsCompletionMessage`, `attachments`, `attachMountPath`
- **Parallx file**: `src/openclaw/openclawSubagentSpawn.ts`, `ISubagentSpawnParams` (~lines 72-83)
- **Rationale for deferral**: All missing fields are N/A for single-agent desktop:
  | Field | Upstream purpose | Why N/A |
  |-------|-----------------|---------|
  | `agentId` | Cross-agent targeting | Single agent — no routing needed |
  | `thinking` | Thinking-level config | Not yet exposed in Parallx UI |
  | `thread` | Thread-bound sessions | Single chat surface, no thread binding |
  | `mode` | `"run"` \| `"session"` | Only `"run"` mode — documented adaptation |
  | `cleanup` | `"delete"` \| `"keep"` | In-memory runs, no session to delete |
  | `sandbox` | `"inherit"` \| `"require"` | No sandboxed runtimes on desktop |
  | `expectsCompletionMessage` | Delivery mode | Direct delegate call, always delivered |
  | `attachments` | File mount workflow | No file-mount for desktop sub-tasks |
  | `attachMountPath` | Mount target path | Same as above |
- **Action (deferred)**: Add `@deviation` JSDoc on `ISubagentSpawnParams`:
  ```ts
  /**
   * Parameters for spawning a sub-agent.
   * Upstream: SpawnSubagentParams (src/agents/subagent-spawn.ts:52-76).
   *
   * @deviation D5.3 — Upstream defines agentId, thinking, thread, mode, cleanup,
   * sandbox, expectsCompletionMessage, attachments, attachMountPath. All N/A for
   * single-agent desktop (no cross-agent routing, no persistent sub-sessions,
   * no sandbox runtimes, no file-mount workflow).
   */
  ```
- **Trigger for implementation**: When Parallx adds multi-agent support, thinking-level config, or file-attachment workflows.

---

### D5.4: ISubagentRun Missing Upstream Fields — DEFERRED

- **Status**: MISALIGNED (remains MISALIGNED, deferred)
- **Upstream**: `src/agents/subagent-registry.types.ts`, `SubagentRunRecord` — defines `parentRunId`, `childRunIds`, `childSessionKey`, `controllerSessionKey`, `requesterSessionKey`, `requesterOrigin`, `workspaceDir`, `createdAt`, `startedAt`, `endedAt`, `outcome` (structured), `cleanup`, `spawnMode`, `archiveAtMs`, `announceRetryCount`, `outputTokens`
- **Parallx file**: `src/openclaw/openclawSubagentSpawn.ts`, `ISubagentRun` (~lines 87-99)
- **Rationale for deferral**: Missing fields fall into three categories:
  1. **Tree tracking** (`parentRunId`, `childRunIds`) — covered by D5.2b deferral
  2. **Multi-session** (`childSessionKey`, `controllerSessionKey`, `requesterSessionKey`, `requesterOrigin`) — N/A for single-agent desktop with no gateway
  3. **Server reliability** (`archiveAtMs`, `announceRetryCount`, `cleanup`, `spawnMode`) — N/A for short-lived in-memory desktop runs
  4. **Metrics** (`outputTokens`, structured `outcome`) — nice-to-have but not required for MVP
- **Action (deferred)**: Add `@deviation` JSDoc on `ISubagentRun`:
  ```ts
  /**
   * A tracked sub-agent run.
   * Upstream: SubagentRunRecord (src/agents/subagent-registry.types.ts).
   *
   * @deviation D5.4 — Upstream tracks 25+ fields for multi-session server with
   * persistence, tree queries, and announce retry. Parallx tracks 11 fields for
   * single-agent desktop with in-memory runs consumed immediately. Missing:
   * parentRunId/childRunIds (D5.2b), session keys (N/A), archiveAtMs (N/A),
   * announceRetryCount (N/A), outputTokens (future metrics).
   */
  ```
- **Trigger for implementation**: Incremental — `outputTokens` when token tracking is added; tree fields when D5.2b is implemented; session keys if multi-agent is added.

---

## Dependency Order

1. **D5.2a** (history pruning) — standalone, no dependencies
2. **D5.3** (deviation JSDoc) — standalone, no dependencies
3. **D5.4** (deviation JSDoc) — standalone, no dependencies
4. **D5.2b** (descendant tracking) — depends on D5.4 adding `parentRunId`/`childRunIds` first

Items 1–3 can be implemented in parallel. Item 4 is deferred.

---

## Cross-File Impact

| Change | Files affected |
|--------|---------------|
| D5.2a: `MAX_REGISTRY_HISTORY` + pruning | `src/openclaw/openclawSubagentSpawn.ts`, `tests/unit/openclawSubagentSpawn.test.ts` |
| D5.3: JSDoc deviation | `src/openclaw/openclawSubagentSpawn.ts` only |
| D5.4: JSDoc deviation | `src/openclaw/openclawSubagentSpawn.ts` only |
| D5.2b: tree fields (deferred) | `src/openclaw/openclawSubagentSpawn.ts`, tests, any future tree-query consumers |

No type-level breaking changes. All modifications are additive or documentation-only.

---

## Anti-Pattern Compliance (M41)

| Anti-Pattern | Status |
|-------------|--------|
| Preservation bias | ✅ Not preserving broken code — existing code is correct |
| Patch-thinking | ✅ History pruning is clean addition, not a patch over broken accumulation |
| Wrapper framing | ✅ No wrappers proposed |
| Output repair | ✅ No output repair |
| Pre-classification | ✅ No routing heuristics |
| Eval-driven patchwork | ✅ No test-driven patches |

---

## Platform Adaptation Summary

| Upstream pattern | Parallx adaptation | Documented |
|-----------------|-------------------|-----------|
| Disk persistence (`subagent-registry-state.ts`) | In-memory Map | Yes (audit D5.2) |
| Multi-session gateway spawning | Delegate pattern (`SubagentTurnExecutor`) | Yes (header comment) |
| `"session"` spawn mode | Only `"run"` mode | Yes (type + comment) |
| Orphan recovery (`subagent-orphan-recovery.ts`) | Not needed — runs are short-lived desktop | Yes (audit N/A table) |
| Announce retry with idempotency keys | Single fire-and-forget delegate call | Yes (audit D5.9) |
| `agentId` cross-agent targeting | Single agent — not applicable | Yes (D5.3 deviation) |
| Sandbox enforcement | No sandboxed runtimes on desktop | Yes (D5.3 deviation) |
