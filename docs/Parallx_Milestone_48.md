# Milestone 48 — Unified Selection → AI Action System

**Status:** Planning  
**Branch:** `editor-chat-context`  
**Depends on:** master at `90b942a`

---

## Vision

A user studying a document in Parallx gets stuck on specific text. They highlight it, right-click, and see AI actions — Explain, Summarize, Ask AI, Send to Canvas. The experience is the same whether they're reading a PDF, editing a text file, or browsing a markdown preview. The surface-specific wiring (how the selection is captured, how the menu appears) differs per editor, but the system that receives the selection payload and acts on it is **one shared pipeline**.

---

## Prior Art in Parallx

### Canvas InlineAIMenu (M10 Phase 7 — Task 7.3)

The canvas editor already has a fully functional selection → AI action system:

| Component | Location | Role |
|-----------|----------|------|
| `InlineAIMenuController` | `src/built-in/canvas/menus/inlineAIMenu.ts` | Selection-driven floating menu with 4 actions (Summarize, Expand, Fix Grammar, Translate). Streams response into an Accept/Reject overlay that replaces text in-place. |
| `CanvasEditorProvider` | `src/built-in/canvas/canvasEditorProvider.ts` L62-90 | Holds `SendChatRequestFn` + `RetrieveContextFn`, exposes `setInlineAIProvider()` setter and `hasInlineAI` accessor. Passes functions to each pane. |
| `chat.getInlineAIProvider` | `src/built-in/chat/main.ts` L1269-1296 | Cross-tool command bridge. Chat tool exposes `{ sendChatRequest, retrieveContext }` via the command system. Canvas calls it at activation. |
| `@canvas` participant | `src/openclaw/participants/openclawCanvasParticipant.ts` | Separate path — full OpenClaw chat participant for page-aware conversation. Does NOT share infrastructure with InlineAIMenu. |

**Key takeaway:** The canvas inline AI is **self-contained and surface-locked**. It streams directly to an in-place overlay — it cannot route actions to the chat panel, create canvas pages from results, or share its action pipeline with other editors. This milestone introduces the unified layer that the canvas AI should eventually migrate to.

### External Research

| App | Selection → AI Pattern |
|-----|----------------------|
| **VS Code Copilot** | Implicit context — active file + selection auto-included when user opens chat. `Ctrl+I` opens inline chat at selection. No context-menu AI actions. |
| **Notion AI** | Highlight text → floating "Ask AI" button → dropdown with preset actions (Summarize, Explain, Translate, Fix spelling, Change tone) + custom prompt. Results replace or insert below. |
| **Cursor** | `Ctrl+L` sends selection to chat sidebar. `Ctrl+K` opens inline edit at selection. Selection auto-included as context in any chat. |

---

## Architecture: The Unified AI Action Dispatch

### Design Principle

> The surface captures the selection and provides metadata.  
> The dispatcher receives a standard payload and routes it to the correct handler.  
> Surfaces never talk to AI directly — they go through the dispatcher.

This means one integration point, one set of action handlers, and one place to add new actions. Any new editor surface (future: spreadsheet viewer, code editor, diagram viewer) only needs to implement the Surface Adapter contract.

