# Canvas assessment, 2026-10-03

Asked for: a deep assessment of Canvas, every block, every piece of logic,
the full system, before any work on it.

How it was done: seven reviewers each took one slice (the document model and
every block; block and text interactions; storage and history; sidebar, page
chrome and properties; databases; AI, import/export and search; a hands-on
run of the built app in dark and light). Each finding needed a concrete
failing case. Many were reproduced with throwaway probes against the real
code (vitest against `createEditorExtensions`, a Python replay of the real
migrations and SQL, Electron runs of the built app). The most serious ones
were then re-read in the code by hand. Nothing was changed. Build at
`4666e6f9`.

Scale: 38,000 lines in 101 files on Tiptap 3.19. 53 unit-test files (792
tests) pass. Of the Canvas e2e specs, 10 pass and 19 fail; all but one fail
because the specs are stale (hidden editor panes now stay in the DOM, a menu
class was renamed, Recent duplicates sidebar rows), not because the product
broke.

## The verdict

The foundation is genuinely good, better than most Notion-likes: one block
registry drives the slash menu, turn-into, column rules and drag; the
transform engine never drops children; moves across pages are atomic; AI
edits stream in with margin marks and Keep/Undo; persistence survived close,
reopen and relaunch byte for byte; typing costs about 4 ms a character in a
400-block page. The comments explain the why of past bugs unusually well.

What lets it down is the edges, and some of them lose data. Two independent
reviewers found the same silent page-wipe. A database is destroyed by moving
it to Trash. Divider, Table of Contents and Concept Map vanish at the next
keystroke. Add Cover throws every time. Markdown, which is the only language
AI edits and exports speak, corrupts ordinary text ("$5 and $10" becomes an
equation). Most of these are small fixes in sound code; they exist because
the hard paths were built carefully and the boundaries (load, trash, AI,
markdown, focus) were not tested adversarially.

## What is strong

- **Block registry.** One `BlockDefinition` per block drives slash menu,
  turn-into, placeholders, column content rules and drag capabilities
  (`config/blockRegistry.ts`).
- **Transforms.** Decompose/build with "never drop children" and in-place list
  splicing, better than Tiptap's own toggle-lift (`blockStateRegistry/`).
- **Undo hygiene.** Trailing node, auto-joiner and UniqueID are exempt from
  history, with a fuzzer behind them.
- **Atomic structure.** Page moves and cross-page block moves are single
  transactions with revision guards and retry; subtree trash/restore use
  recursive CTEs with cycle guards; sidebar drags freeze ancestry and drain
  refreshes afterwards.
- **Save safety.** Per-page write queue, staleness detection, a guard against
  saving an empty doc over a full page, close-time commit with a snapshot.
- **AI co-authoring.** Read-before-edit gate, approvals, pre-edit checkpoint,
  a surgical top-level diff that keeps cursor and scroll, decoration-only
  margin marks, a streamed reveal that honours reduced motion.
- **Databases as pages.** "A database is a page, rows are pages" is Notion's
  own model; filter/sort/group logic is pure and testable
  (`database/databaseViewModel.ts`).
- **Table controls** (union cell edges, pinned header row/column, guarded
  pointer drags) and the list/table keyboard policies.
- **PDF export** from the live DOM, so math, code and columns print as seen.
- **Performance and persistence** held up in the running app.

## Critical: content can be lost

