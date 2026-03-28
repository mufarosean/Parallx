# F12 — Runtime UX Fidelity — Gap Map (Change Plans)

**Gap Mapper:** AI Senior Architect
**Date:** 2026-03-27
**Domain:** F12 — Runtime UX Fidelity
**Input:** `docs/F12_RUNTIME_UX_FIDELITY_AUDIT.md`
**Upstream baseline:** OpenClaw commit e635cedb

---

## Change Plan Overview

| Gap ID | Severity | Classification | Summary | Dependency |
|--------|----------|----------------|---------|------------|
| F12-1 | HIGH | MISALIGNED → ALIGNED | Remove ToolInvocation from strip list in `close()` | None |
| F12-2 | HIGH | MISALIGNED → ALIGNED | Add explicit `read_file` tool naming to skill prompt | None |
| F12-3 | HIGH | MISSING → ALIGNED | Add fabrication guard to skill prompt | None |
| F12-4 | MEDIUM | MISSING → ALIGNED | Add explicit user naming case to skill prompt | None |
| F12-5 | HIGH | MISALIGNED → ALIGNED | Synchronize pipeline and UI skill prompts | Depends on F12-2/3/4 |

**Dependency order:** F12-1 (independent) || F12-2/3/4 (independent) → F12-5

---

## Change Plan: F12-1 — Tool Call Persistence After Stream Close

### Gap
`close()` in `chatService.ts` strips `ToolInvocation` parts alongside `Progress` and `Reference`. Completed tool calls vanish from the message after streaming ends.

### Functional citation
Desktop workbench UX requirement — completed tool invocations carry substantive information. The renderer at `chatContentParts.ts` line 1081 already implements `_renderToolInvocation()` with full card rendering — it's just invisible after `close()`.

### File: `src/services/chatService.ts` lines 275-283

**Current:**
```typescript
for (let i = parts.length - 1; i >= 0; i--) {
  const kind = parts[i].kind;
  if (
    kind === ChatContentPartKind.Progress ||
    kind === ChatContentPartKind.ToolInvocation ||
    kind === ChatContentPartKind.Reference
  ) {
    parts.splice(i, 1);
  }
}
```

**New:**
```typescript
for (let i = parts.length - 1; i >= 0; i--) {
  const kind = parts[i].kind;
  if (
    kind === ChatContentPartKind.Progress ||
    kind === ChatContentPartKind.Reference
  ) {
    parts.splice(i, 1);
  }
}
```

**Risk:** Low. One line removed. Renderer already handles all tool invocation states.

---

## Change Plan: F12-2 + F12-3 + F12-4 — Pipeline Skill Prompt Alignment

### Gap
`buildSkillsSection()` is missing: explicit `read_file` naming (F12-2), fabrication guard (F12-3), explicit user naming handler (F12-4).

### Upstream citation
`agents/system-prompt.ts:20-37` — model must read skill file. The canonical correct version is the UI path at `chatSystemPrompts.ts` line 238-248 which already has all three.

### File: `src/openclaw/openclawSystemPrompt.ts` lines 182-193

**Current:**
```typescript
return `## Skills (mandatory)
Before replying: scan <available_skills> <description> entries.
- If exactly one skill clearly applies: read its SKILL.md at <location>, then follow it.
- If multiple could apply: choose the most specific one, then read/follow it.
- If none clearly apply: do not read any SKILL.md.
Constraints: never read more than one skill up front; only read after selecting.
When a skill drives external API writes, assume rate limits: prefer fewer larger writes, avoid tight one-item loops, serialize bursts when possible, and respect 429/Retry-After.
<available_skills>
${entries}
</available_skills>`;
```

**New:**
```typescript
return `## Skills (mandatory)
Before replying: scan <available_skills> <description> entries.
- If exactly one skill clearly applies: read its SKILL.md at <location> using read_file, then follow its instructions step by step.
- If the user explicitly names a skill (e.g. "use the X skill"): read that skill's SKILL.md at <location> using read_file, then follow its instructions.
- If multiple could apply: choose the most specific one.
- If none clearly apply: do not read any SKILL.md.
- NEVER describe a skill's instructions from memory or the description alone — always read the actual SKILL.md file first.
Constraints: never read more than one skill up front; only read after selecting.
When a skill drives external API writes, assume rate limits: prefer fewer larger writes, avoid tight one-item loops, serialize bursts when possible, and respect 429/Retry-After.
<available_skills>
${entries}
</available_skills>`;
```

**Risk:** Medium. 4 existing test assertions must be checked. 3 new assertions needed.

---

## Change Plan: F12-5 — Prompt Synchronization

### Gap
After F12-2/3/4, the pipeline path gains 4 instructions. The UI path is still missing: constraints line and rate-limit guidance.

### File: `src/built-in/chat/config/chatSystemPrompts.ts` lines 246-247

**Current (after fabrication guard, before `<available_skills>`):**
```typescript
    '- NEVER describe a skill\'s instructions from memory or the description alone — always read the actual SKILL.md file first.',
    '<available_skills>',
```

**New:**
```typescript
    '- NEVER describe a skill\'s instructions from memory or the description alone — always read the actual SKILL.md file first.',
    'Constraints: never read more than one skill up front; only read after selecting.',
    'When a skill drives external API writes, assume rate limits: prefer fewer larger writes, avoid tight one-item loops, serialize bursts when possible, and respect 429/Retry-After.',
    '<available_skills>',
```

**Post-change parity verification:**

| Instruction | Pipeline | UI |
|---|---|---|
| Explicit `read_file` tool naming | ✓ | ✓ |
| Step-by-step instruction | ✓ | ✓ |
| Explicit user naming case | ✓ | ✓ |
| Fabrication guard | ✓ | ✓ |
| Constraints line | ✓ | ✓ |
| Rate-limit guidance | ✓ | ✓ |

**Risk:** Low. Additive only.

---

## Test Requirements

| Test | Type | Location |
|------|------|----------|
| `'names read_file tool explicitly'` | Unit | `tests/unit/openclawSystemPrompt.test.ts` |
| `'includes fabrication guard'` | Unit | `tests/unit/openclawSystemPrompt.test.ts` |
| `'includes explicit user naming case'` | Unit | `tests/unit/openclawSystemPrompt.test.ts` |
| Existing assertions unchanged | Unit | `tests/unit/openclawSystemPrompt.test.ts` |
| Tool cards persist after response completes | Manual | Chat panel |
| Both skill builders produce identical instruction text | Manual/unit | Parity check |

---

## Files Modified Summary

| File | Change | Lines |
|------|--------|-------|
| `src/services/chatService.ts` | Remove `ToolInvocation` from strip list | -1 line |
| `src/openclaw/openclawSystemPrompt.ts` | Rewrite skill instruction bullets | 6 → 8 lines |
| `src/built-in/chat/config/chatSystemPrompts.ts` | Add constraints + rate-limit lines | +2 lines |
| `tests/unit/openclawSystemPrompt.test.ts` | Add 3 new test assertions | +15 lines |