### Three-Layer Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                    LAYER 1 — Surface Adapters                    │
│  (Per-editor. Capture selection, build metadata, show triggers)  │
│                                                                  │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐  │
│  │ PDF Viewer   │  │ Text Editor  │  │ Markdown Preview       │  │
│  │ Adapter      │  │ Adapter      │  │ Adapter                │  │
│  └──────┬───────┘  └──────┬───────┘  └────────┬───────────────┘  │
│         │                 │                    │                  │
│         └────────────┬────┴────────────────────┘                  │
│                      │ ISelectionActionPayload                    │
└──────────────────────┼───────────────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────────────┐
│                 LAYER 2 — AI Action Dispatcher                   │
│          (Shared. Routes payload → action handler)               │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────────┐│
│  │  SelectionActionDispatcher                                   ││
│  │  ├── receives ISelectionActionPayload                        ││
│  │  ├── looks up action handler by action ID                    ││
│  │  └── delegates to handler with payload + services            ││
│  └──────────────────────────────────────────────────────────────┘│
│                      │                                           │
└──────────────────────┼───────────────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────────────┐
│                 LAYER 3 — Action Handlers                        │
│         (Shared. Each handler knows how to do one thing)         │
│                                                                  │
│  ┌───────────────┐ ┌─────────────────┐ ┌───────────────────────┐│
│  │ ExplainHandler │ │ SummarizeHandler│ │ SendToChatHandler     ││
│  │ Pre-fill chat  │ │ Pre-fill chat   │ │ Attach selection      ││
│  │ + /explain cmd │ │ + /summarize cmd│ │ + focus input         ││
│  └───────────────┘ └─────────────────┘ └───────────────────────┘│
│  ┌───────────────┐ ┌─────────────────┐                          │
│  │SendToCanvas   │ │ (future actions)│                          │
│  │ Handler       │ │                 │                          │
│  └───────────────┘ └─────────────────┘                          │
└──────────────────────────────────────────────────────────────────┘
```

### Core Contracts

#### ISelectionActionPayload

The standard payload that every surface adapter produces. This is the *lingua franca* between surfaces and the dispatcher.

```ts
interface ISelectionActionPayload {
  /** The selected text content */
  readonly selectedText: string;

  /** Source surface identifier */
  readonly surface: 'text-editor' | 'pdf-viewer' | 'markdown-preview' | 'canvas' | string;

  /** Source file metadata (when available) */
  readonly source: {
    readonly fileName: string;       // e.g. "Auto Insurance Policy.md"
    readonly filePath: string;       // full workspace-relative path
    readonly startLine?: number;     // 1-based (text editors, markdown)
    readonly endLine?: number;
    readonly pageNumber?: number;    // PDF-specific
  };

  /** The action to perform */
  readonly actionId: 'explain' | 'summarize' | 'ask-ai' | 'send-to-canvas' | string;
}
```

**Design notes:**
- `surface` is a string union, not an enum — new surfaces can be added without touching the contract.
- `source` always has `fileName` and `filePath`. Line numbers and page numbers are optional and surface-dependent.
- `actionId` is also extensible — future actions (Translate, Fix Grammar, Define) can be added by registering a new handler.

#### ISurfaceSelectionAdapter

The contract each editor surface implements. It knows how to capture a selection and produce context-menu items.

```ts
interface ISurfaceSelectionAdapter {
  /** Surface identifier — must match the surface field in payloads */
  readonly surfaceId: string;

  /** Get the current text selection, or undefined if nothing is selected */
  getSelectedText(): string | undefined;

  /** Get source metadata for the current selection */
  getSelectionSource(): ISelectionSource | undefined;

  /** Build context menu items for a given selection. Returns items with action IDs. */
  getContextMenuItems(selection: string): IContextMenuItem[];
}

interface ISelectionSource {
  readonly fileName: string;
  readonly filePath: string;
  readonly startLine?: number;
  readonly endLine?: number;
  readonly pageNumber?: number;
}
```

#### ISelectionActionHandler

Each action handler implements this. The dispatcher calls `execute()` with the payload.

```ts
interface ISelectionActionHandler {
  readonly actionId: string;
  readonly label: string;
  readonly icon?: string;

  execute(payload: ISelectionActionPayload, services: IActionHandlerServices): Promise<void>;
}

interface IActionHandlerServices {
  /** Access to the chat widget for pre-filling input and submitting */
  readonly chatAccess: IChatProgrammaticAccess;

  /** Access to canvas data for "send to canvas" */
  readonly canvasAccess: ICanvasDataService;

  /** Access to the command service */
  readonly commandService: ICommandService;
}
```

#### IChatProgrammaticAccess

A new focused interface for driving the chat from outside — the missing piece today.

```ts
interface IChatProgrammaticAccess {
  /** Add a selection attachment to the chat input */
  addSelectionAttachment(attachment: IChatSelectionAttachment): void;

  /** Set the text input contents */
  setInputValue(text: string): void;

  /** Focus the chat input */
  focus(): void;

  /** Submit the current input (as if the user pressed Enter) */
  submit(): void;

  /** Ensure the chat panel is visible */
  reveal(): void;
}
```

### New Chat Attachment Kind: `'selection'`

Extends the existing `IChatAttachment` discriminated union:

```ts
interface IChatSelectionAttachment extends IChatAttachmentBase {
  kind: 'selection';
  readonly selectedText: string;
  readonly surface: string;
  readonly startLine?: number;
  readonly endLine?: number;
  readonly pageNumber?: number;
}