| # | What | Where | Status |
|---|---|---|---|
| C1 | A page containing any block type the editor does not know (a removed `databaseInline`, version skew between machines) loads **blank**; the empty-doc guard only blocks a fully empty save, so the **first keystroke overwrites the stored page**. Tiptap swallows the parse error; `enableContentCheck` is off. The reload path also drops unparseable blocks. | `canvasEditorProvider.ts:930`, `canvasDataService.ts:1410`, `~1090` | **Fixed**: unknown nodes and marks load as an "Unsupported block" placeholder holding their JSON, and save back unchanged (`unknownContent.ts`). Checked in the app. |
| C2 | **Moving a database to Trash erases it.** Archive fires `PageChangeKind.Deleted`; the database service treats that as permanent and deletes values, rows, views, properties and the database. Restore brings back a plain page. Deleting or cutting the `/database` card, or trashing any ancestor, does the same. | `canvasDataService.ts:2495`, `database/databaseDataService.ts:97,195` | **Fixed**: a Trash move fires `Deleted` with `archived: true`; the database service clears its tables only on a permanent delete. Checked in the app (trash the parent, restore: database, columns and view intact). |
| C3 | **Empty Trash deletes a page already restored**, with its history: restoring a child leaves `parent_id` on the trashed parent, and the cascade takes it. A stale Trash panel can also hard-delete a live page (`permanentlyDeletePage` has no `is_archived` guard). | `canvasDataService.ts:1812, 2226`, `canvasSidebar.ts:677` | **Fixed**: a page restored out of a trashed parent moves to the top level; permanent delete refuses a page not in the Trash and lifts out live descendants first; Empty Trash reads the Trash when it runs (`emptyTrash`). Tested on real SQLite; checked in the app. |
| C4 | **Divider, Table of Contents and Concept Map are replaced by the next keystroke**: insertion leaves a node selection on the new atom. | slash insert actions | **Fixed**: `executeBlockInsert` moves the caret into an empty paragraph after a block left selected whole (`moveCaretPastInsertedBlock`). Checked in the app. |
| C5 | **Split editor:** two panes on one page never sync; closing the stale pane writes its old content over the other pane's saved edits. | `canvasEditorProvider.ts:731`, `commitPageClose` | **Fixed**: editors of one page mirror every edit to each other (`paneMirror.ts`), history-free and without a second save. In the app before the fix: edit pane 1, then pane 2, and pane 1's saved edit was gone; after: both kept, both panes identical. |
| C6 | "Repair on open" replaces content it cannot decode with an empty doc and keeps no copy. | `contentSchema.ts:72`, `canvasDataService.ts:1603` | **Fixed**: unreadable content is never repaired; the page opens read-only with a notice; `updatePage` refuses content writes over it. Checked in the app. |
| C7 | **Structural repair deletes a toggle's title** and stray children when the toggle is malformed (an AI insert anchored on the title is enough); it runs on the next unrelated keystroke. | `plugins/structuralRepair.ts:41` | **Fixed**: a malformed toggle is rebuilt as a valid one from all its parts (title, stray blocks, body); if that fails, the parts are released title first. Unit-tested on the real schema. |
| C8 | **Turn into Code / Equation duplicates and merges text** from containers and list rows (`node.textContent` plus children emitted again). | `blockTransforms.ts:211, 321` | **Fixed** (block sweep below) |
| C9 | **Dragging a non-contiguous selection deletes the blocks between** the selected ones (one span from first to last). | `blockHandles.ts:438`, `columnInvariants.ts:436` | **Fixed** (block sweep below) |
| C10 | **A stale block selection hijacks copy, cut and paste in other inputs**: Ctrl+X in the chat box cuts the canvas block instead. | `handles/blockClipboard.ts:68` | **Fixed**: copy, cut and paste are taken only when focus is in this editor or on nothing editable. |
| C11 | **Image/media upload eats the start of the next block**: the file dialog blurs the window, the popup cancels, the upload then inserts over a stale range. | `menus/imageInsertPopup.ts:68`, `mediaInsertPopup.ts` | **Fixed**: the image, media and bookmark popups follow their placeholder through edits (`insertTarget.ts`), replace it only while intact, ignore the file dialog's blur and any result after closing. |
| C12 | **Markdown round-trip corrupts text** (AI edits, Edit-mode Accept and export all pass through it): a code block in a list item swallows everything after it; `$5 and $10` becomes math; `my_func_name` gets italics; `# x` and `1. x` paragraphs become a heading and a list (no escaping); `|` splits table cells; toggle headings, page cards, bookmarks, columns, media, TOC, colours and backgrounds vanish. | `markdownExport.ts`, `markdownImport.ts:788` | **Fixed**: export then import now gives back the same page for every block, at the top level and inside columns, rows, quotes, callouts and toggles (`canvasMarkdownRoundTrip.test.ts`, plus 60,000 random nested pages in a scratch sweep). Text is escaped; what markdown cannot say (columns, toggle headings, colours, page cards, media, icons) travels in `<!-- parallx:… -->` comments around readable markdown. The reader follows CommonMark for `$`, `_`, `*` and `\`, and a row can hold any block. Reading surfaces (dashboard embed, chat block context, flashcard and workflow sources) get a plain version without comments or escapes. Still open: Edit mode shows the AI the page as plain text, so an accepted whole-page edit can still drop blocks the AI never saw (architecture item 4). |
| C13 | `canvas_edit_block` on a nested id (list row, cell) writes a schema-invalid doc; an AI insert after a list row produces an invalid list that throws on Enter. Nothing calls `check()` before saving. | `ai/blockTools.ts:189`, `ai/blockApi.ts:157, 240` | **Fixed**: edits and inserts are fitted to their place (`fitBlocksAtTarget`: rows join or split their list, a row's line stays a paragraph) and checked against the editor schema before writing; an invalid result is refused, never written. |
| C14 | Board grouped by multi-select: dragging a card turns its tag array into one string; dropping on "No X" clears all tags. | `database/databaseEditorPane.ts:490` | **Fixed**: the drop swaps only the tag the card was dragged from (`boardDropValue`); "No …" removes only that tag. |
| C15 | Re-running the legacy property migration overwrites current values with stale ones. | `database/legacyPropertyMigration.ts:553` | **Fixed**: the migration only fills empty cells, never overwrites. |
| C16 | Typing during an AI write (or while a child page is renamed) drops the last ~500 ms of keystrokes yet reports Saved; Ctrl+Q / Reload skip the close-time flush. | `canvasDataService.ts:1453`, `electron/main.cjs:816` | **Fixed**: Ctrl+Q now goes through the guarded window close, so pending saves are written. In the app: quitting right after typing lost the last words before the fix and kept them after. A reload sends every pending save at once at unload. A reload while edits wait to save merges by block (`reloadMerge.ts`) and saves the merge. The single-page reload and the AI-write case did not reproduce in app runs (the save landed first); the merge is unit-tested. |

## High: broken features

- **Add Cover throws every time** (`TypeError ... _handleAddCoverClick`):
  `const DEFAULT_COVER_GRADIENTS = COVER_GALLERY` is read at module load
  inside an import cycle, while still undefined (`header/pageChrome.ts:24`;
  `menus/coverMenu.ts:19` uses the same pattern). Verified in the app and the
  code. **Fixed**: both read the gallery when used; in the app Add Cover now
  sets a gradient cover.
- **Save as Template always produces an empty page**: it stores the stored
  envelope `{schemaVersion, doc}` instead of the doc (`main.ts:1218`). Verified.
  **Fixed**: the template gets the page's doc, without sub-page cards or
  block ids; templates saved by the old code are unwrapped on load; each new
  page gets its own copy. In the app a page saved as a template now builds a
  page with its text.
- **Template picker "Start with a blank page" does nothing** (same result as
  Cancel, `canvasTemplatePicker.ts:126`). **Fixed**: it creates a plain page;
  Cancel still creates nothing (checked in the app).
- **Toggle headings load with their body hidden** while the chevron says open;
  Enter moves the caret into the hidden body; open state is not saved
  (`extensions/toggleHeadingNode.ts:65`). **Fixed**: an `open` attribute is
  saved with the page (old pages load open) and decides whether the body
  shows; the chevron sets it without an undo step; Enter in a closed title
  makes a paragraph after it; the caret never rests in a closed body. In the
  app the body shows on insert, closes, and stays closed after reopening.
- **Block keyboard shortcuts die after a handle click, marquee or drag**:
  focus leaves the editor, so Del, Ctrl+D and Shift+Arrow do nothing although
  the menu advertises them; Ctrl+Z right after a drag undoes earlier typing.
  Verified in the app. **Fixed**: a handle click or a marquee puts the editor caret in the
  selected block and focuses the editor (`focusEditor`), and a drop focuses
  it too. In the app, after a handle click Delete, Backspace, Ctrl+D,
  Shift+Down, Ctrl+Shift+Up/Down and Enter all act; Delete after a marquee
  deletes; Ctrl+Z after a drag undoes the move. Found on the way and fixed:
  the action menu re-targeted the next block after its own was deleted (it
  now checks the block id); Esc did not close it; the editor's blur timer
  closed a menu the handle click had just opened; deleting the last selected
  blocks of a page threw in the selection handler.
- **Mod-Shift-Up/Down does not move blocks.** Verified in the app (the one
  real e2e failure). **Fixed** for blocks (block sweep below); the e2e spec
  is about a table row, still to re-run.
- **No drop indicator while dragging**; a small sideways drift silently makes
  columns. **Fixed**: the guide stays while the pointer rests (the stale-guide
  timer was 150 ms, shorter than Chromium's ~350 ms dragover interval); the
  left column strip starts at the block's edge, not in the handle gutter,
  and needs a 40 px sideways move from where the drag entered. In the app a
  straight drag with 0 to 40 px of drift now reorders (10 px used to make
  columns), and a deliberate move into the left or right strip still makes
  columns. Found on the way and fixed: no drop target at all next to a leaf
  block outside a column (video, audio, file, bookmark, divider, equation,
  table of contents, image, concept map), so no guide and no columns there;
  each now works at the top level and inside a column, right edge and below
  (checked in the app). The e2e spec `13-column-drag-drop` had a broken
  fixture (two editors); with the fixture and guide lookups scoped to the
  editor under test, 3 of 6 pass, and the other 3 fail on stale positions
  from the synthetic-event harness, the same as before this change.
- **Clicking a callout's icon did nothing** (found 2026-10-04 by the
  repaired e2e suite). The callout redrew its icon on every update, the new
  SVG was a mutation that re-rendered the node, so the icon was replaced in
  a loop and a click hit a detached SVG; and the handle of the block inside
  the callout sat on the icon. **Fixed**: the icon is redrawn only when it
  changes, the node view ignores its own chrome mutations, and the handle of
  a block in a callout stays left of the icon. Checked in the app.
- **Slash menu runs inside code blocks** ("// todo" + Enter turns the code
  block into a to-do list). **Fixed**: it stays closed in code blocks and in text-only lines
  (a toggle's summary, a toggle heading's title).
- **Turn Into → Columns on a list row throws** `RangeError`. **Fixed.**
- **Duplicating a page card then deleting one copy trashes the child page**
  the other copy points to. **Fixed**: a copied card is dropped.
- **Database data integrity:** deleting a property leaves view filters on it
  (the view then shows zero rows); options are stored by name, so an option
  cannot be renamed and removed options orphan values; checkbox, date and
  number filters disagree with themselves; "Tags" and "Page properties"
  databases are found by title, so a user database named "Tags" is hijacked;
  the AI property tool writes raw SQL with no type validation. **Fixed
  (2026-10-04)**: deleting a property removes its filter rules, sorts,
  grouping and column settings from every view (and views saved before are
  repaired when read); options can be renamed in Edit Options… and a rename
  or removal carries to every cell and filter that used the name; every cell
  write is stored in its column's one shape (`database/cellValues.ts`) and a
  value that does not fit is refused, and new select or tag names become
  options; filters read values by type (unchecked = never set, cleared,
  false or "false"; numbers compare as numbers; a date rule compares days),
  and the filter popover offers the operations and input that fit the
  column; the workspace Tags, Page properties and Migrated properties
  databases are found by a stored role (migration 016), adopting an earlier
  app-made one, never a user's database of that title; the AI property tool
  writes through the database service. Tests: `canvasDatabaseIntegrity`
  (real SQLite); checked in the app.
- **Inline AI Replace** uses a range captured when the chat opened (wrong text
  if the page changed) and parses the reply as HTML (`<b>` becomes bold,
  newlines collapse). **Fixed (2026-10-04)**: the selected range follows every
  edit while the chat is open (`menus/inlineAIReplace.ts`), Replace refuses
  with a note when the selected text itself was edited or deleted, the AI gets
  the selection as markdown, and the reply is read as markdown and put in the
  way a paste is (one paragraph joins the line; several become blocks with
  their own ids). Covered by `canvasInlineAIReplace.test.ts`; not tried in the
  app, which has no model in the cloud container.
- **AI page edits lose formatting**: `canvas_read_page` returns plain text,
  so a `replace` edit rewrites bold, links, nesting and callouts away and drops
  sub-page cards. `canvas_link_block` inserts literal text, not a link
  (**fixed 2026-10-04**: it writes a link to `parallx-page:<page>#<block>`,
  which opens the page at the block inside the app; checked in the app). **Fixed (2026-10-04)**
  for page edits: `canvas_read_page` and Edit mode give the AI the page as
  lossless markdown with a `<!-- block:ID -->` line per top-level block, so a
  rewrite keeps formatting, nesting, columns, colours and cards, and keeps
  top-level block ids (nested blocks get fresh ids). `canvas_edit_page` puts
  back sub-page cards a rewrite left out, drops cards for pages that are not
  this page's children, gives appended blocks fresh ids when theirs are taken,
  and refuses a result the editor schema rejects.
