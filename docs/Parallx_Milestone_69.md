# Milestone 69 — AI Node Inspector

> **Status:** Planning

## Why

Workspace Graph is a map of the user's second brain. Right now, clicking a node
tells you what it is connected to and how strongly. That is useful metadata, but
it is not insight. A mindmap that cannot tell you *why* two ideas are linked, or
*what* a node is actually about, is a diagram — not a thinking tool.

M69 makes the node inspector an AI-powered context panel. When a user clicks a
node and asks for an AI summary, they get:

1. A concise summary of what that note or file is actually about.
2. For each semantically connected node, one sentence on the shared conceptual
   thread — the idea that ties them together.

This is the first step toward AI being a core component of every surface in
Parallx, not just the chat panel. The workspace graph becomes the place where
the user can see and interact with the shape of their knowledge.

The broader principle: AI in Parallx should be contextual and triggered by
user intent. M69 establishes the pattern that other surfaces (file explorer,
search results, canvas page inspector) can follow later.

## Hard constraints

1. **No change to chat model routing, system prompts, or Ollama configuration.**
   This milestone is additive. It uses the language model bridge as an extension
   consumer — the same path any external tool would use. It must not modify chat
   session state, chat history, or the active model lifecycle.

2. **No automatic AI calls on graph open or node hover.**
   The AI call is always explicit — triggered by the user pressing a button
   inside the inspector. Graph rendering, physics, and data loading remain
   model-free.

3. **No persistence of AI responses.**
   Summaries are ephemeral. They are not written to the database, the workspace,
   or any cache. They are generated fresh on each explicit request and discarded
   when the inspector closes.

4. **No dependency on an active chat session.**
   The inspector AI call uses `api.lm.getModels()` and `api.lm.sendChatRequest`
   directly. It does not require the chat tool to be open or a session to be
   active. If no model is available, the inspector shows a clear error state.

## Scope

In scope for M69:

- "Ask AI" button in the node inspector panel.
- AI-generated node summary (2–3 sentences on what the node is about).
- AI-generated connection explanation for each semantic neighbor (one sentence
  per connection on the shared conceptual thread).
- Streaming response rendered progressively into the inspector.
- Graceful fallback: if no model is available, show a human-readable error.
- Model selection: piggyback off the active chat session's model via the same
  `chat.getInlineAIProvider` pattern Canvas uses. Fall back to
  `api.lm.getModels()[0]` if no session is active. No custom context management
  — the session's existing configuration is inherited as-is.
- Content sourced from stored chunk texts in `vec_embeddings` — no model call
  to generate content, no file re-read at click time.

Out of scope for M69:

- Structural connection explanations (parent/child hierarchy is self-explanatory).
- Auto-generating summaries without user action.
- Saving or caching AI responses.
- AI summaries in the sidebar mini-graph.
- Any change to the chat participant, system prompts, session handling, or
  Ollama transport.
- Applying AI suggestions back to the node content.
- Multi-node comparison ("compare these two nodes").

## Architecture

### 1. Content retrieval — vector store helper

The prompt needs chunk texts for the clicked node and its semantic neighbors.
These already exist in `vec_embeddings.chunk_text`. Add a read-only helper to
`IVectorStoreService`:

```ts
getSourceChunks(
  sourceType: 'page_block' | 'file_chunk',
  sourceId: string,
  limit?: number,
): Promise<Array<{ text: string; contextPrefix: string; chunkIndex: number }>>
```

This is a pure DB read — no embedding, no vector math. It maps directly to a
`SELECT … FROM vec_embeddings WHERE source_type = ? AND source_id = ? ORDER BY chunk_index LIMIT ?`.

### 2. Node content bridge

The workspace-graph extension needs to call the above helper by graph node id
(`page:xxx` or `file:<uri>`). Add a thin bridge surface — either a new method
on the existing `workspaceGraphBridge` or a standalone `nodeContentBridge`:

```ts
// Exposed as api.workspaceGraph.getNodeChunks(nodeId, maxChunks?)
getNodeChunks(
  nodeId: string,
  maxChunks?: number,
): Promise<Array<{ text: string; contextPrefix: string }>>
```

This bridge owns the node-id → sourceType/sourceId mapping (reusing the same
`semanticSourceToNodeId` logic from `semanticGraphService.ts` in reverse). It
returns an empty array if the node has no indexed content, rather than throwing.

The bridge must not call `IEmbeddingService` or any model. It is a cache read.

### 3. Prompt design — one prompt, structured response

One model call per "Ask AI" action. The prompt provides:

- The clicked node's label and concatenated chunk texts.
- Each semantic neighbor's label and chunk texts.
- An instruction to return a JSON object.

System message:

```
You are a knowledge assistant helping a user understand their personal notes
and files. Be concise and direct. Do not invent information not present in the
provided content.
```

User message structure:

