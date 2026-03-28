# D5: Media/Vision — Gap Map

**Domain:** D5 — Media/Vision (VLM support via Ollama vision models)
**Date:** 2025-01-28
**Based on:** D5_MEDIA_VISION_AUDIT.md (Iteration 1)

---

## Change Plan Overview

| Gap | Capability | Severity | Files Changed | Description |
|-----|-----------|----------|---------------|-------------|
| G1 | D5-8a Token Estimation | HIGH | `openclawTokenBudget.ts` | `estimateMessagesTokens()` ignores image byte size |
| G2 | D5-8b Compaction Images | MEDIUM | `openclawContextEngine.ts` | `compact()` transcript silently drops images |
| G3 | D5-6 Vision System Prompt | MEDIUM | `openclawSystemPrompt.ts`, `openclawAttempt.ts` | No vision-specific guidance in system prompt |
| G4 | D5-7 Vision Auto-Suggest | LOW | `chatContextAttachments.ts`, `chatWidget.ts` | No auto-suggestion to switch to vision model |

---

## G1: Image-Aware Token Estimation

**Capability:** D5-8a  
**Severity:** HIGH  
**File:** `src/openclaw/openclawTokenBudget.ts`

### Current State

`estimateMessagesTokens()` at line 120 computes tokens as `4 + estimateTokens(msg.content)` per message. The `images` field on `IChatMessage` is completely ignored. A 5MB base64 image is counted as 0 tokens, which can silently blow the context window.

### Change Plan

1. Widen the input type of `estimateMessagesTokens()` to accept `{ role: string; content: string; images?: readonly { data: string }[] }` (compatible with `IChatMessage`)
2. For each message, if `images` is present, estimate image tokens as: `Math.ceil(image.data.length / 4)` per image (base64 chars / 4 ≈ bytes; Ollama charges ~1 token per 4 bytes of image data)
3. Add `IMAGE_BYTES_PER_TOKEN` constant (default 4) for tunability

### Upstream Reference

Upstream token budget accounts for media attachments in the content stream. The Parallx adaptation uses base64 byte estimation since Ollama's exact image tokenization is undocumented.

---

## G2: Image-Aware Compaction

**Capability:** D5-8b  
**Severity:** MEDIUM  
**File:** `src/openclaw/openclawContextEngine.ts`

### Current State

`compact()` at line 389 builds transcript via `msg.content` only — images are silently discarded. When history is compacted into a summary, any image descriptions or analysis context from previous turns is lost.

### Change Plan

1. In `compact()`, when building the transcript (line 389), check each message for `images`:
   - If a user message has images, append `[User attached ${images.length} image(s)]` to the transcript line
2. When replacing history with compacted messages, strip `images` from old turns (images are ephemeral — they've already been analyzed by the model)
3. The compacted summary message should be text-only (no images field)

### Upstream Reference

Upstream compaction does not preserve binary attachments across compaction boundaries — the summary captures the semantic content of the turn including any media analysis the model performed.

---

## G3: Vision-Aware System Prompt

**Capability:** D5-6  
**Severity:** MEDIUM  
**Files:** `src/openclaw/openclawSystemPrompt.ts`, `src/openclaw/openclawAttempt.ts`

### Current State

`IOpenclawSystemPromptParams` has no `supportsVision` flag. `buildOpenclawSystemPrompt()` emits identical instructions regardless of whether the active model supports vision. Vision models get no guidance on how to handle image attachments.

### Change Plan

1. Add `readonly supportsVision?: boolean` to `IOpenclawSystemPromptParams`
2. Add `buildVisionGuidanceSection()` function that returns:
   ```
   ## Vision Capabilities
   You can analyze images attached to user messages. When the user includes an image:
   - Describe what you see clearly and specifically
   - Reference visual elements (text, diagrams, UI, photos) in your response
   - If the image relates to the workspace content, connect visual observations to workspace context
   When no image is attached, respond normally to text input.
   ```
3. Insert the vision section after behavioral rules (position 8b) — only when `supportsVision === true`
4. Wire in `openclawAttempt.ts`: pass `supportsVision` based on model capabilities (need to propagate from `IOpenclawTurnContext` or derive from `runtimeInfo`)

### Upstream Reference

Upstream system prompt builder has capability-aware sections that activate based on model properties. The vision guidance section follows this pattern.

---

## G4: Vision Model Auto-Suggestion

**Capability:** D5-7  
**Severity:** LOW  
**Files:** `src/built-in/chat/input/chatContextAttachments.ts`, `src/built-in/chat/widgets/chatWidget.ts`

### Current State

When an image is pasted with a non-vision model selected, `getAttachments()` silently drops images. The chip shows "Vision required" but there's no actionable suggestion to switch models. The user must manually discover and select a vision-capable model.

### Change Plan

1. Add a `readonly onRequestVisionModel?: () => void` callback to `ChatContextAttachmentRibbon` constructor
2. When a non-vision chip is rendered, add a clickable "Switch to vision model" link on the chip or below it
3. The callback queries available models for those with `'vision'` capability and switches to the first one (or shows a picker if multiple)
4. In `chatWidget.ts`, wire the callback to the model selection service

### Upstream Reference

Upstream channels handle content-type mismatches by suggesting channel capabilities. The Parallx adaptation maps this to model-level auto-suggestion.

---

## Implementation Order

```
G1 (token estimation) → G2 (compaction) → G3 (system prompt) → G4 (auto-suggest)
```

---

## Iteration 2 — Refinement Gaps (2026-03-28)

All G1–G4 implemented. Refinement audit found 9 follow-up issues:

| ID | Severity | Gap | Fix Effort |
|----|----------|-----|------------|
| R-01 | HIGH | Token formula overcounts base64 by ~33% | S — fix constant/comment |
| R-02 | HIGH | `supportsVision` signal source (attachments vs model capability) | M — resolve from model info |
| R-03 | MEDIUM | Auto-suggest silent failure when no vision model | S — add toast |
| R-04 | MEDIUM | Unhandled rejection in auto-suggest callback | S — add `.catch()` |
| R-05 | MEDIUM | `estimateMessagesTokens` inline type vs `IChatMessage` | S — use shared type |
| R-06 | LOW | Compaction loses image descriptions | L — needs description capture |
| R-07 | LOW | Vision guidance not model-tier gated | S — add tier check |
| R-08 | LOW | Empty images array cosmetic guard | S — change to `?.length` |
| R-09 | LOW | Unthrottled vision sync calls | S — add debounce |

### Recommended Iteration 3 Priority
1. R-04 (unhandled rejection — crash risk)
2. R-02 (architecture fix — correct signal source)
3. R-03 (UX feedback)
4. R-01 (token accuracy)
5. R-05 (type safety)
6. R-07, R-08, R-09 (polish)
