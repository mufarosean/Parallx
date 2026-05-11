# Citation & Attribution Redesign — RAG Source Transparency

## Date: March 4, 2026

---

## The Problem

Parallx's RAG system has a fundamental **source attribution disconnect**:

1. The **model** sees a workspace digest (file tree) in the system prompt and references files by name correctly in its thinking/response.
2. The **UI source pills** show whatever chunks the retrieval pipeline returned — often completely unrelated to what the model actually referenced.
3. The user sees a confident answer citing "FSI Shona Basic Course" while the source pills say "Stock Investing For Dummies." This destroys trust.

No amount of retrieval score tuning fixes this. The architecture itself creates a disconnect between what the model knows and what the user is shown.

---

## Research: How Others Solve This

| System | Source Origin | Inline Citations | Clickable Nav | Disconnect Handling |
|--------|-------------|-----------------|--------------|-------------------|
| **VS Code Copilot** | Retrieval pipeline | No | Yes (file opener) | Weak — shows pipeline, not model |
| **Cursor** | Pipeline + model output parsing | Yes (auto-linked paths) | Yes (file + line) | **Strong** — dual layer |
| **Obsidian Smart Connections** | Pipeline + wikilink rendering | Yes (via `[[wikilinks]]`) | Yes (note opener) | Medium |
| **Perplexity AI** | Pipeline, model instructed to cite `[N]` | Yes (`[1][2]` badges) | Yes (URL opener) | **Strong** — 1:1 numbered mapping |
| **Claude Citations** | Model-native structured output | Yes (char-range) | Yes (passage highlight) | **Strongest** — model-level |
| **Open WebUI / AnythingLLM** | Retrieval pipeline only | No | Limited | **None** — same problem as us |
| **Continue.dev** | Pipeline (pre-send) | No | Yes (file opener) | Weak |
| **Parallx (before)** | Retrieval pipeline only | No | Yes (reference pills) | **None** — complete disconnect |

### Key Insight

The best systems (Perplexity, Cursor) use a **dual-layer approach**:
1. **Numbered citations** — Tell the model to cite `[1]`, `[2]` from retrieved chunks. Post-process the response to render them as clickable badges.
2. **Auto-linked mentions** — Parse the model's output for file/page names and make them clickable.

This bridges both directions: what retrieval provided AND what the model actually referenced.

---

## Design: What Changes in Parallx

### Change 1: Numbered Context Injection (Perplexity Pattern)

**File: `retrievalService.ts` — `formatContext()`**

Before:
```
[Retrieved Context]
---
Source: FSI Shona Basic Course > Vocabulary
Path: Books/Shona/FSI Shona Basic Course.pdf
<chunk text>
---
```

After:
```
[Retrieved Context]
---
[1] Source: FSI Shona Basic Course > Vocabulary
Path: Books/Shona/FSI Shona Basic Course.pdf
<chunk text>
---
[2] Source: Shona Dictionary > Greetings
Path: Books/Shona/Shona Dictionary.pdf
<chunk text>
---
```

### Change 2: Citation Instructions in System Prompt

**File: `chatSystemPrompts.ts`**

Add to both Ask and Agent mode prompts (gated by `isRAGAvailable`):
```
CITATION RULES:
- When your answer uses information from the [Retrieved Context], cite the 
  source using its number in square brackets: [1], [2], etc.
- Place citations at the end of the sentence or paragraph that uses that source.
- Only cite sources you actually used. Do not cite all sources.
```

### Change 3: Source Index Plumbing

**File: `chatTypes.ts`**

Add `index?: number` to:
- `IChatThinkingContent.references` entries
- `IChatResponseStream.reference()` signature
- `IContextPill`

**File: `chatDataService.ts`**

`_buildSourceCitations()` assigns incrementing `index` (1-based).

**File: `chatService.ts`**

`ChatResponseStream.reference()` accepts and stores `index`.

**File: `defaultParticipant.ts`**

`response.reference()` call passes `source.index`.

### Change 4: Citation Badge Rendering (Post-Processing)

**File: `chatContentParts.ts`**

After `_markdownToHtml()`, post-process the rendered HTML to:
1. Detect `[N]` patterns (where N is 1-9) in text nodes
2. Replace with clickable superscript badge elements
3. Badge click dispatches `parallx:navigate-page` or `parallx:open-file`

The citation map (number → source) is carried on `IChatMarkdownContent.citations`.

### Change 5: Auto-Link Workspace Mentions

**File: `chatContentParts.ts` — `_inlineFormat()`**

Detect quoted file/page names in the model's prose and auto-link them. The model often writes things like `"FSI Shona Basic Course.pdf"` — these should become clickable.

Pattern: `&quot;([^&]+\.(pdf|md|txt|docx|xlsx))&quot;` → clickable file link.

---

## Implementation Order

1. Types (chatTypes.ts) — add index fields
2. Retrieval (retrievalService.ts) — number chunks in formatContext
3. Data service (chatDataService.ts) — index in _buildSourceCitations
4. Chat service (chatService.ts) — reference() accepts index
5. Participant (defaultParticipant.ts) — pass index, store citation map
6. System prompt (chatSystemPrompts.ts) — citation rules
7. Rendering (chatContentParts.ts) — [N] badges + auto-links
8. CSS (chatWidget.css) — citation badge styles
9. Tests — update existing, add new

---

## Expected Outcome

**Before:** User asks about Shona. Model thinks about correct Shona files. Source pills show Stock Investing For Dummies. User's trust: zero.

**After:** User asks about Shona. Model cites `[1]` and `[2]` inline. Clicking `[1]` opens the Shona PDF. Source pills show numbered sources matching the model's citations. User can verify every claim.

This is the Perplexity + Cursor hybrid — the proven architecture for traceable AI responses.
