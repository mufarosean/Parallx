# Study: research brief and design

A new extension, named Study, that turns dense study material (a PDF, a
chapter, a selection, or a question bank you already own) into review that
is faster than rereading and more honest than self-grading: multiple-choice
practice, typed and essay tests, calculation questions with checked
answers, and a hand-off of only what you missed to Flashcards. Written 2026-10-07 from
Mufaro's ask after seeing Notability's Learn feature again; revised the same
day after his bar was set.

The bar, in his words: the material is dense actuarial study text, so ten
questions is not enough; a session can cap at 20 as long as a refresh
brings the next set. Every question must be sourced so nothing is made up.
The essay questions he has already pulled from past exams and from Rising
Fellow (they live in his local study workspace) must be part of it, and
the CAS examiner's reports with them. No mock exams and no point scoring:
what matters is being able to go through the content. No concessions: if
time goes into this it has to be top tier, better than Notability and
better than NotebookLM.

How this was researched: web search plus the pages this container could
reach. Notability's blog and support site, Apple's App Store pages and
Google's NotebookLM pages are blocked here, so their details come from
search excerpts of those pages and should be checked in the app before
anything is copied exactly. The one first-party page read in full is
Anthropic's customer case study on Notability Learn.

## 1. How Notability Learn works

**Entry.** Open any note or PDF, tap the sparkle icon top right. Learn
writes a summary first (copyable into the note), then offers the study
modes. The material must be at least 250 words and at most about 20,000
words. A page range can be chosen so the rest of the document is left out.
Plus and Pro subscribers only. Sources: handwriting, typed text, PDFs and
audio recordings.

**Three modes, one picker.** The picker reads "Memorize with flashcards,
Practice with questions, or Mixed-method test."

| Mode | What it is |
| --- | --- |
| Memorize | AI-generated flashcards from the material. Since the 2026 back-to-school release every card is rated Again, Hard, Good or Easy and spaced repetition brings weak cards back sooner. Decks import from Anki (.apkg, .txt) or CSV; import is cloud-only. |
| Practice | A multiple-choice quiz, about 10 questions per run. Right or wrong shows as you go. A wrong answer can be retried immediately. "Explain this" breaks down the correct answer. A "Final Score!" screen ends the run with Retry and Give Feedback. Scores are tracked across retakes. |
| Test | Mixed formats that make you type: fill-in-the-blank (keyboard or Apple Pencil), multiple choice, and the newer true-or-false and mix-and-match (tap or drag terms onto definitions). A "Show only Fill in the Blanks" option forces typed answers. |

"Auto Study" chains the three into one flow: multiple choice, then
flashcards, then fill-in-the-blanks.

**Under the hood** (from the Anthropic case study, read in full):

- Claude writes the questions and the "Explain this" explanations. Haiku is
  the default model; Sonnet serves Pro subscribers' quizzes.
- 220 million quiz questions answered in a year, about 600,000 a day.
- Quality is measured by the thumbs up or down on each question. Flagged
  questions fell from 33 per 10,000 to about 18 after a model upgrade.
  Internal evaluators run on every release.
- Learn users spend 90% more time in the app; 85% return weekly against 58%.
- The first version shipped in two months.

**What it does not do.** No citation from a question back to the passage.
No coverage: ten questions per run, however long the material. No control
over question type beyond the mode. No numeric or calculation questions. No
way to bring in your own exam questions. Nothing is local: the material
goes to the cloud.

## 2. How NotebookLM does it

NotebookLM added Flashcards and Quizzes to its Studio pane in September
2025, mobile in early 2026.

- One click per type. A pencil icon opens the options: number of items
  (fewer, standard, more), difficulty (easy, medium, hard) and a free-text
  prompt to narrow the topic. A quiz is typically 10 to 15 four-option
  multiple-choice questions across all sources in the notebook.
- Each answer is marked at once with a short explanation. Explain sends the
  question to the main chat, where the answer comes back with citations to
  the source passages.
- A results screen shows the score with Review and Retake. A 2026 update
  added a summary of which topics the set covered, which you got right and
  which you struggled with, and the option to generate a study guide or a
  new flashcard set from the questions you missed.
- Quizzes can be shared by email. Flashcards are plain two-sided cards.

**What it does not do.** Citations arrive only when you ask Explain; the
question itself is not verified against the text. "More" is still a dozen
or two questions. Multiple choice only; no typed, essay or calculation
answers. No scheduling, no mastery across sessions, no own question banks.

## 3. The neighbours

