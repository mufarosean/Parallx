# Study Modes: research brief

Research for a new extension that turns an open PDF (or part of one) into a
quick review session: multiple-choice practice, typed-answer tests, and a
hand-off of what you missed to Flashcards. Written 2026-10-07 from Mufaro's
ask after seeing Notability's Learn feature again.

The ask, in his words: Notability lets you open a doc and go into Learn,
Memorize or Test mode. Memorize is flashcards. The multiple-choice questions
are a quick way to review a section instead of rereading it. This could cut
how many flashcards he has to grind through: review a section fast by
multiple choice, and memorize only the few things that need it. Multiple
choice should be switchable off so he has to type answers. It would likely
be a new extension built on top of the PDF viewer.

How this was researched: web search plus the pages the container could
reach. Notability's own blog and support site, Apple's App Store pages and
Google's NotebookLM pages are blocked from this container, so their details
below come from search excerpts of those pages and should be checked in the
app before anything is copied exactly. The one first-party page that could
be read in full is Anthropic's customer case study on Notability Learn.

## 1. How Notability Learn works

**Entry.** Open any note or PDF, tap the sparkle icon top right. Learn
first produces a summary of the material (copyable into the note), then
offers the study modes. The material has to be at least 250 words and at
most about 20,000 words. A page range can be chosen so the rest of the
document is left out. Learn is a Plus and Pro subscriber feature. Sources
it works from: handwriting, typed text, PDFs, and audio recordings.

**Three modes, one picker.** The picker reads "Memorize with flashcards,
Practice with questions, or Mixed-method test."

| Mode | What it is |
| --- | --- |
| Memorize | AI-generated flashcards from the material. Since the 2026 back-to-school release every card is rated Again, Hard, Good or Easy and spaced repetition brings weak cards back sooner. Decks can also be imported from Anki (.apkg, .txt) or CSV; import is cloud-only. |
| Practice | A multiple-choice quiz, about 10 questions per run. Right or wrong is shown as you go. A wrong answer can be retried immediately, "reinforcing the correct answer right then and there." An "Explain this" button at the bottom left breaks down the correct answer. A "Final Score!" screen ends the run with Retry and Give Feedback. Scores are tracked across retakes of the same quiz. |
| Test | Mixed formats that make you type: fill-in-the-blank (also by Apple Pencil), multiple choice, and the newer true-or-false and mix-and-match (tap or drag terms onto definitions, correct pairs turn green). A "Show only Fill in the Blanks" option forces typed answers. |

"Auto Study" chains the three into one flow: multiple choice, then
flashcards, then fill-in-the-blanks.

**Under the hood** (from the Anthropic case study, read in full):

- Claude writes the questions and the "Explain this" explanations. Haiku is
  the default model; Sonnet serves Pro subscribers' quizzes.
- Scale: 220 million quiz questions answered in a year, about 600,000 a
  day. 273,000 students answered study questions in April 2026.
- Quality is measured by the thumbs up or down on each question. Flagged
  questions fell from 33 per 10,000 to about 18 after a model upgrade.
  Internal evaluators run on every release.
- Learn users spend 90% more time in the app and 85% return weekly, against
  58% without it.
- The first version shipped in two months.

The two design facts worth copying: a question is a disposable, cheap
artifact that is regenerated freely, and the one quality signal that
matters is the user flagging a bad question.

## 2. How NotebookLM does it

NotebookLM added Flashcards and Quizzes to its Studio pane in September
2025, mobile in early 2026.

- **Generation** is one click per type. A pencil icon opens the options:
  number of items (fewer, standard, more), difficulty (easy, medium, hard)
  and a free-text prompt to narrow the topic. A quiz is typically 10 to 15
  four-option multiple-choice questions across all sources in the notebook.
- **During a quiz** each answer is marked right or wrong at once with a
  short explanation. An Explain button sends the question to the main
  chat, where the answer comes back with citations to the exact source
  passages, like any other NotebookLM answer.
- **After a quiz** a results screen shows the score with Review and Retake.
  A 2026 update added a summary of which topics the set covered, which you
  got right and which you struggled with, and the option to generate a
  study guide or a new flashcard set from the questions you missed.
- Quizzes can be shared by email. Flashcards are plain two-sided cards
  with no scheduling.

The idea to copy from NotebookLM is the citation: every question knows the
passage it came from, so "explain" and "show me where" are one click.

## 3. The neighbours

- **Quizlet Learn** is the oldest version of this loop. It mixes flashcards,
  multiple choice and written questions, and moves you from multiple choice
  to written as you get terms right ("guidance fading"). It tracks the terms
  you miss and drills them until you know them.
