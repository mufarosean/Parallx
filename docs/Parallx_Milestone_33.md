# Milestone 33 — OpenClaw Memory Invocation And Transcript Alignment

> Authoritative scope notice
>
> This document is the single source of truth for Milestone 33.
> All work that aligns Parallx memory-layer definition, transcript separation,
> and runtime memory invocation with current upstream OpenClaw behavior must
> conform to the research findings, contract, and execution plan defined here.

---

## Table of Contents

1. Problem Statement
2. Verified Upstream OpenClaw Findings
3. Current Parallx Misalignment
4. Target Product Contract
5. Execution Plan
6. Task Tracker
7. Risks And Open Questions
8. References

---

## Problem Statement

Milestone 32 made canonical markdown memory the source of truth for workspace
memory, but Parallx is still misaligned with OpenClaw in three product-critical
areas:

1. transcript state is not yet a clean, separate canonical layer;
2. grounded turns still inject memory too aggressively by default;
3. new chats do not yet behave like a true fresh session with explicit,
   controlled continuity.

That creates the user-facing failures we must eliminate:

1. the AI can over-anchor on recalled memory and answer an older topic instead
   of the current question;
2. new chats can feel contaminated by prior sessions rather than fresh;
3. session continuity and workspace memory are not clearly distinguished.

Milestone 33 fixes the invocation model, not just storage.

---

## Verified Upstream OpenClaw Findings

The following findings were re-verified against current upstream OpenClaw docs
and source, not just Parallx notes.

### 1. Core memory layers

OpenClaw uses two core markdown memory layers:

1. `memory/YYYY-MM-DD.md`
   - append-only daily log;
   - today and yesterday are read at session start.
2. `MEMORY.md`
   - curated long-term memory;
   - only loaded in the main/private session, not shared/group contexts.

### 2. Fresh-session model

OpenClaw treats the agent as a fresh instance each session.

Continuity lives in files and explicit session state, not in hidden carry-over
prompt state.

The session reset prompt explicitly tells the agent to run its Session Startup
sequence before responding.

### 3. Session startup contract

Upstream OpenClaw templates instruct the agent to read the following on session
start:

1. `SOUL.md`;
2. `USER.md`;
3. `memory/YYYY-MM-DD.md` for today and yesterday;
4. `MEMORY.md` only in the main/private session.

This is a controlled startup read, not broad semantic recall on every normal
turn.

### 4. Transcript separation

OpenClaw stores transcripts separately from memory.

Verified upstream behavior:

1. transcripts are append-only `.jsonl` session files;
2. session metadata is tracked separately from the transcript;
3. transcripts are not the same thing as daily logs or curated durable memory.

### 5. Transcript usage

Transcript recall is not the default primary memory mechanism.

Verified upstream behavior:

1. transcript indexing is optional and experimental;
2. transcript search can be enabled as a separate recall layer;
3. transcript recall is isolated from the default markdown memory layer.

### 6. Memory invocation model

OpenClaw exposes explicit memory tools:

1. `memory_search`;
2. `memory_get`.

Its system prompt guidance treats memory recall as an explicit step before
answering questions about prior work, decisions, dates, preferences, or todos.

This is materially different from Parallx's current automatic grounded-turn
memory injection.

### 7. Compaction and write-back

OpenClaw also supports a silent pre-compaction memory flush that tells the model
to write durable memory to disk before context is compacted.

This reinforces the core contract:

1. memory belongs on disk;
2. transcript and memory are not the same layer;
3. continuity is explicit and file-backed.

---

## Current Parallx Misalignment

Parallx is still misaligned with that OpenClaw model in these ways:

1. `ChatService` persists chat sessions in SQLite, but there is no explicit
   canonical transcript file layer yet;
2. `createChatContextPlan(...)` currently enables memory recall for default
   grounded turns, so memory can be injected when the user did not ask for prior
   context;
3. `composeChatUserContent(...)` currently places context blocks before the
   current user text, increasing the risk that models latch onto recalled memory
   instead of the present question;
4. Parallx has no explicit fresh-session startup contract equivalent to
   OpenClaw's Session Startup sequence;
5. transcript state, daily memory, and durable workspace memory are still not
   formally separated as product layers in runtime behavior.

---

## Target Product Contract

Milestone 33 establishes the following Parallx contract.

### 1. Transcript layer

Canonical transcript storage is separate from workspace memory.