- **Quizlet Learn** mixes flashcards, multiple choice and written questions
  and moves you from multiple choice to written as you get terms right
  ("guidance fading"). It tracks the terms you miss and drills them.
- **Goodnotes** has Study Sets (AI flashcards from handwriting) with Smart
  Learn adapting to per-card progress. Nothing on multiple choice from PDFs.

## 4. What the learning research says

- Retrieval practice of any kind beats rereading for retention. Multiple
  choice is at least as effective as recall at producing the testing effect.
- Little and Bjork (UCLA): multiple choice with **competitive** alternatives,
  wrong options plausible enough that you must recall why they are wrong,
  improves later recall of the wrong options' own facts too. Cued recall
  does not. A well-built multiple-choice question reviews several facts.
- The weakness of machine-written questions is the distractors. In one
  audit of LLM-generated items, 57% had at least one implausible distractor;
  ambiguous items with more than one defensible answer were the other common
  flaw. The fixes that work: distractors semantically close to the answer and
  the same length, no "all of the above", no absolute terms, reasoning
  before writing, and a check pass that shows the model each distractor
  alone with the stem and rejects the item if any could be correct.
- Typed answers remain the honest test. Recognising a right answer you could
  not have produced is the main way self-grading overstates what you know,
  which is why Flashcards already grades typed answers against a rubric.

## 5. What Parallx has today

- **Flashcards** (`ext/flashcards`): SM-2 scheduling, Again/Hard/Good/Easy,
  Anki import, AI card generation from canvas pages, PDFs and photos with
  per-page attribution (M98), typed answers graded against a rubric with
  hit/partial/miss points (M102), essay-practice cards that take typed
  answers by default, deck exam dates with pacing, a dashboard widget, chat
  tools, `parallx://flashcards/...` links.
- **Worksheets' Problem Bank** (`src/built-in/worksheet`, docs/PROBLEM_BANK.md):
  the Exam 7 workbook imported sheet for sheet. Per the last handoff the
  bank holds rf 221, cas 110, exam 92 and custom 136 problems across 15
  papers, each with paper, source (Rising Fellow, CAS, custom, generated),
  kind (quantitative, qualitative, essay), the vendor's quadrant, ratings
  and attempts. The 14 Rising Fellow essay sheets (one per paper) are in the
  bank as kind `essay`, kept out of the campaign draw; the workbook's
  Shapland Q&A and Flashcards sheets exist as hidden sheets. Quizzes there
  are named, saved sessions with a timer, marks and stars.
- **The PDF pane**: highlights, Ask AI About Selection, Send to Chat,
  capture to Canvas, selection actions from running tools, and
  `api.editors.openFileEditor(uri, { reveal: { page, quote } })` to land on
  a page with a passage highlighted.
- **Extraction**: `parallxElectron.document.extractText` returns whole text
  and `pageTexts` per page. Dense actuarial PDFs extract formulas as
  garbage; Flashcards carries a standing instruction to reconstruct them.
- **Python**: a per-workspace environment with `python:runScript`, so a
  calculation can be executed, not just asserted.
- **Nothing does Practice or Test on reading material**, and nothing puts
  the essay bank, the reading, and the cards into one loop. Every card
  generated today goes into the scheduled queue whether or not the fact was
  already known.

## 6. The bar

Study is better than both products when every row below is true.

| | Notability | NotebookLM | Study |
| --- | --- | --- | --- |
| Questions per material | ~10 per run | 10 to 20 | A bank that covers every concept; a session serves 20 and Refresh draws the next 20 until the scope is clean |
| Sourcing | None shown | Citation on request | Every question carries a verbatim anchor, checked by string match against the page text before it is shown; no anchor, no question |
| Answer formats | MC, fill-in, matching, true/false | MC only | MC, short typed, essay, numeric with tolerance, formula |
| Grading | Right/wrong | Right/wrong | MC exact; typed and essay against a rubric with hit/partial/miss, the essay rubric from the examiner's report; numeric against an executed solution |
| Own questions | Import flashcards | None | Past exam and Rising Fellow questions as first-class items, with the generated ones |
| Coverage | None | Topics covered summary | Concept map per document; mastery per concept; the weak list drives the next session |
| Memory | Flashcards with SRS | None | Missed items only go to Flashcards; concept mastery feeds back |
| Privacy | Cloud | Cloud | Local models, local SQLite, nothing leaves the machine |
| Quality loop | Thumbs up/down | None | Thumbs down hides and logs; edit any question; regenerate; checks run before display |

## 7. Design