// Updated union:
type IChatAttachment = IChatFileAttachment | IChatImageAttachment | IChatSelectionAttachment;
```

**Rendering:** Selection attachments appear as context pills in the chat input ribbon:
- `📎 Auto Insurance Policy.md (lines 12-18)` for text/markdown editors
- `📎 Claims Guide.pdf (page 3)` for PDF viewer

**Prompt assembly:** `chatContextAssembly.ts` (or OpenClaw equivalent) formats the attachment into the system/user prompt:

```
<selection source="Auto Insurance Policy.md" lines="12-18">
Coverage limits are determined by the policy tier selected at enrollment.
The standard tier provides up to $50,000 in liability coverage.
</selection>
```

---

## New Slash Commands

Register `/explain` and `/summarize` as built-in OpenClaw commands:

```ts
{
  name: 'explain',
  description: 'Explain the provided text clearly and concisely',
  promptTemplate: 'Explain the following text. Be clear and concise. If it contains technical or domain-specific terms, define them.\n\n{input}',
  isBuiltIn: true,
}

{
  name: 'summarize',
  description: 'Summarize the provided text',
  promptTemplate: 'Provide a brief, accurate summary of the following text. Capture the key points.\n\n{input}',
  isBuiltIn: true,
}
```

These work standalone (`/explain what is RRF?`) or with selection context (selection attachment provides the text, command provides the instruction).

---

## Action Handler Behaviors

### Explain / Summarize

1. Dispatcher receives payload with `actionId: 'explain'` or `'summarize'`
2. Handler calls `chatAccess.reveal()` + `chatAccess.focus()`
3. Handler calls `chatAccess.addSelectionAttachment(...)` with the selected text + source metadata
4. Handler calls `chatAccess.setInputValue('/explain')` or `chatAccess.setInputValue('/summarize')`
5. Handler calls `chatAccess.submit()` — auto-submits, response streams in chat

### Ask AI (open-ended)

1. Dispatcher receives payload with `actionId: 'ask-ai'`
2. Handler calls `chatAccess.reveal()` + `chatAccess.focus()`
3. Handler calls `chatAccess.addSelectionAttachment(...)` with the selected text
4. **Does NOT auto-submit** — user sees the selection pill attached and types their own prompt

### Send to Canvas

1. Dispatcher receives payload with `actionId: 'send-to-canvas'`
2. Handler creates a new canvas page via `canvasAccess.createPage(null, 'Selection from <fileName>')`
3. Handler builds a TipTap doc node:
   ```json
   {
     "type": "doc",
     "content": [
       { "type": "heading", "attrs": { "level": 3 }, "content": [{ "type": "text", "text": "From: <fileName> (lines X-Y)" }] },
       { "type": "blockquote", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "<selectedText>" }] }] }
     ]
   }
   ```
4. Handler saves via `canvasAccess.updatePage(pageId, { content: encoded })`
5. Optionally opens the new page in the canvas editor

---

## Surface Adapter Details

### Phase 1 Surfaces (this milestone)

#### PDF Viewer Adapter

**Existing infrastructure:** Full selection capture in `pdfEditorPane.ts` — `_capturedSelection` is already populated on mouseup, context menu is wired via `_wireContextMenu()`.

**Changes needed:**
1. Expose `getSelectedText()` as a public method (currently private `_capturedSelection`)
2. Emit `onDidChangeSelection` event
3. Add AI action items to existing context menu (below Copy / Find in Document separator)
4. Build `ISelectionActionPayload` with `surface: 'pdf-viewer'`, `pageNumber` from visible page

#### Text Editor Adapter

**Existing infrastructure:** `<textarea>` with `selectionStart`/`selectionEnd`. No context menu, no selection API.

**Changes needed:**
1. Add `getSelectedText()` method: `this._textarea.value.substring(selectionStart, selectionEnd)`
2. Compute line numbers from selection offsets (count newlines)
3. Wire `contextmenu` event on the textarea to show `ContextMenu.show()` with both standard items (Cut/Copy/Paste/Select All) and AI action items
4. Build `ISelectionActionPayload` with `surface: 'text-editor'`, `startLine`/`endLine`

#### Markdown Preview Adapter

**Existing infrastructure:** Rendered HTML in `_contentEl` div. No selection handling at all.

**Changes needed:**
1. Add `mouseup` listener to capture `window.getSelection().toString()`
2. Wire `contextmenu` event to show AI action items when selection exists
3. Build `ISelectionActionPayload` with `surface: 'markdown-preview'` (no reliable line numbers — rendered HTML loses that mapping)

### Phase 2 Surfaces (future — not this milestone)

#### Canvas Editor (Migration Path)

The canvas already has `InlineAIMenuController` with its own action set (Summarize, Expand, Fix Grammar, Translate) that streams responses into an in-place overlay. This is a **different UX pattern** from what this milestone builds (route to chat panel), but the actions overlap.

**Migration plan:**
1. Canvas keeps its inline overlay UX — it's well-suited for in-place text replacement
2. Canvas **also** adds the dispatcher's "Ask AI" and "Send to Canvas" actions (alongside its existing inline ones)
3. Canvas surface adapter implements `ISurfaceSelectionAdapter` using the existing `editor.state.doc.textBetween(from, to)` selection API
4. The inline AI actions (Summarize, Expand, Fix Grammar, Translate) remain canvas-specific because they do in-place replacement — this is a canvas UX concern, not a shared action
5. New shared actions (Ask AI, Explain via chat, Send to Canvas) are routed through the dispatcher

**This means canvas will have two categories of selection actions:**
- *Inline actions* (existing): Summarize, Expand, Fix Grammar, Translate → stream into overlay, replace text
- *Dispatch actions* (new): Ask AI, Explain, Send to Canvas → routed through the unified dispatcher

The bubble menu area shows inline actions. The right-click context menu shows dispatch actions. Both can coexist.

#### Future Surfaces

Any new editor surface (code viewer, spreadsheet, diagram) only needs:
1. Implement `ISurfaceSelectionAdapter` (expose selection + source metadata)
2. Wire a context menu trigger (right-click or toolbar button)
3. Call `dispatcher.dispatch(payload)` — everything else is handled

---

## Command Integration

Register three commands in the command service:

| Command ID | Title | Keybinding | Behavior |
|-----------|-------|------------|----------|
| `editor.explainSelection` | Explain Selection | — | Get selection from active editor → dispatch `explain` |
| `editor.summarizeSelection` | Summarize Selection | — | Get selection from active editor → dispatch `summarize` |
| `editor.askAIAboutSelection` | Ask AI About Selection | `Ctrl+Shift+E` | Get selection from active editor → dispatch `ask-ai` |
| `editor.sendSelectionToCanvas` | Send Selection to Canvas | `Ctrl+Shift+K` | Get selection from active editor → dispatch `send-to-canvas` |

Commands are also invokable from the command palette. The `when` clause activates them only when an editor has focus and a selection exists.

---

## Implementation Phases

### Phase 1 — Core Infrastructure

**Goal:** Build the dispatcher, contracts, and chat integration. No surface wiring yet.

| # | Task | Files |
|---|------|-------|
| 1.1 | Define `ISelectionActionPayload`, `ISurfaceSelectionAdapter`, `ISelectionActionHandler`, `IActionHandlerServices` interfaces | `src/services/selectionActionTypes.ts` (new) |
| 1.2 | Add `IChatSelectionAttachment` kind to the attachment union | `src/services/chatTypes.ts` |
| 1.3 | Build `SelectionActionDispatcher` — registers handlers, receives payloads, routes to handler | `src/services/selectionActionDispatcher.ts` (new) |
| 1.4 | Build `IChatProgrammaticAccess` implementation — wraps active chat widget | `src/built-in/chat/chatProgrammaticAccess.ts` (new) |
| 1.5 | Extend `ChatContextAttachments` — `addSelectionAttachment()` method, render selection pills | `src/built-in/chat/input/chatContextAttachments.ts` |
| 1.6 | Extend prompt assembly — format selection attachments into the prompt with source reference | `src/openclaw/openclawContextEngine.ts` |
| 1.7 | Register `/explain` and `/summarize` slash commands | `src/openclaw/openclawDefaultRuntimeSupport.ts` |
| 1.8 | Build action handlers: ExplainHandler, SummarizeHandler, AskAIHandler, SendToCanvasHandler | `src/services/selectionActionHandlers.ts` (new) |
| 1.9 | Register commands: `editor.explainSelection`, `editor.summarizeSelection`, `editor.askAIAboutSelection`, `editor.sendSelectionToCanvas` | `src/commands/editorCommands.ts` |
| 1.10 | Wire dispatcher + handlers + chat access in chat `main.ts` activation | `src/built-in/chat/main.ts` |

### Phase 2 — Surface Adapters (Text Editors)

**Goal:** Wire the three non-canvas editor surfaces to the dispatcher.

| # | Task | Files |
|---|------|-------|
| 2.1 | PDF Viewer: expose `getSelectedText()`, add `onDidChangeSelection` event, add AI context menu items, build adapter | `src/built-in/editor/pdfEditorPane.ts` |
| 2.2 | Text Editor: add `getSelectedText()`, compute line numbers, wire context menu with AI items, build adapter | `src/built-in/editor/textEditorPane.ts` |
| 2.3 | Markdown Preview: capture selection on mouseup, wire context menu, build adapter | `src/built-in/editor/markdownEditorPane.ts` |
| 2.4 | Editor group integration — detect active pane's adapter, connect to dispatcher | `src/built-in/editor/editorGroup.ts` or `editorPart.ts` |

### Phase 3 — Polish & Testing

**Goal:** End-to-end verification, keyboard shortcuts, edge cases.

| # | Task | Files |
|---|------|-------|
| 3.1 | Unit tests: dispatcher routing, payload construction, handler behaviors (mock chat access) | `tests/unit/selectionAction*.test.ts` |
| 3.2 | Unit tests: selection attachment rendering in chat pills | `tests/unit/chatContextAttachments.test.ts` |
| 3.3 | Unit tests: prompt assembly with selection attachments | existing prompt assembly test files |
| 3.4 | Keybinding registration: `Ctrl+Shift+E` (Ask AI), `Ctrl+Shift+K` (Send to Canvas) | `src/commands/editorCommands.ts` |
| 3.5 | Edge cases: empty selection (no menu items shown), very long selection (truncation), selection across page boundaries (PDF) | surface adapters |
| 3.6 | Context menu visual polish — AI items get a distinctive icon/separator group | surface adapters + CSS |

### Phase 4 — Canvas Migration (Future Milestone)

**Goal:** Not in scope for M48. Documented here for continuity.

| # | Task | Notes |
|---|------|-------|
| 4.1 | Build canvas `ISurfaceSelectionAdapter` using `editor.state.doc.textBetween()` | Leverages existing selection tracking |
| 4.2 | Add dispatch-category actions (Ask AI, Send to Canvas) to canvas right-click context menu | Alongside existing inline AI in bubble menu |
| 4.3 | Evaluate migrating InlineAIMenu's streaming to go through the dispatcher where possible | May keep inline overlay as a canvas-specific handler that consumes `ISelectionActionPayload` |
| 4.4 | Consolidate `chat.getInlineAIProvider` bridge — canvas inline AI routes through `IActionHandlerServices` instead of a direct `SendChatRequestFn` | Reduces coupling between canvas and chat internals |

---

## Context Menu Layout

When a user right-clicks selected text, the context menu items should be grouped consistently:

```
────────────────────────
  Cut                    Ctrl+X         ← standard group
  Copy                   Ctrl+C
  Paste                  Ctrl+V
  Select All             Ctrl+A