Initial Parallx contract:

1. transcripts live under `.parallx/sessions/<session-id>.jsonl`;
2. transcripts are the session-history layer;
3. transcripts are not injected as default memory;
4. transcript recall remains optional and separate from workspace memory recall.
5. transcript indexing is opt-in via `memory.transcriptIndexingEnabled` and is disabled by default.

### 2. Daily memory layer

`.parallx/memory/YYYY-MM-DD.md` remains day-scoped curated memory:

1. daily notes;
2. day-scoped context;
3. session summaries or carry-forward notes when explicitly written.

It is not the raw transcript.

### 3. Durable memory layer

`.parallx/memory/MEMORY.md` remains the durable workspace memory layer:

1. preferences;
2. decisions;
3. durable facts;
4. curated concepts and conventions.

### 4. New session behavior

New sessions should feel fresh.

That means:

1. no automatic prior-session recall on generic greetings or lightweight
   conversational turns;
2. no broad memory injection just because a turn is grounded;
3. continuity should come from explicit memory invocation or tightly scoped
   startup behavior, not from hidden carry-over.

### 5. Memory invocation policy

Parallx should move closer to OpenClaw's invocation model:

1. explicit memory-recall turns may use memory recall directly;
2. normal grounded turns should not auto-inject prior-session memory by
   default;
3. memory tools remain the primary explicit recall path for prior-work
   questions;
4. the current user request must remain more prominent than any recalled memory
   context in prompt composition.

### 7. Transcript recall policy

Transcript recall is a distinct explicit channel, not an extension of default
workspace memory.

1. transcript indexing is off by default;
2. when enabled, only `.parallx/sessions/*.jsonl` is indexed for transcript recall;
3. transcript recall is accessed explicitly through `transcript_search` and
   `transcript_get`;
4. transcript recall should only be used when the user explicitly asks about
   prior session history, prior turns, or transcript-backed recap.

### 6. Prompt composition rule

When context is attached to the current user turn, the user's actual question
must appear before supporting memory/context blocks or be otherwise clearly
foregrounded.

This is required to stop models from answering recalled context instead of the
present ask.

---

## Execution Plan

### Phase A — Transcript separation

- [x] Define canonical transcript path and file format.
- [x] Create a transcript persistence service for `.parallx/sessions/*.jsonl`.
- [x] Wire transcript creation/update/delete into `ChatService`.
- [x] Keep transcript storage separate from daily memory and durable memory.
- [x] Add optional transcript indexing toggle for `.parallx/sessions/*.jsonl`.
- [x] Add explicit transcript recall tools separate from memory recall.

### Phase B — Memory invocation rework

- [x] Remove automatic memory recall from default grounded turns.
- [x] Keep explicit memory-recall routing for explicit prior-context questions.
- [x] Rework user-content composition so the current ask is foregrounded ahead
      of supporting memory/context.
- [x] Add explicit new-session guardrails so greetings and light conversational
      turns do not pull prior-session memory.

### Phase C — Validation

- [x] Add focused unit coverage for transcript persistence.
- [x] Add focused unit coverage for memory-invocation routing.
- [x] Add a live regression proving a new session greeting does not surface
      unrelated prior-session memory.
- [x] Add a live regression proving explicit prior-memory questions still work.
- [ ] Add a stable live regression for explicit transcript recall.

---

## Task Tracker

- [x] Re-verify current upstream OpenClaw memory/session behavior from online sources
- [x] Create Milestone 33 branch
- [x] Create Milestone 33 document
- [x] Define transcript contract for Parallx
- [x] Implement transcript separation
- [x] Define memory invocation contract for fresh sessions
- [x] Implement memory injection rework
- [x] Validate clean-slate session behavior
- [x] Validate explicit memory recall behavior

---

## Implementation Log

### 2026-03-13 — Initial alignment slice completed

Completed implementation work in this session:

1. created the `milestone-33` branch from the committed Milestone 32 baseline;
2. re-verified current upstream OpenClaw memory/session behavior from online
   docs and source rather than relying only on local milestone notes;
3. defined the Parallx transcript contract as a separate canonical layer under
   `.parallx/sessions/<session-id>.jsonl`;
4. added `IWorkspaceTranscriptService` and `WorkspaceTranscriptService` for
   transcript scaffold creation, read, write, and delete behavior;
