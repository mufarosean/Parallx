# F11: AI Configuration Surface — Gap Map (Iteration 2)

**Date:** 2026-03-27  
**Scope:** Address MISALIGNED/DEAD capabilities from Iter-2 re-audit  
**Focus:** Safe removals + wiring the most impactful dead knob

---

## Iter-2 Changes

| Gap | Priority | Description | Files |
|-----|----------|-------------|-------|
| F11-G07 | HIGH | Wire `autoRag` toggle into context engine | `openclawContextEngine.ts`, `openclawDefaultParticipant.ts` |
| F11-G08 | HIGH | Remove dead `chat.responseLength` field | `unifiedConfigTypes.ts`, `unifiedAIConfigService.ts` |
| F11-G09 | MEDIUM | Mark dead persona/suggestions/agent/memory fields `@deprecated` | `unifiedConfigTypes.ts` |

---

## F11-G07: Wire autoRag toggle

**Problem:** `retrieval.autoRag` config field exists in settings UI but the context engine always performs retrieval regardless.

**Fix:** Read `autoRag` from effectiveConfig in the default participant and pass to context engine. When `autoRag === false`, skip retrieval.

## F11-G08: Remove dead `chat.responseLength`

**Problem:** `chat.responseLength` is a config field with UI control but zero runtime consumers.

**Fix:** Remove from `IUnifiedChatConfig` type, defaults, and preset definitions.

## F11-G09: Mark dead fields @deprecated

**Problem:** Multiple config fields have zero runtime effect but look active in the UI.

**Fix:** Add `@deprecated` JSDoc to all confirmed-dead fields so they're clearly marked for future removal.
