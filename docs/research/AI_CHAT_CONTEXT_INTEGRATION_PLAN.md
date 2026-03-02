# AI Chat Context Integration — Research & Action Plan

> **Date**: February 2026  
> **Milestone**: M9 — AI Chat System  
> **Branch**: `milestone-9`  
> **Goal**: Make the AI a seamless, integral part of Parallx — not a tool users must hand-hold.

---

## 1. Research Summary

### 1.1 VS Code Chat Architecture (DeepWiki + Source)

**Three-Layer Architecture:**
- **Extension Host** (`ExtHostChatAgents2`, `ExtHostChatSessions`) — extension-side handlers
- **Core Services** (`IChatService`, `IChatAgentService`, `IChatModeService`) — orchestration  
- **UI Layer** (`ChatWidget`, `ChatInputPart`, `ChatViewPane`) — rendering

**Key Pattern — Implicit Context:**
VS Code's `ChatImplicitContextContribution` (`chatImplicitContext.ts`) automatically tracks:
- **Active file URI** — when a code editor is focused  
- **Selection (Location with range)** — when user has selected text  
- **Viewport** — visible ranges merged into a single Location  
- **Notebook cells** — active cell URI or selection within it  
- **Webview context** — from `chatContextService.contextForResource()`

Configuration: `chat.implicitContext.enabled` per location with values `'always'`, `'first'`, or disabled.

**Critical insight:** VS Code does NOT require tool calls to read the active file. The content is injected as `IChatRequestVariableEntry` directly into the request's `variableData`. The model sees `"User's active file"` / `"User's active selection"` as context alongside the message — zero round-trips.

**Attachment Resolution:**
- `chatAttachmentResolveService.ts` — dedicated service that resolves attachment entries to text content before sending
- `ChatAttachmentModel` — manages explicit user-added context (files, images, tools)
- Both explicit and implicit entries are unified into `IChatRequestVariableEntry[]`

**Variable Entries:**
```typescript
interface IChatRequestVariableEntry {
  kind: 'file' | 'string' | 'implicit';
  id: string;
  name: string;
  value: Location | URI | string;
  modelDescription: string;  // e.g. "User's active file"
}
```

**Modes:**
| Mode | Tools | Implicit Context | File Edits |
|------|-------|-----------------|------------|
| Ask | Read-only | ✅ (auto) | ❌ |
| Edit | Full (tool-call based) | ✅ | ✅ |
| Agent | Full + autonomous | ✅ | ✅ |

### 1.2 Microsoft MarkItDown

**What it is:** Python utility converting 15+ file formats to Markdown optimized for LLM ingestion (89k GitHub stars).

**Supported formats:**
- Office: DOCX, PPTX, XLSX, XLS  
- PDF (via pdfminer.six/pdfplumber)  
- Web: HTML, RSS, YouTube URLs, Wikipedia, EPUB  
- Media: Images (EXIF + OCR), Audio (transcription)  
- Data: CSV, JSON, XML, IPYNB  
- Email: Outlook MSG  
- Archives: ZIP (recursive)

**Integration options for Electron:**
| Approach | Pros | Cons |
|----------|------|------|
| CLI subprocess (`markitdown file.pdf`) | Simple, stdout output | Requires Python installed |
| MCP server (markitdown-mcp) | Standard protocol | Heavy, over-engineered for local use |
| Pure JS alternatives | No Python dependency | Fragmented, less robust |

**Recommendation for Parallx:** Phase into two stages:
1. **Immediate (M9):** Use pure JS for common formats — `mammoth` (DOCX→HTML→text), basic PDF text extraction, CSV/JSON natively  
2. **Future (M10+):** Optional Python MarkItDown integration via CLI subprocess for full format coverage

### 1.3 Patterns from Other AI-Integrated Tools

**Cursor IDE:**
- Auto-injects open files as context  
- `@file`, `@folder`, `@codebase` context variables  
- Search-before-answer: tool calls for workspace search happen automatically

**Notion AI:**
- Reads the current page content implicitly  
- Can create, format, summarize, and structure content  
- User types naturally; AI understands the workspace context

**Common patterns across successful implementations:**
1. **Zero-config context** — AI always knows what you're looking at  
2. **Content-type agnostic** — Files, pages, databases all treated as "readable context"  
3. **Implicit > Explicit** — User shouldn't have to tell AI to "read" something that's open  
4. **Smart resolution** — Accept names, not just IDs; fuzzy match when possible

---

## 2. Current Parallx Architecture Gaps

### Gap 1: No Implicit Context Injection
**Problem:** AI has no idea what the user is looking at. System prompt includes `currentPageTitle` but NOT the page content.  
**VS Code approach:** Auto-injects active editor content/selection as variable entries.  
**Fix:** Inject active canvas page content directly into the user message context.

### Gap 2: Canvas Pages Can't Be Attachments  
**Problem:** `readFileContent(fullPath)` uses `fileService.readFile()` — only filesystem files. Canvas pages stored in SQLite are invisible to the attachment system.  
**Fix:** Create `IChatContentResolver` that handles both filesystem paths and `parallx-page://` URIs.