────────────────────────
  Find in Document       Ctrl+F         ← editor-specific group (PDF only)
────────────────────────
  ✨ Explain Selection                  ← AI group
  ✨ Summarize Selection
  ✨ Ask AI...
  ✨ Send to Canvas
────────────────────────
```

**Rules:**
- AI items appear in a dedicated `'ai'` group, separated by a divider from standard items
- AI items only appear when there is a non-empty selection
- Each AI item uses a sparkle icon (✨) or similar visual distinguisher
- The "Ask AI..." item has an ellipsis — it opens the chat but doesn't auto-submit
- If the chat panel is not visible, Explain/Summarize/Ask AI will auto-reveal it

---

## Relationship to Canvas Inline AI

The existing `InlineAIMenuController` and this new system serve **different UX patterns**:

| Aspect | Canvas Inline AI (existing) | Unified Dispatch (this milestone) |
|--------|----------------------------|-----------------------------------|
| **Trigger** | Selection → floating menu below bubble | Selection → right-click context menu |
| **Result destination** | In-place overlay with Accept/Reject | Chat panel (or new canvas page) |
| **Actions** | Summarize, Expand, Fix Grammar, Translate | Explain, Summarize, Ask AI, Send to Canvas |
| **Streaming** | Direct `SendChatRequestFn` → overlay | Through chat panel's normal streaming |
| **Scope** | Canvas-only | Any editor surface |
| **Text replacement** | Yes (Accept replaces selection) | No (results go to chat or canvas) |

They are complementary, not conflicting. In Phase 4, both will coexist on the canvas surface: inline actions for in-place edits, dispatch actions for chat/canvas routing.

---

## Success Criteria

- [ ] **P1.** Right-click selected text in PDF viewer → "Explain Selection" → chat opens with selection context → AI explains the text
- [ ] **P1.** Right-click selected text in text editor → "Summarize Selection" → chat opens → AI summarizes
- [ ] **P1.** Right-click selected text in any editor → "Ask AI..." → chat opens with selection attached as pill → user types question → AI responds with selection as context
- [ ] **P1.** Right-click selected text → "Send to Canvas" → new canvas page created with quoted selection
- [ ] **P1.** `/explain` and `/summarize` work as standalone slash commands in chat
- [ ] **P1.** Selection pills render with source metadata: `📎 filename (lines X-Y)` or `📎 filename (page N)`
- [ ] **P2.** Commands registered and discoverable in command palette
- [ ] **P2.** `Ctrl+Shift+E` shortcut triggers Ask AI from any editor
- [ ] **P3.** Dispatcher architecture allows new surface to integrate by implementing `ISurfaceSelectionAdapter` only

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/services/selectionActionTypes.ts` | All shared interfaces: `ISelectionActionPayload`, `ISurfaceSelectionAdapter`, `ISelectionActionHandler`, `IActionHandlerServices`, `IChatProgrammaticAccess` |
| `src/services/selectionActionDispatcher.ts` | `SelectionActionDispatcher` class — handler registry + payload routing |
| `src/services/selectionActionHandlers.ts` | Built-in handlers: Explain, Summarize, AskAI, SendToCanvas |
| `src/built-in/chat/chatProgrammaticAccess.ts` | `ChatProgrammaticAccess` — implements `IChatProgrammaticAccess`, wraps active chat widget |