- **Search quality**: the index splits words at formatting boundaries
  ("Para" + "llx"); `canvas_find_pages` runs `LIKE` over raw JSON, so
  "paragraph" or "attrs" match every page. **Fixed (2026-10-04)**: the index
  text and the search/snippet text run a line's pieces together (the index
  joined a paragraph's pieces with newlines, the snippets with spaces);
  `canvas_find_pages` matches the query against each page's title and text,
  not the JSON (`canvasSearchText`).
- **Lock Page** locks the body and title only (icon, cover, font still edit).
  **Fixed (2026-10-04)**: icon, cover and font lock too, in the header and in
  the sidebar's page menu (checked in the app).
- **"Delete" means three things**: sidebar = Trash with confirm, header =
  Trash with no confirm, `canvas.deletePage` = permanent. **Fixed
  (2026-10-04)**: Delete is Move to Trash after the same question in all
  three; deleting for good happens only in the Trash (checked in the app).
- **Ctrl+P is taken by PDF export** on canvas pages, shadowing Go to File.
  **Fixed (2026-10-04)**: PDF export is Ctrl+Alt+P. The shortcut and the
  `canvas.exportPdf` command had never worked (they looked the page up by
  editor id); both open the dialog now (checked in the app).
- **PDF export prints collapsed toggles as their title only.** **Fixed
  (2026-10-04)**: the print opened `<details>`, but canvas toggles are divs
  that hide a collapsed body with `hidden`; toggle and toggle heading bodies
  now print (`canvasPdfExport`).

