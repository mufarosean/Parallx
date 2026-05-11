# Milestone 66 — Unified linking, citations, and AI self-awareness

## Why

Parallx is six tools in one shell, but they don't feel like one app. The user
is about to make canvas pages their primary note-taking surface and wants notes
that **reference real things**: a paragraph in a PDF they're studying, a photo
in the media-organizer library, a file in the explorer, a transaction in the
budget extension, a node in the workspace graph. Today there is no way to:

1. **Mint a stable link** to any of these from anywhere else in the app.
2. **Cite a source** in an AI conversation that, when written to a canvas
   page, becomes a clickable jump-to-source.
3. **Tell the AI what Parallx even is** — what tools exist, which extension
   they come from, what they can reference. The model sees a flat tool list
   with no self-description.
4. **Find tools in settings by extension** — the tools panel renders a flat
   alphabetical list ignoring the `extensionId` already on every tool record.

User verdict: *"This is not a disjoint app, it is a real app."*

## Audit (file:line citations)

### Linking surface (none today)

| Concern | Current state |
|---|---|
| Canvas → file | No mechanism. Markdown links in `text` blocks are inert vs. tool surfaces. |
| Canvas → page | `pageBlockNode.ts` (`extensions/`) embeds a page card but only inside the canvas tool. |
| Canvas → photo/video | None. AI cannot reference a media-organizer item. |
| Canvas → PDF anchor | None. PDFs open at page 1 even if the user just discussed page 12. |
| AI citations | AI emits raw markdown links the renderer treats as plaintext. |

### AI self-awareness

| Concern | File:line | Issue |
|---|---|---|
| Chat system prompt | `src/built-in/chat/promptBuilder.ts` (to confirm) | No "About Parallx" block; no extension inventory. |
| Tool list passed to model | tool registry serialization | Flat; no grouping by extension; no app-level concept. |
| `extensionId` on tool records | `src/tools/toolRegistry.ts` | Already populated — unused in prompt. |

### Tools settings panel

| Concern | File:line | Issue |
|---|---|---|
| Tools settings rendering | `src/aiSettings/...` (panel renderer) | Iterates flat `toolRegistry.getAll()`, no group-by extension. |
| Extension manifest data | `ExtensionRegistry` | Already loaded with name + icon + version per extension — unused in tools panel. |

### Pre-existing pieces we can build on

- `EditorsBridge.openFileEditor(uri, options)` — opens text files with optional `pinned`. No line-jump option today.
- `EditorsBridge.openEditor({ typeId, instanceId, ... })` — opens tool editors. Used by canvas, budget, media-organizer, workspace-graph, web-research.
- `api.commands.executeCommand` — every tool already exposes commands; we can resolve some link paths via existing commands rather than new APIs.
- PDF viewer: `src/built-in/pdfViewer/` — currently opens to page 1; PDF.js text-layer exists in renderer.

## Design

### 1. `parallx://` URI scheme — one canonical link format

| URI | Resolves via |
|---|---|
| `parallx://explorer/file?path=<fsPath>&line=<n>&col=<n>` | `openFileEditor` + new `revealLine` |
| `parallx://canvas/page/<pageId>?block=<blockId>` | `canvas.openPageInEditor(pageId)` + scroll to block |
| `parallx://media-organizer/photo/<id>` | media-organizer `openItem` command (new) |
| `parallx://media-organizer/video/<id>?t=<sec>` | media-organizer `openItem` + seek |
| `parallx://pdf?path=<fsPath>&page=<n>&quote=<text>` | pdfViewer open + page navigate + text-layer match scroll |
| `parallx://budget/transaction/<id>` | budget `openTransaction` command (new) |
| `parallx://budget/account/<id>` | budget `openAccount` command (existing) |
| `parallx://workspace-graph/node/<id>` | workspace-graph `focusNode` command (new) |
| `parallx://web-research/result?url=<url>` | opens external in default browser via existing egress |

Encoding rules:
- All query values URI-encoded.
- `quote` for PDF is fuzzy-matched (whitespace and line-break tolerant).
- Unknown scheme paths return `false` from `links.open` (no throw) and render as plain link.

### 2. Core service: `LinkResolverService` + `api.links`

