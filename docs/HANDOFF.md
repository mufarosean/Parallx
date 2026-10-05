# Handoff: where the work stands

Last updated 2026-10-05, night. Branches: `dev` (app work) and
`exam7-campaign` (the owner's study campaign work), both pushed; `master`
was fast-forwarded to `2e1e8719` when `dev` started. Working tree clean.
tsc, the full vitest suite (7621 tests) and `npm run build` pass.

Read `CLAUDE.md` first: git rules, the first principle (the app is only
what the user turned on), house rules, copy rules, checks.

## Done on 2026-10-05, cloud: the Creations character generator

Six changes the owner asked for after a week of use, each its own commit
with tests; design and reasons in `docs/CREATIONS_AI.md`, "Characters that
are not alone". In short: the card is the start of a story and the chat's
memory is its present (the prompt says so; the Timeline's tail rides with
the memory); a Dialogue rules setting (Settings, shipped default, Reset To
Default) replaces the hand-typed standing note; a supporting cast of people
who never take a turn (Chat Settings › Supporting cast); Pitch Ideas before
the sheet; example dialogue drawn from the character's own sheet; a shipped
Character Seeds table (`tables/character-seeds.txt`, the user's to edit)
behind Surprise Me and the dice; Make one of their people from a
Relationships line. Prompt assembly changed in three places (Cast and
memory wording, How People Talk, Supporting Cast); history retention is
untouched (`creationsReplyRoom.test.ts`). Tests: `creationsGrowthAndDialogue`,
`creationsSupportingCast`, and additions to the Studio core and pane,
Tables and Story suites.

## Done on 2026-10-05, cloud, late: review without a quiz

The owner wanted to go back over problems he has done, filtered as he
likes, without a quiz. The Problem Bank now has a Done chip (the opposite
of Incomplete) and a Review These action over whatever the filters show.
It opens a Review tab (`createReviewPane`, instance `review`): Previous and
Next over the list, each step the problem's own sheet as he left it, with
the solution revealed from the start (`createSheetPane(…, { revealed })`).
Nothing is scored or recorded; rating, starring and the note stay on the
sheet because they are his tracking, and an edit still counts as work.
The bank's filter logic moved to `bankFilters.ts` (pure, tested in
`worksheetBankFilters.test.ts`). Its search now takes words: every word
must appear somewhere (title, sheet, question, paper name, tags, note), in
any order; a quoted phrase matches whole; a leading minus excludes
(`brosius credibility -essay`). It was one substring before, so two words
apart in the text found nothing.

## Done on 2026-10-05, cloud, late: the assistant always browses privately

The owner's rule: anything that uses the browser on its own uses it in
private mode. Both automatic uses now do.

- **The Assistant Browser** (`browserOpen` and the rest): every assistant tab
  is a private session, the chat's own in-memory partition, wiped with its
  last tab; `createTab` in `browserAutomationBroker.cjs` makes nothing else,
  and the tool spec in `ext/browser/main.js` no longer offers a `private`
  flag (a flag passed anyway changes nothing). Captures therefore live in
  memory only and go when their tab closes; downloads sit in the run's
  `private-downloads` folder and are erased when the session ends unless
  saved with save_download. The on-disk erase machinery stays for files
  older versions left. `docs/BROWSER.md`, "Two partitions", says so. Tests
  rewritten in `browserAutomationBrokerRuntime.test.ts` ("private sessions",
  "erasing what the assistant kept", "downloads", "artifacts") and
  `browserAutomationService.test.ts`.
- **The browser-engine fetch** (`electron/browserFetch.cjs`) was private from
  the start: an in-memory partition per read, cleared after.

## Done on 2026-10-05, cloud, late: Web Research that works, and the browser engine

The owner said the web tools "do not work half the time". The review found
one serious defect and three smaller ones, all fixed, and added the browser
engine as the way past bot walls.

- **The chat never seeded the links the user typed.** webFetch only takes an
  address in the turn's provenance set (the user's message, a search result,
  a redirect). The seeding function was called only by the Studio, never by
  the chat, so "read this link" was refused every time and only search then
  fetch worked. Now `ChatService.onDidStartRequest` fires as a turn begins
  (`{ sessionId, turnId, text }`, before the participant runs; `IChatService`
  carries it, `chatServiceCompletion.test.ts`) and Web Research subscribes
  (`_wireChatTurns`, via `api.services.get({ id: 'IChatService' })`): it
  seeds the turn from the text and, on `onDidCompleteRequest`, forgets the
  turn here and in the bridge's backstop counter. URLs are lexed from prose
  by `lexUrls`: trailing punctuation is not theirs, a closing bracket is
  only when they opened one.
