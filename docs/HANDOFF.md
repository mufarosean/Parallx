# Handoff: where the work stands

Last updated 2026-10-05. Branch `dev` (the working branch; `master` was
fast-forwarded to `2e1e8719` when `dev` started). Working tree clean,
everything pushed. tsc, the full vitest suite (7543 tests) and
`npm run build` all pass.

Read `CLAUDE.md` first: git rules, the first principle (the app is only
what the user turned on), house rules, copy rules, checks.

## Done in the last session: chat citations that land on the spot

The owner's study chat gave "Source:" links that did not open, called them
"validated", then gave page numbers that were one off. All app causes are
fixed:

- **Links use workspace paths.** `parallx://explorer/file?path=<path>` takes
  the workspace-relative path the file tools show, resolved against the open
  workspace when used (`src/built-in/explorer/fileLink.ts`). The template's
  examples used to be a developer's `D:/AI/Parallx/...`, which the AI copied.
  Absolute paths and `uri=file:///…` still open.
- **`link_create` checks the target.** Link kinds can implement `verify`
  (`LinkKindHandler.verify`, `LinkResolverService.verify`,
  `api.links.verify`). The explorer's checks the file exists; thorough, it
  finds the quote and sets the page (PDF), line (text) or sheet and cell
  (spreadsheet) from where the words are, and returns `checked` (what was
  confirmed) and `location` (e.g. "page 13 of 30"). Before, `ok: true`
  meant only "shaped like a link". `params` is encoded by the tool.
- **Where a quote is:** `src/services/quoteLocator.ts` (matching on letters
  and digits only, so case, spacing, line-end hyphens, quote styles,
  ligatures and math letters do not matter) and `fileLocator.ts` (reads a
  file's pages, lines or cells; cached per file until it changes). Exposed
  as `fileService.locateInFile` / `readPdfPages` and `api.workspace.fs.locate`.
- **Page numbers the AI cannot misread.** pdf-parse marked each page break
  AFTER the page (`-- 13 of 30 --`), read as a heading for what follows:
  every page came out one low. Now `fs_read_file` returns a PDF page by
  page, each page starting with `===== Page N of M =====`, with
  `start_page`/`end_page`; `fs_grep_search` on a PDF reports pages, not
  lines; knowledge search results and retrieved context from a PDF carry
  "page N of M". The page is the PDF's own (1 = first page of the file),
  which the viewer shows and a link's `page` takes, not the printed one.
- **Opening at the spot.** `api.editors.openFileEditor(uri, { reveal })`
  files the spot (`src/editor/fileReveal.ts`); the editor group calls
  `pane.didShow()` after layout and view-state restore, and the pane takes
  it then: PDF page and quote (only once its pages are laid out; the old
  100 ms timer dropped the page on a fresh open), text and code editor
  lines, spreadsheet sheet and cell. A link with a quote opens where the
  words are even if its page is wrong.
- **The spreadsheet viewer shows the workbook's own row numbers and column
  letters** (blank rows kept, used range offset), so a cited C180 is the
  C180 on screen. The AI's spreadsheet text says its lines are not rows.
- **Dead links show as dead.** Chat marks a `parallx://` link whose target
  is gone (struck through, title says why); clicking a link that fails
  shows why instead of doing nothing.
- **Prompt.** The Linking section says to make every citation with
  `link_create`, cite the `location` it returns, never write a page, line
  or row a tool did not give, and keep linking when one link fails.

Tests: `quoteLocator`, `fileLocator`, `explorerFileLink` (including the
`D:\AI\Parallx` path from the session), `parallxLinkTool`,
`linkResolverService`, `fileReveal`, `fileToolsPdfPages`, `citationReveal`,
`spreadsheetReadingRows`, `retrievalService`.

## Waiting on the owner

- Try it in a study chat after pulling and rebuilding: ask for sources and
  click them. Expected: each link opens the file at the cited page and
  highlights the quote; the reply cites the page link_create returned.
- The owner's workspace memory lesson `source-links-clickable` hard-codes a
  base folder (`C:\Users\…\Exam 7 - October 2026\`). It is no longer
  needed and would break links again if the folder moves. Suggested
  replacement: "Every Source: line is a link made with link_create, with
  the quoted words; cite the page it returns." It lives in the owner's
  workspace, not the repo, so the owner edits it (or asks the AI to).

## Context window (Creations roleplay): settled

- Tested by the owner, works (qwen 3.8 27B at 64K, picked in Ctx). No cap,
  no change to what Auto resolves to.
- Auto's "model length" is the provider's estimate (`_extractContextLength`
  in `ollamaProvider.ts`: the larger of the file's `context_length` and a
  RoPE-based guess, capped at 256K), e.g. 128K for qwen3:8b. Known and
  accepted; a slow model is answered by picking a size in Ctx.

## Cloud setup

- `npm ci` in a cloud container: set `ONNXRUNTIME_NODE_INSTALL=skip`
  (its download resets through the proxy). Do not skip Electron's binary:
  `optionalBridgesLazy.test.ts` requires `electron` and fails without it.

## Lessons to keep

- Do not change what the roleplay model sees (prompt assembly, history
  trimming) without checking history retention. A "reply reserve" that
  dropped old history broke continuity and was reverted (`b7fad86b`);
  `tests/unit/creationsReplyRoom.test.ts` guards it. Confirm with the
  owner before touching roleplay prompt assembly again.
- A citation's page, line or cell comes from the file (`locateInFile`),
  never from arithmetic. A tool that says "validated" must have checked.
- Answer "why" questions directly: name the line and who set the value.

## Open, not started

- The owner has more pressing chat work queued after linking; ask what is
  next.
- Parked by the owner: canvas date-property time zone (in the audit doc).
- Blocks 8: AI block, agent output block, dashboard widget block, budget
  block, runnable snippet.
- S3: persistent agents research and design proposal.
- D: toward Notion (mentions/backlinks, property types, CSV import).
- Story Writer (`story.js`) and Studio (`studio.js`) send no `num_ctx` when
  no size is picked; they could use the same resolver as the chat.
- Word and EPUB citations can only confirm a quote is in the file (no pages
  or lines); the link opens the file.