```
Here is a note or file from my workspace:

Title: {nodeLabel}
Content:
{chunkTexts joined with \n\n}

It has the following conceptually related notes/files:

{for each semantic neighbor}
[Connection {n}]
Title: {neighborLabel}
Content:
{neighborChunkTexts joined with \n\n}
{end for}

Please provide:
1. A 2–3 sentence summary of what the main note is about.
2. For each connection, exactly one sentence explaining the shared conceptual
   thread — the idea that links the main note to that neighbor.

Respond only with a JSON object in this exact shape:
{
  "summary": "...",
  "connections": [
    { "nodeId": "{neighborNodeId}", "explanation": "..." }
  ]
}
```

If a node has no indexed content, its chunk section is omitted and the prompt
notes that the content is unavailable. The model still attempts a summary from
the label alone.

### 4. Model selection

Use the same `chat.getInlineAIProvider` command Canvas uses to get the active
session's `sendChatRequest` function. This inherits the user's configured model
and its context window settings without any custom management:

```ts
const provider = await api.commands.executeCommand('chat.getInlineAIProvider');
if (provider?.sendChatRequest) {
  // Active session available — use its model and context configuration as-is.
  stream = provider.sendChatRequest(messages);
} else {
  // No active session — fall back to first available model.
  const models = await api.lm.getModels();
  if (!models.length) { showError('No language model available.'); return; }
  stream = api.lm.sendChatRequest(models[0].id, messages);
}
```

No chunk character caps, no token budget management. The user's chat session
configuration is the source of truth for what the model can handle. If the
user has chosen a small model with a limited context window, that is their
choice and we respect it. `sendChatRequestForModel` routes directly to the
provider without mutating global active-model state, so concurrent chat usage
is unaffected.

### 5. Response parsing and streaming

`api.lm.sendChatRequest` returns an `AsyncIterable<IChatResponseChunk>`. The
extension accumulates the streamed text and attempts to parse the JSON object
once the stream closes. While streaming, the inspector shows a spinner and the
partial raw text so the user sees progress.

If JSON parsing fails (model hallucinated structure, local model truncated the
response), the inspector renders the raw text as a plain fallback rather than
showing an error.

### 6. Inspector UI changes

The inspector panel gets a new section above the connections list:

```
┌─────────────────────────────────┐
│  Node Label            [×]      │
│  domain · type                  │
│  /path/to/file (if file node)   │
│                                 │
│  [Ask AI ✦]                     │  ← explicit trigger button
│                                 │
│  ┄ while loading ┄              │
│  [spinner] Thinking…            │
│                                 │
│  ┄ after response ┄             │
│  This note explores the         │
│  relationship between…          │
│                                 │
│  Connections (3)                │
│  ┄─────────────────────────┄    │
│  Other Note                     │
│  Conceptual 82%                 │
│  ↳ Both examine the problem     │
│    of knowledge fragmentation.  │
│  ┄─────────────────────────┄    │
│  …                              │
└─────────────────────────────────┘
```

States:
- **Idle**: "Ask AI" button visible, no summary section.
- **Loading**: Button replaced by spinner + "Thinking…" text. Streaming
  partial text shown as it arrives if rendering is feasible, otherwise plain
  spinner until JSON is parseable.
- **Complete**: Summary block rendered above connections. Each semantic
  connection row gains an explanation line beneath the score.
- **Error (no model)**: Button replaced by a muted "No model available" note.
- **Error (parse failure)**: Raw model text shown in a preformatted block.
- **Re-trigger**: After a response is shown, the button reappears as
  "Re-ask AI" so the user can regenerate.

The button and summary section are only shown when the inspector is open for
a node that has at least one semantic connection and indexed content. Nodes
with no indexed content (e.g. directory nodes, session nodes) show the button
greyed out with a tooltip: "No indexed content for this node."

## Plan / sequencing

### Iteration A — Vector store helper and content bridge

1. Add `getSourceChunks` to `VectorStoreService` and `IVectorStoreService`.
2. Add `getNodeChunks(nodeId, maxChunks?)` to the workspace graph API bridge.
   - Reverse-maps `page:<id>` → `('page_block', id)` and
     `file:<uri>` → `('file_chunk', relPath)` using the workspace root URI.
   - Returns `[]` for unmapped or unindexed nodes.
3. Expose the method in `api.workspaceGraph` and type it in `parallx.d.ts`.

**Verification:**
- Unit test `getSourceChunks` returns chunks in chunk-index order, capped at
  limit, empty array for unknown source.
- Unit test bridge reverse-mapping for page and file node ids.
- `npx.cmd tsc --noEmit` clean.

### Iteration B — Inspector AI panel

1. Add "Ask AI" button to the inspector `_renderInspector` function.
2. Implement `_askAi(node, semanticConnections)`:
   - Fetch chunk texts for node and each semantic neighbor via
     `api.workspaceGraph.getNodeChunks`.
   - Resolve model via `api.lm.getModels()`.
   - Build prompt.
   - Call `api.lm.sendChatRequest`, accumulate streamed chunks.
   - Parse response JSON and update inspector DOM.
