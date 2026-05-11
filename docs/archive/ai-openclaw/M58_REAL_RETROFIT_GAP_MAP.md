# M58-real Retrofit Gap Map

**Input:** `M58_REAL_RETROFIT_AUDIT.md`
**Reference implementation (local):** `src/openclaw/openclawSubagentExecutor.ts` (W5, 15/15 ALIGNED)
**Upstream reference:** openclaw `e635cedb`:
- `runtime-agents/heartbeat-runner.ts` — heartbeat turn invocation + system-event framing
- `runtime-agents/cron-tool.ts` — cron fire with agentTurn execution

---

## Planned changes

### 1. `src/openclaw/openclawHeartbeatExecutor.ts` (full rewrite)

**Upstream / local citation:** `openclawSubagentExecutor.ts#createSubagentTurnExecutor` — the "createEphemeralSession → sendRequest → extract → purge in finally" pattern, applied per-reason with the new reason→behavior matrix.

**New types:**
- `IHeartbeatChatService` — narrow ChatService shape (mirrors `ISubagentChatService`).
- `IHeartbeatRealTurnDeps` — `{ chatService, getParentSessionId, debounceMs?, now? }`.

**New factory signature:**
```ts
createHeartbeatTurnExecutor(
  router: ISurfaceRouterService,
  getConfig: () => IHeartbeatExecutorConfig,
  realTurnDeps?: IHeartbeatRealTurnDeps, // ← NEW, optional
): HeartbeatTurnExecutor
```

**Behavior (pseudo):**
```
if (reason not in allowlist) return
if (reason === 'cron') return                     // delegated
status.sendWithOrigin(flash, ORIGIN_HEARTBEAT)
if (reason === 'interval' || !realTurnDeps) {
  status.sendWithOrigin(idle, ORIGIN_HEARTBEAT)
  return
}
parentId = realTurnDeps.getParentSessionId()
if (!parentId) { idle; return }
if (reason === 'system-event') {
  keys = unique(events.map(computeDebounceKey))
  if (all keys within debounceMs of last fire) { idle-debounced; return }
  update last-fired timestamps
}
handle = createEphemeralSession(parentId, { systemMessage, firstUserMessage })
try {
  sendRequest(handle.sessionId, userMessage)
  text = extractFinalAssistantText(lastPair.response.parts)
  if (text) chat.sendWithOrigin({ heartbeatResult: true, reason, ... }, ORIGIN_HEARTBEAT)
} catch (err) {
  chat.sendWithOrigin({ heartbeatResult: true, error: true, content: `Heartbeat turn error: ${msg}` }, ORIGIN_HEARTBEAT)
} finally {
  purgeEphemeralSession(handle)    // mirrors subagent executor L177-181
  status.sendWithOrigin(idle, ORIGIN_HEARTBEAT)
}
```

**Debounce:** closure-local `Map<string, number>` keyed by `${event.type}|${payload.path || json(payload)}`.

**Seed text:** `buildSeedSystemMessage` + `buildSeedUserMessage` render the reason + events array into readable prompts. Event payloads are serialized per-event, truncated at 10.

---

### 2. `src/openclaw/openclawCronExecutor.ts` (full rewrite)

**Local citation:** same subagent executor pattern (`createSubagentTurnExecutor` L157-185) but with thin fallback preserved for `agentTurn`-less jobs.

**New types:**
- `ICronChatService` — narrow ChatService shape.
- `ICronRealTurnDeps` — `{ chatService, getParentSessionId }`.

**New factory signature:**
```ts
createCronTurnExecutor(
  router: ISurfaceRouterService,
  realTurnDeps?: ICronRealTurnDeps, // ← NEW, optional
): CronTurnExecutor
```

