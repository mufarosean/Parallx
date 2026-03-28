# F13: Legacy Prompt Elimination — GAP MAP

**Date:** 2026-03-27  
**Iteration:** 1  
**Based on:** `docs/F13_LEGACY_PROMPT_ELIMINATION_AUDIT.md`

---

## Implementation Order

| Step | Capability | File(s) | Action |
|------|-----------|---------|--------|
| 1a | F13-1 | `src/services/chatRuntimeTypes.ts` | Add `promptText?: string` to `IOpenclawSystemPromptReport` |
| 1b | F13-1 | `src/openclaw/openclawPromptArtifacts.ts` | Store `promptText: systemPrompt` in report |
| 1c | F13-1 | `src/built-in/chat/data/chatDataService.ts` | Rewrite `getSystemPrompt` to read cached report; remove `composeChatSystemPrompt` import |
| 2 | F13-2 | `src/built-in/chat/widgets/chatTokenStatusBar.ts` | Remove `buildSystemPrompt` import + entire fallback block |
| 3 | F13-3 | `src/built-in/chat/config/chatSystemPrompts.ts` | **DELETE FILE** |
| 4 | F13-4 | `src/built-in/chat/utilities/chatSystemPromptComposer.ts` | **DELETE FILE** |
| 5a | F13-5 | `tests/unit/chatSystemPrompts.test.ts` | **DELETE FILE** |
| 5b | F13-5 | `tests/unit/chatSystemPromptComposer.test.ts` | **DELETE FILE** |
| 5c | F13-5 | `tests/unit/chatGateCompliance.test.ts` | Remove 2 FOLDER_RULES entries, update tokenStatusBar entry |
| 6 | Secondary | `ARCHITECTURE.md` | Remove stale `chatSystemPrompts.ts` row |

---

## Per-Gap Change Plans

### F13-1: System prompt viewer shows real OpenClaw prompt

**Upstream:** OpenClaw has a single builder `buildEmbeddedSystemPrompt`. The prompt text is built once per turn and cached. There is no secondary "viewer" builder.

**Step 1a: Add `promptText` to `IOpenclawSystemPromptReport`**

File: `src/services/chatRuntimeTypes.ts` ~line 112

Add `readonly promptText?: string` to the interface. Non-breaking — new optional field.

**Step 1b: Cache `promptText` in report during artifact construction**

File: `src/openclaw/openclawPromptArtifacts.ts` ~line 77

Add `promptText: systemPrompt` to the returned report object (the `systemPrompt` variable is already in scope).

**Step 1c: Rewrite `getSystemPrompt` in `chatDataService.ts`**

File: `src/built-in/chat/data/chatDataService.ts` lines 63 and 2134

Before:
```ts
import { composeChatSystemPrompt } from '../utilities/chatSystemPromptComposer.js';
...
getSystemPrompt: () => composeChatSystemPrompt({...20 lines of context assembly...}),
```

After:
```ts
// import removed
...
getSystemPrompt: async () => {
  const report = this.getLastSystemPromptReport();
  if (report?.promptText) {
    return report.promptText;
  }
  return '(No system prompt generated yet — send a message first)';
},
```

---

### F13-2: Token status bar removes legacy fallback

**Upstream:** No "pre-turn fallback" to a separate builder. Before the first turn, there's no data.

File: `src/built-in/chat/widgets/chatTokenStatusBar.ts`

- Remove import of `buildSystemPrompt` from `../config/chatSystemPrompts.js` (line 23)
- Remove the entire `else` block (lines 281-322) that builds `ISystemPromptContext` and calls legacy `buildSystemPrompt()`
- Keep only the `if (promptReport)` branch + comment that pre-turn estimates are 0

---

### F13-3: Delete legacy builder file

File: `src/built-in/chat/config/chatSystemPrompts.ts` — **DELETE**

Depends on: F13-1 and F13-2 completing first (all consumers migrated).

---

### F13-4: Delete legacy composer file

File: `src/built-in/chat/utilities/chatSystemPromptComposer.ts` — **DELETE**

Depends on: F13-1 completing first (chatDataService import removed).

---

### F13-5: Clean tests and gate compliance

**Delete files:**
- `tests/unit/chatSystemPrompts.test.ts` (~400 lines)
- `tests/unit/chatSystemPromptComposer.test.ts` (~45 lines)

**Update gate compliance:** `tests/unit/chatGateCompliance.test.ts`
- Remove: `'config/chatSystemPrompts.ts': []` (~line 57)
- Remove: `'utilities/chatSystemPromptComposer.ts': ['config/']` (~line 110)
- Update: `'widgets/chatTokenStatusBar.ts': ['chatIcons', 'config/']` → `'widgets/chatTokenStatusBar.ts': ['chatIcons']` (no longer imports from config/)

---

### Secondary: ARCHITECTURE.md stale reference

File: `ARCHITECTURE.md` line 314

Remove row: `| chatSystemPrompts.ts | Mode-aware system prompt builder... |`

---

## Cross-File Impact

| Concern | Impact |
|---------|--------|
| `IOpenclawSystemPromptReport` type change | Non-breaking — new optional field `promptText` |
| `chatWidgetSessionAdapter.ts` | No change — `getSystemPrompt` signature unchanged |
| `chatTokenBarAdapter.ts` | No change — already wires `getLastSystemPromptReport` |
| `chatWidget.ts` | No change — calls `getSystemPrompt()` which now returns cached text |
| `ISystemPromptContext` type | Still used by `openclawSystemPrompt.ts` via `chatTypes.ts` — NOT deleted |
