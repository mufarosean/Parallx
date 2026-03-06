# Interaction Layer Architecture — Research & Implementation Plan

> **Date:** March 3, 2026
> **Status:** Approved for implementation
> **Scope:** Refactor the AI chat interaction pipeline so the planner (thinking layer) runs on every message, removing deterministic heuristics that bypass it.

---

## 1. Research Findings

### 1.1 How ChatGPT, Claude, and VS Code Copilot Handle This

All three frontier systems share the same core architecture for conversational AI with tool use:

| Design Decision | ChatGPT | Claude | VS Code Copilot |
|---|---|---|---|
| Separate intent classifier before model call? | **No** | **No** | **No** |
| How tools are sent | Always all tools, `tool_choice: "auto"` | Always all tools, `tool_choice: auto` | Mode-filtered tools, model decides |
| How model decides to use tools | System prompt + tool descriptions | System prompt + tool descriptions | System prompt + tool descriptions |
| How conversational messages are handled | Model self-regulates — no code-level gating | Model self-regulates | Model self-regulates |
| Visible to user during tool use | "Searching..." progress label | "Using [tool]..." collapsible | Compact card with status badge |
| Raw JSON visible? | Never | Never | Never (expandable on demand) |

**Key takeaway:** None of these systems use a pre-model classifier, heuristic matcher, or separate LLM call to decide intent before the main model call. The model reads the system prompt, sees available tools, reads the user's message, and decides what to do. Tool descriptions serve as implicit routing rules.

### 1.2 Why Frontier Systems Don't Need a Planner

GPT-4, Claude 3.5+, and similar frontier models have strong enough instruction-following that they can:
- Classify intent (conversational vs task vs question) from context
- Decide which tools are relevant (or none)
- Generate targeted search queries
- Maintain conversational tone across tool-use turns

...all in a **single model call**. No pre-routing needed.

### 1.3 Why Parallx Needs a Planner (Small Model Compensation)

Parallx runs llama3.1:8b and qwen2.5:32b locally via Ollama. These models have known limitations:

1. **Weak self-regulation with tools present.** When tools are in the request, small models tend to use them regardless of whether the message warrants it. "Who are you?" with 11 tool definitions → model calls tools.
2. **Tool call format instability.** Small models emit tool calls as JSON text in the content field instead of structured `tool_calls`. (Already handled by `_extractToolCallsFromText()`.)
3. **Preamble narration.** Small models add "Here is the JSON response..." before tool calls. (Already handled by preamble stripping.)
4. **Tone loss across tool-use turns.** After processing tool results, small models can lose conversational tone.

**The planner is our small-model compensation pattern.** It does what GPT-4 does internally — classify intent and decide what context is needed — but as a separate, focused LLM call before the main response. This is architecturally sound. The problem is that we bypass it for exactly the messages where it's most needed.

### 1.4 What Our System Does Wrong — "Who are you?" Trace

Current pipeline for `"Who are you?"`:

```
1. shouldSkipPlanning("Who are you?")
   → ≤6 words + ends with "?" → returns TRUE → PLANNER SKIPPED

2. isObviouslyConversational("Who are you?")
   → not in GREETING_PATTERNS regex → returns FALSE

3. Synthetic plan created:
   → { intent: 'question', needsRetrieval: true, queries: [] }
   → WRONG: classified as a factual question needing workspace data

4. Direct RAG retrieval fires → workspace documents injected
5. Memory recall fires → conversation memories injected
6. isConversational → false → ALL TOOLS SENT TO MODEL

7. Model receives:
   - System prompt (~1500 tokens) with RULES and WHEN TO USE TOOLS
   - Workspace digest (~2000 tokens)
   - RAG-retrieved documents
   - Conversation memories
   - 11+ tool definitions
   - "Who are you?"

8. Model does the only logical thing with all that context: uses tools.
9. Preamble narration leaks: "Here is the JSON response with its proper arguments..."
```

The root cause is clear: **deterministic heuristics bypass the thinking layer, produce wrong synthetic plans, and the wrong plan cascades through every downstream gate.**

### 1.5 The Right Architecture

