# Study: build specification

The contract every part of the Study build is written against. The design
is `docs/STUDY_MODES_BRIEF.md` (what and why) and `docs/mockups/study.html`
(every screen, the motion table, the copy). This file is the how: file
layout, schema, the function contracts between sections, the core seams,
and the tests. Written 2026-10-07 for a parallel build; parts are written
by different hands at the same time, so a name here is a promise.

## 0. Conventions

- Extension id `parallx-community.study`, display name **Study**, prefix
  `st` on every function and `st_` on every table, CSS class prefix `st-`.
- `ext/study/main.js` is **generated**: the concatenation, in filename
  order, of `ext/study/src/*.js`. `node scripts/bundle-study.mjs` writes
  it; `tests/unit/studyBundle.test.ts` fails when it is stale. The parts
  are plain top-level JavaScript sharing one module scope: no `import`, no
  `export` except in `90-activate.js`, which exports `activate`,
  `deactivate` and `__testables`. A part may call any function another
  part defines; function declarations hoist, `const` does not, so a part
  never runs code at load time beyond declaring things (no top-level calls
  that touch another part's `const`).
- Plain ESM JavaScript, no TypeScript syntax, no `require`, no imports from
  `src/`. The only surface is the `api` argument. Everything in
  `docs/PARALLX_EXTENSION_AUTHORING_FOR_AI.md` §6 and §7 applies; the ratchet
  (`tests/unit/extStyleRatchet.test.ts`) starts Study at zero: no hex or
  `rgb(<digit>` colours, no px font sizes, no uppercase, no emoji, no
  `confirm(`, no `<select>`. `rgba(var(--px-green-rgb), .12)` is allowed
  (no digit after the paren). Copy rules: Title Case for actions and
  titles, sentence case elsewhere, no em dashes in labels, `…` when an
  action opens a dialog.
- Chrome comes from the kit: `api.ui.createButton`, `createIconButton`,
  `createPageHeader`, `createEmptyState`, `createSectionLabel`,
  `createFilterChip`, `createSegmented`, `createDropdown`, `showContextMenu`,
  `api.window.showConfirmModal`, `showQuickPick`, `showInputBox`. Icons by
  `api.icons.createIconHtml(id, size)`; `px-ai-mark` is the only AI icon.
- Pure logic lives in `10-model.js` and is exported through `__testables`
  so `tests/unit/study*.test.ts` can test it without a DOM or a model.
  Nothing in `10-model.js` touches `_api`, the DOM, `Date.now()` (take
  `now` as an argument) or the database.
- Every `api.*` registration's disposable goes on `context.subscriptions`.
  Study turned off leaves nothing running: no timers, no cron, no listeners.
- Reference implementation for every pattern not spelled out here is
  `ext/flashcards/main.js` (database wrapper, `electronBridge()`,
  `injectStyles()`, `fcStreamWithStall`, `fcExtractJsonArray`,
  `fcContextPlan`, `fcPickModel`, rubric grading, dashboard widget, links,
  chat tools, selection action, planner day loads). Copy the pattern,
  rename to `st`, and say in a comment that it is a copy and why.

## 0b. Shared helpers (`00-header.js`), the names every part may use

```
let _api = null;                 // set in activate
let _dbBridge = null;            // api.database
const db = { run(sql, params), get(sql, params) → row|null, all(sql, params) → rows }   // the Flashcards wrapper, errors thrown as Error('[ST-DB] …')
function electronBridge()        → globalThis.parallxElectron
function el(tag, className = '', text = '') → HTMLElement
function icon(id, size = 16)     → html string from _api.icons.createIconHtml, '' when unavailable
function cfg(key, fallback)      → _api.workspace.getConfiguration('study').get(key, fallback)
function stNow()                 → Date.now()
function stWorkspaceRoot()       → fsPath of workspaceFolders[0] or ''
function stFsPathOf(uriOrPath)   → fsPath (strip file://, decode)
function stUriOf(fsPath)         → 'file://…' string
function stTruncate(text, max)   → text cut with '…'
function stEsc(text)             → HTML-escaped text
const bus = { on(event, fn) → dispose, emit(event, detail) }   // events: 'data' (anything changed), 'route' (pane navigation), 'run' (generation progress {runId, …}), 'session' (session item answered)
function _emitDataChanged()      → bus.emit('data')
function onDataChanged(fn)       → bus.on('data', fn)
const ST_FORMATS = ['mc', 'short', 'essay', 'numeric', 'formula', 'cloze'];
const ST_TYPED = new Set(['short', 'essay', 'numeric', 'formula', 'cloze']);
const AGAIN = 1, HARD = 2, GOOD = 3, EASY = 4; const MIN = 60000, DAY = 86400000;
const ST_ICON_HTML = the px-study svg string (for openEditor iconHtml)
```

Orchestration, so the pane stays thin:

```
30-ai.js:   stEnsureBank(scope, { size, modelId, numCtx, token, onProgress }) → { kept, concepts }
               for each section in scope: concept map when unmapped; generate until every concept has
               questionsPerConcept of each applicable format; python decides whether numeric is applicable
            stNextDraw(session, { token, onProgress }) → StQuestion[]
               stEnsureBank when short, then stDrawSession excluding every question already in the session, stAddSessionItems
60-pane.js: stOpenPane(route) → opens or focuses the tab for the route (setup → instanceId 'setup'; session/results/review → 'session-<id>'; learn → 'learn-<materialId>-<sectionId>')
            stOpenSetup({ materialIds, sectionId?, pageFrom?, pageTo?, selectionText?, selectionPage? })
70-integration.js: stShowSource(question) → openFileEditor(uri, { reveal: { page, quote }, side: true }); for a provider question with open(), the provider's open
                   stSendMissedToFlashcards(session) → { count } ; stFlashcardsAvailable() → boolean
                   stStartSession({ scope, mode, answerFormat, model, numCtx }) → session, then stOpenPane({ view: 'generating' | 'session', sessionId })
50-sidebar.js: createSidebarView(container) → IDisposable
```

## 1. File layout

```
ext/study/
  parallx-manifest.json
  main.js                      generated, committed
  db/migrations/study_001_initial.sql
  src/
    00-header.js               header comment, db wrapper, electronBridge, el(), icon(), cfg(), bus
    10-model.js                pure logic (no api, no DOM, no db)
    20-data.js                 database access, materials and ingest, banks and providers, import parsers' IO
    30-ai.js                   prompts, generation pipeline, checks, grading, explain, numeric execution
    40-css.js                  injectStyles(): every st-* rule
    50-sidebar.js              the sidebar view
    60-pane.js                 the editor pane: setup, generation, session, results, learn, review
    70-integration.js          commands, selection action, providers, Flashcards hand-off, widget, links, chat tools, planner
    90-activate.js             activate, deactivate, __testables
scripts/bundle-study.mjs
tests/unit/studyBundle.test.ts
tests/unit/studyModel.test.ts          10-model
tests/unit/studyImport.test.ts         file and report parsers
tests/unit/studyPane.test.ts           jsdom: pane and sidebar against a fake api
tests/unit/editorTitleMenu.test.ts     core: the new menu location
tests/unit/questionProviders.test.ts   core: the provider seam
```

## 2. Manifest

```json
{
  "manifestVersion": 1,
  "id": "parallx-community.study",
  "name": "Study",
  "version": "0.1.0",
  "publisher": "parallx-community",
  "description": "Review dense material without rereading it: multiple-choice practice, typed and essay tests graded against the text, every question anchored to its page, and only what you missed sent to Flashcards.",
  "main": "main.js",
  "activationEvents": ["*"],
  "engines": { "parallx": "^0.1.0" },
  "contributes": {
    "icons": [{ "id": "px-study", "svg": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M4 19.5V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v13.5\"/><path d=\"M4 19.5A1.5 1.5 0 0 0 5.5 21H20\"/><path d=\"M9 9h6M9 13h4\"/></svg>" }],
    "commands": [
      { "id": "study.open", "title": "Open Study", "category": "Study" },
      { "id": "study.studyDocument", "title": "Study This Document…", "category": "Study" },
      { "id": "study.quizSelection", "title": "Quiz This Selection", "category": "Study" },
      { "id": "study.studyTogether", "title": "Study Materials Together…", "category": "Study" },
      { "id": "study.weakSpots", "title": "Study Weak Spots", "category": "Study" },
      { "id": "study.addMaterial", "title": "Add Material…", "category": "Study" },
      { "id": "study.importQuestions", "title": "Import Questions…", "category": "Study" },
      { "id": "study.importReport", "title": "Import Examiner's Report…", "category": "Study" }
    ],
    "viewContainers": [{ "id": "study-container", "title": "Study", "icon": "px-study", "location": "sidebar" }],
    "views": [{ "id": "study.materials", "name": "Materials", "defaultContainerId": "study-container" }],
    "editors": [{ "typeId": "study", "displayName": "Study" }],
    "menus": {
      "editor/title": [{ "command": "study.studyDocument", "when": "activeEditor == 'parallx.editor.pdf'" }],
      "viewContainer/title": [
        { "command": "study.addMaterial", "title": "Add Material…", "group": "1_actions", "when": "activeViewContainer == 'study-container'" },
        { "command": "study.importQuestions", "title": "Import Questions…", "group": "1_actions", "when": "activeViewContainer == 'study-container'" },
        { "command": "study.importReport", "title": "Import Examiner's Report…", "group": "1_actions", "when": "activeViewContainer == 'study-container'" }
      ]
    },
    "configuration": [{ "title": "Study", "properties": {
      "study.sessionSize":        { "type": "number",  "default": 20, "description": "Questions per session. Refresh draws the next set from the same scope." },
      "study.choices":            { "type": "number",  "default": 4,  "description": "Options per multiple-choice question: 4 or 5." },
      "study.questionsPerConcept":{ "type": "number",  "default": 2,  "description": "How many questions of each format a concept needs before generation considers it covered." },
      "study.answerFormat":       { "type": "string",  "default": "mixed", "description": "Default answer format for a new session: choose, type, or mixed. Mixed starts on choices and moves a concept to typing once it has been answered right." },
      "study.aiModel":            { "type": "string",  "default": "", "description": "Model id used to write and grade questions. Leave empty to use the chat's active model." },
      "study.generationContext":  { "type": "number",  "default": 0,  "description": "Context window (tokens) for generation and grading. 0 = auto: sized per run from the scope's length and the model's limit. A fixed value caps VRAM on a smaller machine." },
      "study.aiThinking":         { "type": "boolean", "default": false, "description": "Let reasoning models think before writing or grading. Slower; sometimes better on dense material." },
      "study.checkAnchor":        { "type": "boolean", "default": true, "description": "Drop a question whose quote is not on its page." },
      "study.checkSupport":       { "type": "boolean", "default": true, "description": "Drop a question whose quote, read alone, does not settle its answer." },
      "study.checkDistractors":   { "type": "boolean", "default": true, "description": "Drop a multiple-choice question when any wrong option could be defended as correct." },
      "study.checkNumeric":       { "type": "boolean", "default": true, "description": "Keep a numeric question only when its solution, run in Python, agrees with the stated answer. Needs the workspace Python environment." },
      "study.numericTolerance":   { "type": "number",  "default": 0.005, "description": "Relative tolerance for a numeric answer to count as right (0.005 = half a percent)." },
      "study.staleDays":          { "type": "number",  "default": 14, "description": "Days without an answer before a clean concept counts as stale." }
    }}]
  }
}
```

## 3. Database (`study_001_initial.sql`)

```sql
CREATE TABLE IF NOT EXISTS st_materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,                 -- pdf | canvas | bank
  uri TEXT NOT NULL,                  -- file URI or path for pdf; canvas page id; '' for a bank
  label TEXT NOT NULL,
  page_count INTEGER NOT NULL DEFAULT 0,
  content_hash TEXT NOT NULL DEFAULT '',
  outline_json TEXT NOT NULL DEFAULT '[]',   -- [{title, pageFrom, pageTo, level}]
  model TEXT NOT NULL DEFAULT '',            -- remembered per material
  context_setting INTEGER NOT NULL DEFAULT 0,
  answer_format TEXT NOT NULL DEFAULT '',    -- remembered per material; '' = setting
  created_at INTEGER NOT NULL,
  last_studied_at INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_st_materials_uri ON st_materials(kind, uri);

CREATE TABLE IF NOT EXISTS st_sections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  material_id INTEGER NOT NULL REFERENCES st_materials(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  page_from INTEGER NOT NULL,
  page_to INTEGER NOT NULL,
  ord INTEGER NOT NULL,
  mapped_at INTEGER NOT NULL DEFAULT 0       -- when the concept map for it was last built
);
CREATE INDEX IF NOT EXISTS idx_st_sections_material ON st_sections(material_id, ord);

CREATE TABLE IF NOT EXISTS st_concepts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  material_id INTEGER NOT NULL REFERENCES st_materials(id) ON DELETE CASCADE,
  section_id INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',          -- one sentence, as the text states it
  page INTEGER NOT NULL DEFAULT 0,
  anchor_quote TEXT NOT NULL DEFAULT '',
  ord INTEGER NOT NULL DEFAULT 0,
  mastery REAL NOT NULL DEFAULT 0,
  answers INTEGER NOT NULL DEFAULT 0,
  misses INTEGER NOT NULL DEFAULT 0,
  miss_streak INTEGER NOT NULL DEFAULT 0,
  right_choose_at INTEGER NOT NULL DEFAULT 0,  -- last right answer in choose format
  right_type_at INTEGER NOT NULL DEFAULT 0,    -- last right answer in type format
  last_answered_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_st_concepts_material ON st_concepts(material_id, section_id, ord);

CREATE TABLE IF NOT EXISTS st_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  material_id INTEGER NOT NULL DEFAULT 0,    -- 0 for a bank question not yet mapped
  concept_id INTEGER NOT NULL DEFAULT 0,
  format TEXT NOT NULL,                      -- mc | short | essay | numeric | formula | cloze
  stem TEXT NOT NULL,
  options_json TEXT NOT NULL DEFAULT '[]',   -- mc: ["...", ...]
  answer TEXT NOT NULL DEFAULT '',           -- mc: index as text; short/essay: model answer; numeric: value; formula: LaTeX; cloze: term
  explanation TEXT NOT NULL DEFAULT '',      -- one or two sentences grounded in the anchor
  rubric_json TEXT NOT NULL DEFAULT '[]',    -- [{text, required}]
  rubric_origin TEXT NOT NULL DEFAULT '',    -- source | answer | report
  contradictions_json TEXT NOT NULL DEFAULT '[]', -- statements that mark an answer wrong (report "common errors")
  numeric_json TEXT NOT NULL DEFAULT '',     -- {inputs, solutionPy, expected, units, tolerance, executed, agreed}
  source_page INTEGER NOT NULL DEFAULT 0,
  source_quote TEXT NOT NULL DEFAULT '',
  source_uri TEXT NOT NULL DEFAULT '',       -- the PDF, the report, or '' (then the material's uri)
  origin TEXT NOT NULL DEFAULT 'generated',  -- generated | exam | rising-fellow | imported | provider
  origin_label TEXT NOT NULL DEFAULT '',     -- "CAS Exam 7 · 2019 Fall · Q5(b)"
  provider_id TEXT NOT NULL DEFAULT '',
  provider_ref TEXT NOT NULL DEFAULT '',
  bank_id INTEGER NOT NULL DEFAULT 0,
  checks_json TEXT NOT NULL DEFAULT '{}',    -- {anchor, support, distractor, numeric}: true | false | null (not run)
  difficulty TEXT NOT NULL DEFAULT '',       -- easy | medium | hard
  hidden INTEGER NOT NULL DEFAULT 0,         -- thumbs down
  edited INTEGER NOT NULL DEFAULT 0,
  run_id INTEGER NOT NULL DEFAULT 0,
  model TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_st_questions_concept ON st_questions(concept_id, format, hidden);
CREATE INDEX IF NOT EXISTS idx_st_questions_material ON st_questions(material_id, hidden);

CREATE TABLE IF NOT EXISTS st_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  material_id INTEGER NOT NULL,
  section_id INTEGER NOT NULL DEFAULT 0,
  model TEXT NOT NULL DEFAULT '',
  num_ctx INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER NOT NULL,
  finished_at INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'running',    -- running | done | stopped | failed
  written INTEGER NOT NULL DEFAULT 0,
  kept INTEGER NOT NULL DEFAULT 0,
  dropped_json TEXT NOT NULL DEFAULT '{}',   -- {anchor: n, support: n, distractor: n, numeric: n, parse: n}
  error TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS st_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  scope_json TEXT NOT NULL,                  -- see §5 StScope
  mode TEXT NOT NULL,                        -- practice | test | learn | weak
  answer_format TEXT NOT NULL,               -- choose | type | mixed
  size INTEGER NOT NULL DEFAULT 20,
  model TEXT NOT NULL DEFAULT '',
  num_ctx INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER NOT NULL,
  finished_at INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,       -- index of the current item
  refreshes INTEGER NOT NULL DEFAULT 0,
  seconds INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS st_session_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES st_sessions(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL,
  draw INTEGER NOT NULL DEFAULT 0,           -- which refresh the item came in on
  ord INTEGER NOT NULL,
  format_used TEXT NOT NULL DEFAULT '',      -- mc | short | essay | numeric | formula | cloze (mixed resolves per item)
  status TEXT NOT NULL DEFAULT 'pending',    -- pending | right | wrong | skipped
  chosen TEXT NOT NULL DEFAULT '',
  typed TEXT NOT NULL DEFAULT '',
  verdict_json TEXT NOT NULL DEFAULT '',
  retried INTEGER NOT NULL DEFAULT 0,
  answered_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_st_session_items ON st_session_items(session_id, draw, ord);

CREATE TABLE IF NOT EXISTS st_answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id INTEGER NOT NULL,
  concept_id INTEGER NOT NULL DEFAULT 0,
  session_id INTEGER NOT NULL DEFAULT 0,
  format_used TEXT NOT NULL,
  correct INTEGER NOT NULL,                  -- 1 | 0
  rating INTEGER NOT NULL DEFAULT 0,         -- 1 Again | 2 Hard | 3 Good | 4 Easy, for typed; 1 or 3 for choose
  retried INTEGER NOT NULL DEFAULT 0,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_st_answers_concept ON st_answers(concept_id, at);

CREATE TABLE IF NOT EXISTS st_banks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,                        -- file | provider | report
  path TEXT NOT NULL DEFAULT '',
  provider_id TEXT NOT NULL DEFAULT '',
  exam TEXT NOT NULL DEFAULT '',             -- report: "CAS Exam 7"
  sitting TEXT NOT NULL DEFAULT '',          -- report: "2019 Fall"
  count INTEGER NOT NULL DEFAULT 0,
  imported_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS st_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  at INTEGER NOT NULL
);
```

## 4. The pure model (`10-model.js`), exported through `__testables`

Shapes (plain objects, camelCase; `20-data.js` maps rows to these):

```
StConcept  { id, materialId, sectionId, title, summary, page, anchorQuote, ord,
             mastery, answers, misses, missStreak, rightChooseAt, rightTypeAt, lastAnsweredAt }
StQuestion { id, materialId, conceptId, format, stem, options, answer, explanation,
             rubric: [{text, required}], rubricOrigin, contradictions: [], numeric: {...}|null,
             sourcePage, sourceQuote, sourceUri, origin, originLabel, providerId, providerRef,
             bankId, checks: {anchor, support, distractor, numeric}, difficulty, hidden, edited }
StScope    { kind: 'document'|'pages'|'chapter'|'selection'|'materials'|'weak'|'bank',
             materialIds: number[], sectionIds?: number[], pageFrom?, pageTo?,
             selectionText?, selectionPage?, bankIds?: number[], label: string }
StVerdict  { points: [{status: 'hit'|'partial'|'miss'}], contradiction: boolean, note: string }
```

Functions (signatures are the contract):

```
stConceptState(concept, now, { staleDays = 14 })        → 'unasked' | 'weak' | 'clean' | 'stale'
   answers == 0 → unasked; mastery < 0.6 → weak; now - lastAnsweredAt > staleDays d → stale; else clean.
stApplyAnswer(concept, { correct, rating, formatUsed, retried }, now)  → new concept (pure copy)
   target = rating 4|3 → 1, rating 2 → 0.5, else 0 (choose: correct → 1 else 0; a retried right is 0).
   alpha = typed formats (short, essay, formula, numeric, cloze) ? 0.5 : 0.35.
   mastery' = mastery + alpha * (target - mastery); answers+1; wrong → misses+1, missStreak+1 else missStreak = 0;
   right && !retried → rightChooseAt or rightTypeAt = now by format class.
stConceptIsCleanIn(concept, formatClass)                 → boolean  ('choose' → rightChooseAt > 0; 'type' → rightTypeAt > 0)
stFormatClass(format)                                    → 'choose' | 'type'
stResolveFormat(concept, question, answerFormat)         → the format this item is answered in
   choose → 'mc' when the question is mc, else the question's own; type → the question's own typed form
   (an mc question answered in type becomes 'short' using its answer text as the model answer);
   mixed → 'mc' until stConceptIsCleanIn(concept, 'choose'), then the typed form; essay and numeric always their own.
stDrawSession({ questions, concepts, size, exclude: Set<questionId>, answerFormat, now, rng }) → StQuestion[]
   Candidates: not hidden, not in exclude, concept in scope. Order of concepts: unasked, weak (lowest mastery
   first), stale, clean (oldest lastAnsweredAt first). Within a draw, round-robin across materialId so no two
   consecutive questions share a material when more than one has candidates. One question per concept per
   draw until every concept has one, then a second round. Prefer the format stResolveFormat picks for the
   concept. Deterministic given rng.
stCoverage(concepts, now, opts)                          → { total, clean, weak, unasked, stale, states: [] }
stSessionSummary(items, concepts)                        → { right, wrong, skipped, answered, missed: [{conceptId, questionId, note, secondMiss}] }
stContextPlan({ chars, outputTokens, modelCtx, setting })→ { numCtx, maxChars }  (port of fcContextPlan)
stChunkPages(pageTexts, { from, to, maxChars })          → [{ pageFrom, pageTo, text }]  whole pages, never split mid-page
stSkeleton(text)                                         → lower-cased letters and digits only (NFKC), like quoteLocator
stAnchorOnPage(quote, pageText)                          → { ok, similarity }  exact skeleton substring, else best window similarity ≥ 0.9
stFindAnchorPage(quote, pageTexts, hintPage)             → page number or 0 (hint page first, then ±2, then all)
stHeadingsFromPages(pageTexts)                           → [{ title, pageFrom, pageTo, level }]  numbered-heading heuristic ("3. Title", "3.1 Title", "Chapter 3"), fallback: every 8 pages "Pages a–b"
stSectionsFromOutline(outline, pageCount)                → same shape from a PDF outline [{title, page, level}]
stExtractJsonArray(text) / stExtractJsonObject(text)     → ports of the Flashcards extractors (code fences, trailing prose, LaTeX escapes)
stNormalizeRubric(raw) → [{text, required}]; stNormalizeVerdict(raw, rubric) → StVerdict; stScoreVerdict(verdict, rubric) → {score, hits, partials, misses, requiredMissed, gaps, total}; stMapVerdictToRating(verdict, rubric) → 1..4 | null   (ports of the Flashcards M102 grader, thresholds identical)
stVerdictLabel(verdict, rubric)                          → 'Complete' | 'Two of three' (n of m) | 'Not quite' | 'Contradicts the source'
stRatingWord(rating)                                     → 'Again' | 'Hard' | 'Good' | 'Easy'
stNormalizeFormula(s); stFormulaMatches(a, b)            → ports of the Flashcards formula path
stNumericMatches(answer, expected, tolerance)            → boolean  (parses "1,234.5", "12.5%", "$1.2M"; relative tolerance, absolute 1e-9 near zero)
stClozeMatches(answer, term, aliases)                    → boolean  (case, whitespace, punctuation folded)
stValidateQuestion(raw, { choices })                     → { ok, question } | { ok: false, reason }  shape check of a model-written question
stDistractorPrompts(question)                            → [{ optionIndex, stem, option }] the checks to run
stParseQuestionFile(text, ext)                           → { questions: [...], skipped }  (§7)
stParseExaminerReport(pageTexts)                         → { exam, sitting, questions: [{ number, part, sampleAnswer, commonErrors, page }] } (§7)
stMatchReportToQuestions(report, questions)              → [{ questionId, entry }]  by exam + sitting + number + part
stInterleaveMaterials(items)                             → items reordered so no two consecutive share materialId when avoidable
stMasteryFromCardRating(mastery, rating)                 → rating 1 → mastery*0.5, 2 → mastery*0.85, else unchanged
```

## 5. Data (`20-data.js`)

Database wrapper `db.run/get/all` as Flashcards. Functions return the §4
shapes. All take and return plain objects; none touch the DOM.

```
stEnsureDatabase(api)
stListMaterials() ; stGetMaterial(id) ; stUpsertMaterial({kind, uri, label, pageCount, contentHash, outline})
stSetMaterialPrefs(id, { model, contextSetting, answerFormat }) ; stTouchMaterial(id, now)
stListSections(materialId) ; stReplaceSections(materialId, sections) ; stMarkSectionMapped(sectionId, now)
stListConcepts({ materialIds, sectionIds }) ; stInsertConcepts(materialId, sectionId, concepts) ; stUpdateConcept(concept)
stListQuestions({ materialIds, conceptIds, formats, includeHidden }) ; stInsertQuestions(questions) ; stUpdateQuestion(q) ; stHideQuestion(id, reason)
stStartRun({materialId, sectionId, model, numCtx}) ; stFinishRun(id, {status, written, kept, dropped, error})
stCreateSession({name, scope, mode, answerFormat, size, model, numCtx}) ; stGetSession(id) ; stListSessions({ open }) ; stUpdateSession(id, patch)
stAddSessionItems(sessionId, draw, questionIds, formats) ; stListSessionItems(sessionId) ; stAnswerItem(itemId, { status, chosen, typed, verdict, retried, formatUsed }, now)
stLogAnswer({ questionId, conceptId, sessionId, formatUsed, correct, rating, retried }, now)
stListBanks() ; stInsertBank(bank) ; stDeleteBank(id)
stRecordFeedback(questionId, reason)
stMaterialText(material)                 → { pageTexts, text, pageCount }   via electronBridge().document.extractText (pdf) or api.commands 'canvas.getPageMarkdown' (canvas); cached in memory per material id + hash
stIngestPdf(fsPath)                      → material   extract, hash, outline (from extractText's `outline` when the core returns one, else stHeadingsFromPages), store sections
stIngestCanvasPage(pageId)               → material
stPickWorkspacePdf()                     → fsPath | null   quick pick of every .pdf under the workspace (walk api.workspace.fs.readdir, skip dot folders and node_modules)
stImportQuestionFile(fsPath)             → { bank, inserted }   reads the file, stParseQuestionFile, inserts with origin 'imported'
stImportExaminerReport(fsPath)           → { bank, matched, unmatched }   extract pages, stParseExaminerReport, stMatchReportToQuestions, write rubric_json/contradictions_json/rubric_origin 'report'/source_uri/source_page on matched questions
stSyncProviders(registry)                → pulls every provider's items into st_questions with origin 'provider', provider_id, provider_ref (idempotent by provider_id + provider_ref), one st_banks row per provider
stWeakConcepts({ limit })                → concepts across all materials ordered by state weak first, mastery ascending
```

## 6. AI (`30-ai.js`)

Model choice: `stPickModel(material)` = material.model || setting `study.aiModel` || `api.lm.getActiveModel()` || first of `getModels()`. Context: `stContextPlan` with `material.context_setting || setting`, model ctx from `api.lm.getModelInfo(modelId).contextLength`. Every request sends `numCtx`, `think` from the setting, `format: 'json'` where a JSON reply is wanted, and runs through `stStreamWithStall` (port). Temperature 0.3 for generation, 0 for checks and grading.

Pipelines (all async, all cancellable through a `{ cancelled }` token the pane owns, all report progress through a callback `onProgress({ phase, done, total, written, kept, dropped })`):

```
stBuildConceptMap(material, section, { modelId, token, onProgress })
   per stChunkPages chunk: prompt returns [{ title, summary, page, quote }]; quote checked with stFindAnchorPage;
   dedupe by title similarity; insert; mark section mapped.
stGenerateQuestions(material, { sectionId|conceptIds, formats, perConcept, choices, modelId, token, onProgress })
   per concept group (its page ± 1 of text as material): prompt returns raw questions; stValidateQuestion;
   then the checks in order, each skipped when its setting is off:
     anchor:     stAnchorOnPage(quote, pageTexts[page-1]) or stFindAnchorPage → set sourcePage; fail → drop (dropped.anchor)
     support:    model, quote + stem + answer only, JSON {settles: true|false}; false → drop
     distractor: per stDistractorPrompts, model JSON {defensible: true|false}; any true → drop
     numeric:    stRunNumericCheck → agreed false → drop; python missing → format skipped, said once
   over-generate by a third; keep until perConcept per format; stInsertQuestions; stFinishRun with counts.
stGradeTyped(question, answer, { modelId })        → { verdict: StVerdict, rating, label }   prompt: rubric points + contradictions + source quote; model returns {points:[{status}], contradiction, note}; stNormalizeVerdict; stMapVerdictToRating
stExplain(question, { chosen, typed, modelId, onChunk })   streams a short explanation grounded in the quote; never free-floating
stRubricFromAnswer(question, { modelId })          → rubric   for a bank question with an answer but no rubric (rubric_origin 'answer')
stRubricFromReport(entry, { modelId })             → { rubric, contradictions }   from a report entry's sample answer and common errors (rubric_origin 'report')
stRunNumericCheck(question)                        → { available, agreed, computed, error }   writes a .py under the Python bridge's own tmp dir (read electron/pythonBridge.cjs TMP_REL) through api.workspace.fs, runs parallxElectron.python.runScript({workspaceRoot, scriptPath, args, timeout: 20000}), parses the JSON the script prints; stNumericMatches against expected
stPythonAvailable()                                → boolean   parallxElectron.python.status(workspaceRoot).exists (read the status shape in pythonBridge.cjs getStatus)
```

Prompt rules (write them into the system prompts): one concept per question; competitive distractors semantically close to the answer and about its length; no "all of the above", no "none of the above", no absolute words; the quote must be verbatim from the page; formulas in LaTeX; never invent a fact; the garbled-maths exception from Flashcards; no em dashes. Output JSON only.

Question JSON from the model:
```
{ "format": "mc", "stem": "...", "options": ["...", "...", "...", "..."], "answer": 0, "explanation": "...", "quote": "...", "page": 17, "difficulty": "medium" }
{ "format": "short", "stem": "...", "answer": "...", "rubric": [{"text": "...", "required": true}], "explanation": "...", "quote": "...", "page": 17 }
{ "format": "numeric", "stem": "...", "inputs": {"premium": 1000, "elr": 0.65}, "solutionPy": "def solve(i):\n    return i['premium'] * i['elr']", "expected": 650, "units": "", "quote": "...", "page": 16 }
{ "format": "formula", "stem": "...", "answer": "G(x) = \\frac{x^\\omega}{x^\\omega + \\theta^\\omega}", "quote": "...", "page": 8 }
{ "format": "cloze", "stem": "The ____ method fits one expected loss ratio for every year.", "answer": "Cape Cod", "aliases": ["Cape-Cod"], "quote": "...", "page": 15 }
```

## 7. Import formats (parsers in `10-model.js`, IO in `20-data.js`)

**Question files.** `.md`: questions separated by `---` or `## ` headings; inside, `Q:`/`A:` lines or a `**Question**` block then `**Answer**`; optional `Points:`, `Paper:`, `Source:`, `Exam:`, `Sitting:`, `Number:` key lines. `.csv`/`.tsv`: header row with any of question, answer, paper, source, exam, sitting, number, part, kind, rubric (rubric points separated by `|`). `.json`: `[{question, answer, paper, source, exam, sitting, number, part, kind, rubric: []}]`. Unknown columns are kept in `providerRef` as JSON. Every imported question is format `essay` unless `kind` says `short`, `mc` (then `options` and `answer` index), `numeric` or `formula`.

**Examiner's reports.** A CAS report PDF: find entries headed `QUESTION n` (case-insensitive, also `Question n`), optional part letters `a)`, `(b)`, `Part b:`; within an entry take the text under headings matching `sample answer`, `model solution`, `sample response`, `examiner's comments`, `common errors`, `candidates`; `sampleAnswer` = the sample text, `commonErrors` = the comments text. `exam` and `sitting` from the first page (`Exam 7`, `Fall 2019` / `2019 Fall`). The parser is pure over `pageTexts` and records each entry's page.

## 8. Core seams (small, generic; each with a unit test)

**C1. `editor/title` menu location** (`src/contributions/menuContribution.ts`, `contributionTypes.ts`, `src/tools/parallx-manifest.schema.json`, `docs/PARALLX_EXTENSION_AUTHORING_FOR_AI.md` §3.4): a fifth location. `getEditorTitleItems()` returns the items whose `when` passes the context key service (the key `activeEditor` holds the active editor's typeId, so `when: "activeEditor == 'parallx.editor.pdf'"`). A module-level `getEditorTitleActions(): { commandId, label, toolId, toolName }[]` like `getToolSelectionActions` so a pane can list them with no reference to the processor; `toolName` is the tool's display name (the registry's manifest name). The PDF pane's More Actions menu appends them after a separator, label at left, tool name at the right as a muted tag (the mockup, section 1), and executes the command with one argument `{ uri, fsPath, page }` (its file URI string, fsPath, current 1-based page). Turned off, the entries go (the processor already removes a tool's items). Test: `tests/unit/editorTitleMenu.test.ts` modelled on `viewContainerTitleMenu.test.ts`, plus an assertion that `pdfEditorPane.ts` names no tool.

**C2. Question providers** (`src/services/questionProviders.ts`): a registry any tool can register into and any tool can read: `registerQuestionProvider(p): IDisposable`, `listQuestionProviders()`, `onDidChangeQuestionProviders`. Provider: `{ id, displayName, toolId, list(opts?: { limit? }): Promise<QuestionItem[]>, open?(ref: string): Promise<boolean> }`. `QuestionItem`: `{ ref, question, answer, kind: 'essay'|'short'|'quant'|'mc'|'other', rubric?: [{text, required}], paper?, source?, exam?, sitting?, number?, part?, label?, sourceUri?, sourcePage?, tags?: string[] }`. Exposed to extensions as the core command `questions.getRegistry` (a `CommandDescriptor` in `src/commands/`, returning the live registry object; the pattern `planner.getRegistry` uses, now in the core). Worksheets registers a provider over `ws_items` with kind `essay` or `qual`: `question` = `question_md`, `answer` = `solution_notes_md` (or the sheet's own solution text when that is empty and a solution column exists), `paper`, `source` (rf | cas | custom), `label` = title, `open` opens the item's sheet. Flashcards registers a provider over cards whose `importance_reason` starts with `essay practice` (front, back, rubric, tags, source). Test: `tests/unit/questionProviders.test.ts`.

**C3. `flashcards.addCards`** command in `ext/flashcards/main.js`: `({ deckName, cards: [{ front, back, tags, sourceUri, sourceLabel, sourcePage, sourceExcerpt, recallMode, rubric }] }) → { deckId, ids }`, through `fcGetOrCreateDeckByName` and `fcCreateCardsBulk`. And a generic rating event: after any card rating is stored, `document.dispatchEvent(new CustomEvent('parallx:card-rated', { detail: { toolId: 'parallx-community.flashcards', cardId, rating, tags, sourceUri, sourcePage } }))`. Study listens and lowers mastery of the concept named by a `study:c:<conceptId>` tag (`stMasteryFromCardRating`).

**C4. `openFileEditor(uri, { reveal, side: true })`** (`src/api/bridges/editorsBridge.ts`, `parallx.d.ts`, the authoring guide): `side` opens the file in the group to the right of the active group, splitting when there is none (the `markdown.showPreviewToSide` pattern), so Show Source lands beside the session. The reveal still applies.

**C5. Card stock tokens** (`src/theme/px-tokens.css`, Tier 3, both themes the same): `--px-stock`, `--px-stock-edge`, `--px-stock-line`, `--px-stock-well`, `--px-stock-ink`, `--px-stock-ink-soft`, `--px-stock-ink-faint`, `--px-stock-shadow`. A white printed card with dark ink. Values are the Flashcards card's (#ffffff, #e2e2e2, #ececec, #fbfbfb, #111111, #4a4a4a, #9a9a9a, its shadow). Not redefined for light mode. If `pxTokenDefinedCompliance` or another test constrains new tokens, satisfy it.

**C6. Outline from the extractor** (`electron/documentExtractor.cjs`): `extractPdf` also returns `outline: [{ title, page, level }]` when pdf-parse's underlying pdf.js document exposes `getOutline` and destinations resolve to pages; `[]` otherwise. Pure addition; the shape is documented at the preload's `document.extractText`.

## 9. UI contracts (`60-pane.js`, `50-sidebar.js`)

Routes the pane renders, in one editor tab per session (`instanceId: 'session-<id>'`) and one for the sheet (`instanceId: 'setup'`):

```
{ view: 'setup', materialIds, sectionId?, pageFrom?, pageTo?, selectionText?, selectionPage? }
{ view: 'generating', sessionId }         the run screen; Start With N Ready once ≥ size kept
{ view: 'session', sessionId }            card, answer area, feedback, strand, controls
{ view: 'results', sessionId }
{ view: 'learn', materialId, sectionId }
{ view: 'review', sessionId }
```

Behaviour, from the mockup and nothing else:
- Toolbar: scope line, strand (one `<i>` per item of the current draw: faint, `ok`, `no`, `cur`, skipped faint), close. No counter.
- Eyebrow: the concept title; for a bank question its origin label and the rubric origin.
- Card: `st-card` on the stock tokens, serif face, question at `--px-text-xl`; options as rows with keycaps 1..n; typed formats a textarea in a well with the hint line; numeric a short input with the units; formula a one-line input; cloze a short input.
- Keys: 1–5 choose, Enter check or next, S source, R retry (once, after a wrong choice), E explain, K skip, Esc close source (second Esc asks to end the session). Scoped to the pane (keydown on the pane root, which is focusable).
- Feedback: verdict line with the text actions (Show Source, Explain, Retry) at the right; why; the anchor quote with its page link (opens the PDF beside: `openFileEditor(uri, { reveal: { page, quote }, side: true })`); for typed, the rubric points landing with the stagger; full answer folded.
- Next: the card leaves, the next arrives (motion tokens only; honour `prefers-reduced-motion` and `data-px-motion="reduced"`).
- Results: big right-of-size, the under line, Send Missed to Flashcards (only while `flashcards.addCards` exists: `api.commands.getCommands()`), Refresh, the coverage bar, Missed this session, Review Answers.
- Setup sheet: scope segmented (Document, Pages, Chapter, Selection, Materials), the list (outline rows with `ocov` bars; page inputs for Pages; the picked materials for Materials), Mode and Answer on one row, footer: model line (opens one `showContextMenu` with the models and the context sizes), the count line, Cancel, Start (or Make Questions and Start when the bank is short).
- Sidebar: header (Select Materials toggle, +, ⋯), pick bar when selecting (Study Together), Materials with chapters and coverage bars, Sessions (open with the live dot and position; finished with score and when), Question banks folded. Clicking a material opens its setup sheet; a chapter row opens the sheet with that chapter; a session row focuses its tab.
- Session state is in the database after every answer, so a closed tab reopens where it was; `openEditor` with the same `instanceId` focuses the existing tab (the Flashcards pattern with `focusEditor`).

## 10. Integration (`70-integration.js`)

- Commands as in the manifest. `study.studyDocument(arg)` takes the pane's `{ uri, fsPath, page }` (or the active PDF through `api.editors.openEditors` when called from the palette), ingests, opens the setup sheet on the chapter containing `page`. `study.quizSelection` is the selection action (`actionId: 'quiz-selection'`, label `Quiz This Selection`, icon `px-study`, through `chat.getSelectionActionDispatcher` with the Flashcards retry pattern) and starts a Practice session over the selection straight away.
- Providers: `questions.getRegistry` with the retry pattern; `stSyncProviders` on activate and on `onDidChangeQuestionProviders`.
- Flashcards hand-off: Send Missed makes one card per missed concept (`front` = the concept's title as a question, `back` = the concept summary, `sourceUri`/`sourcePage`/`sourceExcerpt` = the anchor, tags `['study', 'study:c:<id>']`, `recallMode: 'conceptual'`, rubric from the best typed question of the concept when one exists) into deck `Study: <material label>`.
- `parallx:card-rated` listener → `stMasteryFromCardRating`.
- Dashboard widget `parallx-community.study.weak-spots` (the mockup): rows per material with weak count and last score, a bar, the footer link to `study.weakSpots`.
- Links `parallx://study/session/<id>` and `parallx://study/concept/<id>`.
- Chat tools: `study_session` ({ material, pages?, mode?, format? } → opens a session), `study_weak_spots` ({ limit } → the list), `study_results` ({ sessionId? } → the last session's summary).
- Planner day loads: `planner.getRegistry` with the retry pattern, if it accepts a provider; otherwise skip silently.
- Configuration change: nothing to re-arm (no cron).

## 11. Tests

- `studyModel.test.ts`: every function in §4 with the edge cases named there (state thresholds, stale days, alpha per class, retried right is a miss, draw order and interleave, no repeats, format resolution for mixed, anchor on garbled pages, heading heuristic on real-looking page texts, JSON extraction with fences and LaTeX, verdict thresholds at 2 of 3 and 3 of 5, contradiction outranks, numeric parsing with commas and percents, cloze folding, question validation rejecting a bad option count or an answer out of range).
- `studyImport.test.ts`: the three question-file formats, a synthetic report with two questions and parts, matching to questions.
- `studyPane.test.ts` (jsdom, fake `api` with a fake `database` holding rows in memory, fake `lm` returning canned JSON): opening the sheet renders the scope and the list; Start creates a session and renders the card; choosing a wrong option marks rows, shows the feedback, enables Next; keys 1 and Enter work; typed Check renders the verdict points; Results shows the right count and the missed list; Refresh adds a second draw; Send Missed appears only when the command exists; the sidebar lists materials and sessions and Study Together opens the sheet with the Materials scope. Use `api.ui` wired to the real kit factories like `budgetDropdown.test.ts` does.
- `studyBundle.test.ts`: `main.js` equals the concatenation of `src/*.js`.
- Core: `editorTitleMenu.test.ts`, `questionProviders.test.ts`, and the existing suites unchanged.
- Checks: `npx tsc --noEmit`, `npx vitest run`, `npm run build`, all green. The ratchet at zero for `study`.

## 12. As built (2026-10-07)

Where the build departed from the sections above, after a code review
and three runs of the real app. The code is the authority; this lists the
decisions so they are not re-litigated.

- **Bank questions** get concepts like reading questions, but under a
  hidden material per bank (`kind 'bank'`, `uri 'bank:<id>'`), because
  `st_concepts.material_id` is a foreign key and 0 cannot be used.
  `stListMaterials` leaves those materials out; `stDeleteBank` removes it.
  A bank scope is `{ kind: 'bank', bankIds, materialIds: [], label }`; it
  never generates; essay and short questions without a rubric get one
  from their answer on first draw (`rubric_origin 'answer'`); a question
  with neither is left out and counted as unanswerable.
- **Match keys** (exam, sitting, number, part, paper, source) live in
  `provider_ref` as JSON (`stProviderRefOf`, `stQuestionKeys`). A report
  entry matches only when exam, sitting and number agree (part when both
  have one); an empty exam or sitting never matches.
- **Sections**: outline level is the extractor's level + 1. Each page
  belongs to its deepest section (`stPagePartition`) and is mapped once;
  a chapter scope resolves by page range, so a parent includes its
  subsections (`stConceptsForSections`). Repeated running headers and
  "(continued)" headings are folded. A concept whose title merely repeats
  its section title is dropped; a leading copy of a heading is stripped
  from concept titles and quotes.
- **Generation** maps lazily and visits units round-robin across
  materials and spread across each document, so the first session-size
  questions already span the scope. A (concept, format) pair that keeps
  nothing in two calls is not asked again in that run, and a pass that
  keeps nothing ends it. Progress payloads add `sessionId`, `available`,
  `unanswerable`, `unitsDone`, `unitsTotal`; unusable model output is
  counted as `dropped.parse` and shown as its own row when above zero.
- **Draws**: when the scope has fewer unasked questions than a session,
  the draw is filled with questions already asked, wrong ones first, never
  twice in one draw. "No questions could be made" is only for a scope with
  no usable question.
- **Numeric check**: the wrapper script vets the model's solution with
  Python's `ast` against an allowlist and runs it with closed builtins and
  only `math`; its output goes under `.parallx/tmp/study/out`, removed
  after.
- **Test mode** records answers without verdicts and marks typed answers
  in the background one at a time; results list every item with its
  points. Multiple-choice questions are answered as typed short answers in
  Test, graded against the correct option's text.
- **Commands** `study.addMaterial`, `study.importQuestions` and
  `study.importReport` take an optional path or URI; `study.studyTogether`
  takes optional material ids.
- **Show Source** opens the file beside the session (`side: true`; a file
  open only in the session's own group opens in the group to its right)
  at the page, with the anchor highlighted (the PDF pane no longer gives
  pdf.js's find controller its document early; the viewer's own call
  after the first render reset it and wiped the quote's find). A question
  with no anchor shows no quote box; from a notes file it opens at the
  question's line (`stLineOfStem`). The first Esc closes it; only with no
  source open does Esc ask to end.
- **Labels**: a material is named by the PDF's /Title when it is a real
  one (the extractor now passes it as `metadata.title`), else its file
  name made readable; an imported bank or report the same way, without
  the extension.
- **Model line**: one menu sets the model and the context together and
  stays open (`keepOpen` rows; a model pick redraws it). Sizes are the
  chat's steps from 8K (Auto's floor) to the model's maximum, the maximum
  included (`stContextSizesFor`); a fixed size the new model cannot hold
  becomes its maximum. Sizes read as in the chat ("128K").
- **Feedback says nothing twice**: a grader's note is left out when it is
  a missed or partial point near enough, or only a short frame around the
  points it quotes ("The answer leaves out: ..."); "required" marks points
  only on a rubric that mixes required and supporting ones.
- **Lifecycle**: every registration is owned by an activation token;
  continuations that resume after Study was turned off stop quietly, and
  late registrations are disposed at once.
- **Testing**: `tests/unit/studyModel.test.ts` (pure model, plus a harness
  over the generated bundle on node:sqlite), `studyImport.test.ts`,
  `studyPane.test.ts` (the real pane in jsdom, SQLite, a scripted model),
  and `tests/probes/study-app-probe.mjs` (the real app in Electron with a
  scripted model provider and fixture PDFs from `study-fixture-pdfs.py`;
  `npm run build`, then `node tests/probes/study-app-probe.mjs [outDir]`,
  under `xvfb-run -a` without a display; it reads the database with
  node:sqlite after the app closes). Last run: every flow passes, no
  renderer errors.