### Gap 3: read_page Requires UUID
**Problem:** Model must chain `list_pages` → `read_page(uuid)` (2 round-trips). Model often guesses page content instead.  
**Fix:** Make `read_page` accept title OR UUID. Add `read_page_by_title` for explicit title-based lookup.

### Gap 4: No "What Am I Looking At" Tool
**Problem:** No `read_current_page` tool — model can't access whatever is currently open without knowing its UUID.  
**Fix:** Add `read_current_page` tool that reads the active editor's content.

### Gap 5: System Prompts Don't Inject Content
**Problem:** System prompt lists page names for anti-hallucination but doesn't include actual content of the current page.  
**Fix:** Add current page content as structured context in the user message (like VS Code's implicit context pattern).

---

## 3. Action Plan

### Layer 1: Context Foundation (This Session)

| # | Task | Files | Impact |
|---|------|-------|--------|
| 1 | Remove debug `console.log` statements | `defaultParticipant.ts` | Clean up |
| 2 | Auto-inject active canvas page content into user message | `defaultParticipant.ts`, `chatTool.ts` | AI always knows current page |
| 3 | Fix attachment resolution for canvas pages | `chatTool.ts`, `chatContextAttachments.ts` | Canvas pages attachable |
| 4 | Add `read_current_page` tool | `builtInTools.ts` | Zero-hop access to active page |
| 5 | Add `read_page_by_title` tool | `builtInTools.ts` | Title-based lookup |
| 6 | Make `read_page` accept title OR UUID | `builtInTools.ts` | Flexible lookup |
| 7 | Update system prompts for implicit context | `chatSystemPrompts.ts` | Better guidance |

### Layer 2: File Format Support (Future — M10)

| # | Task | Approach |
|---|------|----------|
| 8 | DOCX attachment → text | `mammoth` npm package |
| 9 | PDF attachment → text | `pdf-parse` npm package |
| 10 | CSV/JSON preview | Native TS parsing |
| 11 | Image metadata | EXIF extraction |
| 12 | Optional MarkItDown CLI | Python subprocess for full format suite |

### Layer 3: Write Tools (Future — Deferred per user)

| # | Task |
|---|------|
| 13 | `update_page` tool (edit block content) |
| 14 | `delete_block` tool |
| 15 | `format_page` tool (apply styles/structure) |

---

## 4. Implementation Design

### 4.1 Implicit Context Injection

**Pattern:** Before building the user message, check if there's an active canvas page. If so, prepend its text content as structured context.

```typescript
// In defaultParticipant.ts handler, before building messages:
let implicitContext = '';
if (services.getCurrentPageContent) {
  const pageContent = await services.getCurrentPageContent();
  if (pageContent) {
    implicitContext = `\n\n[Currently open page: "${pageContent.title}"]\n${pageContent.textContent}\n`;
  }
}
// Prepend to user message
const userContent = implicitContext + request.message;
```

**Key:** This goes into the user message, NOT a system prompt, so the model can reference it naturally.

### 4.2 Smart read_page (Title OR UUID)

```typescript
// In builtInTools.ts:
// Try UUID lookup first (fast, exact)
let page = db.get('SELECT ... FROM pages WHERE id = ?', identifier);
if (!page) {
  // Fallback to case-insensitive title match
  page = db.get('SELECT ... FROM pages WHERE LOWER(title) = LOWER(?)', identifier);
}
if (!page) {
  // Fuzzy: LIKE match
  page = db.get('SELECT ... FROM pages WHERE title LIKE ?', `%${identifier}%`);
}
```

### 4.3 Canvas Page Attachment Resolution

**New flow:** When an attachment has `fullPath` starting with `parallx-page://`, resolve via SQLite instead of filesystem.

```typescript
async function resolveAttachmentContent(attachment: IChatAttachment): Promise<string> {
  if (attachment.fullPath.startsWith('parallx-page://')) {
    const pageId = extractPageId(attachment.fullPath);
    const page = db.get('SELECT content FROM pages WHERE id = ?', pageId);
    return extractTextContent(page.content);
  }
  return fileService.readFile(attachment.fullPath);
}
```

---

## 5. Success Criteria

After implementation, the following scenarios must work naturally:

1. **"Summarize this page"** → AI reads currently open page content (implicit) and summarizes without tool calls  
2. **"What's on my 'Project Ideas' page?"** → AI uses `read_page_by_title("Project Ideas")` or smart `read_page` with title fallback  
3. **"Compare this page with 'Meeting Notes'"** → AI reads implicit current page + uses tool for named page  
4. **"Create a new page summarizing everything in my workspace"** → AI chains `list_pages` → multiple `read_page` calls → `create_page`  
5. **Attaching a canvas page via "Add Context"** → Content resolved from SQLite, injected correctly  

---

## 6. References

- [VS Code Chat System (DeepWiki)](https://deepwiki.com/microsoft/vscode/13.1-chat-system)  
- [VS Code AI Features (DeepWiki)](https://deepwiki.com/microsoft/vscode/13-ai-and-chat-features)  
- [VS Code chatImplicitContext.ts](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/chat/browser/attachments/chatImplicitContext.ts)  
- [Microsoft MarkItDown](https://github.com/microsoft/markitdown)  
- [MarkItDown Architecture (DeepWiki)](https://deepwiki.com/microsoft/markitdown/1.1-architecture)
