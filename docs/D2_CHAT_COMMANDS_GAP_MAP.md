# D2 Chat Commands — Gap Map

**Generated:** 2026-03-28 | Iteration 1 Structural Audit

## Gap Summary

| # | Command    | Status    | Gap Type | Blocking? |
|---|-----------|-----------|----------|-----------|
| 1 | `/status`  | MISSING   | No command registration, no handler | No |
| 2 | `/new`     | PARTIAL   | Widget-layer command exists, no slash command bridge | Medium — needs session bridge |
| 3 | `/models`  | MISSING   | No command registration, no handler, needs service delegate | No |
| 4 | `/doctor`  | MISSING   | No unified diagnostic runner | No |
| 5 | `/think`   | PARTIAL   | Request-level flag exists, no session toggle | Medium — needs session state |
| 6 | `/usage`   | PARTIAL   | Per-turn data exists, no cumulative view | No |
| 7 | `/tools`   | PARTIAL   | Tool state exists in /context, no standalone command | No |
| 8 | `/verbose` | MISSING   | No verbose concept at all | Medium — needs new subsystem |

## Required Service Extensions

1. **`IDefaultParticipantServices` additions needed:**
   - `listModels?(): Promise<readonly ILanguageModelInfo[]>` — for `/models`
   - `checkProviderStatus?(): Promise<IProviderStatus>` — for `/status` and `/doctor`
   - `getSessionFlag?(key: string): boolean` — for `/think`, `/verbose` state
   - `setSessionFlag?(key: string, value: boolean): void` — for `/think`, `/verbose` state
   - `executeCommand?(commandId: string): Promise<void>` — for `/new` to bridge to `chat.newSession`

2. **`OPENCLAW_COMMANDS` registry:** Add 8 entries (pure data, no logic)

3. **Participant `commands` array:** Add 8 entries for UI slash menu

## Implementation Files Needed

- [ ] `src/openclaw/commands/openclawStatusCommand.ts`
- [ ] `src/openclaw/commands/openclawNewCommand.ts`
- [ ] `src/openclaw/commands/openclawModelsCommand.ts`
- [ ] `src/openclaw/commands/openclawDoctorCommand.ts`
- [ ] `src/openclaw/commands/openclawThinkCommand.ts`
- [ ] `src/openclaw/commands/openclawUsageCommand.ts`
- [ ] `src/openclaw/commands/openclawToolsCommand.ts`
- [ ] `src/openclaw/commands/openclawVerboseCommand.ts`
- [ ] `tests/unit/openclawSlashCommands.test.ts`

## Modifications to Existing Files

- [ ] `src/openclaw/openclawDefaultRuntimeSupport.ts` — add 8 command entries to `OPENCLAW_COMMANDS`
- [ ] `src/openclaw/participants/openclawDefaultParticipant.ts` — add dispatch for 8 new commands + add to `commands` array 
- [ ] `src/openclaw/openclawTypes.ts` — extend `IDefaultParticipantServices` with new delegates
- [ ] `src/openclaw/openclawParticipantServices.ts` — wire new delegates in adapter
- [ ] `src/built-in/chat/main.ts` — provide new service delegates at construction time