**Study** (`ext/study`). A new extension rather than a mode in
Flashcards or Worksheets: it is its own job (review and testing), it must
run with either of them off, and both are large enough. It talks to them
only through generic seams, the way Worksheets offers "Review Due
Flashcards" only while the command exists.

### 7.1 Material and the concept map

A **material** is anything Study can read: a PDF (whole, page range,
outline chapter or selection), a canvas page, or an imported question file.
On first use of a PDF, Study builds a **concept map** for the scope: one
pass per page group extracts the concepts the text actually teaches, each
with its page and anchor quote, grouped under the document's outline
headings. The map is the unit of coverage and mastery: every question
belongs to a concept, every result lands on one.

Scope is never limited by length. A 400-page study manual is chunked by
page; generation runs per chunk with a progress bar and can be stopped and
resumed; the bank grows until every concept has questions. The settings say
how many questions per concept are enough (default: until two of each
format exist), never a per-document total.

**Sessions are 20 questions** (`study.sessionSize`, default 20). A session
draws from the bank: weak and unasked concepts first, then stale ones,
never the same question twice while the bank has another for that concept.
**Refresh** on the results screen draws the next 20 from the same scope;
when the bank runs short on a concept, generation tops it up in the
background before the draw, so a refresh is never a repeat. A scope is
clean when every concept has been answered right once in the chosen
format, and the results screen says how many refreshes that took.

### 7.2 Sourcing, enforced

Every generated question stores `sourcePage`, `sourceQuote` and
`conceptId`. Before a question is kept:

1. **Anchor check (mechanical).** The quote must appear in the page's
   extracted text after whitespace and ligature normalisation, or match it
   at 0.9 similarity when extraction mangled it. Fails: dropped, counted.
2. **Support check (model).** Shown only the quote and the question, does
   the quote settle the answer? A "no" drops the question. This catches a
   real quote attached to an invented claim.
3. **Distractor check (model).** Each wrong option alone with the stem. If
   any could be defended as correct, dropped.
4. **Numeric check (executed).** A calculation question ships with the
   solution as a short Python function and the inputs; Study runs it through
   the Python bridge and keeps the question only if the stated answer
   matches the executed one. No bridge, no numeric questions, said plainly.

Drop rates are shown per generation run, because they are the quality
signal before any user sees a question. Over-generation covers the drops.

### 7.3 Question formats

