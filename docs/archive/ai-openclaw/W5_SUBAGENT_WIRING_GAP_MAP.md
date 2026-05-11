# W5 — SubagentSpawner Wiring Gap Map

**Milestone:** M58 (Wake Parallx)
**Domain:** W5
**Branch:** `milestone-58`
**Source audit:** `W5_SUBAGENT_WIRING_AUDIT.md`
**Baseline upstream:** `github.com/openclaw/openclaw@e635cedb`

---

## Change plan

### Change 1 — Ephemeral session substrate (`src/services/chatSessionPersistence.ts`)

**Upstream ref:** OpenClaw isolated session fork — scratch-scope sessions.

Add module-exported sentinel + helper and persistence guards:

- Export `EPHEMERAL_SESSION_ID_PREFIX = 'ephemeral-'`.
- Export `isEphemeralSessionId(id: string): boolean`.
- `saveSession(session)` — early return `{ ok: true }` when
  `isEphemeralSessionId(session.id)`.
- `deletePersistedSession(id)` — early return when id is ephemeral.

### Change 2 — Ephemeral session API on `ChatService` (`src/services/chatService.ts`)

**Upstream ref:** `spawnSubagentDirect` step 2-3 (create isolated session,
inherit model/mode).

- Export `IEphemeralSessionSeed` (task text, optional systemMessage,
  toolsEnabled, loopSafetyContext captured but not consumed — M59).
- Export `IEphemeralSessionHandle` (sessionId, parentId, seed snapshot).
- `createEphemeralSession(parentId, seed)`:
  - Generates id `ephemeral-<nanoid>`.
  - Inserts session into `_sessions` map with parent's mode + model.
  - **Does not** emit `_onDidCreateSession` (UI stays quiet).
  - Seeds `messages[]` as empty so `sendRequest` can run normally.
- `purgeEphemeralSession(handle)`:
  - Cancels in-flight `CancellationTokenSource` if present.
  - Removes from `_sessions`.
  - **Does not** emit `_onDidDeleteSession`.
- `getSessions()` filters out ephemeral ids.
- `_schedulePersist` early-returns on ephemeral ids.
- `getSession(id)` continues to return ephemeral by id (lookup still
  works during `sendRequest`).

### Change 3 — Always-approval policy (`src/openclaw/openclawToolPolicy.ts`)

**Upstream ref:** OpenClaw privileged-tool policy layer.

- `subagentToolRequiresApproval(_name): boolean` — constant `true`.
- `subagentToolPermissionLevel(_name): ToolPermissionLevel` — constant
  `'requires-approval'`.

No workspace-setting override. No dev-mode bypass.

### Change 4 — Subagent executor + announcer (NEW: `src/openclaw/openclawSubagentExecutor.ts`)

**Upstream ref:** `subagent-spawn.ts:140-320` (sendLLMRequest +
collectFinalResponse + announce).

- Module-level `_subagentDepth` counter (JS is single-threaded; no race).
- `currentSubagentDepth()` and `_resetSubagentDepthForTests()`.
- `extractFinalAssistantText(parts)` — joins `content / code / message`
  fields from the last assistant message parts.
- `createSubagentTurnExecutor({ chatService, getParentSessionId,
  buildSendOptions? })`:
  1. Throws if no active parent session id.
  2. `chatService.createEphemeralSession(parentId, { firstUserMessage:
     task, ... })`.
  3. `_subagentDepth++`.
  4. Calls `chatService.sendRequest(ephemeralId, task, buildSendOptions?
     (model))`.
  5. Reads last message pair's response parts via `getSession`.
  6. Returns `extractFinalAssistantText(parts)`.
  7. `finally { _subagentDepth--; chatService.purgeEphemeralSession() }`.
- `createSubagentAnnouncer({ surfaceRouter, getParentSessionId })`:
  - Calls `surfaceRouter.sendWithOrigin({ surfaceId: SURFACE_CHAT,
    content, metadata: { subagentResult: true, runId, label, task,
    parentSessionId, durationMs } }, ORIGIN_SUBAGENT)`.

### Change 5 — `sessions_spawn` tool (NEW: `src/built-in/chat/tools/subagentTools.ts`)

**Upstream ref:** `sessions-spawn-tool.ts:1-212` (run mode only).

- `createSessionsSpawnTool(spawner?: SubagentSpawner): IBuiltInTool`.
- `requiresConfirmation: true`,
  `permissionLevel: subagentToolPermissionLevel('sessions_spawn')`.