## Medium and smaller (grouped)

- **Sidebar**: Recent ignores content edits; the filter skips Favorites and
  Enter opens the first favorite; breadcrumbs never refresh after a move or an
  ancestor rename, and open a database ancestor in the wrong editor; no arrow
  keys or `aria-expanded` in a `role="tree"`; the active page is never revealed;
  dragging a sidebar row into a page inserts a raw UUID; adding a property to a
  plain page creates a visible "Page properties" page; Cover Cancel after a
  reposition does not revert; the last title edit is lost if the tab closes
  within 300 ms; the page "⋯" menu closes itself on any change or autosave;
  text/number/URL property edits can be silently dropped after one blur.
- **Editing**: a new table puts the caret in the last cell; "+" on the last
  list row puts the caret before the "/"; after Esc the next key reopens the
  slash menu; the slash list does not scroll to the highlighted row; menus do
  not follow the page on scroll; the action menu has no Escape or keyboard
  navigation; Esc in the link field drops focus to the body; pasting from Excel
  or Word pastes a picture; the internal Ctrl+V fallback can paste an older
  copy; Enter always commits a block equation (no multi-line LaTeX); the file
  attachment opens any URL scheme.
- **Storage**: retries ignore the staleness and blank checks; restore puts a
  child's card at the end of the parent; version restore does not restore the
  title or child cards; `canvas_blocks` is never written, so "Blocks" is always
  0; `sort_order` midpoints are never re-spaced. **Fixed (2026-10-04)**: a
  retried save runs the same stale and blank checks as the first attempt (it
  used to write an older doc over another writer's content after the
  backoff); Trash remembers where the card was (migration 017) and Restore
  puts it back there, at the end only when its neighbour is gone; removing
  and restoring cards go through the one write door; version restore brings
  back the title, drops cards for pages that are no longer children and keeps
  cards for children added since; the block count and chat's page structure
  read the page content (the `canvas_blocks` table is left unused); moves
  re-space sibling order once a gap is too small to halve. Tests:
  `canvasStorage` (real SQLite, failing first); Trash and Restore checked in
  the app.
