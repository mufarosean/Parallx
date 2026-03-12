# Milestone 29 — Chat UX Modernization, Regenerate, and Vision Attachments

> **Authoritative Scope Notice**
>
> This document is the single source of truth for Milestone 29.
> All Parallx chat UX redesign, assistant message actions, image attachment,
> vision-model support, and context-surface consolidation work for this
> milestone must conform to the findings, scope, and task boundaries defined
> here.

---

## Table of Contents

1. [Problem Statement](#problem-statement)
2. [Current State Audit](#current-state-audit)
3. [Research Findings](#research-findings)
4. [Product Decisions](#product-decisions)
5. [Vision](#vision)
6. [Guiding Principles](#guiding-principles)
7. [Execution Plan](#execution-plan)
8. [Task Tracker](#task-tracker)
9. [Verification Checklist](#verification-checklist)
10. [Risk Register](#risk-register)

---

## Problem Statement

Parallx chat is functionally useful, but the interaction model still feels like
an earlier implementation stage rather than a modern first-class AI workspace.

The user-visible problems are structural, not cosmetic-only:

1. **The overall chat surface does not feel modern enough**
   - the composer still presents as a temporary utility input rather than a
     primary AI workspace surface;
   - message chrome and action placement are sparse and utilitarian.

2. **Assistant responses do not support a first-class regenerate flow**
   - completed assistant messages currently expose copy-only actions;
   - there is no direct way to tell the AI to rerun the same request.

3. **Image paste and vision-capable chat are missing**
   - users cannot paste screenshots/images into chat as attached context;
   - Parallx cannot currently route image inputs into multimodal models.

4. **Context visibility is fragmented and unclear**
   - the chat UI currently exposes multiple context-related surfaces with
     different meanings;
   - the distinction between "what will be sent on this turn" and
     "overall context-window usage" is not communicated clearly enough.

This milestone redesigns the chat interface as a coherent system instead of a
series of local patches.

---

## Current State Audit

### Chat shell and composer

The main shell is implemented in:

- `src/built-in/chat/widgets/chatWidget.ts`
- `src/built-in/chat/widgets/chatWidget.css`
- `src/built-in/chat/input/chatInputPart.ts`
- `src/built-in/chat/input/chatInput.css`

The current composer is still a temporary textarea-based implementation.
`chatInputPart.ts` explicitly documents that M9 shipped a plain `<textarea>` as
an interim step rather than the richer long-term input surface.

### Message actions

Assistant message actions are implemented in:

- `src/built-in/chat/rendering/chatListRenderer.ts`

Current finding:

- completed assistant messages only expose a copy button;
- there is no regenerate / rerun action;
- thumbs-up / thumbs-down do not exist and are not required for this milestone.

### Attachments and context chips

Current attachment and context UI is split across:

- `src/built-in/chat/input/chatContextAttachments.ts`
- `src/built-in/chat/input/chatContextPills.ts`
- `src/built-in/chat/widgets/chatTokenStatusBar.ts`

These surfaces represent different concepts:

- **attachment ribbon**: explicit and implicit file attachments;
- **context pills**: per-turn sources and exclusions for the next request;
- **token status popup**: overall context-window consumption and breakdown.

The data model behind them is real, but the visual system is fragmented.

### Attachment model limitations

Chat attachments are currently defined as file-like entries in:

- `src/services/chatTypes.ts`

Current finding:

- `IChatAttachment` only models file-style context (`id`, `name`, `fullPath`);
- there is no first-class image attachment type;
- there is no model capability for `vision`.

### Request pipeline limitations

Attachment loading is currently text-only in:

- `src/built-in/chat/utilities/chatContextSourceLoader.ts`

Current finding:

- attached files are read as text and folded into prompt context;
- there is no multimodal message construction path for images.

### Provider limitations

The Ollama provider currently builds text-only chat messages in:

- `src/built-in/chat/providers/ollamaProvider.ts`

Current finding:

- request messages are serialized with `role` and `content` only;
- the provider does not send an `images` array on chat messages;
- model capabilities currently include only `completion`, `tools`, and
  `thinking`.

### Retry / attempt metadata

The chat service already carries useful retry-oriented metadata in:

- `src/services/chatTypes.ts`
- `src/services/chatService.ts`

Current finding:

- participant requests already include `requestId` and `attempt`;
- this gives Milestone 29 a solid base for a true regenerate action rather
  than a UI-only retry hack.

---

## Research Findings

### VS Code chat patterns relevant to this milestone

Code and platform research show that VS Code chat treats this as one integrated
input and attachment system, not separate one-off affordances.

Key findings:

1. **VS Code uses a richer input architecture than Parallx currently does**
   - the chat input is a real editor-based surface with integrated attachment,
     context, picker, and context-usage behavior.

2. **VS Code has explicit attachment widgets for images**
   - the attachment pipeline includes first-class image widgets and
     attachment-resolution services.

3. **VS Code supports paste-driven image attachment**
   - image attachments can be added from clipboard and are rendered as attached
     context before send.

4. **VS Code distinguishes per-turn attachments from context-usage details**
   - both concepts exist, but they are part of one coherent information model.

5. **VS Code supports rerun/regenerate request flows at the chat list level**
   - retry/rerun is treated as a message/session action, not a one-off manual
     user workaround.

### Ollama multimodal findings relevant to this milestone

Ollama now supports multimodal chat requests for vision models.

Key findings:

1. **`/api/chat` supports images on messages**
   - user chat messages can include an `images` array.

2. **The REST API expects image bytes encoded for transport**
   - the request shape differs from simple text-only `content` messages.

3. **Vision support is model-dependent**
   - not every Ollama model supports image inputs;
   - the Parallx model capability model must represent this explicitly.

4. **Image handling belongs in the provider boundary**
   - the UI should not know Ollama wire details beyond capability and preview;
   - the provider/request layer should own multimodal serialization.

---

## Product Decisions

These decisions were established before implementation planning.

### 1. Modernization is a system redesign, not a skin pass

Milestone 29 will treat the chat interface as a full composer + transcript +
context architecture problem.

This means:

- modernizing layout, spacing, message rhythm, and action placement;
- improving the composer shell itself, not just recoloring the existing UI;
- reducing visual clutter while making important actions more obvious.

### 2. Regenerate should replay the original request exactly

The first shipped regenerate behavior will:

- replay the original user text;
- preserve the original attachments;
- preserve the original model/mode execution snapshot where possible;
- increment retry/attempt metadata rather than inventing a second request type.

This is preferred over "rerun with whatever is currently selected" because it
keeps the action deterministic and easier to reason about.

### 3. Image attach should be caught at attach time, not at send time

If the active model does not support vision, Parallx should not wait until send
to reject the prompt.

Target behavior for this milestone:

- users can paste or attach an image into chat;
- if the active model lacks vision support, the image is rendered in a disabled
  or crossed-out state with a clear inline explanation;
- switching to a vision-capable model should allow the attachment to become
  sendable without forcing the user to reattach it.

Implementation note:

- exact VS Code parity for the disabled-state affordance should be confirmed
  during the implementation audit;
- the milestone target is the same user outcome even if the final styling is
  not pixel-identical.

### 4. Context window should be the primary context surface

The status-bar context window is the more important surface because it answers
the global question:

- how full is the model context window,
- what categories are consuming it,
- whether the conversation is approaching token pressure.

The per-turn context UI still has value, but for a different reason:

- it explains what is attached or selected for the next turn;
- it allows exclusion and inspection of turn-local sources.

Milestone 29 will therefore:

- make the context-window surface the canonical context entry point;
- simplify or demote the per-turn strip so it no longer feels like a competing
  second dashboard;
- unify the terminology and information architecture so these surfaces feel
  related rather than contradictory.

---

## Vision

After Milestone 29:

- the chat interface feels intentionally designed rather than merely functional;
- assistant messages expose regenerate directly under or alongside each
  response, without feedback/thumb actions;
- users can paste screenshots and images directly into chat;
- vision-capable models can read attached images;
- non-vision models clearly communicate unsupported image input immediately;
- context visibility feels unified, with one clear primary place to inspect
  context-window usage.

---

## Guiding Principles

1. **Behavior parity matters more than visual imitation.**
   - Parallx should learn from VS Code chat patterns without becoming a pixel
     clone.

2. **Unify the system before polishing the details.**
   - modern feel comes from coherent interaction design, not isolated cosmetic
     tweaks.

3. **Make important actions explicit.**
   - regenerate should be a visible supported workflow.

4. **Catch capability mismatches early.**
   - vision support should be validated when an image is attached, not after the
     user submits.

5. **Keep provider details behind the model boundary.**
   - the chat UI owns previews, attachment state, and affordances;
   - the provider owns multimodal serialization details.

6. **Do not keep redundant context dashboards.**
   - local attachment/source context and global context-window usage are both
     useful, but they must not compete for the same conceptual role.

---

## Execution Plan

### Phase A — Research and parity audit

- Audit VS Code chat input, attachment, and regenerate patterns relevant to:
  - message actions,
  - image attachment affordances,
  - context usage presentation.
- Confirm the exact Ollama multimodal request contract that Parallx should use
  for local vision models.
- Document deliberate deviations where Parallx keeps its own product identity.

### Phase B — Chat shell and composer redesign

- Redesign the chat transcript and composer shell in:
  - `chatWidget.css`
  - `chatInput.css`
  - related chat DOM builders.
- Modernize the composer so it feels like a first-class AI workspace surface.
- Reduce the amount of floating utility chrome and improve hierarchy.

### Phase C — Assistant message actions

- Add a regenerate action to completed assistant messages.
- Remove any planned thumbs-up / thumbs-down work from this milestone.
- Ensure regenerate replays the original request deterministically.

Implementation note:

- this likely requires preserving or reconstructing request execution metadata
  beyond the current minimal request shape so replay is honest.

### Phase D — Image attachments and vision capability

- Extend the attachment model to represent image attachments explicitly.
- Add image paste support to the chat input.
- Add image preview chips/cards in the attached-context area and message
  transcript where appropriate.
- Extend model capabilities with `vision` and expose that to the UI.
- Add unsupported-state UX for images when the selected model cannot see.
- Extend the provider path to send images through Ollama's chat request format.

### Phase E — Context-surface consolidation

- Reduce the current duplication between turn-local context UI and the context
  window surface.
- Make the context window the canonical place for quantitative context status.
- Simplify the per-turn surface into a lighter entry point or summary instead of
  a second dashboard.
- Unify terminology around:
  - attached context,
  - sources for this turn,
  - total context-window usage.

### Phase F — Verification

- Add targeted unit coverage for:
  - regenerate action behavior,
  - image attachment state changes,
  - vision capability gating.
- Add targeted Electron/Playwright coverage for:
  - paste image into chat,
  - non-vision disabled state,
  - vision-capable model path,
  - regenerate action visibility and replay.
- Run build validation after each major phase.

---

## Task Tracker

### A. Research and architecture

- [x] A1. Audit the current Parallx chat shell, composer, and context surfaces. ✅
- [x] A2. Audit VS Code chat patterns for input attachments, regenerate, and context usage. ✅
- [x] A3. Confirm Ollama multimodal request and capability details for local vision models. ✅
- [x] A4. Record product decisions and deliberate parity deviations in this milestone doc. ✅

### B. Chat shell redesign

- [x] B1. Redesign the chat transcript/composer visual hierarchy. ✅
- [x] B2. Improve message rhythm, spacing, and action placement. ✅
- [x] B3. Modernize the input composer shell without regressing current chat behavior. ✅

### C. Regenerate flow

- [x] C1. Add regenerate action UI to completed assistant messages. ✅
- [x] C2. Implement deterministic replay of the original request. ✅
- [x] C3. Preserve attachment and execution metadata required for replay. ✅

### D. Image attachments and vision

- [x] D1. Extend chat attachment types to support images. ✅
- [x] D2. Add paste-image support in the chat input. ✅
- [x] D3. Add image attachment rendering/previews in the composer. ✅
- [x] D4. Add `vision` model capability detection and exposure. ✅
- [x] D5. Add unsupported-image state for non-vision models. ✅
- [x] D6. Extend the Ollama provider to send multimodal chat messages with images. ✅

### E. Context consolidation

- [x] E1. Make the context window the primary quantitative context surface. ✅
- [x] E2. Simplify or demote the per-turn context strip. ✅
- [ ] E3. Unify context terminology and interaction flow across the chat UI.

### F. Verification

- [x] F1. Add targeted unit tests for regenerate behavior. ✅
- [x] F2. Add targeted unit tests for image-attachment and vision gating behavior. ✅
- [x] F3. Add targeted Electron/Playwright coverage for pasted-image flows. ✅
- [x] F4. Add targeted Electron/Playwright coverage for regenerate. ✅
- [x] F5. Run `npm run build` after each major implementation phase. ✅

---

## Verification Checklist

- [ ] The composer feels materially more modern and intentional than the pre-M29 UI.
- [x] Completed assistant messages expose a visible regenerate action.
- [x] Regenerate replays the original request deterministically.
- [x] Users can paste an image directly into chat.
- [x] Image attachments preview correctly before send.
- [x] Vision-capable models receive image inputs correctly.
- [x] Non-vision models show unsupported image state immediately on attach.
- [ ] The context window is clearly the primary quantitative context surface.
- [ ] The per-turn context UI no longer feels like a competing second dashboard.
- [x] Targeted unit tests pass.
- [ ] Targeted Electron/Playwright tests pass.
- [x] `npm run build` passes.

---

## Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| Chat shell redesign regresses layout behavior in narrow sidebars | High | Validate in both primary and auxiliary sidebars with focused manual and Playwright checks |
| Regenerate becomes nondeterministic if replay metadata is incomplete | High | Persist enough request execution metadata to distinguish exact replay from fresh send |
| Image support is added in UI without correct provider serialization | High | Treat provider/request-layer work as required milestone scope, not optional follow-up |
| Context consolidation removes useful per-turn inspection affordances | Medium | Preserve local source/attachment inspection, but demote it from primary dashboard status |
| Vision capability detection is inaccurate for some models | Medium | Add explicit capability parsing and defensive unsupported-state UX |
| Large UI changes inflate scope and mix unrelated polish work | Medium | Keep the milestone focused on chat shell, regenerate, image attachments, and context surfaces only |