```
User sends message
  ↓
Planner ALWAYS runs (fast, focused LLM call)
  - Reads message + recent history
  - Classifies intent: conversational | question | situation | task | exploration
  - Decides: needsRetrieval (true/false)
  - Generates: targeted search queries (if retrieval needed)
  ↓
Pipeline uses planner output to gate everything:
  - conversational → NO RAG, NO memory, NO tools. Just system prompt + history + message.
  - question       → RAG context injected. Read-only tools available.
  - situation      → RAG + memory injected. Full contextual tools.
  - task           → RAG + memory injected. Full tools.
  - exploration    → RAG injected. Discovery tools.
  ↓
Model receives ONLY what the planner decided it needs
  ↓
Response streams to user naturally
```

This matches the frontier architecture in spirit — the **model decides** — but with an extra focused LLM call to compensate for the smaller model's weaker self-regulation.

---

## 2. What Changes

### 2.1 Remove: Deterministic Heuristics

| Component | Location | Action |
|---|---|---|
| `isObviouslyConversational()` | `defaultParticipant.ts:143-155` | **Delete function entirely** |
| `GREETING_PATTERNS` regex | `defaultParticipant.ts:131` | **Delete constant** |
| `shouldSkipPlanning()` | `defaultParticipant.ts:162-183` | **Simplify to only skip when planner is literally unavailable** |
| Synthetic plan creation (conversational branch) | `defaultParticipant.ts:608-617` | **Remove — planner always provides the real plan** |
| Synthetic plan creation (question branch) | `defaultParticipant.ts:618-626` | **Remove — planner always provides the real plan** |

### 2.2 Modify: Planner Always Runs

| Component | Location | Action |
|---|---|---|
| `usePlanner` gate | `defaultParticipant.ts:527` | **Planner runs whenever `planAndRetrieve` is available, regardless of message length or content** |
| Fallback when planner unavailable | `defaultParticipant.ts:628-665` | **Keep as fallback, but add a default `{ intent: 'question' }` synthetic plan so downstream gates still work** |
| Progress message "Analyzing your message…" | `defaultParticipant.ts:536` | **Remove — thinking should be silent** |

### 2.3 Rewrite: System Prompts

The current system prompts have two problems:
1. **Too prescriptive.** Rules like "For greetings, respond naturally. Do NOT use tools for conversational messages." try to do what the planner already handles through tool gating.
2. **Personality buried under rules.** The identity block is good but the RULES section reads like a compliance document.

**New approach:** Personality-first. Brief principles. No tool-use decision rules (the planner handles that). The model should feel like an expert, not a rule-follower.

| Section | Current | New |
|---|---|---|
| Identity | Good — keep | Keep as-is |
| CONTEXT | Good — keep | Keep as-is |
| RULES (Ask) | 10 rules, many about when to use tools | 4-5 principles. Remove tool-decision rules. |
| RULES (Agent) | 10 rules, many about when to use tools | 4-5 principles. Remove tool-decision rules. |
| WHEN TO USE TOOLS | 5 prescriptive rules | **Remove entirely** — tools are planner-gated now. When the model receives tools, it should use them. When it doesn't receive tools, it can't. |
| "For greetings..." rule | First rule in both Ask and Agent | **Remove** — models handle greetings natively. Planner gates tools away for conversational messages. |

### 2.4 Keep: Small-Model Safety Nets

| Component | Location | Rationale |
|---|---|---|
| `_extractToolCallsFromText()` | `defaultParticipant.ts:63-119` | Small models emit JSON text tool calls. Essential. |
| Preamble stripping | `defaultParticipant.ts:106-119` | Small models narrate before JSON. Essential. |
| `replaceLastMarkdown()` | `chatService.ts:160-176` | Cleans rendered markdown after extraction. Essential. |
| Mode-based tool filtering | `defaultParticipant.ts:943-947` | Ask=read-only, Agent=full. Matches VS Code. Keep. |
| `isConversational` tool gating | `defaultParticipant.ts:944` | When planner says conversational, no tools sent. **Now always works because planner always runs.** |
| Max iteration guard | `defaultParticipant.ts:989` | Prevents infinite tool loops. Keep. |
| Context overflow / summarization | `defaultParticipant.ts:892-938` | Budget management. Keep. |