- **Databases**: new rows ignore the view's filter; `addRow` is two writes; no
  reload guard; every edit rebuilds the whole table; row-property panels listen
  to every database.
- **Copy and design system**: slash menu labels differ from Turn Into
  ("Bullet List" / "Bulleted List", "To-Do" / "To-do", "Code Block" / "Code");
  "Turn into", "Send blocks to Chat", "OPEN", "+ Blank Page", "Add tags...",
  "Untitled database"; the slash menu interleaves Database between headings
  and shows no group labels; the drag grip is white in light mode; zero kit
  components in the sidebar, header and property UI (19 and 18 hand-built
  buttons, a hand-rolled toast, switch, popovers and modal); `canvas.css` mixes
  `--px-*` (812), `--vscode-*` (192) and `--parallx-*` (151) tokens, with 41 raw
  z-index values; hard-coded Catppuccin colours in `propertyBar.css` and the
  select palette in `propertyEditors.ts`.

## Architecture

1. **The schema is strict but never enforced at the boundaries.** Load, reload,
   AI writes and repair use `nodeFromJSON` without `check()`; unknown types
   blank the page (C1), invalid trees persist (C13), and the repair plugin
   knows six shapes and can delete content (C7). One validated boundary, with
   a lossless placeholder for unknown blocks, removes a whole class of bugs.
