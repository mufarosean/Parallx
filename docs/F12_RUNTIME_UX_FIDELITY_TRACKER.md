# F12 — Runtime UX Fidelity — Parity Tracker

**Domain:** Runtime UX Fidelity
**Status:** CLOSED ✅
**Execution order position:** Post-closure remediation (triggered by functional testing)
**Root cause:** F3 iterations 2-3 accepted structural similarity as parity; skill prompt gap survived

---

## Scorecard

| ID | Capability | Iteration 1 | Iteration 2 | Iteration 3 |
|----|-----------|-------------|-------------|-------------|
| F12-1 | Tool call parts persist after stream close | MISALIGNED | ALIGNED | ALIGNED |
| F12-2 | Skill prompt names `read_file` tool explicitly | MISALIGNED | ALIGNED | ALIGNED |
| F12-3 | Skill prompt includes fabrication guard | MISSING | ALIGNED | ALIGNED |
| F12-4 | Skill prompt handles explicit user naming | MISSING | ALIGNED | ALIGNED |
| F12-5 | Pipeline and UI prompt synchronized | MISALIGNED | ALIGNED | ALIGNED |

---

## Key Files

| File | Role |
|------|------|
| `src/services/chatService.ts` | Stream `close()` — strips transient parts |
| `src/openclaw/openclawSystemPrompt.ts` | Pipeline skill prompt (`buildSkillsSection`) |
| `src/built-in/chat/config/chatSystemPrompts.ts` | UI skill prompt (`appendSkillCatalog`) |
| `src/built-in/chat/rendering/chatContentParts.ts` | Tool invocation renderer |
| `src/services/chatTypes.ts` | Part kind enum and interfaces |
| `tests/unit/openclawSystemPrompt.test.ts` | System prompt test suite |

---

## Upstream Reference

| Upstream File | What it defines |
|---------------|-----------------|
| `agents/system-prompt.ts:20-37` | Skill scan instruction with mandatory read |
| `agents/skills/workspace.ts:633-724` | XML skill entries pattern |

---

## Iteration Summary

| Iter | Gaps Found | Gaps Fixed | Tests Added | Verification |
|------|-----------|------------|-------------|-------------|
| 1 | 5 (3 MISALIGNED, 2 MISSING) | 5 | 3 | tsc 0 errors, 2498/2498 pass |
| 2 | 0 | — | — | Re-audit: 5/5 ALIGNED, no new gaps |
| 3 | 0 | — | — | Orchestrator spot-check: 9/9 instruction lines match, 5/5 ALIGNED |

---

## Iteration 1 — Functional Audit + Fix

**Date:** 2026-03-27
**Report:** `docs/F12_RUNTIME_UX_FIDELITY_AUDIT.md`
**Gap Map:** `docs/F12_RUNTIME_UX_FIDELITY_GAP_MAP.md`

### Key Findings
- Tool invocations stripped from message on stream close (chatService.ts)
- Pipeline skill prompt missing 3 critical instructions that UI path already has
- Split-brain prompt: two builders, same purpose, different quality

### Changes Made

| Gap | File(s) Changed | What Changed |
|-----|-----------------|--------------|
| F12-1 | `chatService.ts` | Removed `ToolInvocation` from strip list in `close()` — tool cards persist |
| F12-2 | `openclawSystemPrompt.ts` | Added "using read_file" to skill match instruction |
| F12-3 | `openclawSystemPrompt.ts` | Added fabrication guard: "NEVER describe from memory" |
| F12-4 | `openclawSystemPrompt.ts` | Added explicit user naming case |
| F12-5 | `chatSystemPrompts.ts` | Added constraints + rate-limit guidance to match pipeline |

### Tests Added
- `'names read_file tool explicitly'` — verifies `using read_file` in skill prompt
- `'includes fabrication guard'` — verifies `NEVER describe a skill` in prompt
- `'includes explicit user naming case'` — verifies user naming instruction

### Verification
- `npx tsc --noEmit` — 0 errors
- `npx vitest run` — 134 files, 2498 tests, 0 failures
