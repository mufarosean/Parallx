# F12 Runtime UX Fidelity — Iteration 1 Audit

**Auditor:** AI Parity Auditor (strict functional audit)
**Date:** 2026-03-27
**Domain:** F12 — Runtime UX Fidelity
**Upstream baseline:** OpenClaw commit e635cedb
**Audit methodology:** Functional parity (not structural similarity). Every capability tested for whether a 20B model would produce correct behavior.

---

## Summary

| Metric | Value |
|--------|-------|
| Capabilities audited | 5 |
| ALIGNED | 0 |
| MISALIGNED | 3 |
| MISSING | 2 |

---

## Per-Capability Findings

### F12-1: Tool call parts persist after stream close — **MISALIGNED** (HIGH)

**Parallx file:** `src/services/chatService.ts` lines 271-283 — `close()` method
**Upstream reference:** Parallx-specific UX concern (OpenClaw is a messaging gateway; tool visibility is a desktop workbench UX requirement)

**Current state:**

In `close()`, tool invocations are stripped alongside progress and reference parts:

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

The renderer at `chatListRenderer.ts` lines 152-163 detects the part-count decrease and re-renders, causing tool cards to vanish.

**Expected state:** Completed tool invocations should persist in the response parts after stream close. The user should see which tools were called, their arguments, status, and results. This is essential for:
1. **Traceability** — user can see exactly what the AI did
2. **Skill reads** — the `read_file` call to load a SKILL.md should be visible
3. **Debugging** — when tool calls fail or produce unexpected results, the user needs to see them
4. **Trust** — silent tool execution with no visible artifact makes the AI a black box

**Gap analysis:** `ToolInvocation` is treated as transient (same category as `Progress`) when it should be persistent. Progress parts are genuinely ephemeral (status spinners). References being folded into thinking provenance is reasonable. But tool invocations carry substantive information: tool name, args, status, result content. Stripping them destroys the audit trail.

The renderer already has a full `_renderToolInvocation()` function at `chatContentParts.ts` line 1081 that renders tool cards with status badges, argument summaries, and collapsible results. This rendering code is currently only visible *during* streaming.

---

### F12-2: Skill prompt explicitly instructs model to use `read_file` tool — **MISALIGNED** (HIGH)

**Parallx file:** `src/openclaw/openclawSystemPrompt.ts` lines 181-189 — `buildSkillsSection()`
**Upstream reference:** `agents/system-prompt.ts:20-37` — model must read the skill file

**Current state (pipeline path — the LIVE production path):**

```
- If exactly one skill clearly applies: read its SKILL.md at <location>, then follow it.
- If multiple could apply: choose the most specific one, then read/follow it.
```

Does NOT name the `read_file` tool.

**Expected state (UI path has it right at `chatSystemPrompts.ts` line 241):**

```
- If exactly one skill clearly applies: read its SKILL.md at <location> using read_file, then follow its instructions step by step.
```

Explicitly names the tool.

**Gap analysis:** A 20B parameter model does not reliably infer tool names from abstract verbs. "Read its SKILL.md" is ambiguous — the model could hallucinate instructions, call a different tool, or ask the user. Without explicit `read_file` naming, skill loading is probabilistic, not deterministic.

---

### F12-3: Skill prompt includes fabrication guard — **MISSING** (HIGH)

**Parallx file:** `src/openclaw/openclawSystemPrompt.ts` lines 181-193 — `buildSkillsSection()`

**Current state:** No fabrication guard exists in the pipeline path.

**Expected state (UI path at `chatSystemPrompts.ts` line 245):**

```
- NEVER describe a skill's instructions from memory or the description alone — always read the actual SKILL.md file first.
```

**Gap analysis:** Without this guard, a model that has seen similar skill names in training data will fabricate multi-step instructions based on the `<description>` field alone, never reading the actual SKILL.md. The `<description>` gives just enough context to fabricate convincingly.

---

### F12-4: Skill prompt handles explicit user skill naming — **MISSING** (MEDIUM)

**Parallx file:** `src/openclaw/openclawSystemPrompt.ts` lines 181-193 — `buildSkillsSection()`

**Current state:** Three cases covered:
1. Exactly one skill applies → read
2. Multiple apply → choose most specific
3. None apply → skip

No case for user explicitly naming a skill.

**Expected state (UI path at `chatSystemPrompts.ts` line 242):**

```
- If the user explicitly names a skill (e.g. "use the X skill"): read that skill's SKILL.md at <location> using read_file, then follow its instructions.
```

**Gap analysis:** When a user types "use the document-comparison skill", the model must map this to the three existing rules. Explicit naming is a deterministic signal — the user has already done the selection. The pipeline forces re-derivation, adding a failure path.

---

### F12-5: Pipeline prompt and UI prompt synchronized — **MISALIGNED** (HIGH)

**Parallx files:**
- `src/openclaw/openclawSystemPrompt.ts` lines 175-195 — `buildSkillsSection()`
- `src/built-in/chat/config/chatSystemPrompts.ts` lines 225-255 — `appendSkillCatalog()`

**Word-for-word divergence table:**

| Aspect | Pipeline (`buildSkillsSection`) | UI (`appendSkillCatalog`) | Impact |
|---|---|---|---|
| Explicit `read_file` tool naming | **Missing** | Present ("using read_file") | Model may not call the right tool |
| Step-by-step instruction | "then follow it" | "then follow its instructions step by step" | Model may skim rather than execute sequentially |
| Explicit user naming | **Missing** | Present (dedicated bullet) | User "use skill X" may fail |
| Fabrication guard | **Missing** | Present ("NEVER describe from memory") | Model may hallucinate skill instructions |
| Rate limit guidance | Present | **Missing** | Pipeline-only mitigation for API skills |
| Multi-match follow-through | "then read/follow it" | Just "choose the most specific one" | Minor — pipeline slightly better |

The UI path is strictly better for model compliance on 4 of 6 points. The pipeline path is better on 1 point (rate limits).

**Gap analysis:** The pipeline path is the LIVE production path. The UI path's `appendSkillCatalog` was updated to a higher standard but the pipeline path was not synchronized. Two builders, same purpose, different quality.

---

## Critical Findings

1. **F12-1 (HIGH):** Tool invocations stripped on `close()`. Completed tool calls vanish. Fix: remove `ChatContentPartKind.ToolInvocation` from the strip list.

2. **F12-2 + F12-3 + F12-4 (HIGH):** Pipeline skill prompt is inferior to the UI skill prompt. Three critical instructions missing from the production path that the display path already has.

3. **F12-5 (HIGH):** Split-brain prompt — two skill prompt builders diverge on 4 of 6 functional aspects. Must converge to one canonical builder.

---

## Root Cause

The pipeline path (`openclawSystemPrompt.ts`) was a parallel implementation, not a refactor of the existing UI path. When the UI path was improved, the pipeline was not synchronized.