### 2.5 Modify: Thought Process Rendering

| Component | Location | Action |
|---|---|---|
| Thinking UI (retrieval plan) | `defaultParticipant.ts:1215-1222` | **Keep** — uses `response.thinking()` which renders as collapsible UI. But only show when `needsRetrieval` is true (not for conversational). Already gated correctly. |

---

## 3. Implementation Tasks

### Task 1: Remove `isObviouslyConversational` and `GREETING_PATTERNS`

**File:** `src/built-in/chat/participants/defaultParticipant.ts`

- Delete `GREETING_PATTERNS` constant (line 131)
- Delete `isObviouslyConversational()` function (lines 143-155)
- Remove the two call sites:
  - `shouldSkipPlanning()` line 173: remove the `isObviouslyConversational` check
  - Synthetic plan creation line 609: remove the `isObviouslyConversational` branch

### Task 2: Simplify `shouldSkipPlanning` → `shouldUsePlanner`

**File:** `src/built-in/chat/participants/defaultParticipant.ts`

Replace `shouldSkipPlanning()` with a simpler `shouldUsePlanner()` that returns `true` unless the planner is literally unavailable:

```typescript
/**
 * Determine whether to use the retrieval planner.
 * The planner runs on EVERY message when available — it is the AI's
 * thinking layer. Only skip when structurally impossible.
 */
function shouldUsePlanner(
  isRAGAvailable: boolean,
  hasSlashCommand: boolean,
  hasPlanAndRetrieve: boolean,
): boolean {
  if (!hasPlanAndRetrieve) { return false; }
  if (!isRAGAvailable) { return false; }
  if (hasSlashCommand) { return false; }
  return true;
}
```

Key differences:
- **No message content inspection.** No word counting, no question mark detection, no greeting regex.
- **Name inversion:** `shouldUsePlanner` (positive) vs `shouldSkipPlanning` (negative) — clearer intent.
- **Slash commands still bypass** — they have their own explicit prompt templates.

### Task 3: Remove synthetic plan creation, add simple fallback

**File:** `src/built-in/chat/participants/defaultParticipant.ts`

Remove the `if (!usePlanner && !retrievalPlan)` block that creates synthetic plans (lines 608-626). Replace with a minimal fallback for when the planner is unavailable (no `planAndRetrieve` service, or RAG not ready):

```typescript
// Fallback plan when planner is unavailable (RAG not ready, slash command, etc.)
// Uses a safe default: treat as a question that may need retrieval.
if (!retrievalPlan) {
  retrievalPlan = {
    intent: 'question',
    reasoning: 'Planner unavailable — using default question intent.',
    needsRetrieval: isRagReady,
    queries: [],
  };
}
```

This ensures downstream gates always have a plan, but the fallback only applies when the planner literally cannot run.

### Task 4: Remove "Analyzing your message…" progress indicator

**File:** `src/built-in/chat/participants/defaultParticipant.ts`

Remove `response.progress('Analyzing your message…')` (line 536). The thinking step should be invisible to the user. ChatGPT doesn't say "Deciding whether to call tools...". Neither should we.

### Task 5: Rewrite system prompts — personality over rules

**File:** `src/built-in/chat/config/chatSystemPrompts.ts`

#### 5a. Ask Mode — New RULES section

Replace the current 10-rule RULES + WHEN TO USE TOOLS block with:

```typescript
lines.push(
  '',
  'RULES:',
  '- Be direct and useful. Answer with real content, not meta-commentary about what you could do.',
  '- You already know this workspace — use the file tree, page list, and digest above. Go straight to the answer.',
  '- Do NOT invent content. Only reference what is in the provided context or discovered via tools.',
  '- read_page accepts both a page UUID and a page title.',
  '- You can READ workspace content but CANNOT create, modify, or delete anything in Ask mode.',
);
```

**Removed:**
- "For greetings, respond naturally" — the planner gates tools away for conversational messages, so the model won't have tools to misuse.
- "WHEN TO USE TOOLS" section — when the model receives tools, it should use them as needed. When it doesn't (conversational), it can't. No rules needed.
- "NEVER just list file or page names" — good guidance but belongs in tool descriptions, not system prompt.
- "When asked to summarize: read_file or read_page..." — overly prescriptive. The model knows how to summarize.