5. wired transcript persistence into `ChatService` so transcript snapshots are
   persisted separately from canonical memory and deleted with session teardown;
6. late-bound the new transcript service through the workbench in the same way
   other late-bound chat dependencies are wired;
7. removed automatic memory recall and concept recall from generic grounded
   turns so prior-session memory is no longer injected by default;
8. kept explicit `memory-recall` routing intact for direct prior-context
   questions;
9. changed user-turn composition so the current user request is foregrounded as
   `[User Request]` before retrieval analysis or supporting context;
10. added explicit clean-slate system prompt guidance telling the model not to
    reference prior sessions or memory unless the user explicitly asks;
11. added focused unit coverage for transcript persistence and the updated
    memory-invocation behavior;
12. re-ran the live memory-layer AI-eval to confirm explicit memory recall and
    markdown-backed write-back still work after the invocation change.
13. added a live clean-slate greeting regression proving a fresh new session
   saying `hi` does not surface unrelated durable or daily memory.
14. added an opt-in transcript indexing path for `.parallx/sessions/*.jsonl`
   that sanitizes JSONL into user/assistant text before chunking;
15. added explicit `transcript_search` and `transcript_get` built-in tools so
   prior-session recall is a separate, named capability rather than implicit
   memory injection.
16. excluded transcript-specific prompts from the markdown memory-recall route
   so transcript asks no longer short-circuit into canonical memory answers;
17. added an explicit transcript recall path in chat context preparation so
   transcript-specific asks can attach transcript context without broadening
   default grounded-turn memory behavior;
18. switched transcript search and transcript recall to a direct canonical
   `.parallx/sessions/*.jsonl` scan for deterministic transcript lookup rather
   than relying only on generic workspace retrieval ranking.

Focused validation completed:

1. `npm run test:unit -- chatRuntimePlanning.test.ts chatUserContentComposer.test.ts chatService.test.ts workspaceTranscriptService.test.ts` ✅
2. `npx playwright test --config=playwright.ai-eval.config.ts tests/ai-eval/memory-layers.spec.ts` ✅
3. `npm run test:unit -- builtInTools.test.ts indexingPipeline.test.ts chatSystemPrompts.test.ts` ✅
4. `npm run test:unit -- builtInTools.test.ts chatRuntimePlanning.test.ts` ✅

---

## Risks And Open Questions

1. OpenClaw's exact runtime session-start injection is driven by its broader
   agent bootstrap architecture, which Parallx does not yet mirror fully.
2. Parallx may need a follow-up milestone for a fuller OpenClaw-style session
   startup procedure once transcript and memory invocation are corrected.
3. We must avoid breaking grounded workspace answers while narrowing automatic
   memory recall.
4. We should keep transcript search optional rather than accidentally turning it
   into another broad implicit memory layer.
5. A stable live transcript AI-eval still needs dedicated observability or a
   cleaner harness path, because current live validation conflates transcript
   recall with generic workspace/tool availability behavior.

---

## References

### Current upstream OpenClaw sources re-verified for this milestone

1. https://github.com/openclaw/openclaw/tree/main/docs/concepts/memory.md
2. https://github.com/openclaw/openclaw/tree/main/docs/concepts/agent-workspace.md
3. https://github.com/openclaw/openclaw/tree/main/docs/reference/templates/AGENTS.md
4. https://github.com/openclaw/openclaw/tree/main/docs/reference/AGENTS.default.md
5. https://github.com/openclaw/openclaw/tree/main/docs/reference/session-management-compaction.md
6. https://github.com/openclaw/openclaw/tree/main/src/agents/system-prompt.ts
7. https://github.com/openclaw/openclaw/tree/main/src/agents/tools/memory-tool.ts
8. https://github.com/openclaw/openclaw/tree/main/src/auto-reply/reply/session-reset-prompt.ts
9. https://github.com/openclaw/openclaw/tree/main/src/hooks/bundled/session-memory/HOOK.md

### Parallx sources to modify in this milestone

1. `src/services/chatService.ts`
2. `src/services/chatSessionPersistence.ts`
3. `src/services/chatTypes.ts`
4. `src/services/serviceTypes.ts`
5. `src/built-in/chat/utilities/chatContextPlanner.ts`
6. `src/built-in/chat/utilities/chatUserContentComposer.ts`
7. `src/built-in/chat/utilities/chatTurnRouter.ts`
8. `src/built-in/chat/participants/defaultParticipant.ts`