- **Two caps disagreed.** The bridge's per-turn backstop was 5 while the
  setting and the tool text said 20; the sixth fetch failed. The backstop is
  60, a ceiling above any setting; the skill text names the settings.
- **Searches are paced.** Brave allows a query a second; searches now run one
  at a time a second apart, and a 429 is tried once more (`_pacedSearch`;
  `_setBridge` zeroes the pacing for tests).
- **Pages decode in their own charset** (`decodeBody`: Content-Type, then
  `<meta charset>`, then UTF-8).
- **The browser engine, for refused pages.** `electron/browserFetch.cjs`
  loads the page in a hidden `BrowserWindow` on an in-memory partition with
  Electron's own user agent (a Chrome UA with no client hints breaks the
  challenge, as the assistant browser learned), waits a JavaScript challenge
  out (two rounds within a 25 s budget), and returns the document's HTML for
  the same sanitizer. Every rule of the plain fetch holds for the page and
  for all it loads: https only, the blocklist, the DNS preflight on every
  main-frame navigation, private addresses refused by form on subresources,
  no downloads, popups or permissions, the session wiped after. Reached as
  `webFetch:browserRequest` on the Web Research bridge (lazy, listed in
  `OPTIONAL_BRIDGE_CHANNELS`). `webFetchTool` takes it when the plain fetch
  is refused (401, 403, 429, 5xx; never a 404) and the setting
  `webResearch.browserFallback` ("Read Refused Pages With The Browser
  Engine", on by default) allows; the Studio's Add Link gets it through
  `fetchReadableForExtension`. A check that needs a human (the "verify you
  are human" box) cannot pass hidden: when a person is present (a turn the
  user typed, carried as `origin` undefined on `onDidStartRequest`, or Add
  Link) the window is shown with the title "Parallx: finish this site's
  check to continue", the user ticks the box, the site reloads into the
  page and the read goes on (up to 3 minutes); an autonomous turn
  (heartbeat, cron) never shows a window and fails with a message. Tests:
  `browserFetch.test.ts` (fake Electron), `webFetchBridge`,
  `webResearchProvenance`, `optionalBridgesLazy`.

## Done on 2026-10-05, cloud, late: Add Link said "Could Not Fetch" and no more

The owner's Add Link in the Character Studio failed with no reason shown.
Three causes, all fixed in `ext/web-research/main.js` and `studio.js`:

- `fetchReadableForExtension` read `error.code` off a soft error that
  carries `errorCode` and a prefixed `content`, so every failure became a
  bare "fetch failed". It now returns the code and the reason.
- The URL was lexed out of its own text with the chat's regex, which stops
  at `)` and `]`; a wiki address such as `/wiki/Name_(character)` was cut
  short, failed provenance and was refused. The exact URL is now seeded.
- An HTTP error page (403 from a site that blocks non-browsers, a 404) was
  returned as the page. `webFetchTool` now refuses status 400 and up with
  a message in words (`HTTP_<status>`), for the chat tool too.

The Studio shows the reason under the source row and on the chip. Tests:
`webResearchProvenance` (fetchReadableForExtension), `creationsStudioPane`.
Sites behind a bot wall refused the plain fetch; since the same night the
browser engine reads those (the section above).

## Done on 2026-10-05, local: the Exam 7 campaign

The owner sits CAS Exam 7 on 2026-10-27. His plan for the last three weeks
is recorded in Claude's memory in his words; the plan file is
`Syllabus and Planning/Final Weeks Plan.json` in his October workspace,
generated by `.claude/scratch-final-weeks-plan.py` (git-ignored).

- **Worksheets, the Campaign tab** (`src/built-in/worksheet/plan.ts`,
  `planPane.ts`, migration 015, tests `worksheetPlan.test.ts`). A plan is
  imported JSON: days of blocks in clock order. Block kinds: `quiz` (drawn
  once from named pools `starred-hard`, `starred-medium`, `starred-easy`,
  `starred`, `hard`, `easy-medium`, `new`; the draw is saved and never
  reshuffles), `exam` (the paper's questions in order as a quiz session,
  with a clock in the quiz bar; done when the session finishes), `session`
  (another tool's command; done when the activity journal shows the verb
  and object the block names, or Mark Done). Streak, XP, levels
  (campaign.ts's level table), plan rewards (`plan:*` ids in ws_reward).
  Commands `worksheet.plan`, `worksheet.importPlan(path?)`; sidebar and
  Home carry Campaign.
- **No grading.** The owner tracks by rating (Reveal and Rate) and stars,
  and knows when he misses. The grading pane, the exam score, the `grade`
  block kind and the `misses` pool shipped on 10-05 and were removed the
  same night at his word (cloud, after the local session). An older plan
  file still imports: `grade` blocks are left out and a `misses` entry in a
  pool list is dropped (a quiz whose every pool is gone is an error). The
  `ws_exam_grade` table stays in migration 015, unused. Plan rewards are
  now the eight that need no grade; `plan:graded-same-day`,
  `plan:misses-redone` and `plan:all-graded` are gone (an unlock row for
  one of them is simply never shown).
- **Practice exams** import as their own paper (`pe1`, source `exam`, the
  reading as a `reading:` tag); each question carries `points` from the
  point sheet; a re-import fills blank points on existing rows. The old
  campaign and the dashboard arithmetic count Rising Fellow and CAS
  problems only (`isWorkbookProblem`); the last campaign day asks only for
  what is left, so finishing everything closes it as full.
- **The custom bank** (136 generated problems) was rewritten into the RF
  layout (solution to the right under "Solution ->", formulas re-pointed)
  by `.claude/scratch-bank-rf-layout.py` and imported, as were PE1 to
  PE3. Bank: rf 221, cas 110, exam 92, custom 136.
- **Flashcards**: `flashcards.studyTag(tag)`; finished sessions reach the
  journal as `finished` + `flashcards session due` or
  `flashcards session #<tag>`; concept, list, comparison, steps,
  reading-results and essay-practice cards take typed answers by default
  (`fcDefaultRecallMode`); `flashcards.reclassifyByType` switched the 370
  existing ones.
- **Seeding** his workspace is done by hidden app instances
  (`.claude/scratch-seed-campaign.mjs`, `.claude/scratch-exam-import.mjs`)
  with the app closed and indexing off for the run (an ai-config override
  created and removed). Never a visible launch, never a direct write.
- The core-tool mention ratchet keys files with forward slashes; on
  Windows it read 0 for every file and failed.

## Done on 2026-10-05, cloud: chat citations that land on the spot

The owner's study chat gave "Source:" links that did not open, called them
"validated", then gave page numbers that were one off. All app causes are
fixed:

- **Links use workspace paths.** `parallx://explorer/file?path=<path>` takes
  the workspace-relative path the file tools show, resolved against the open
  workspace when used (`src/built-in/explorer/fileLink.ts`).
- **`link_create` checks the target.** Link kinds can implement `verify`
  (`LinkKindHandler.verify`, `LinkResolverService.verify`,
  `api.links.verify`): the explorer's finds the quote and sets the page
  (PDF), line (text) or sheet and cell (spreadsheet), and returns
  `checked` and `location`.
- **Where a quote is:** `src/services/quoteLocator.ts` and
  `fileLocator.ts`; exposed as `fileService.locateInFile` /
  `readPdfPages` and `api.workspace.fs.locate`.
- **Page numbers the AI cannot misread.** `fs_read_file` returns a PDF page
  by page, each starting `===== Page N of M =====`; grep on a PDF reports
  pages; retrieved context carries "page N of M".
- **Opening at the spot.** `api.editors.openFileEditor(uri, { reveal })`
  (`src/editor/fileReveal.ts`); the pane takes the reveal after layout.
- **The spreadsheet viewer shows the workbook's own row numbers and column
  letters.** Dead links show as dead. The prompt's Linking section says to
  make every citation with `link_create` and cite the location it returns.

Tests: `quoteLocator`, `fileLocator`, `explorerFileLink`, `parallxLinkTool`,
`linkResolverService`, `fileReveal`, `fileToolsPdfPages`, `citationReveal`,
`spreadsheetReadingRows`, `retrievalService`.

## Waiting on the owner

- Creations, after a pull and rebuild: a chat with a supporting person
  added, a Pitch Ideas run, Roll The Dice, and dialogue under the shipped
  rules. Watch for: the model giving a supporting person a whole turn (the
  contract says a line or two); pitches too alike; a model that returns no
  JSON for pitches (the error says so; Try Again). The Settings field
  "Dialogue rules" is where to tune the wording.
- Eyes on the Campaign tab (Worksheets › Campaign) after a pull, rebuild
  and restart: the Today card, Start the Clock on the exam block, the day
  strip, the pools, the rewards. His verdict on the Hard and Medium focus
  days and the XP values in the plan file.
- His plan file (`Final Weeks Plan.json`, from the git-ignored script)
  still holds `grade` blocks and `misses` pools from the first version.
  They import harmlessly (left out, dropped), but the script and the file
  are his to simplify; after an edit, `worksheet.importPlan` again.
- Exam 1 is Tue Oct 6, 5:30: Start the Clock opens the 30 questions as a
  quiz with a 4 hour clock; the block is done when the session finishes.
  Reveal and Rate per question is the whole of the marking.
- Web Research, after a pull and rebuild: in chat, "read <a link you type>"
  should fetch it (it never could before); the link that gave a 403 should
  come through the browser engine (slower, a few seconds); if it shows a
  window asking to finish the site's check, tick the box and wait; a search
  twice in one reply should not 429. The Settings switch "Read Refused Pages With The
  Browser Engine" turns the fallback off.
- Review These: filter the bank to "Brosius" plus Done, Review These, step
  with Next. The sheet should show the work and the solution together; a
  rating given there counts as any rating does.
- Chat citations: try them in a study chat; each link should open the file
  at the cited page with the quote highlighted. His workspace memory lesson
  `source-links-clickable` hard-codes a base folder and is no longer
  needed; he edits it (it lives in his workspace).

## Lessons to keep

- Do not change what the roleplay model sees (prompt assembly, history
  trimming) without checking history retention; `b7fad86b` was reverted
  for breaking continuity (`tests/unit/creationsReplyRoom.test.ts` guards
  it). Confirm with the owner before touching it.
- A citation's page, line or cell comes from the file (`locateInFile`),
  never from arithmetic. A tool that says "validated" must have checked.
- Answer "why" questions directly: name the line and who set the value.
- The owner asked for the custom bank in the RF layout on 2026-09-22; a
  different approach shipped on 09-24 without his agreement. Never swap an
  approach silently; say so and ask.
- Worksheets' optional dependency on Flashcards is by command existence and
  journal lines named in plan data, never by code reading its tables.
- The Campaign tab is "open the app, see what to work on". The owner
  asked for no grading, no miss counts, no scoring; a feature he did not
  ask for is removed, not refined. Ask before adding a workflow.

## Context window (Creations roleplay): settled

- Tested by the owner, works. No cap, no change to what Auto resolves to.
  Auto's "model length" is the provider's estimate (`_extractContextLength`
  in `ollamaProvider.ts`); a slow model is answered by picking a size in Ctx.

## Cloud setup

- `npm ci` in a cloud container: set `ONNXRUNTIME_NODE_INSTALL=skip`
  (its download resets through the proxy). Do not skip Electron's binary:
  `optionalBridgesLazy.test.ts` requires `electron` and fails without it.
- Hidden probes on the owner's machine: `PARALLX_HIDDEN_PROBE=1`,
  `PARALLX_TEST_MODE=1`, own `PARALLX_APP_ROOT`; never a visible launch.

## Open, not started

- A plan editor in the app; today the plan is a JSON file.
- Parked by the owner: canvas date-property time zone (in the audit doc).
- Blocks 8: AI block, agent output block, dashboard widget block, budget
  block, runnable snippet.
- S3: persistent agents research and design proposal.
- D: toward Notion (mentions/backlinks, property types, CSV import).
- Story Writer (`story.js`) and Studio (`studio.js`) send no `num_ctx` when
  no size is picked; they could use the same resolver as the chat.
- Word and EPUB citations can only confirm a quote is in the file (no pages
  or lines); the link opens the file.