**Behavior (pseudo):**
```
agentTurn = job.payload.agentTurn?.trim() || ''
status.sendWithOrigin(flash, ORIGIN_CRON)
parentId = realTurnDeps?.getParentSessionId()
canRunRealTurn = agentTurn && realTurnDeps && parentId
if (!canRunRealTurn) {
  notifications.sendWithOrigin(info, ORIGIN_CRON) // legacy thin path
  status.sendWithOrigin(idle, ORIGIN_CRON)
  return
}
systemMessage = `This is a scheduled cron job "${name}" firing at ${iso}. ...`
userMessage = ['Previous chat context:', ...contextLines, '', `Task: ${agentTurn}`].join('\n')
handle = createEphemeralSession(parentId, { systemMessage, firstUserMessage: userMessage })
try {
  sendRequest(handle.sessionId, userMessage)
  text = extractFinalAssistantText(...)
  if (text) chat.sendWithOrigin({ cronResult: true, jobId, jobName }, ORIGIN_CRON)
} catch (err) {
  chat.sendWithOrigin({ cronResult: true, error: true, content: `Cron turn error: ${msg}` }, ORIGIN_CRON)
  thrownError = err
} finally {
  purgeEphemeralSession(handle)
  status.sendWithOrigin(idle, ORIGIN_CRON)
}
if (thrownError) throw thrownError   // propagate so CronService records success=false
```

**Context-line seeding rationale:** `IEphemeralSessionSeed` does not yet support prior message pairs. Folding context lines into the user message preserves the intent ("model sees recent chat before executing the task") without widening the substrate API. Swap to proper prior-message seeding is a 5-line executor change when the substrate adds it.

**Status flash placement:** fires BEFORE `createEphemeralSession` so the user sees cron activity even if the turn takes seconds (tested in `openclawCronExecutorRealTurn.test.ts > "status flash fires before real turn completes"`).

---

### 3. `src/built-in/chat/main.ts` (two wiring updates)

**Cron executor instantiation** (in the `if (surfaceRouter) { ... cronService = new CronService(...) }` block):

```ts
const chatServiceForCron = chatService as unknown as ChatService;
const cronExecutor = createCronTurnExecutor(surfaceRouter, {
  chatService: {
    createEphemeralSession: (parentId, seed) => chatServiceForCron.createEphemeralSession(parentId, seed),
    purgeEphemeralSession: (handle) => chatServiceForCron.purgeEphemeralSession(handle),
    sendRequest: (sid, msg, opts) => chatService.sendRequest(sid, msg, opts),
    getSession: (sid) => chatService.getSession(sid),
  },
  getParentSessionId: () => _activeWidget?.getSession()?.id,
});
```

**Heartbeat executor instantiation** (in the `if (surfaceRouter && unifiedConfigService)` block):

```ts
const executor = createHeartbeatTurnExecutor(
  surfaceRouter,
  () => ({ reasons: unifiedConfigService.getEffectiveConfig().heartbeat.reasons }),
  {
    chatService: { ... as above ... },
    getParentSessionId: () => _activeWidget?.getSession()?.id,
  },
);
```

---

### 4. Tests (new)

- `tests/unit/openclawHeartbeatExecutorRealTurn.test.ts` — 14 tests covering:
  interval status-only, cron no-op, system-event real turn, wake/hook real turns, debounce (same-path, different-paths, window-expiry, wake-not-debounced), no-session skip, send failure with purge, origin stamp, loop-safety, allowlist still blocks real-turn reasons.

- `tests/unit/openclawCronExecutorRealTurn.test.ts` — 8 tests covering:
  agentTurn set → real turn + result card, agentTurn unset → thin path, contextLines seeding, no parent session fallback, real-turn failure rethrow, origin stamp, status flash-first ordering, factory without deps.

- `tests/unit/m58RealAutonomy.test.ts` — 4 integration scenarios covering:
  file-save → heartbeat result card, cron → cronResult card, no session pollution across both, heartbeat origin deliveries do not re-enter event queue.

---

## What is NOT changing

- `openclawHeartbeatRunner.ts` — unchanged. Debounce lives in the executor because the runner is already audit-closed and its API would need a new surface for tests to reach the debounce buffer. Executor-local is the smallest-blast-radius choice.
- `openclawCronService.ts` — unchanged. `ICronRunResult` is NOT extended with real-turn metadata; the existing `success` / `error` fields carry outcome correctly (executor rethrows on failure).
- `chatSessionPersistence.ts` / `chatService.ts` — unchanged. The W5 substrate is used as-is; no API widening.
- `surfaceRouterService.ts` — unchanged. `sendWithOrigin(ORIGIN_HEARTBEAT | ORIGIN_CRON)` already exists.
- `unifiedConfigTypes.ts` — unchanged. `heartbeat.reasons` allowlist unchanged. `heartbeat.enabled = false` default retained.