- Args: `task` (required), `label`, `model`, `tools[]` (captured,
  informational for M59), `timeoutMs`.
- Handler:
  - Missing spawner → `isError: true`, error "Subagent spawning is not
    available in this session".
  - Missing `task` → `isError: true`.
  - `currentSubagentDepth() > 0` → `isError: true`, error mentions max
    depth 1 + caller depth. Registry stays clean.
  - Converts `timeoutMs` → `runTimeoutSeconds = Math.ceil(timeoutMs / 1000)`.
  - Calls `spawner.spawn({ task, label, model, runTimeoutSeconds,
    callerDepth: currentSubagentDepth() })`.
  - Returns JSON string with `ok/runId/status/durationMs/result/error`.

### Change 6 — Register the tool (`src/built-in/chat/tools/builtInTools.ts`)

- Import `createSessionsSpawnTool` + `SubagentSpawner`.
- Add `subagentSpawner?: SubagentSpawner` as 13th parameter.
- Append `createSessionsSpawnTool(subagentSpawner)` to tools array.

### Change 7 — Activation wiring (`src/built-in/chat/main.ts`)

**Upstream ref:** OpenClaw agent activation — subagent subsystem attaches
to surface router + chat service.

Inside extension activation, after `cron` block, before
`registerBuiltInTools`:

```ts
let subagentSpawner: SubagentSpawner | undefined;
if (surfaceRouter) {
  const getParentSessionId = () => _activeWidget?.getSession()?.id;
  const chatServiceForSubagent = chatService as unknown as
    import('../../services/chatService.js').ChatService;
  const subagentExecutor = createSubagentTurnExecutor({
    chatService: {
      createEphemeralSession: (p, s) =>
        chatServiceForSubagent.createEphemeralSession(p, s),
      purgeEphemeralSession: (h) =>
        chatServiceForSubagent.purgeEphemeralSession(h),
      sendRequest: (sid, msg, opts) =>
        chatService.sendRequest(sid, msg, opts),
      getSession: (sid) => chatService.getSession(sid),
    },
    getParentSessionId,
  });
  const subagentAnnouncer = createSubagentAnnouncer({
    surfaceRouter,
    getParentSessionId,
  });
  subagentSpawner = new SubagentSpawner(
    subagentExecutor,
    subagentAnnouncer,
    /* maxDepth */ 1,
  );
  context.subscriptions.push(subagentSpawner);
}
```

Pass `subagentSpawner` as the 13th arg to `registerBuiltInTools(...)`.

### Change 8 — Tests

#### 8a. `tests/unit/ephemeralSessionSubstrate.test.ts` (NEW)

14 tests — sentinel prefix, handle shape, `getSessions` exclusion,
persistence guards, no onDidCreate/onDidDelete, mode/model inheritance,
parent `messages[]` untouched.

#### 8b. `tests/unit/openclawSubagentWiring.test.ts` (NEW)

17 tests —
- `extractFinalAssistantText` (2)
- Executor: happy path + no-parent throw + purge-on-error + depth=1
  observable during spawn (4)
- Announcer: ORIGIN_SUBAGENT + full metadata (1)
- Policy: always-approval invariants (2)
- Tool: definition requires-confirmation + permission-level (1)
- Tool: happy path (1)
- Tool: missing task, missing spawner (2)
- Tool: depth-2 rejection via nested real executor (1)
- Tool: SubagentSpawner belt-and-braces rejection (1)
- Tool: timeout path with slow executor (1)
- Tool: executor error bubbles as failed result (1)

#### 8c. Regression updates

- `tests/unit/builtInTools.test.ts`: expected tool count 32 → 33, insert
  `'sessions_spawn'` in alphabetical list.
- `tests/unit/chatGateCompliance.test.ts`: add
  `'tools/subagentTools.ts': []` to `FOLDER_RULES`.

## Non-goals (deferred to M59)

- Seed `systemMessage`, `toolsEnabled`, `loopSafetyContext` captured on
  the handle but not yet consumed.
- `tools[]` allowlist on `sessions_spawn` tool captured but not enforced.
- Shared ChatToolLoopSafety counter across parent + subagent — currently
  per-turn instances; maxDepth=1 + runTimeoutSeconds are the structural
  guards.
- `"session"` mode (persistent sub-sessions) — deliberately not ported
  (D5.3 deviation).