## Files to Modify

| File | Change |
|------|--------|
| `src/services/chatTypes.ts` | Add `IChatSelectionAttachment`, update `IChatAttachment` union |
| `src/built-in/chat/input/chatContextAttachments.ts` | Add `addSelectionAttachment()`, render selection pills |
| `src/openclaw/openclawContextEngine.ts` | Format selection attachments in prompt assembly |
| `src/openclaw/openclawDefaultRuntimeSupport.ts` | Register `/explain` and `/summarize` commands |
| `src/built-in/chat/main.ts` | Wire `ChatProgrammaticAccess`, register with dispatcher, expose via command |
| `src/built-in/editor/pdfEditorPane.ts` | Public `getSelectedText()`, AI context menu items, adapter |
| `src/built-in/editor/textEditorPane.ts` | `getSelectedText()`, context menu, adapter |
| `src/built-in/editor/markdownEditorPane.ts` | Selection capture, context menu, adapter |
| `src/commands/editorCommands.ts` | New commands + keybindings |

---

## Open Questions

1. **Truncation policy:** When a user selects 10,000 characters, should we truncate the text sent to the model? If so, at what threshold? (Proposed: 4000 characters max, with a "selection truncated" indicator.)
2. **Multiple selections:** Some editors support multiple selections. Do we handle only the primary selection for now? (Proposed: yes, primary only.)
3. **Canvas page target for "Send to Canvas":** Always create a new page, or offer a quick-pick to choose an existing page? (Proposed: new page by default, with a future enhancement to pick existing.)
4. **Keyboard shortcut conflicts:** `Ctrl+Shift+E` is commonly Explorer toggle. May need adjustment after testing. `Ctrl+Shift+K` is sometimes used for "delete line." Both should be verified against existing bindings.