New file: `src/links/linkResolverService.ts`

```ts
type LinkHandler = (parsed: ParsedLink, ctx: { source?: string }) => Promise<boolean>;

class LinkResolverService {
  register(scheme: 'parallx', segment: string, handler: LinkHandler): IDisposable;
  open(uri: string, ctx?: { source?: string }): Promise<boolean>;
  // returns false if no handler or handler refused; never throws on bad input
}
```

`segment` is the first path component after `parallx://` (e.g. `canvas`,
`explorer`, `media-organizer`). Each extension registers its own segments in
its `activate()`. Built-ins register through the same bridge.

API surface (new file `src/api/bridges/linksBridge.ts`):

```ts
parallx.links: {
  /** Resolve a parallx:// URI by dispatching to the registered handler. */
  open(uri: string): Promise<boolean>;

  /** Register a full LinkContract (see §6). One call per extension. */
  register(contract: LinkContract): IDisposable;

  /** Pure helper to build a properly-encoded URI. */
  mint(segment: string, path: string, params?: Record<string, string>): string;

  /** Pure helper to parse a parallx:// URI; null on invalid scheme/syntax. */
  parse(uri: string): ParsedLink | null;

  /**
   * Snapshot of every contract registered in this workspace.
   * The prompt builder, the canvas link block, and the `parallx_link`
   * tool ALL consume this. Adding a new extension contract makes the
   * extension citable everywhere automatically.
   */
  allContracts(): readonly LinkContract[];

  /** Fired when contracts are added/removed (extension load/unload). */
  onDidChangeContracts: Event<void>;

  /** Lazy metadata fetch for a single URI; routed to kind.resolveMetadata. */
  resolveMetadata(uri: string): Promise<{ title: string; icon?: string } | null>;
}
```

`mint` is a pure helper that builds a properly-encoded URI; extensions use it
instead of string-concat to avoid encoding bugs.

### 3. `link` block in canvas

Add one new block to `src/built-in/canvas/config/blockRegistry.ts`:

```ts
{
  id: 'link',
  schema: {
    uri: string,          // parallx:// or http(s)://
    anchor: string,       // user-visible text
    resolvedTitle?: string,
    resolvedIcon?: string,
    resolvedAt?: number,
    note?: string,        // optional inline note from the AI ("cited on p.12")
  }
}
```

Renderer: a clickable chip — icon + anchor + optional note. On click calls
`api.links.open(uri)`. If `links.open` returns `false` (target missing) shows
"(missing)" state with a tooltip.

Lazy resolution: when the chip first renders, if `resolvedTitle` is empty,
call a lightweight `links.resolveMetadata(uri)` (returns `{title, icon}`,
implemented per-segment) and persist the result back to the block.

### 4. AI emission path

Two parts:

**a. New chat tool `parallx_link`:**

```ts
{
  name: 'parallx_link',
  description: 'Mint a parallx:// link to cite a Parallx resource. Use this anytime you reference a file, page, PDF, photo, or transaction so the user can click through.',
  parameters: {
    target: { description: 'parallx:// URI built via the format shown in the system context. Required.' },
    anchor: { description: 'Display text the user will see and click on. Required.' },
    note: { description: 'Optional short note rendered under the chip ("cited on p.12").' },
  }
}
```

Returns `{ block: { type: 'link', ... } }`. The AI then includes that block in
its next `compose_page` / `insert_block` call.

**b. System-context block injected into every chat turn:**

A small generator in `src/built-in/chat/promptBuilder.ts` that emits, before
the tool list, a section auto-generated from `api.links.allContracts()` and
`extensionRegistry.list()`. **No hardcoded extension list, no hardcoded URI
templates.** See §6 for the contract-driven generator and a sample of the
emitted prompt. Cost: ~30–50 lines of prompt depending on how many
extensions are loaded.

### 5. PDF deep-linking with quote (hardest piece)

Acceptance: `parallx://pdf?path=...&page=12&quote=foo%20bar%20baz` opens the
PDF, navigates to page 12, scrolls so the first match for `foo bar baz` (after
collapsing whitespace) is visible, and highlights the match span.