- **Goodnotes** has Study Sets (AI flashcards from handwriting) with Smart
  Learn adapting to per-card progress. No multiple-choice from PDFs found.

## 4. What the learning research says

- Retrieval practice of any kind (short answer, multiple choice, free
  recall) beats rereading for retention. Multiple choice is at least as
  effective as recall at producing the testing effect.
- Little and Bjork (2012, UCLA): multiple choice with **competitive**
  alternatives, meaning wrong options that are plausible enough that you
  have to recall why they are wrong, improves later recall of the wrong
  options' own facts too. Cued recall does not do this. So a well-built
  multiple-choice question is a review of several facts, not one.
- The weakness of machine-written questions is the distractors. In one
  audit of LLM-generated items, 57% had at least one implausible
  distractor; ambiguous items with more than one defensible answer were the
  other common flaw. The fixes that work: ask for 2 or 3 distractors that
  are semantically close to the answer and the same length, forbid "all of
  the above" and absolute terms, let the model reason before writing, and
  run a check pass that shows the model each distractor alone with the stem
  and rejects the item if any distractor could be correct.
- Typed answers remain the honest test. Recognising a right answer you
  could not have produced is the main way self-grading overstates what you
  know, which is why Flashcards already grades typed answers against a
  rubric.

Taken together: multiple choice is the right tool for fast coverage of a
section, typed answers for the things that must be produced on an exam, and
the two should feed each other.

## 5. What Parallx has today, and the gap

- **Flashcards** (`ext/flashcards`, 12,000 lines) does Memorize well: SM-2
  scheduling, Again/Hard/Good/Easy, Anki import, AI card generation from
  canvas pages, PDFs and photos with per-page attribution, typed answers
  graded against a rubric (M102), deck exam dates with pacing, a dashboard
  widget, chat tools, and `parallx://flashcards/...` links.
- **The PDF pane** (`src/editor/panes/pdfEditorPane.ts`) has highlights,
  Ask AI About Selection, Send to Chat, capture to Canvas, and lists the
  selection actions running tools register (that is how Flashcards'
  "Create Flashcard…" appears). It can be opened to a page and a quoted
  passage through `api.editors.openFileEditor(uri, { reveal: { page, quote } })`.
- **Extraction**: `parallxElectron.document.extractText` returns the whole
  text and `pageTexts` per page, so a question can carry its page.
- **Nothing does Practice or Test.** There is no way to open a chapter and
  be asked ten questions about it, and no way to find out which few things
  in a chapter you actually need cards for. Every card generated today goes
  into the scheduled queue whether or not the fact was already known.

## 6. Proposal: a Study extension

Working name **Study** (`ext/study`). A new extension rather than a mode
inside Flashcards, for three reasons: it is a different job (ten minutes on
a section now, versus a scheduled memory system), it must work with
Flashcards turned off, and Flashcards should stop growing. The hand-off
between them goes through a generic seam, the same way Worksheets offers
"Review Due Flashcards" only while the command exists.

### The loop

1. Open a PDF. Choose **Study This Document…** from the pane, or select a
   passage and choose **Quiz This Selection**.
2. Pick the scope: whole document, a page range, an outline chapter, or the
   selection. Pick the mode and the answer format.
3. Answer. Each question is marked at once. Wrong answers get a retry, an
   explanation grounded in the source passage, and a **Show Source** that
   jumps the PDF to the page and highlights the passage.
4. The results screen gives the score, the list of questions, which ones
   you missed, and **Send Missed to Flashcards** (shown only while
   Flashcards is on). Only what you got wrong becomes cards. That is the
   point of the whole thing.

### Modes

| Mode | What it does |
| --- | --- |
| Learn | A summary of the scope with the key points, each cited to a page. Read it, then go on to Practice. (Optional for v1: Chat already summarises; include only if the one-screen format earns it.) |
| Practice | Multiple choice, four options, ten questions by default. Instant marking, retry, explain, show source. |
| Test | The same questions with the answer format set to Type: a short typed answer graded against a rubric the way Flashcards grades its typed cards. Score and per-point feedback (hit, partial, miss). |
| Memorize | Not built here. Flashcards does it; Study feeds it. |

**Answer format** is a session setting, not a mode: Choose (multiple
choice), Type, or Mixed (start with multiple choice, switch a question to
Type once it has been answered right, the Quizlet fade). The user asked for
exactly this switch. Fill-in-the-blank, true-or-false and matching are not
in v1; a four-option question and a typed answer cover the two things that
matter.