#### 5b. Agent Mode — New RULES section

Replace the current 10-rule RULES + WHEN TO USE TOOLS block with:

```typescript
lines.push(
  '',
  'RULES:',
  '- Be direct and useful. Deliver results, not narration about your process.',
  '- You already know this workspace — use the digest above. Go straight to relevant files.',
  '- Do NOT invent content. Only reference what is in the provided context or discovered via tools.',
  '- read_page accepts both a page UUID and a page title.',
  '- Read-only tools can be used freely. Write tools (create, update, delete) require user confirmation.',
  '- If a tool call fails, try alternatives before reporting failure.',
);
```

**Removed:** Same items as Ask mode, plus "When the user is vague about workspace content..." (prescriptive).

### Task 6: Update tests

**File:** `tests/unit/m12RetrievalPlanner.test.ts`

- Replace `shouldSkipPlanning` test suite with `shouldUsePlanner` tests
- Tests should verify:
  - Returns `false` when `hasPlanAndRetrieve` is false
  - Returns `false` when RAG is unavailable
  - Returns `false` for slash commands
  - Returns `true` for all other messages (short, long, questions, greetings, tasks)

**File:** `tests/unit/chatSystemPrompts.test.ts`

- Update tests that check for removed text ("WHEN TO USE TOOLS", "For greetings", etc.)
- Add tests verifying the new slimmer RULES section
- Keep token budget tests (prompts should still be under 2000 tokens — and now smaller)

### Task 7: Verify and commit

- `tsc --noEmit` clean
- All 1353+ tests pass
- Manual test: "Hello", "Who are you?", "What's in my workspace?", "I got into a car accident"

---

## 4. What This Does NOT Change

- **The planner prompt itself** (`buildPlannerPrompt()`) — it's well-designed with clear intent definitions and examples. No changes needed.
- **The agentic loop** — tool invocation, card rendering, result processing all stay the same.
- **The rendering pipeline** — markdown rendering, tool cards, thinking UI all stay the same.
- **Text-based tool extraction** — `_extractToolCallsFromText()` and preamble stripping stay.
- **Mode-based tool filtering** — Ask=read-only, Agent=full. Matches VS Code.
- **Memory, RAG, attachments, mentions** — context injection mechanisms stay. Only the gating changes.
- **Token budget management** — context overflow detection and summarization stays.
- **Edit mode** — no tools, structured JSON output. Unaffected.

---

## 5. Expected Outcomes

| Scenario | Before | After |
|---|---|---|
| "Hello" | `isObviouslyConversational` → skip planner → synthetic `conversational` plan → no tools → works OK | Planner runs → `conversational` → no tools → works |
| "Who are you?" | `shouldSkipPlanning` (short ?) → skip planner → synthetic `question` plan → RAG + tools → model calls tools → broken | Planner runs → `conversational` → no tools → natural response |
| "What's my deductible?" | `shouldSkipPlanning` (short ?) → skip planner → synthetic `question` → direct RAG → tools sent → sometimes works | Planner runs → `question` → RAG + tools → always works |
| "I got into a car accident" | Planner runs → `situation` → RAG + memory + tools → works | Same — no change |
| "Write a summary of X" | Planner runs → `task` → RAG + tools → works | Same — no change |

**Latency impact:** Messages that previously skipped the planner (greetings, short questions) now incur an extra ~200-500ms for the planner call. This is the right tradeoff — a 300ms thinking step that produces the right response beats a 0ms shortcut that produces the wrong one.

---

## 6. Execution Order

1. **Task 1 + Task 2 + Task 3** — Remove heuristics, simplify planner gate, remove synthetic plans. (All in `defaultParticipant.ts`, logically coupled.)
2. **Task 4** — Remove "Analyzing..." progress. (Same file, independent.)
3. **Task 5** — Rewrite system prompts. (Different file, independent.)
4. **Task 6** — Update tests. (After code changes so tests match new behavior.)
5. **Task 7** — Final verification.