Implementation steps:
1. PDF viewer's open call accepts `{ initialPage, initialQuote }` options.
2. After PDF.js renders the target page's text layer, walk its `TextItem[]`,
   join with spaces, normalize whitespace, run `indexOf` on the same-normalized
   quote.
3. Map the byte-offset back to a text-layer span via cumulative character
   counts; add a temporary `.parallx-link-highlight` class; scroll the span
   into view with `block: 'center'`.
4. Fallback: if no match on page N, search page N±1; if still none, just leave
   user at page N with a non-fatal toast "couldn't find quoted text on this page."

### 6. Per-tool resolver registration — the extension contract

This is the single most important design constraint of M66: **adding link
support to a new extension must be one `activate()` call, with zero changes
to core, chat, prompt builder, settings panel, or anywhere else.** Future
extensions (notes-app, task-tracker, email-importer, anything) get full
AI-citation support for free the moment they publish their contract.

#### The `LinkContract` shape

Every extension that wants to be cite-able publishes one contract through
`api.links.register(...)`. The contract is **fully self-describing** —
the prompt builder, the chat markdown renderer, the link-block resolver,
and `parallx_link`'s parameter schema all read from these registrations.
Nothing about a new extension is hardcoded anywhere else in the app.

```ts
interface LinkContract {
  /** Segment owned by this extension, e.g. "media-organizer", "budget". */
  segment: string;

  /** Per-resource-kind handlers. */
  kinds: {
    [kind: string]: {
      /** URI template shown to the AI in the system prompt. */
      uriTemplate: string;             // e.g. "parallx://budget/transaction/<id>"

      /** Short human-readable description shown to the AI. */
      description: string;             // e.g. "Cite a single budget transaction by id"

      /** Examples for the AI (1–2 max). */
      examples?: string[];

      /** Open the resource. Returns false if the target is missing/invalid. */
      open(parsed: ParsedLink, ctx: { source?: string }): Promise<boolean>;

      /** Lazy metadata fetch for the canvas link chip (title + icon). */
      resolveMetadata?(parsed: ParsedLink): Promise<{ title: string; icon?: string } | null>;

      /**
       * OPTIONAL: lets an extension expose a "mint a link to the currently
       * focused thing" command so the user can copy a link via UI.
       * The chat tool `parallx_link` also calls this when the AI asks
       * "give me a link to the currently selected media-organizer photo."
       */
      mintFromContext?(ctx: ExtensionContextSnapshot): string | null;
    }
  };
}
```

#### Registration example (any future extension)

```ts
// ext/notes-app/main.js   (hypothetical future extension)
export function activate(api) {
  api.links.register({
    segment: 'notes-app',
    kinds: {
      note: {
        uriTemplate: 'parallx://notes-app/note/<id>',
        description: 'Cite a specific note in the Notes app',
        examples: ['parallx://notes-app/note/abc-123'],
        async open(parsed) {
          const id = parsed.pathSegments[1];
          await api.editors.openEditor({
            typeId: 'notes-app-editor',
            title: getNoteTitle(id),
            instanceId: id,
          });
          return true;
        },
        async resolveMetadata(parsed) {
          const id = parsed.pathSegments[1];
          const note = await getNote(id);
          return note ? { title: note.title, icon: '📝' } : null;
        },
      },
    },
  });
}
```

That's it. The extension is now fully citable:

- The system prompt automatically includes `parallx://notes-app/note/<id>`
  in its URI-template list.
- The chat renderer automatically intercepts `parallx://notes-app/...`
  clicks and calls the registered `open()`.
- The canvas `link` block automatically renders notes-app citations with
  the title/icon returned by `resolveMetadata()`.
- The tools settings panel automatically shows it in the notes-app
  section (already grouped by `extensionId`).
- `parallx_link` automatically accepts notes-app URIs since the chat tool
  validates against the union of all registered segments.

#### The contracts at launch (built-ins + bundled extensions)

| Extension | Segment | Kinds |
|---|---|---|
| canvas | `canvas` | `page` (`?block=` optional) |
| explorer | `explorer` | `file` (`?line=&col=` optional) |
| pdf-viewer | `pdf` | `pdf` (`?path=&page=&quote=`) |
| media-organizer | `media-organizer` | `photo`, `video` (`?t=` optional for video) |
| budget | `budget` | `transaction`, `account` |
| workspace-graph | `workspace-graph` | `node` |
| web-research | `web-research` | `result` (`?url=`) |
| chat | `chat` | `session` (cite a past chat session by id) |