| Format | Answer | Grading |
| --- | --- | --- |
| Multiple choice | One of four or five | Exact; competitive distractors required by prompt and check |
| Short typed | One or two sentences | Rubric of points, hit/partial/miss, the Flashcards M102 grader |
| Essay | A written answer, a paragraph or more | The same rubric grader, with the rubric taken from the examiner's report where there is one: what a full answer states, what the report accepted as partial, the mistakes it called out as contradictions. Hit, partial, miss per point; no score out of marks |
| Numeric | A number with units | Tolerance set per question; the executed solution shown after |
| Formula | A formula in LaTeX or plain text | Normalised comparison first, model judgement on mismatch (Flashcards' formula path) |
| Fill-in-the-blank | A term | Exact or alias match |

True-or-false and matching are not built: they test recognition at its
weakest and the formats above cover their ground.

**Answer format is a session setting**, not a mode: Choose, Type, or Mixed.
Mixed starts each concept on multiple choice and switches it to typed once
it has been answered right, the Quizlet fade. Essay and numeric items are
always answered in their own format.

### 7.4 Own question banks

Questions Mufaro already has are items with a `source` of `exam`,
`rising-fellow` or `imported`, beside `generated`. They live in his local
study workspace, so the first import is matched to their actual shape on
his machine, not guessed from here.

- **From Worksheets' Problem Bank.** Worksheets registers a generic
  **question provider** (a command the core defines the shape of, like the
  planner's day-load seam) exposing its essay sheets and any qualitative
  problem as question text, model answer, paper and source. Study lists
  every provider it finds; none is named in code. The quantitative sheets
  stay in Worksheets, where the sheet is the point.
- **From files.** Markdown, CSV or JSON with question, answer, paper, year
  and source. Past CAS questions import this way.
- **Examiner's reports.** A report PDF is read with the same extractor and
  matched to its exam's questions by number. Each question's sample answer
  becomes the rubric, the report's note of what candidates commonly missed
  becomes the contradiction list, and the report's page is the question's
  anchor, so Show Source opens the report at the right place. A question
  with no report keeps a model-written rubric from its answer, marked as
  such.
- **From Flashcards.** Its essay-practice cards, through the same provider
  seam, if Flashcards registers one.

Imported items get a concept assignment by the model (confirmable), so a
past exam question counts toward the same concept as the reading it tests.

### 7.5 Modes

| Mode | What it does |
| --- | --- |
| Practice | 20 questions from a scope, Refresh for the next 20, until the scope is clean: every concept answered right once in the chosen format. Instant marking, retry, Explain (grounded in the anchor, never free text), Show Source (opens the PDF on the page with the quote highlighted). |
| Test | The same bank in Type format, no retry, results at the end with per-point feedback. |
| Weak Spots | A session drawn from the concepts with the lowest mastery across the whole workspace, any material. |
| Learn | A one-screen summary of the scope, every line cited to a page. Optional; Chat can do this, so it ships only if the citations earn it. |
| Memorize | Not built here. Flashcards does it; Study feeds it. |

### 7.6 Mastery and scheduling

Mastery is per concept: a decayed score over the last answers in each
format, typed outweighing multiple choice. A concept is **weak** below a
threshold, **clean** above it, **stale** when not answered in N days. Study
schedules concepts, not cards: a chapter with weak concepts is offered on
the dashboard and in Weak Spots; a clean chapter is left alone until stale.
This is lighter than card scheduling on purpose: the cards are Flashcards'
job.

**Send Missed to Flashcards** appears while Flashcards is on and makes one
card per missed concept, not per missed question, with the anchor as the
card's source so it jumps to the page. Mastery written back from Flashcards
ratings is a later step if the seam exists.

### 7.7 Quality loop

- Thumbs down on any question hides it, logs the reason, and counts
  against the generation run that made it.
- Edit any question in place; edits are kept across regeneration.
- Regenerate a concept's questions, or the whole scope, with the drops
  reported.
- A per-model report: drop rate per check, thumbs-down rate, so a local
  model that cannot write clean distractors is visible, not suffered.

### 7.8 Surfaces

- **PDF pane entry.** The toolbar's right cluster and More Actions menu have
  no slot for a tool, and the core must not name Study. The missing
  contribution point is an `editor/title` menu location (`when:
  "activeEditor == 'pdf'"`), the same shape as `view/title`. Build it
  generically; Study is its first user. The selection entry needs nothing
  new: a selection action with the dispatcher, like Flashcards.
- **Session pane**: `contributes.editors` type `study`. Question, answer
  area, feedback strip with Explain and Show Source, results screen. Kit
  components and `--px-*` tokens only; maths rendered as in Flashcards.
- **Sidebar**: materials with coverage and mastery bars, weak concepts,
  recent sessions, the question banks and providers.
- **Dashboard widget**: weak concepts across the workspace, each a door into
  a session.
- **Chat tools**: `study_session` (start on a document and range),
  `study_weak_spots`, `study_results`.
- **Links**: `parallx://study/session/<id>`, `parallx://study/concept/<id>`.
- **Planner**: the day-load seam Flashcards already feeds gets Study's
  scheduled weak-spot sessions, if the seam takes a second provider.

### 7.9 Modularity

- Study names no other tool. Providers are discovered; Flashcards is a
  command-exists check; Worksheets is a provider it may or may not find.
- The PDF pane learns nothing about Study; it gains a generic menu slot.
- Nothing runs while Study is off: no extraction, no model calls, no cron.
- The rubric grader (`fcNormalizeVerdict`, `fcScoreVerdict`,
  `fcMapVerdictToRating`, about 150 pure lines) is duplicated into Study
  with a note, since extensions cannot import each other; a shared module
  both copy at build is the later step if a third user appears.

### 7.10 Models

Generation runs on whatever `api.lm` offers, local by default. Local
models write worse distractors than Claude does, which is why the checks
run before display and the per-model report exists: the checks are the
quality floor, the model only raises it. Settings: `study.aiModel`,
`study.aiThinking`, `study.generationContext` (sized per run, as
Flashcards does), `study.choices` (4 or 5), `study.questionsPerConcept`,
`study.sessionSize` (20), `study.answerFormat`, `study.numericTolerance`, `study.checks` (each
check on or off, all on by default).

## 8. Open decisions for Mufaro

Settled 2026-10-07: the name is Study; sessions cap at 20 with Refresh
for the next 20; the pulled questions are in his local study workspace and
the import is matched there; examiner's reports are included; no mock
exams and no point scoring.

1. Learn mode in v1 or not.
2. Four or five options per multiple-choice question.
3. Whether the examiner's reports are already PDFs in the study workspace
   or still need collecting.

## 9. Proposed slices (order only)

1. Core: the `editor/title` menu contribution point and the generic
   question-provider seam, with tests.
2. Study skeleton: manifest, DB, settings, session pane, scope picker over
   `pageTexts` and the outline.
3. Concept map per scope, resumable generation, the anchor and support
   checks; Practice in multiple choice with Show Source and Explain.
4. Distractor check, thumbs down, edit, regenerate, the drop report.
5. Typed, essay and formula formats with rubric grading; Test mode; Mixed.
6. Numeric format through the Python bridge.
7. File import of question banks; Worksheets' provider for essay and
   qualitative problems; examiner's reports as rubric sources.
8. Mastery per concept, Weak Spots, Send Missed to Flashcards.
9. Sidebar, dashboard widget, chat tools, links, planner day loads.
10. Canvas pages as a material.

## Sources

Notability

- Anthropic customer case study, Notability (read in full):
  https://claude.com/customers/notability
- Notability Learn support article (search excerpt only):
  https://support.gingerlabs.com/hc/en-us/articles/8073483239834-Notability-Learn
- Flashcards Import support article (search excerpt only):
  https://support.gingerlabs.com/hc/en-us/articles/11128218737690-Flashcards-Import
- Introducing Notability Learn (search excerpt only):
  https://blog.notability.com/post/introducing-notability-learn
- Inside Notability Learn (search excerpt only):
  https://blog.notability.com/post/inside-notability-learn
- Back-to-School 2026 Guide (search excerpt only):
  https://blog.notability.com/post/notabilitys-back-to-school-2026-guide-every-new-feature-explained
- What's Coming to Notability This Semester (search excerpt only):
  https://blog.notability.com/post/whats-coming-to-notability-this-semester
- App Store story, 5 Tips to Level Up Your Learning With Notability
  (search excerpt only): https://apps.apple.com/us/mac/story/id1586860080
- User walkthrough on Lemon8 (search excerpt only):
  https://www.lemon8-app.com/@troll0618/7436275180232393271?region=us
- Wikipedia, Notability (application):
  https://en.wikipedia.org/wiki/Notability_(application)

NotebookLM

- Google blog, NotebookLM app now lets you build flashcards and quizzes:
  https://blog.google/innovation-and-ai/models-and-research/google-labs/notebooklm-app-quizzes-flashcards/
- 9to5Google, Google rolling out Flashcards, Quizzes to NotebookLM:
  https://9to5google.com/2025/09/08/notebooklm-flashcards-quizzes/
- XDA, NotebookLM's new feature beats Quizlet at its own game:
  https://www.xda-developers.com/notebooklms-flashcards-feature-beats-quizlet/
- TechRadar, I started using NotebookLM's new quiz tools:
  https://www.techradar.com/ai-platforms-assistants/gemini/i-started-using-notebooklms-new-quiz-tools-and-theyre-actually-great-for-learning
- NotebookLM Quiz and Flashcard Upgrade (2026):
  https://notebooklm-guide.com/notebooklm-quiz-flashcard-upgrade-2026-enhanced/
- Android Central, NotebookLM flashcards and quizzes on mobile:
  https://www.androidcentral.com/apps-software/ai/notebooklm-is-becoming-a-better-android-study-tool-with-flashcards-and-quizzes

Neighbours and research

- Quizlet, Introducing the new Quizlet Learn:
  https://quizlet.com/blog/introducing-the-new-quizlet-learn
- Goodnotes, Getting Started with Study Sets and Smart Learn:
  https://support.goodnotes.com/hc/en-us/articles/5836056341903-Getting-Started-with-Study-Sets-and-Smart-Learn
- Bjork Learning and Forgetting Lab, research summary:
  https://bjorklab.psych.ucla.edu/research/
- Little and Bjork, The Role of Retrieval in Answering Multiple-Choice
  Questions: https://www.littlelearninglab.com/MCTrivia_JEPLMC.pdf
- Multiple-choice pretesting potentiates learning of related information,
  Memory and Cognition: https://link.springer.com/article/10.3758/s13421-016-0621-z
- Docimological Quality Analysis of LLM-Generated Multiple Choice
  Questions: https://www.researchgate.net/publication/381324274
- Distractor Generation in Multiple-Choice Tasks: A Survey:
  https://arxiv.org/html/2402.01512v2
- Enhancing Student Learning with LLM-Generated Retrieval Practice
  Questions: https://arxiv.org/pdf/2507.05629
