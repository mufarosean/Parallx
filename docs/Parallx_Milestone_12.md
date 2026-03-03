# Milestone 12: Proactive Intelligence — From Reactive RAG to Anticipatory AI

## Research Document — March 3, 2026

**Demo target: END OF DAY — March 3, 2026**

---

## Table of Contents

1. [Vision](#vision)
2. [The Problem](#the-problem)
3. [Research: How The Industry Solves This](#research-how-the-industry-solves-this)
4. [Architecture: The 2-Call Pipeline](#architecture-the-2-call-pipeline)
5. [Current State — What Exists Today](#current-state--what-exists-today)
6. [Transformation Plan](#transformation-plan)
7. [Task Tracker](#task-tracker)
8. [Demo Script](#demo-script)

---

## Vision

**Before M12 — what the user experiences today:**

> You open a workspace full of insurance documents. You type "I got into a fender bender on the highway." The AI searches for "fender bender on the highway" — a phrase that appears in zero of your documents. It returns a thin, generic response. You feel like the AI doesn't know your workspace at all. You have to explicitly ask: "What's my deductible?" then "What's the claims process?" then "What's my agent's number?" — three separate questions to get information the AI should have offered proactively.

**After M12 — what the user will experience:**

> You open a workspace full of insurance documents. You type "I got into a fender bender on the highway." The AI pauses for 3-5 seconds while it **thinks** — a visible planning indicator shows it's analyzing your situation. Then it responds with a comprehensive briefing: your collision coverage limits, your deductible amount, the step-by-step claims filing procedure, your agent's phone number, what to document at the scene, and the deadline for filing. **You didn't ask for any of this.** The AI understood your situation, reasoned about what you'd need, and proactively retrieved everything relevant from YOUR workspace.

**The one-sentence pitch:**

> Parallx doesn't wait for the right question — it understands your situation and gives you what you need before you know to ask for it.

**Why this wins investors:**

This is the moment Parallx stops being "a chatbot with a search index" and becomes "a second brain." Every other local AI tool (Ollama Web UI, LM Studio, GPT4All) just wraps a chat interface around a model. None of them understand your data proactively. This is the differentiator.

---

## The Problem

### Current Pipeline: Single-Query RAG (Reactive)

```
User: "I got into a fender bender on the highway"
                    │
                    ▼
         Embed user's literal words
         "fender bender highway"
                    │
                    ▼
         Single vector search + FTS5
                    │
                    ▼
         Maybe 1-2 vaguely related chunks
         (the phrase "fender bender" appears nowhere in insurance docs)
                    │
                    ▼
         Thin response: "I found some general info about your auto policy..."
```

### Why It Fails

1. **Vocabulary mismatch**: The user says "fender bender" but the insurance docs say "collision," "covered loss," "claim event." Single-query search misses the connection.
2. **No situational reasoning**: The system treats "I got into a fender bender" the same as "search for: fender bender." It doesn't understand this is a *situation* that implies information needs.
3. **No query expansion**: One search query means one chance to match. If that query misses, the response is thin.
4. **No proactive intent**: The system only retrieves what matches — it never asks "what would be *helpful* for this person right now?"

---

## Research: How The Industry Solves This

### VS Code Copilot Chat

**Key architecture patterns:**

| Pattern | How Copilot Does It | Parallx Implication |
|---------|--------------------|--------------------|
| **Multi-strategy parallel retrieval** | Runs GitHub code search + local semantic search + text grep + IntelliSense in parallel for the same query | We should run multiple search queries in parallel, not just one |
| **Agent-driven iterative search** | After initial search, agent evaluates results and issues follow-up targeted searches | Our planning call replaces this (we can't afford iterative LLM calls) |
| **`#codebase` as a tool, not a participant** | LLM can invoke codebase search *multiple times* with different queries | Our `search_knowledge` tool should accept the planning call's queries |
| **Plan agent (4-phase)** | Discovery → Alignment → Design → Refinement — explicit planning before action | Our pre-retrieval planning call is the lightweight version of this |
| **Intent detection** | Determines if a message needs workspace context before searching | Our planning call classifies intent as part of the same LLM call |

**Key insight from Copilot**: They moved from `@workspace` (single handoff, one search) to `#codebase` (tool the LLM invokes repeatedly). We're making the same architectural shift — from a single `retrieveContext(userMessage)` call to a planning-driven multi-query retrieval.

### OpenClaw

**Key finding: OpenClaw does NOT do programmatic query expansion.** Everything is delegated to the LLM via prompt engineering. Their approach works because they target GPT-4/Claude (cloud models that can chain 10+ tool calls naturally).

**What we take from OpenClaw:**
- "Gather first, act second" — skill manifests instruct the model to search before responding
- `/think` directive for controlling reasoning depth
- Tool-call loop detection (relevant for our agentic loop, not for planning)

**What we CAN'T copy:** OpenClaw's "just let the model figure it out" approach fails with local 32B models. Qwen2.5:32b takes the path of least resistance — one tool call, then stops. We need explicit infrastructure.

### RAG Research (Academic + Industry)

| Technique | LLM Calls | Quality Impact | Our Plan |
|-----------|-----------|---------------|----------|
| **Multi-Query Generation** | 1 | High | ✅ Include in planning call |
| **Step-Back Prompting** | 0 (combined) | Medium | ✅ Include in planning call |
| **Intent Classification** | 0 (combined) | Medium | ✅ Include in planning call |
| **Planning-Based Retrieval** | 1 | Highest | ✅ This IS our planning call |
| **HyDE (Hypothetical Document)** | 1 | Medium | ⏭️ Future enhancement |
| **Cross-Encoder Re-ranking** | 0 (separate model) | High | ⏭️ Future (needs separate model) |
| **Contextual Retrieval (index-time)** | 0 at query time | Very High | ⏭️ Future (background job) |
| **Agentic RAG (full loop)** | 3-6 | Highest | ❌ Too slow for local model |

**The consensus**: A single **unified planning call** that combines multi-query generation + step-back prompting + intent classification gives the best quality-per-latency ratio for a local model. This is our architecture.

---

## Architecture: The 2-Call Pipeline

### Overview

```
                     ┌────────────────────────────────────────┐
                     │          CURRENT (M11)                 │
                     │                                        │
   User message ──→  │  Embed literal words → One search ──→  │ ──→ LLM response
                     │  (single query, single retrieval)      │
                     └────────────────────────────────────────┘

                     ┌────────────────────────────────────────────────────┐
                     │          NEW (M12) — The 2-Call Pipeline           │
                     │                                                    │
                     │  ┌─── Call 1: Planning (~3-8s) ───────────┐       │
                     │  │                                         │       │
   User message ──→  │  │  LLM analyzes situation                │       │
                     │  │  Classifies intent                     │       │
                     │  │  Generates 3-5 targeted search queries │       │
                     │  │  Reasons about what user needs         │       │
                     │  └────────────┬────────────────────────────┘       │
                     │               │                                    │
                     │               ▼                                    │
                     │  ┌─── Parallel Retrieval (~100-300ms) ────┐       │
                     │  │                                         │       │
                     │  │  Query 1 → hybrid search → results     │       │
                     │  │  Query 2 → hybrid search → results     │       │
                     │  │  Query 3 → hybrid search → results     │       │
                     │  │  Query 4 → hybrid search → results     │       │
                     │  │  Query 5 → hybrid search → results     │       │
                     │  │           ↓                             │       │
                     │  │  Merge + Deduplicate + RRF re-rank     │       │
                     │  │  Top-K chunks selected                 │       │
                     │  └────────────┬────────────────────────────┘       │
                     │               │                                    │
                     │               ▼                                    │
                     │  ┌─── Call 2: Response Generation ─────────┐      │
                     │  │                                          │      │
                     │  │  System prompt + Workspace digest        │      │
                     │  │  + Rich retrieved context (from 5 queries│)     │
                     │  │  + Conversation history                  │      │
                     │  │  + User message                          │      │
                     │  │  → Comprehensive, proactive response     │      │
                     │  └──────────────────────────────────────────┘      │
                     └────────────────────────────────────────────────────┘
```

### Call 1: The Retrieval Planner

This is the single most important new component. One LLM call that does four things simultaneously:

**Input:**
- User's message
- Workspace digest (page titles, file tree, key files — so the LLM knows what it CAN search for)
- Last 2-3 conversation turns (for conversational continuity)
- Current mode (Ask/Agent)

**Output (structured JSON):**
```json
{
  "intent": "situation",
  "reasoning": "User describes a car accident. This workspace contains insurance 
    policy documents, claims guides, and agent contact info. The user needs: 
    coverage details, deductible amounts, claims procedure, agent contact, 
    what to document at the scene, filing deadlines.",
  "needs_retrieval": true,
  "queries": [
    "collision coverage limits deductible amount",
    "auto insurance claims filing procedure steps deadline",
    "insurance agent contact phone number office",
    "what to document after car accident police report photos",
    "auto insurance policy summary coverage types"
  ]
}
```

**Intent taxonomy:**

| Intent | Description | Retrieval Strategy |
|--------|-------------|-------------------|
| `question` | Direct question about workspace content | Standard multi-query retrieval |
| `situation` | User describes a situation, needs proactive help | Expanded multi-query + reasoning about needs |
| `task` | User wants the AI to DO something | Minimal retrieval, route to agentic tools |
| `conversational` | Greeting, follow-up, no workspace content needed | Skip retrieval entirely |
| `exploration` | User wants to browse/discover workspace content | Broad retrieval, multiple sources |

**Why this works with a 32B model:** This is a narrow, well-structured task — classify intent and generate search terms. It's one of the easiest LLM tasks. The structured JSON output with a clear schema is reliable even for small models. We include chain-of-thought via the `reasoning` field, which improves query quality.

### Parallel Multi-Query Retrieval

Each query from the planning call hits the existing hybrid retrieval pipeline independently:

```
For each query in plan.queries:
  1. Embed query → nomic-embed-text (search_query: prefix)
  2. Vector similarity search (sqlite-vec)  
  3. FTS5 keyword search (BM25)             } existing pipeline
  4. Merge via RRF (k=60)                   }
  
Merge all query results:
  - Union all chunks
  - Deduplicate by chunk ID (keep highest score)
  - Re-rank by aggregate RRF score across queries
  - Apply token budget (3000 tokens / ~12000 chars)
  - Return top-K chunks
```

**Performance**: Each retrieval query takes ~50ms (embedding ~20ms + search ~30ms). Five queries in parallel complete in ~50-100ms total. This is negligible compared to the planning LLM call.

### Call 2: Response Generation (Existing)

This is the existing response generation path — no changes needed. The only difference is that it now receives **much richer context** from the multi-query retrieval instead of a single thin search.

### Planning Indicator UI

While Call 1 runs (~3-8 seconds), the user sees a visual indicator:

```
┌─────────────────────────────────────────┐
│  🧠 Analyzing your situation...         │
│  ████████░░░░░░░░ Planning retrieval    │
└─────────────────────────────────────────┘
```

This replaces the instant "typing..." indicator. The user should feel the AI is **thinking**, not just waiting. This is a UX signal that the AI is doing more work than a simple chatbot.

After planning completes, the indicator transitions:

```
┌─────────────────────────────────────────┐
│  📚 Searching 5 sources...              │
│  ████████████████ Retrieving context    │
└─────────────────────────────────────────┘
```

Then the normal streaming response begins.

---

## Current State — What Exists Today

### Files That Will Change

| File | Lines | What Changes |
|------|-------|-------------|
| `src/built-in/chat/participants/defaultParticipant.ts` | 1288 | Add planning call before retrieval (L575–L617), add multi-query merge |
| `src/services/retrievalService.ts` | 233 | Add `retrieveMulti(queries[])` method for parallel multi-query retrieval |
| `src/built-in/chat/chatTool.ts` | 1703 | Update `retrieveContext` bridge to use planning-driven retrieval |
| `src/built-in/chat/chatSystemPrompts.ts` | 293 | Add planner system prompt |
| `src/built-in/chat/providers/ollamaProvider.ts` | 632 | Add `planRetrieval()` convenience method (non-streaming internal call) |
| `src/built-in/chat/chatWidget.ts` | ~847 | Add planning phase indicator UI |
| `src/built-in/chat/chatWidget.css` | — | Styles for planning indicator |

### Key Integration Points

```
chatTool.ts (L383-L412)
  └── retrieveContext bridge
      └── currently: retrievalService.retrieve(query, { topK: 8 })
      └── becomes:  planAndRetrieve(userMessage, workspaceDigest, history)
                    ├── Call 1: ollamaProvider.planRetrieval(message, digest)
                    │           → returns { intent, queries[], reasoning }
                    ├── retrievalService.retrieveMulti(queries)
                    │           → parallel search, merge, dedup, re-rank
                    └── returns enriched context

defaultParticipant.ts (L575-L617)
  └── RAG retrieval block
      └── currently: services.retrieveContext(userText)
      └── becomes:  services.planAndRetrieve(userText, conversationSummary)
                    → returns { context, plan, reasoning }
                    → plan/reasoning used for planning indicator
                    → context injected same as before
```

### Retrieval Parameters (Current)

From `chatTool.ts` L383-L412:
- `topK: 8` chunks per query
- `maxPerSource: 3` chunks per source
- `tokenBudget: 3000` chars (~750 tokens)

After M12: each of 5 queries retrieves top-8, merged results deduplicated, final top-K selected within token budget. Effective search space is 5x wider.

---

## Transformation Plan

### Non-Negotiables

| # | Decision | Rationale |
|---|----------|-----------|
| **NN-1** | **Exactly 2 LLM calls per message** — planning + response. No more. | 3-8s per call on local model. 2 calls = 6-16s total, acceptable. 3+ calls = too slow for demo. |
| **NN-2** | **Planning call uses the SAME model** (qwen2.5:32b-instruct) | No separate planning model. One model, consistent behavior. |
| **NN-3** | **Planning is invisible to the user** — they see a "thinking" indicator, not the planning JSON | The magic is that it "just works." Users don't need to know about query expansion. |
| **NN-4** | **Graceful degradation** — if planning call fails or returns invalid JSON, fall back to single-query RAG | Demo cannot crash. Invalid planning output → existing behavior, not an error. |
| **NN-5** | **Skip planning for simple queries** — if the message is < 5 words and contains a `?`, it's a direct question → skip planning, use single-query | Don't add 5s latency to "what's my deductible?" |
| **NN-6** | **Skip planning if RAG is unavailable** — if indexing isn't complete, no planning | Can't search if there's nothing indexed. |

### What We're NOT Building (Scope Limits)

- ❌ Cross-encoder re-ranking (needs separate model deployment)
- ❌ Contextual retrieval at index time (background job, not demo-critical)
- ❌ HyDE (adds complexity, marginal gain over multi-query for this use case)
- ❌ Full agentic RAG loop (too slow — 4+ LLM calls)
- ❌ Custom planning model fine-tuning
- ❌ Planning result caching across sessions

---

## Task Tracker

### How to Use This Tracker

- **Status symbols:** ⬜ Not started → 🔨 In progress → ✅ Complete → ❌ Blocked
- **Each task has code-level precision** — exact files, line numbers, method signatures
- **Dependencies are explicit** — don't start a task if its dependencies aren't ✅
- **Target: ALL tasks ✅ before demo**

### Phase 1 — The Planner Brain (Core Pipeline)

> Goal: The LLM can analyze a user message and produce targeted search queries.

| # | Task | Status | Est. | Depends On | Files | What to Do |
|---|------|--------|------|------------|-------|------------|
| **1.1** | **Retrieval planner prompt** | ⬜ | 30m | — | `chatSystemPrompts.ts` | Write the planner system prompt. Input: user message + workspace digest + last 2-3 turns. Output: JSON `{ intent, reasoning, needs_retrieval, queries[] }`. Include the intent taxonomy (question/situation/task/conversational/exploration). Include few-shot examples. Export as `buildPlannerPrompt(workspaceDigest, recentHistory)`. |
| **1.2** | **Planner LLM call method** | ⬜ | 45m | 1.1 | `ollamaProvider.ts` | Add `planRetrieval(messages: IChatMessage[]): Promise<IRetrievalPlan>`. Uses existing `sendChatRequest()` internally but **collects the full response** instead of yielding chunks (consume the async iterable, concatenate text, parse JSON). Define `IRetrievalPlan` interface: `{ intent: string; reasoning: string; needsRetrieval: boolean; queries: string[] }`. Robust JSON parsing with fallback: if JSON parse fails, extract queries from free text. |
| **1.3** | **Skip-planning heuristic** | ⬜ | 20m | — | `defaultParticipant.ts` | Function `shouldSkipPlanning(message: string, isRAGAvailable: boolean): boolean`. Returns true if: (a) message is < 6 words AND contains `?`, (b) RAG is not available, (c) message starts with `/` (slash command), (d) message is a greeting (< 4 words, common greetings list). When skipped, fall back to existing single-query retrieval. |

### Phase 2 — Multi-Query Retrieval (Search Upgrade)

> Goal: Multiple search queries execute in parallel and results merge intelligently.

| # | Task | Status | Est. | Depends On | Files | What to Do |
|---|------|--------|------|------------|-------|------------|
| **2.1** | **`retrieveMulti()` method** | ⬜ | 1h | — | `retrievalService.ts` | New method: `async retrieveMulti(queries: string[], options?: RetrievalOptions): Promise<RetrievedContext[]>`. Runs `retrieve()` for each query in parallel via `Promise.all()`. Merges results: union all chunks, deduplicate by `chunkId` (keep highest RRF score), re-sort by score, apply token budget. The effective `topK` for each sub-query should be `Math.ceil(options.topK / queries.length) + 2` (over-fetch per query, then trim after merge). |
| **2.2** | **Multi-query context formatting** | ⬜ | 20m | 2.1 | `retrievalService.ts` | Update `formatContext()` to optionally include which query/queries matched each chunk (for transparency in the planning indicator). Add a `queryOrigins: Map<string, string[]>` to the return type — maps chunkId → array of queries that found it. Chunks found by multiple queries are likely more relevant. |

### Phase 3 — Wiring (Connect Planner to Participant)

> Goal: The planning call is integrated into the chat flow. User messages go through plan → retrieve → respond.

| # | Task | Status | Est. | Depends On | Files | What to Do |
|---|------|--------|------|------------|-------|------------|
| **3.1** | **`planAndRetrieve` service method** | ⬜ | 1h | 1.1, 1.2, 1.3, 2.1 | `chatTool.ts` | Replace the current `retrieveContext` bridge (L383-L412) with `planAndRetrieve(userText, recentHistory?)`. Flow: (1) Check `shouldSkipPlanning()` — if true, use existing single-query path. (2) Build planner messages via `buildPlannerPrompt()` with workspace digest + last 2-3 history turns + user message. (3) Call `ollamaProvider.planRetrieval(messages)`. (4) If plan has `needsRetrieval: true` and `queries.length > 0`, call `retrievalService.retrieveMulti(plan.queries)`. (5) Format context. (6) Return `{ text, sources, plan }` — plan included for UI indicator. |
| **3.2** | **Update participant to use planAndRetrieve** | ⬜ | 45m | 3.1 | `defaultParticipant.ts` | Replace the RAG retrieval block at L575-L617. Current: `services.retrieveContext(userText)`. New: `services.planAndRetrieve(userText, recentTurns)`. Extract the `plan` from the result for the planning indicator. Emit planning metadata via a new `response.planningComplete(plan)` or custom progress token. The context injection into `contextParts[]` stays the same — only the source of the context changes. |
| **3.3** | **Pass recent history to planner** | ⬜ | 30m | 3.2 | `defaultParticipant.ts` | Extract last 2-3 conversation turns from the session history (already available in the handler at L499-L519). Format as a compact summary: `"User: ... \nAssistant: ..."` (truncated to ~500 chars). Pass to `planAndRetrieve()` so the planner has conversational context. |
| **3.4** | **Graceful fallback on planner failure** | ⬜ | 20m | 3.1 | `chatTool.ts` | Wrap the planning call in try/catch. If `planRetrieval()` throws, times out (10s max), or returns invalid JSON: log warning, fall back to existing `retrievalService.retrieve(userText, { topK: 8 })`. The user should never see a planning failure — it silently degrades to M11 behavior. |

### Phase 4 — Planning Indicator UI (User Sees "Thinking")

> Goal: The user sees a visible "analyzing..." phase before the response streams, signaling the AI is reasoning proactively.

| # | Task | Status | Est. | Depends On | Files | What to Do |
|---|------|--------|------|------------|-------|------------|
| **4.1** | **Planning progress protocol** | ⬜ | 30m | 3.2 | `defaultParticipant.ts`, `chatWidget.ts` | Define a progress reporting mechanism for the planning phase. Options: (a) emit a progress event `{ phase: 'planning' \| 'retrieving' \| 'responding', detail?: string }` before the stream starts, (b) use existing `response.progress()` if available. The widget listens for this and shows the indicator. |
| **4.2** | **Planning indicator component** | ⬜ | 45m | 4.1 | `chatWidget.ts`, `chatWidget.css` | A small animated banner that appears in the chat response area during the planning phase. Three states: (1) "Analyzing your message..." (during LLM planning call), (2) "Searching N sources..." (during multi-query retrieval), (3) transitions to normal streaming. Use CSS animation (pulsing dots or a subtle progress bar). Component is a `<div>` inserted before the response message DOM, removed when streaming starts. |
| **4.3** | **Planning reasoning in sidebar (debug)** | ⬜ | 20m | 4.1 | `chatListRenderer.ts` or `chatWidget.ts` | Optionally show the planner's `reasoning` field in a collapsible "Thought process" section below the response. Collapsed by default. Shows: intent classification, reasoning text, generated queries. This is for power users and demo — proves the AI is thinking. |

### Phase 5 — Compile, Test, Demo Prep

> Goal: Everything compiles, works end-to-end, and is demo-ready.

| # | Task | Status | Est. | Depends On | Files | What to Do |
|---|------|--------|------|------------|-------|------------|
| **5.1** | **TypeScript compile check** | ⬜ | 15m | All above | — | `npx tsc --noEmit`. Fix all errors. |
| **5.2** | **End-to-end smoke test** | ⬜ | 30m | 5.1 | — | Open a workspace with varied content. Test: (1) Situational message: "I got into a car accident" → should return comprehensive results. (2) Direct question: "What's my deductible?" → should skip planning, fast response. (3) Conversational: "Hello" → should skip planning, no RAG. (4) Follow-up: after a response, ask a follow-up → planner should use conversation context. (5) Edge case: empty workspace → graceful degradation. |
| **5.3** | **Demo workspace preparation** | ⬜ | 30m | 5.2 | — | Create a demo workspace with 3-5 canvas pages: (1) "Auto Insurance Policy" (coverage types, limits, deductibles), (2) "Claims Guide" (step-by-step procedure, deadlines, documentation), (3) "Agent Contacts" (name, phone, email, office hours), (4) "Vehicle Info" (make, model, year, VIN). Index the workspace. Verify the fender bender scenario returns rich results. |
| **5.4** | **Commit and push** | ⬜ | 5m | 5.3 | — | Commit all M12 changes to `milestone-12` branch. |

### Summary

| Phase | Tasks | Estimated Time | Outcome |
|-------|-------|---------------|---------|
| Phase 1 | 1.1–1.3 | ~1.5h | Planner brain: prompt, LLM call, skip heuristic |
| Phase 2 | 2.1–2.2 | ~1.5h | Multi-query retrieval: parallel search, merge, dedup |
| Phase 3 | 3.1–3.4 | ~2.5h | Full wiring: plan → retrieve → respond pipeline |
| Phase 4 | 4.1–4.3 | ~1.5h | UX: planning indicator, thought process display |
| Phase 5 | 5.1–5.4 | ~1.5h | Compile, test, demo prep |
| **Total** | **16 tasks** | **~8.5h** | **Proactive intelligence, demo-ready** |

---

## Demo Script

### Setup
- Open Parallx with the demo insurance workspace
- Ensure workspace is indexed (check for "Indexing complete" in output)
- Have the chat panel open

### Scenario 1: "The Fender Bender" (The Hero Moment)

**User types:** *"I got into a fender bender on the highway this morning"*

**Expected AI behavior:**
1. Planning indicator appears: "Analyzing your situation..." (3-5s)
2. Indicator transitions: "Searching 5 sources..."
3. AI responds with a comprehensive briefing:
   - **Immediate steps**: What to document at the scene (photos, police report, other driver's info)
   - **Your coverage**: Collision coverage limits, deductible amount
   - **Claims process**: Step-by-step filing procedure, deadline
   - **Who to call**: Agent name, phone number, office hours
   - Context pills show: "Auto Insurance Policy", "Claims Guide", "Agent Contacts"
4. *Optional*: Expand "Thought process" to show the AI's reasoning

**Why this impresses:** The user didn't ask a question. They described a situation. The AI understood what they needed and proactively provided everything relevant. This is the "Jarvis moment."

### Scenario 2: "Direct Question" (Speed Demo)

**User types:** *"What's my deductible?"*

**Expected AI behavior:**
1. No planning indicator (skipped — short direct question)
2. Fast response with the deductible amount, directly from the policy document
3. Shows the source document as a context pill

**Why this matters:** Planning doesn't slow down simple questions. The system is smart enough to know when to think and when to just answer.

### Scenario 3: "Follow-Up Intelligence" (Continuity Demo)

**After Scenario 1, user types:** *"What if the other driver was uninsured?"*

**Expected AI behavior:**
1. Planning indicator: "Analyzing your situation..." (shorter — conversational context helps)
2. AI retrieves uninsured motorist coverage details
3. References the original accident context from the conversation
4. Provides: UM/UIM coverage limits, different claims procedure for uninsured drivers, whether to contact police

**Why this matters:** The AI maintains context across turns and uses conversation history to improve retrieval. It didn't forget that "the other driver" refers to the fender bender from Scenario 1.

### Scenario 4: "Exploration" (Discovery Demo)

**User types:** *"What do I have in this workspace?"*

**Expected AI behavior:**
1. Planning recognizes `exploration` intent
2. Summarizes workspace contents: pages, key documents, what kind of information is stored
3. Proactively suggests: "Want me to summarize your policy details? Or review your coverage limits?"

**Why this matters:** The AI knows the workspace and can guide the user through it.

---

*This document is the living plan for Milestone 12. Demo is end-of-day March 3, 2026. All 16 tasks must be ✅ before demo.*
