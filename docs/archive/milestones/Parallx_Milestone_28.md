# Milestone 28 — Chat Rendering Fidelity and Math-Safe Markdown

> **Authoritative Scope Notice**
>
> This document is the single source of truth for Milestone 28.
> All chat rendering, markdown parsing, math display, and chat-formatting
> regression work for this milestone must conform to the findings, scope, and
> task boundaries defined here.

---

## Table of Contents

1. [Problem Statement](#problem-statement)
2. [Current State Audit](#current-state-audit)
3. [Root Cause Model](#root-cause-model)
4. [Vision](#vision)
5. [Guiding Principles](#guiding-principles)
6. [Execution Plan](#execution-plan)
7. [Task Tracker](#task-tracker)
8. [Verification Checklist](#verification-checklist)
9. [Risk Register](#risk-register)

---

## Problem Statement

Parallx chat responses currently render with materially worse formatting than
the model output implies. The user-visible failures are not cosmetic.

Observed failures in the live chat UI:

1. **Math syntax is shown as raw text**
   - display-math delimiters like `\[` and `\]` are shown literally;
   - LaTeX content such as `\frac{...}{...}` is not rendered.

2. **Ordered lists reset unexpectedly**
   - multi-step answers that include intervening bullets, formulas, or block
     content render as separate ordered lists that restart at `1`.

3. **Chat formatting quality is below milestone intent**
   - rich AI responses are being reduced to a narrow markdown subset;
   - answers that should read like structured notes instead look broken.

This milestone fixes the rendering layer so that Parallx chat can display
normal AI markdown safely and predictably, including math-heavy responses.

---

## Current State Audit

### Live rendering path

Chat markdown is currently rendered by:

- `src/built-in/chat/rendering/chatContentParts.ts`
  - `renderContentPart(...)`
  - `_renderMarkdown(...)`
  - `_markdownToHtml(...)`

The current implementation is a custom block parser plus a few inline regex
transforms. It supports only a limited subset:

- headings,
- paragraphs,
- basic ordered/unordered lists,
- blockquotes,
- code fences,
- bold/italic/strike,
- links.

### Proven findings from code inspection

1. **No math renderer is present in the chat path**
   - the chat markdown renderer has no KaTeX or MathJax integration;
   - `_inlineFormat(...)` only handles code, bold, italic, strike, and links.

2. **The chat parser discards ordered-list start values**
   - ordered list items are converted to plain `<ol><li>...</li></ol>` output;
   - the original marker values (`2.`, `3.`) are not preserved in HTML.

3. **The current ordered-list model only groups consecutive list lines**
   - any intervening block content ends the list;
   - this is especially harmful for AI answers that place formulas or nested
     explanation between numbered steps.

4. **Milestone 9 design intent is not what the live code does**
   - `docs/Parallx_Milestone_09.md` explicitly states that chat responses are
     rendered using Tiptap in read-only mode;
   - the live code does not do that and instead uses a hand-rolled parser.

5. **KaTeX already exists in the repo**
   - `package.json` already includes `katex` and the Tiptap math extension;
   - the canvas tool already uses KaTeX, so chat is missing wiring rather than
     missing foundational math support in the product.

6. **Current tests do not cover the failing AI-output shape**
   - `tests/unit/chatMarkdown.test.ts` validates the custom parser's baseline
     behavior;
   - it does not cover display math or ordered-list continuation semantics for
     AI-style explanatory answers.

---

## Root Cause Model

Milestone 28 treats the problem as a rendering-architecture defect, not as a
model-behavior defect.

### Defect 1: ad-hoc markdown parsing in chat

The current parser is too limited to reliably render real AI output. It was
good enough for simple prose but not for math-heavy or structure-heavy answers.

### Defect 2: math support exists in the product, but chat never wired it

Parallx already ships KaTeX elsewhere, but the chat markdown path never added
display-math or inline-math handling.

### Defect 3: ordered-list numbering is not preserved

The current renderer throws away source ordinals. When numbered sections are
split into multiple HTML lists, the browser restarts numbering at `1` because
Parallx never emits the correct `start` value.

### Defect 4: implementation drift from milestone-owned architecture

Milestone 9 resolved chat rendering toward a richer structured renderer, but
the live runtime remained on a custom parser path. Milestone 28 closes that
quality gap at the rendering boundary.

---

## Vision

After Milestone 28:

- normal markdown answers render cleanly in chat,
- display math renders visually instead of leaking LaTeX source,
- ordered steps keep their intended numbering,
- targeted tests prove the exact failure mode in the user screenshot is fixed.

---

## Guiding Principles

1. **Fix the rendering boundary, not the prompt.**
   - the model may emit markdown and LaTeX naturally; Parallx must render it.

2. **Use a real markdown engine instead of extending the ad-hoc parser forever.**
   - the current parser is already underpowered relative to the product need.

3. **Reuse existing product capabilities.**
   - KaTeX already ships in the repo and should be reused for chat.

4. **Keep chat-safe output semantics.**
   - no raw HTML from model output;
   - preserve citation post-processing and existing chat DOM contracts.

5. **Test the exact regression shape.**
   - the milestone is not complete until the math + ordered-list case is under
     targeted unit coverage.

---

## Execution Plan

### Phase A — Renderer Replacement

- Replace the hand-rolled chat markdown parsing path with a standards-based
  markdown engine in `chatContentParts.ts`.
- Keep the existing `renderContentPart(...)` and citation post-processing flow.

Implementation note:

- This milestone closes the live chat-formatting defect with `markdown-it` +
   KaTeX inside the current chat content-part renderer.
- Full Milestone 9 Tiptap conversation-document migration remains a separate
   architectural follow-up rather than part of this targeted rendering fix.

### Phase B — Math Rendering

- Add KaTeX-backed inline and display math rendering for chat markdown.
- Support the AI-output shapes most likely in normal answers:
  - `\(...\)`
  - `\[...\]`
  - `$...$`
  - `$$...$$`

### Phase C — Ordered List Fidelity

- Preserve ordered-list start numbers in rendered HTML.
- Ensure AI answers that split numbered sections with intervening math blocks do
  not visually restart numbering incorrectly.

### Phase D — Regression Coverage

- Extend `tests/unit/chatMarkdown.test.ts` with:
  - display math rendering assertions,
  - inline math rendering assertions,
  - ordered-list start preservation assertions,
  - a realistic finance/chain-ladder style answer matching the screenshot shape.

---

## Task Tracker

### A. Research and architecture

- [x] A1. Audit the live chat markdown rendering path.
- [x] A2. Compare the live implementation against Milestone 9 design intent.
- [x] A3. Confirm whether KaTeX support already exists elsewhere in the repo.

### B. Renderer upgrade

- [x] B1. Replace the ad-hoc chat markdown parser with a standards-based renderer. Implemented with `markdown-it` in the live chat rendering path rather than a same-change Tiptap migration.
- [x] B2. Preserve existing citation badge post-processing on rendered chat output.

### C. Math support

- [x] C1. Add display-math rendering for chat markdown.
- [x] C2. Add inline-math rendering for chat markdown.
- [x] C3. Ensure chat math styles are loaded with the chat rendering path.
- [x] C4. Strip stray streamed delimiter artifacts when live chat leaves raw `$`, `\(`, or `\[` text nodes around already-rendered KaTeX output.

### D. Ordered-list fidelity

- [x] D1. Preserve ordered-list start values in rendered HTML.
- [x] D2. Validate numbered-step rendering across intervening formula blocks.

### E. Verification

- [x] E1. Extend `tests/unit/chatMarkdown.test.ts` with the regression cases.
- [x] E2. Run targeted unit tests for chat markdown rendering.
- [x] E3. Run `npm run build` to validate the renderer integration.
- [x] E4. Run a targeted Electron/Playwright chat-formatting regression against the real Exam 7 workspace.
- [x] E5. Add a live-model inspection harness for the exact Mack prompt in the Exam 7 workspace so real streamed HTML/text can be captured when mocked responses are insufficient.

---

## Verification Checklist

- [x] Chat display math renders visually instead of showing raw `\[` / `\]` blocks.
- [x] Chat inline math renders visually instead of leaking raw LaTeX.
- [x] Ordered lists preserve numbering when the source starts at a value other than `1`.
- [x] A realistic AI answer with steps, bullets, and formulas renders with stable numbering.
- [x] Citation badge post-processing still works on rendered markdown content.
- [x] Targeted chat markdown unit tests pass.
- [x] `npm run build` passes.
- [x] Targeted Electron/Playwright chat formatting passes in the real Exam 7 workspace.
- [x] Real-model inspection can capture the exact Exam 7 Mack prompt path, including slow or stalled generations, for renderer diagnosis.

---

## Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| Markdown-engine swap changes existing HTML details | Medium | Keep targeted regression tests for current supported formatting and citation behavior |
| KaTeX rendering introduces CSS/font issues in chat | Medium | Reuse existing KaTeX dependency and validate with build output |
| Math delimiter parsing conflicts with code blocks | High | Ensure fenced code blocks are opaque to markdown/math processing and test it explicitly |
| Citation post-processing breaks on richer HTML structure | Medium | Preserve the current post-render DOM pass and validate on rendered markdown |
| Real model output is slower or structurally different from mocked test data | Medium | Keep a non-mocked inspection harness for the exact user prompt and harden DOM cleanup against streamed delimiter artifacts |