### Questions

- Generated through `api.lm` from the scope's `pageTexts`, chunked by page,
  with the page tagged so every question stores `sourcePage` and a short
  `sourceQuote` (the Flashcards M98 grounding pattern, reused).
- Each question: stem, four options, the right one, a one-line explanation,
  the page, the quote, a difficulty tag, and for Test a rubric of the points
  a typed answer must contain. One JSON schema, validated on the way in.
- A check pass before a question is shown: each distractor alone with the
  stem; if the model would accept it, the question is dropped. Over-generate
  by a third and keep the ones that pass.
- Prompt rules carried over from the research: distractors must be
  plausible and about the answer's length, no "all of the above", no
  absolute terms, and the Flashcards exception for garbled maths (PDF text
  extraction shreds formulas; the model reconstructs them).
- Questions are cached per document, scope and content hash in the
  extension's SQLite, so a retake is instant and **New Questions** asks for
  a fresh set. Every answer is logged (question, chosen, right or wrong,
  time), and a thumbs-down on a question hides it and is the quality
  signal, as at Notability.

### Settings (manifest `configuration`)

`study.questionCount` (10), `study.choices` (4), `study.answerFormat`
(choose, type, mixed), `study.difficulty` (auto, easy, medium, hard),
`study.aiModel`, `study.aiThinking`, `study.validateDistractors` (on).

### Surfaces

- **PDF pane entry.** The toolbar's right cluster and the More Actions menu
  have no slot for a tool today, and the core must not name Study. The
  missing contribution point is an `editor/title` menu location (an entry
  with `when: "activeEditor == 'pdf'"`, shown in the pane's More Actions
  menu), the same shape as `view/title` and `viewContainer/title` that
  already exist in `contributes.menus`. Build it generically; Study is its
  first user. The selection entry needs nothing new: it registers a
  selection action with the dispatcher, like Flashcards.
- **Session pane.** An editor pane (`contributes.editors`, type `study`)
  with the question, the options or the answer box, the feedback strip, and
  the results screen. Kit components and `--px-*` tokens only.
- **Sidebar view.** Recent sessions per document, each with score and
  missed count, so a chapter's history is one glance.
- **Dashboard widget.** "Weak sections": the scopes with the lowest recent
  scores, each a door back into a new session on that scope.
- **Chat tool.** `study_quiz` so the agent can start a session on a
  document and page range, and `study_results` to report weak sections.
- **Links.** `parallx://study/session/<id>` so results can be cited.

### Modularity

- Study names no other tool. Flashcards is reached by checking that
  `flashcards.newCard` or a generic "add cards" command exists, and the
  Send Missed button appears only then; turned off, it goes.
- The PDF pane learns nothing about Study; it gains a generic menu slot.
- Nothing runs while Study is off: no extraction, no model calls, no cron.
- Canvas pages are a cheap second source (`canvas.getPageMarkdown`, as
  Flashcards does) and should follow once the PDF loop works.

### What is shared with Flashcards

The rubric grading (`fcNormalizeVerdict`, `fcScoreVerdict`,
`fcMapVerdictToRating`, about 150 pure lines) is the right grader for Test
mode. Extensions cannot import each other, so either the pure functions are
duplicated into Study with a note, or they move into a small shared module
both extensions copy at build. Duplicating is the smaller first step.

## 7. Open decisions for Mufaro

1. Name: Study, Quiz, or Practice.
2. Learn mode in v1, or Practice and Test only.
3. Four options or five per question.
4. Should a missed question in Practice also count as a lapse on an
   existing Flashcards card for the same fact, or stay separate.
5. Exam 7 use: should the generator be told the exam's style (CAS-style
   short calculation and essay prompts) through a per-document "exam
   profile", or stay generic in v1.

## 8. Proposed slices (order only)

1. Core: the `editor/title` menu contribution point, with a test.
2. Study extension skeleton: manifest, DB, settings, session pane, scope
   picker reading `pageTexts`.
3. Question generation with page grounding, schema validation and the
   distractor check; Practice mode end to end, with Show Source.
4. Test mode: typed answers, rubric grading, Mixed format.
5. Results, history, Send Missed to Flashcards through the generic seam.
6. Sidebar view, dashboard widget, chat tools, links.
7. Canvas pages as a source.

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
- Bjork Learning and Forgetting Lab, research summary (Little and Bjork on
  competitive alternatives): https://bjorklab.psych.ucla.edu/research/
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