`chat` is included intentionally — the AI can cite "as we discussed in
session X" and the click jumps back to that session.

#### Why the contract is the only integration point

The contract is read by exactly four consumers:

1. **`LinkResolverService.open(uri)`** — routes the URI to the right
   `kinds[kind].open` based on parsed segment + kind.
2. **Prompt builder** — iterates `api.links.allContracts()` to generate
   the "URI templates" + "Active extensions" sections of the system
   prompt. No hardcoded extension list anywhere.
3. **Canvas `link` block renderer** — calls `kinds[kind].resolveMetadata`
   on first paint.
4. **`parallx_link` chat tool** — uses `allContracts()` to build its
   `target` parameter description (so the AI sees an up-to-date list of
   what's mintable in the current workspace) and to validate input.

This means: **adding a new extension never requires editing core, chat,
canvas, settings, or any other file outside the new extension itself.**
We will not regress into a world where the prompt builder has a hardcoded
`if (segment === 'budget')` branch. Reviewers should reject any PR that
adds a per-extension branch in core code; everything goes through the
contract.

#### What the prompt actually emits (auto-generated)

Instead of the hardcoded sample shown in §4b, the prompt builder iterates
contracts:

```ts
function buildLinkingPromptSection() {
  const contracts = api.links.allContracts();
  const exts = extensionRegistry.list().filter(e => e.enabled);

  return [
    '## Linking',
    'You can cite anything in Parallx via parallx:// links. ' +
    'Use the `parallx_link` tool to mint a link.',
    '',
    'URI templates available in this workspace:',
    ...contracts.flatMap(c =>
      Object.entries(c.kinds).map(([_, k]) =>
        `  ${k.uriTemplate}  — ${k.description}`
      )
    ),
    '',
    '## Active extensions',
    ...exts.map(e =>
      `  ${e.displayName} (${e.builtIn ? 'built-in' : 'ext'}) — ${e.summary}`
    ),
  ].join('\n');
}
```

Every new contract automatically appears. Removing an extension removes
its lines automatically. No prompt drift, no stale documentation.

#### `extension.json` `summary` field

To make the "Active extensions" list useful, extensions must publish a
one-line `summary` in their manifest:

```json
{
  "id": "media-organizer",
  "displayName": "Media Organizer",
  "summary": "Photo and video library with EXIF, faces, and AI tagging.",
  ...
}
```

Built-ins get the same field in their built-in registration record.
Lint check: any extension without `summary` fails packaging.

### 7. Tools settings: group by extension

In the tools settings panel renderer (currently flat), change to:

```
function renderTools() {
  const tools = toolRegistry.getAll();
  const byExt = new Map<string, ToolRecord[]>();
  for (const t of tools) {
    const key = t.extensionId ?? 'built-in';
    if (!byExt.has(key)) byExt.set(key, []);
    byExt.get(key)!.push(t);
  }
  const extOrder = sortExtensionsForDisplay(byExt.keys());
  for (const extId of extOrder) {
    const ext = extensionRegistry.get(extId);
    renderExtensionSection({
      icon: ext?.icon ?? '🧩',
      name: ext?.displayName ?? extId,
      version: ext?.version,
      tools: byExt.get(extId)!,
    });
  }
}
```

Collapsible per-extension. Default-expanded for the top 3 extensions with
enabled tools, collapsed for the rest. Search filter unchanged.

### 8. Markdown-link interception in chat rendering

Today AI markdown links render as plain `<a href>`. Wire the chat markdown
renderer so that `parallx://` hrefs are intercepted: clicking them calls
`api.links.open(href)` instead of navigating. Non-parallx links use the
existing external-shell-open path (already secure via egress).

## Plan / sequencing

This milestone is intentionally large; ship in iterations so each step is
testable on its own.

### Iteration A — Foundation (no AI changes yet)

1. Create `LinkResolverService` + `api.links` bridge.
2. Wire canvas, explorer, pdf-viewer, media-organizer, budget,
   workspace-graph, web-research to register their segments.
3. Add `link` block to canvas with click-to-resolve.
4. Intercept `parallx://` links in chat markdown renderer.
5. Tools settings: group by extension.

**Verification:**
- Unit tests for `LinkResolverService.parse/mint/open`.
- Unit test `tests/unit/linkContractAutoWire.test.ts`: register a synthetic
  `fake-ext` contract with one kind, assert that:
    - `api.links.allContracts()` includes it.
    - `promptBuilder.buildLinkingPromptSection()` output contains its
      `uriTemplate` and `description`.
    - `api.links.open(<fake-ext URI>)` invokes the contract's `open()`.
    - Unregister it and re-run: it disappears from all three.
  This test is the **guardrail** that prevents anyone from ever adding a
  hardcoded extension branch in core.
- Manual: paste a `parallx://canvas/page/<existing-id>` into a canvas page,
  click → opens.
- Manual: same for explorer/file with line, media-organizer photo, budget
  account, workspace-graph node, web-research result.
- Tools settings shows extension-grouped sections.

### Iteration B — PDF deep-linking

1. Extend pdf-viewer open API with `initialPage` + `initialQuote`.
2. Implement text-layer match-and-scroll.
3. Register `parallx://pdf` handler.
4. Verification: open a PDF via `parallx://pdf?path=...&page=3&quote=...`
   from a canvas link block; verify scroll + highlight on a known doc.

### Iteration C — AI awareness + citation tool

1. Add `parallx_link` chat tool.
2. Generate "About Parallx + extensions + linking templates" system-context
   block in `promptBuilder.ts`.
3. Update `create_page` / `compose_page` / `insert_block` tool descriptions
   to mention "use `parallx_link` to cite sources."
4. End-to-end verification: open a PDF, chat about it, ask AI to save notes
   and link the source; click citations → land on correct page+quote.

## Out of scope

- **Backlinks panel** ("things that link to this page"). Worth a follow-up
  milestone; needs a links index. We can build the index lazily once Iteration
  A is shipped because every `link` block has a serialized URI.
- **Smart-suggest** ("the AI proactively offers to cite this PDF"). Deferred.
- **Cross-workspace links**. `parallx://` is workspace-local. Cross-workspace
  is a future scheme `parallx-ws://<workspaceId>/...`.

## Open decisions

- Should `parallx_link` return the block payload (current plan) or auto-insert
  into the active page? Current plan keeps the AI in control of where the
  citation lands.
- Should the chat renderer show `parallx://` URLs as chips inline (like the
  canvas `link` block) instead of plain text links? Lean yes; small renderer
  helper. Decide during Iteration A.

## Files to create / modify

| File | Action |
|---|---|
| `src/links/linkResolverService.ts` | new |
| `src/links/parallxUri.ts` | new (parse/mint pure functions) |
| `src/api/bridges/linksBridge.ts` | new |
| `src/api/apiFactory.ts` | add `links` bridge |
| `src/api/parallx.d.ts` | add `links` namespace types |
| `src/built-in/canvas/main.ts` | register `page` segment |
| `src/built-in/canvas/config/blockRegistry.ts` | add `link` block |
| `src/built-in/canvas/extensions/linkBlockNode.ts` | new — TipTap node for link chip |
| `src/built-in/explorer/main.ts` | register `file` segment with revealLine |
| `src/built-in/pdfViewer/...` | accept initialPage/initialQuote (Iter B) |
| `src/built-in/chat/promptBuilder.ts` | inject Parallx self-description (Iter C) |
| `src/built-in/chat/tools/parallxLinkTool.ts` | new (Iter C) |
| `src/built-in/chat/markdownRenderer.ts` (or equivalent) | intercept parallx:// hrefs |
| `src/aiSettings/.../toolsPanel.ts` | group by extension |
| `ext/media-organizer/main.js` | register `photo`/`video` segments |
| `ext/budget/main.js` | register `transaction`/`account` segments |
| `ext/workspace-graph/main.js` | register `node` segment |
| `ext/web-research/main.js` | register `result` segment |
| `tests/unit/linkResolverService.test.ts` | new |
| `tests/unit/parallxUri.test.ts` | new |
