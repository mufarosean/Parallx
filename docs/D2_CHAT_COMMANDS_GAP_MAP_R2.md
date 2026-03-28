# D2 Chat Commands — Gap Map (Iteration 2)

**Updated:** 2026-03-28 | Post-Refinement Audit

## Gap Summary

| # | Command    | Status    | Gap Type | Notes |
|---|-----------|-----------|----------|-------|
| 1 | `/status`  | ✅ CLOSED | Fully wired end-to-end | R1 fix: main.ts wiring |
| 2 | `/new`     | ✅ CLOSED | Bridge + flag clearing | R1+R3 fix |
| 3 | `/models`  | ✅ CLOSED | Fully wired with fallback | R1 fix: main.ts wiring |
| 4 | `/doctor`  | ✅ CLOSED | All 9 diagnostic checks wired | R1 fix |
| 5 | `/think`   | ✅ CLOSED | Session toggle + turn injection | R1 fix: session flags wired |
| 6 | `/usage`   | ✅ CLOSED | No wiring gap (uses context.history) | Already complete |
| 7 | `/tools`   | ✅ CLOSED | No wiring gap (uses service.getToolDefinitions) | Already complete |
| 8 | `/verbose` | ✅ CLOSED | Session toggle + turn debug header | R1+R2 fix |

## Service Wiring Status

All D2 service delegates are now wired in `src/built-in/chat/main.ts`:

| Delegate | Provider | Status |
|----------|----------|--------|
| `listModels` | `_ollamaProvider.listModels()` | ✅ WIRED |
| `checkProviderStatus` | `_ollamaProvider.checkAvailability()` | ✅ WIRED |
| `getSessionFlag` | `_sessionFlags.get()` | ✅ WIRED |
| `setSessionFlag` | `_sessionFlags.set()` | ✅ WIRED |
| `executeCommand` | `api.commands.executeCommand()` | ✅ WIRED |
| `getAvailableModelIds` | `_ollamaProvider.listModels()` | ✅ WIRED |
| `sendChatRequestForModel` | `_ollamaProvider.sendChatRequest()` | ✅ WIRED |

## Remaining Risk Items

1. **Session flag scope:** Module-level Map, not per-session scoped. Acceptable for single-session, flag for multi-session work.
2. **Verbose HTML rendering:** `<details>` tag used for debug output, depends on markdown renderer support.
3. **Model fallback bypass:** `sendChatRequestForModel` calls provider directly, skipping data service middleware.