3. Wire loading, complete, and error states.
4. Add explanation row beneath each semantic connection entry when a response
   is available.

**Verification:**
- Manual: click a node with semantic connections, press "Ask AI", observe
  streaming response appear.
- Manual: chat model performance is not degraded while the inspector is open.
- Manual: closing and reopening the inspector clears the previous response
  (no stale state).
- `node --check ext/workspace-graph/main.js`.

### Iteration C — Prompt tuning and polish

1. Test on real workspaces with varied content: long pages, short files, code
   files, markdown notes.
2. Improve the fallback for nodes with no indexed content (show label-only
   prompt rather than no button).
3. Add "Re-ask AI" button after a response is shown.
4. Validate JSON parse fallback renders gracefully.
5. Document the feature in `USER_GUIDE.md`.

**Verification:**
- Manual: node with very long content does not cause model timeout or context
  overflow.
- Manual: node with no indexed content shows greyed button with tooltip.
- Manual: parse failure on a truncated local-model response shows raw text
  fallback, not a blank panel.
- Manual: opening the chat panel and sending a message while the inspector is
  generating does not cause errors or visual glitches on either surface.

## Acceptance criteria

M69 is complete when:

1. Clicking a node and pressing "Ask AI" produces a 2–3 sentence summary and
   per-semantic-connection explanations.
2. The AI call is always explicit — no model call fires on graph open, node
   hover, or auto-refresh.
3. No chat session, chat history, or active model state is modified.
4. Chat model performance is not degraded while the inspector generates.
5. Nodes with no indexed content show a graceful disabled state.
6. If no language model is available, the inspector shows a clear error.
7. Streaming response is visible to the user — the panel does not blank until
   the full response is ready.
8. The prompt never includes content from sources other than the clicked node
   and its semantic neighbors.
9. `npx.cmd tsc --noEmit` passes.
10. `node --check ext/workspace-graph/main.js` passes.

## Risk register

| Risk | Mitigation |
|---|---|
| Local model context window too small for prompt | User's chat session configuration owns this — if they've chosen a small model, that's their choice. Parse fallback handles truncated responses. |
| Local model returns malformed JSON | Parse fallback renders raw text; never shows blank panel |
| Slow local model makes inspector feel laggy | Explicit trigger + streaming output + spinner so user knows work is happening |
| Concurrent chat + inspector call degrades chat | `sendChatRequestForModel` is concurrent-safe by design; local model queues naturally |
| Node with no semantic connections shows broken UI | "Ask AI" only shown when semantic connections exist; guarded in `_renderInspector` |
| Chunk texts contain sensitive content sent to model | All models are local (Ollama); no data leaves the machine |
| Inspector DOM mutation while model is still streaming | Lock the "Ask AI" button while loading; guard against closed inspector mid-stream |

## Open decisions

1. Should the summary persist for the session (survive re-clicking the same
   node without re-generating)? Lean: no for MVP — keep it stateless.
2. Should the user be able to copy the summary to clipboard? Lean: yes, small
   addition to Iteration C.
3. Should connection explanations be shown inline or in an expandable row?
   Lean: inline beneath the score row, no expand needed given one sentence.
4. Should the prompt include the node's structural context prefix
   (`[Page: Title | Section: Heading]`)? Lean: yes — it gives the model
   better framing for canvas pages without adding significant tokens.

## Files to create / modify

| File | Action |
|---|---|
| `src/services/vectorStoreService.ts` | add `getSourceChunks(sourceType, sourceId, limit?)` |
| `src/services/serviceTypes.ts` | extend `IVectorStoreService` with `getSourceChunks` |
| `src/api/bridges/workspaceGraphBridge.ts` | add `getNodeChunks(nodeId, maxChunks?)` |
| `src/api/apiFactory.ts` | wire `getNodeChunks` into `api.workspaceGraph` |
| `src/api/parallax.d.ts` | type `api.workspaceGraph.getNodeChunks` |
| `ext/workspace-graph/main.js` | "Ask AI" button, prompt builder, streaming renderer |
| `tests/unit/vectorStoreService.test.ts` | coverage for `getSourceChunks` |
| `tests/unit/workspaceGraphNodeContent.test.ts` | bridge reverse-mapping tests |
| `docs/USER_GUIDE.md` | document after Iteration C |

## Progress tracker

| Iteration | Status | Verification | Notes |
|---|---|---|---|
| A — Content bridge | not started | `npx.cmd tsc --noEmit`; unit tests for `getSourceChunks` and bridge mapping | |
| B — Inspector AI panel | not started | Manual trigger test; chat non-interference check | |
| C — Prompt tuning and polish | not started | Real workspace testing; fallback validation | |