2. **Too many write doors.** The service's queue, guards and in-memory
   revisions protect the editor's writes, but AI tools (`ai/pageTools.ts`,
   1,296 lines; `ai/blockTools.ts`), card retitling and the property tool write
   raw SQL around them. Every write should go through one door.
   **Fixed (2026-10-04)** for page writes: every AI tool write (edit page,
   create page, page style, edit/insert/link block, Edit mode's Accept) goes
   through `ai/pageWriter.ts`, which in the app is the data service's new
   `rewritePageContent`: it writes the page's pending editor save first, then
   reads, changes and writes inside the page's write queue, refuses pages whose
   content cannot be read, and records the write so an editor save queued
   against the older content is dropped as stale (the reload merge keeps that
   typing). Before, an AI write could overwrite typing that was waiting to save
   or a save in flight, and a style change made the pending save fail its
   revision check. Card retitling on rename goes through the same door (it lost
   typing waiting to save on the parent) and reads only pages that mention the
   renamed page. Found on the way, both fixed: `setEditable()` emitted an
   editor update that saved the doc on screen over a write that had just
   landed (Edit mode's Accept was undone this way within half a second), and
   the open editor kept a block the AI had removed when the caret was in it,
   so the next save put it back (the caret now moves to the nearest text, not
   onto a card). Tests: `canvasOneWriteDoor` (real SQLite),
   `canvasExternalDocApply`; checked in the app. Still raw SQL: the AI
   property tool's database values (part of the database item below).
3. **The hierarchy is stored twice** (`parent_id` and `pageBlock` cards in the
   parent's JSON). Keeping them in sync is the source of most trash, restore,
   duplicate and delete-card bugs (C2, C3, page-card duplication).
4. **Markdown is the only language AI and export speak**, and it is lossy for
   more than half the block types and unescaped (C12). AI needs a block/JSON
   format; export needs an escaping writer with a round-trip property test.
5. **Five document-to-text converters** (`blockApi`, `pageTools`,
   `builtInTools`, `chunkingService`, `markdownExport`) disagree, which causes
   the search and AI-reading bugs.
6. **Global listeners for pane-local state.** Clipboard, keyboard and mouse
   listeners on `document` in capture phase plus module singletons
   (`_activeSession`, `_lastCopiedPayload`) cause C10.
7. **Monoliths.** `canvasDataService.ts` (2,718 lines, about eight jobs: split
   into repository, save scheduler, hierarchy, history, duplicator),
   `canvasSidebar.ts` (2,055, one class, three near-identical row renderers,
   whole-tree rebuild and four `SELECT *` per refresh that pull every page's
   content and cover), `blockHandles.ts` (1,264), `columnDropPlugin()` (one
   740-line closure), the concept-map and page-block node views.
8. **Cost per keystroke and per save.** Three to four full-document walks per
   change; images stored as base64 in page JSON (re-serialized on every save,
   kept 50 times in history, scanned by search); a title change parses every
   page in the workspace.
9. **Name-based identity** in databases (option values, the Tags database,
   migration columns) where ids exist.
10. **Tests are thorough on happy paths, thin on boundaries**: no
    adversarial markdown round-trip, no load-with-unknown-node, no archive of a
    database, database SQL mocked with regexes, nothing for templates or the
    page header; 19 stale e2e tests.

## Against Notion

Present: pages and nesting, slash menu (29 blocks), toggles and toggle
headings, to-do, callout, quote, divider, code, tables, columns, block and
inline math, table of contents, bookmark, video, audio, file, page cards,
favorites, recent, trash, templates, breadcrumbs, full width / small text /
fonts (richer than Notion), lock, version history, Markdown and PDF export,
databases with table and board views, row pages, AI chat that edits pages.

Missing or weaker, by how much it matters:

- **Linking**: @-mentions, link-to-page, backlinks (no code at all),
  Copy link to block, Move to.
- **Databases**: only 8 property types (no status, person, files, relation,
  rollup, formula, created/edited as columns, email, phone); only table and
  board (no list, gallery, calendar, timeline); filters without typed operators,
  OR, groups or editing; no inline database, linked views, templates, CSV
  import/export, calculations, row reorder or property type change.
- **Blocks**: synced blocks, buttons, generic embeds (video allows only
  YouTube and Vimeo), image captions and alignment, children under any block,
  code language picker and copy button, emoji callout icons, comments.
- **Editing**: Ctrl+K link, turn-into shortcuts for toggle/callout, markdown
  paste, paste-URL choice, Ctrl-click multi-select, slash aliases ("/h1"),
  inline "/" mid-line, action-menu search.
- **Import/export**: no Notion, Markdown, HTML or CSV import; no workspace or
  page-tree export with assets.
- **AI**: no in-place AI blocks or continue/summarize, no database autofill,
  inline AI is plain text only.
- **Sidebar**: content search in quick find, favorite reordering, keyboard
  tree navigation, open to the side.

## Block operations sweep, 2026-10-03

Every block against every structural operation, on the app's own editor
(`tests/unit/canvasBlockMatrix.test.ts`, harness in
`canvasMatrixHarness.ts`). After each operation the test checks that the doc is
schema-valid, that no layout has fewer than 2 columns and no two blocks share
an id, that every character, equation, image, table cell and atom block is
still there exactly once, and that undo restores the doc exactly.

- **Turn into:** 15 source shapes (text, headings, code, quote, callout,
  toggle, toggle heading, equation, list rows at three depths) × 14 targets ×
  6 places (page, column, nested column, callout, toggle, inside a list row):
  1,260 conversions.
- **Drag and drop:** 29 blocks dragged from 6 places (page, column, the only
  block of a column, nested column, callout, beside an empty table) onto 15
  targets in all four zones, moved and Alt-copied: 15,244 drops.
- **Keyboard:** Mod-Shift-↑/↓ through real key events until the block stops,
  for every block in 9 places: about 3,250 presses.
- **Editing keys:** Tab, Shift-Tab, Backspace at a block's start (once and
  twice), Delete at its end (once and twice), Enter and Mod-d, for every block
  in 10 places: 2,000 cases.

The first runs, on the code as it was, found the following. Each is fixed, and
each has a named test besides the sweeps.

**Turn into**
- To Code or Equation, a container or list row took the text of the whole
  subtree, then emitted the children again: text appeared twice. Line breaks
  and inline equations were dropped. Now the target takes the block's own line
  (breaks kept, an inline equation as `$…$`, or bare LaTeX in an equation),
  and the children follow it. Code back into text turns lines into line
  breaks.
- Text with a line break or an inline equation into a Toggle threw (the
  toggle title holds plain text only). The title now gets text in their place.
- A list row into Columns threw (C-high). The row, keeping its list type, now
  goes into the first column, in place.
- When Columns could not be made, the conversion fell through and wrote a
  layout holding inline text.

**Moving into, out of and between columns**
- An empty table, callout, toggle, list or heading counted as an "empty
  column". So moving or dragging the last other block out of a column deleted
  it, column and all. Now only empty paragraphs make a column empty.
- Dragging a block out of a column that still had content deleted the
  *other*, empty column of a 2-column layout and dissolved the layout (a
  "fallback" in `deleteDraggedSource`).
- A column-boundary move reset the widths of every layout on the page. So did
  multi-block delete.
- Dragging list rows beside a block threw (a column of bare rows is invalid).
  Rows now land in a list of the type they came from, and so do rows dragged
  with other blocks (they used to become bullets).
- Creating a column never checked what it held. It now uses checked creation,
  and refuses rather than writing an invalid layout.
- A non-contiguous multi-block drag deleted everything between the selected
  blocks (C9). Each block now carries its own range. A selected row together
  with its own nested row was dragged twice; now it is dragged once.

**Keyboard moves**
- In the app the key never reached the block mover: a higher-priority handler
  turned the caret into a block selection and ran a sibling swap. That swap
  stops at every list, container and column edge (the "does nothing" bug).
  The caret now uses the mover. A single selected block moves the same way
  and stays selected.
- After a move the caret landed in the *next* block (a mapping that pointed
  past the moved block). The next press moved the wrong block, or threw at the
  end of the page.
- Equations, images, dividers and other blocks selected as a whole never
  moved.
- The first or last row of a list moved into a new one-row list right beside
  its old list, which the join plugin merged straight back. Now it swaps with
  the block past the list. A nested row at the edge of its sub-list steps out
  to the parent list.
- A block at the top or bottom of a callout, quote or toggle now steps out of
  it, and the container keeps an empty paragraph.
- A block selection outlived the caret moving away from it (arrow keys).
  Ctrl+D, Delete and Mod-Shift-↑/↓ then acted on the old block. Moving the
  caret out of the selected blocks now ends the selection. Seen in the app,
  then fixed and checked there.
- Shift-Tab on a block directly in a column skipped past the column. It lifted
  the block out of the layout and out of whatever held the layout.

**Ids and page cards**
- Alt-drag, Duplicate and every other copy kept the original's block id.
  (Tiptap's UniqueID only compares ids inside the changed range.) Block ids
  address blocks for the AI tools and the cross-page move. A plugin now gives
  copies fresh ids, and the block already on the page keeps its own.
  Concept maps had no id at all; they have one now.
- A copied page card pointed a second card at the same page. Deleting either
  card archived the page the other still showed. A copy of a card is now
  dropped.

**Cross-page move** (drop onto a page card)
- The source page was saved with blocks cut out of its JSON by hand. A column,
  callout or list left with nothing in it was stored schema-invalid. The
  stored source is now the editor's own deletion.
- When the copy to the other page failed, the source was deleted anyway. Now
  the source stays.
- List rows arrived at the other page bare, not in a list.
- With two blocks sharing an id, both were deleted. Now only the one nearest
  the drag is deleted.

**Editing keys**
- Backspace at the start of a toggle heading's title could not join backward,
  so ProseMirror selected the whole block above; a second Backspace deleted
  it. The toggle heading now becomes a plain heading with its body below
  (Notion), and the next Backspace is an ordinary join.

**Known and left**
- A row of a list that fills a callout inside a column cannot move past the
  list's outer edge by keyboard. It would have to leave the list and the
  callout at once. It stays put; nothing is lost.

## What to do first

1. **Stop the data loss (one focused pass).** C1 (validated load with a
   placeholder for unknown blocks; never save over a page that failed to
   load), C2 (archive is not delete for databases), C3 (restore re-roots a
   child; guard permanent delete), C4 (caret after atom inserts), C5 (sync or
   forbid split panes on one page), C6/C7 (quarantine instead of
   overwrite/delete), C9, C10, C11, C14, C15. Each with a test that fails
   first.
2. **Fix the visibly broken.** Add Cover, Save as Template, blank-page
   template, toggle headings, keyboard focus after handles/drag, Mod-Shift
   move, drop indicator, slash in code blocks, Turn Into Columns on a list.
3. **One write door and one validated boundary** (architecture 1 and 2): all
   writes through the service, `check()` before every persist.
4. **Markdown that does not lie**: escaping export, `$` rules, every block
   either round-trips or is carried losslessly; a JSON/block format for AI;
   one shared document-to-text utility for search and AI reading.
5. **Repair the e2e suite** (hidden panes, renamed menu, Recent duplicates) so
   it guards the work above.
6. **Then grow toward Notion**: mentions and backlinks, database property
   types and views, sidebar keyboard and quick find, design-system pass
   (kit components, one token namespace, copy).

Evidence (probes, logs, screenshots) was kept in the cloud session's scratchpad, which does not outlive the session:
`canvasrun/` (app run, 73 screenshots), `probe/`, `vt/`, `rt/`, `storage/`,
`trash.py`, `vm.ts`.

## Canvas e2e suites, 2026-10-04

The canvas e2e suites could not run: the shared fixture opened a second page
after the new page had opened itself, so every `.tiptap` locator matched two
editors; `12-columns` never passed `workspacePath`; the table menu also
carries `.block-action-menu`. With the fixture closing earlier editors and
the selectors scoped, and stale expectations updated to deliberate later
rules (row-scoped Mod-Shift-Arrow in tables, no Turn into for leaf blocks,
no guide for a no-op drop, Title Case color labels, the left column strip
needing a sideways move):

| Suite | Result |
|---|---|
| 11-block-handles | 31 / 31 |
| 12-columns | 51 / 52 (the right-click Paste path in the bookmark popup fails the same way on the build before 2026-10-03; Ctrl+V works) |
| 13-column-drag-drop | 6 / 6 |
| 14-column-integration | 1 / 1 |
| 19-canvas-journey | 1 / 1 |
| 20-cross-page-diagnostic | passes; the page switch in it is timing-sensitive (1 of 2 runs) |
| 33-canvas-slash-diagnostic | 3 / 3 |
| 21-page-block-lifecycle | 1 / 1 (its editor lookups scoped to the visible pane; it failed after `09` left editors open) |
| 09-canvas | 2 / 7, the same on the build before the write-door change; not yet repaired |
| 93-canvas-close-persist | 0 / 1, the same on the build before the write-door change; not yet repaired |

Noticed while probing, not yet looked into: right-clicking a page in the
sidebar's Recent list opens the chat's context menu, not the page menu.
