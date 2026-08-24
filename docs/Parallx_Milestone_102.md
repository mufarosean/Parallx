# Parallx Milestone 102 — Production Recall: Say It, Don't Recognise It

> **Status: BUILT** (2026-08-23, branch `m100-concept-lab` lineage).
> All of A, B and C landed. `tsc --noEmit` clean; 5,438 unit tests green
> across 319 files, including 63 new pure-logic tests for the grading core
> and 24 for the concept-map renderer.
> **PENDING: in-app verification by Mufaro — none of this has been rendered
> on screen.** Specifically unverified: the answer box and streamed verdict
> in a real study session, marking latency on a local model, whether the
> classify pass promotes sensibly on a real Exam 7 deck, and how a concept
> map looks in the chat column at real widths.

## The ask (Mufaro, 2026-08-23)

Assessing Parallx against NotebookLM surfaced one gap that is not a feature
gap but a *measurement* gap, in his words:

- "It can be easy to think I understand a card because I recognise what it
  says, vs actually being asked to put together a cohesive sentence."
- "This would require a demarkation between conceptual flashcards, lists, vs
  formulas."
- "We tag conceptual cards, I review card, type my answer each time I see it.
  AI grades based on linked context to card, [the] grade is mapped to levels."

Plus two smaller surfaces from the same conversation:

- Quizzes live in **canvas**, graded in place by the AI, with no scoreboard
  and no separate extension. "If we have a free surface to do it, I would use
  that instead of inventing something else."
- The workspace graph is a failure as a study tool ("I was merely copying
  Obsidian"). What is wanted instead is a **small mindmap the AI draws inside
  a chat answer** to show how a handful of ideas connect.

## Why this is a correctness fix, not a feature

Today the study loop reveals the back and asks you to self-grade. For a
formula that is roughly honest — you either produced it in your head or you
did not. For a conceptual card it is close to worthless, because what gets
graded is *fluency*: the answer looks familiar, so it gets a Good.

FSRS-6 (M98) fits stability and difficulty to the grade stream. Every
inflated Good on a soft conceptual card raises stability on a card that
cannot actually be explained, and through M101's exam-date cap that error
propagates into the study plan itself. The scheduler is not wrong; it is
being fed a measurement of the wrong thing.

So the fix is to make the *measurement* match the claim: for cards whose
value is an explanation, the review has to elicit an explanation.

## The three decisions that make it stable

### 1. The rubric is authored once, at card creation, and cached

The obvious implementation — let the model read the source and judge the
answer in one shot — silently destroys the grade stream. The model invents
the standard at grade time, so it invents a slightly different standard on
every review, and the same answer earns Good on Monday and Hard on Friday.
FSRS assumes grades are comparable across time. Inconsistent standards
replace "self-grading is too generous" (a stable bias, which FSRS can
absorb) with "grading is noise" (which it cannot).

Therefore: generation emits `rubric` alongside front/back, it is stored on
the card, it is visible and editable in the card editor, and grading judges
against the **stored** rubric forever after.

### 2. The model extracts; code maps

The model is never asked "is this Good or Easy." It is asked the factual
question it is actually good at — *for each rubric point, did the answer
contain it?* — and returns `hit | partial | miss` per point plus one
`contradiction` flag. A pure function turns that into 1..4.

Consequence: two identical answers cannot land on different levels, the
mapping is unit-testable without a model, and the thresholds are inspectable
and tunable. Same division of labour as M101's pair-judge.

### 3. The source excerpt is captured at generation, not at review

`parallxElectron.document.extractText` extracts a **whole document**
(`main.js:3201`). Calling that on every review of a card sourced from a
300-page paper is not viable. Generation already holds the page text in
memory, so the card stores a capped excerpt of the page it came from.

This also makes the grading standard immutable: the card is graded against
what the source said *when the card was made*, and it keeps working if the
PDF is moved or the workspace is opened elsewhere.

## Grade mapping

`fcMapVerdictToRating(verdict, rubric)` — pure, exported through
`__testables`.

| Condition | Rating |
| --- | --- |
| Answer contradicts the source | **Again (1)** |
| score < 0.5 | **Again (1)** |
| 2+ `required` points missed | **Hard (2)** |
| 1 `required` point missed, and it was the only gap, score >= 0.65 | **Good (3)** |
| 1 `required` point missed, otherwise | **Hard (2)** |
| every point hit, none partial (rubric of 2+) | **Easy (4)** |
| score >= 0.65 | **Good (3)** |
| otherwise | **Hard (2)** |

`score = (hits + 0.5 * partials) / points`.

**The 0.65 floor was found by testing, not chosen.** It started at 0.8, and a
test enumerating the reachable scores per rubric size showed GOOD was
unreachable by hits alone on 2-, 3- and 4-point rubrics — the only scores
below a perfect answer are 0.5, 0.67 and 0.75. Since rubrics are 3-5 points
in practice, that was the *normal* case, not an edge one: every review would
have landed HARD or EASY, feeding FSRS a bimodal stream and shrinking
intervals across the deck. The "one essential gap on an otherwise clean
answer" clause exists for the same reason.

Two properties are pinned by test rather than by example: GOOD is reachable
at every realistic rubric size, and the mapping is **monotonic** — producing
more of the answer can never grade worse. Monotonicity is the stronger
guarantee, because 2- and 3-point rubrics genuinely cannot reach all four
grades by hits alone and no threshold choice would change that.

**Speed is deliberately not an input.** For recognition cards, latency is
evidence of retrieval effort. For a typed answer it measures typing, so
folding it in would grade fast typists as knowing more. Completeness is the
whole signal: a complete, unhedged, self-produced explanation *is* the
Easy-tier evidence, and a stronger one than any recognition-Easy.

**A contradiction outranks everything.** A confidently wrong answer is worse
evidence than a blank one, and it is precisely what self-grading never
catches — you read the back, recognise your error, and press Hard.

## The four recall modes

`fc_cards.recall_mode` — a column, not a tag. Behaviour branches on it, and
a mistyped tag would silently drop a card back to recognition grading with
no visible symptom.

| Mode | Elicits | Grader | Notes |
| --- | --- | --- | --- |
| `recognition` | nothing (today's loop) | self-grade | Default. Existing cards keep exactly today's behaviour. |
| `conceptual` | a typed answer, in prose | AI vs stored rubric points | The reason for the milestone. |
| `list` | free enumeration | set overlap vs stored items | Model only adjudicates paraphrase; the score is arithmetic. |
| `formula` | the formula | deterministic normalise + compare, AI only on mismatch | Cheap and offline in the common case. |

**The dividing line is the SHAPE of a correct answer, not its difficulty.**
The first cut of the classifier got this wrong: it defined `conceptual` as
"an explanation — a why, a mechanism, a comparison" and sent bare definitions
to `recognition`, on the reasoning that recognising a definition is knowing
it. Mufaro's correction: *"when I say conceptual, I just mean any flashcard
that requires a written response without a formula."*

He is right, and the original framing defeated the milestone's own premise on
the largest class of cards in the deck. Stating a definition in your own words
IS the skill being tested, and reading one off the back and feeling it land is
precisely the recognition this exists to stop. So:

- `conceptual` = a correct answer is a **sentence**. Definitions included.
- `recognition` = a correct answer is a **bare token** — a name, a date, a
  number, a term. Nothing is composed, so there is nothing to write.

The tie-break in both prompts was also inverted. It read "be conservative,
when a card could go either way it is recognition"; it now reads "could you
answer this correctly in three words? If not, it is conceptual." The old
default pushed exactly the ambiguous middle — where most real cards sit —
into the mode that measures nothing.

`list` is the sleeper mode. "Name Mack's three assumptions" is exactly where
recognition lies loudest — the list looks obvious once seen — and set
overlap yields a naturally graded score (3 of 5) rather than a binary, which
maps onto FSRS far better than a self-graded guess.

## Decisions taken without blocking (Mufaro did not pick; these are defaults)

1. **Retrofit.** Existing cards default to `recognition`, so no deck changes
   behaviour on migration. A batch classify action proposes modes for review;
   nothing is relabelled silently.
2. **Pacing.** Production cards get their own daily cap, counted separately.
   M101's pacing math assumes cards cost roughly the same; a conceptual card
   is 30-60s against 5s, so mixing them into one allowance would quietly
   shrink real coverage. M101's engine is not touched.
3. **Unsourced cards** (hand-made, Anki imports) may still be `conceptual`.
   They grade against the card's own answer text and the verdict is marked
   unsourced, so weaker evidence is visible rather than hidden.

   Revised during implementation: the grading reference is `back` + the
   source excerpt, and **not** the card's notes, which the plan originally
   included. Notes are the learner's own mnemonics, so marking an answer
   against them is circular — a misconception written into the notes would
   mark itself correct forever after. Pinned by a test.
4. **Source-set coverage tracking** (would subsume `.claude/coverage_ledger.md`)
   is out of scope here.

## Work items

### A. Flashcards — production recall

- **A1** Migration `flashcards_006_recall.sql`: `fc_cards.recall_mode`,
  `fc_cards.rubric`, `fc_cards.source_excerpt`; `fc_reviews.answer_text`,
  `fc_reviews.verdict`. Plus `rowToCard` and the card CRUD paths.
- **A2** Rubric authoring in `fcGenerateCards` / `fcExtractCardsJson` /
  `fcCreateCardsBulk`, and the excerpt capture. Output-token budget
  (`FC_OUTPUT_TOKENS_PER_CARD`) re-costed — rubric points add output per card
  and the current 280 under-reserves, which truncates JSON mid-array.
- **A3** Mode + rubric editing in `fcCardEditorEl`.
- **A4** `fcGradeAnswer` — one AI call, structured verdict out.
- **A5** `fcMapVerdictToRating` — pure, tested.
- **A6** Per-mode graders: rubric judging, set overlap, formula normalise.
- **A7** Study loop: answer box, submit, instant reveal, verdict streaming in
  underneath, grade applied. Only production cards pay the latency.
- **A8** Grading context assembly + unsourced fallback.
- **A9** `fcGradeCard` writes `answer_text` / `verdict`; `fcUndoGrade` unwinds
  them.
- **A10** Answer history for a card.
- **A11** Batch classify action for existing cards.
- **A12** Tests.

### B. Canvas quizzes

- **B1** Quiz template in `canvasTemplates.ts` fixing the question / answer /
  commentary convention. The convention is the mechanism — it is what lets
  grading find your answers instead of guessing at page structure.
- **B2** Quiz skill in `defaultSkillContents.ts`: *generate* (source → questions
  onto a page) and *grade* (read blocks → insert commentary).
- **B3** Commentary block treatment so grading reads as distinct from answers.

No scoreboard, no extension, no writeback into flashcards. Canvas pages are
indexed, so history is a search.

### C. Inline chat mindmap

- **C1** Fenced block + markdown-it block rule, mirroring the math block rule
  at `chatContentParts.ts:748`.
- **C2** SVG renderer, theme tokens only.
- **C3** Clickable nodes → open source / ask follow-up.
- **C4** Parse failure degrades to the indented outline, never a blank box.
- **C5** Emission nudge so the model reaches for it on "how do these connect".

Syntax is an indented list, not mermaid: local models emit indented lists
reliably and mangle mermaid, and a mermaid syntax error renders as nothing
while a mangled outline is still readable.

## What shipped, by file

- `ext/flashcards/db/migrations/flashcards_006_recall.sql` — the three card
  columns and two review columns.
- `ext/flashcards/main.js` — normalizers, the grading core
  (`fcScoreVerdict` / `fcMapVerdictToRating` / `fcNormalizeFormula` /
  `fcMatchListItems`), the marker (`fcMarkAnswer` / `fcGradeAnswer`),
  rubric derivation, the study-loop answer box and streamed verdict, the
  card editor's mode picker and rubric field, the production cap
  (`fcCapProductionCards`), the classify pass (`fcClassifyDeckRecall`), and
  answer history.
- `ext/flashcards/parallx-manifest.json` — `productionRecall`,
  `productionDailyLimit`.
- `src/built-in/canvas/canvasTemplates.ts` — the Quiz template.
- `src/built-in/chat/skills/defaultSkillContents.ts` — the `quiz` skill.
- `src/built-in/chat/rendering/chatMindMap.ts` — parse, layout, render.
- `src/built-in/chat/rendering/chatContentParts.ts` — the ```mindmap fence
  renderer and node click wiring.
- `src/built-in/chat/widgets/chatWidget.{ts,css}` — the node-click listener
  and the map's theme-owned styling.
- `src/openclaw/openclawSystemPrompt.ts` — `buildConceptMapSection`.
- `tests/unit/flashcardsRecall.test.ts` (63), `tests/unit/chatMindMap.test.ts`
  (24), plus the chat-gate registration for the new file.

Two incidental fixes made along the way, both latent before this milestone:

- `fcCreateCardsBulk`'s rows-per-statement was the literal 50 chosen when a
  row was 8 parameters wide. The row is 18 wide now, which put a statement
  at 900 against SQLite's 999 ceiling — two columns from silently failing an
  import. It is derived from the row width now.
- The generation output reserve is re-costed per card when rubrics are on
  (`FC_OUTPUT_TOKENS_PER_RUBRIC`), and *not* when they are off. Folding it
  into the flat 280 would have shrunk the material clip limit on every run,
  which is the same coverage loss M101 raised that number to fix.

## Follow-up: Skip

Defer a card to the back of the session. `Skip` button, or `S`.

Mechanically it is a splice-out at `index` and a push — so the queue length,
the progress denominator, and `doneCount` are all unchanged, and `index`
already points at the next card once the splice lands. Nothing is written: no
review row, no FSRS update, no scheduling change. That is the contract, and
it is what the behavioural test asserts, because a defer that quietly touched
the schedule would be a way to corrupt FSRS without ever pressing a grade.

Two deliberate limits:

- **Before the reveal only.** Once you have seen the answer, re-serving the
  card in the same session tests nothing. Again already covers "I could not
  do this", and it schedules honestly.
- **Rendered only when there is somewhere to skip to** — more cards ahead, or
  a learning card due to cut in. A button that silently does nothing on the
  last card of a session reads as broken.

Fixed while in there: the pre-reveal key legend claimed "Space reveals the
answer" on production cards, where Space deliberately does *not* reveal
(Submit owns the reveal, so Space cannot skip past the answer the card exists
to elicit). The legend is now assembled from the keys that actually fire.

## Follow-up: a marking can go to chat

Asked for by Mufaro after the build. A grade tells you that you missed
something; the conversation worth having is about *what*.

Rather than a new surface, this extends the card-discussion path that already
existed (`fcExplainInChat`, reached from the answer card's corner mark). It
takes an optional `marking`, and when one is present two things change:

- The chat attachment gains the full transcript — the answer as typed, the
  grade, and the **per-point breakdown verbatim**. The breakdown is the point:
  the grade is the least useful part of a verdict, and a model cannot ask
  about a gap it was only told the size of.
- The staged prompt becomes a different question. Not "explain this card" but
  "I was marked Hard, here is what I did not produce, close that gap" — and a
  contradiction rewrites it again, because believing something the source
  denies is a different problem from having missed a point and needs the
  false belief named first.

Three entry points, one function:

- **Discuss This Marking** on the verdict block — the moment you have just
  been told what you could not produce is when the question is sharpest.
- The **existing corner Discuss button** picks the marking up automatically
  when the card was just graded. One AI action that asks a better question
  beats two actions doing nearly the same thing.
- **Discuss** on each entry in the Browse answer history, so an answer from
  weeks ago is reachable too — often the useful question is about a mistake
  you can now see you kept making the same way.

`session.lastMarking` is cleared per card, not merely overwritten: a
recognition card following a graded one would otherwise hand the previous
card's answer to the chat.

## Follow-up: the deadline beats the batch size

Raised by Mufaro after the build, from a real position: *"if I have 2000
cards, I cannot wait until my exam to learn them all."*

The diagnosis was partly a misread — Cram is a preview mode, but **Extra New
Cards** and **Review Ahead** both write scheduling, and the daily limits are
per-session batch sizes rather than daily ceilings. But underneath it was a
real defect.

`fcPacePlan` clamped the paced rate to `dailyNewLimit`:

```js
const rate = Math.min(ceiling, needed);   // old
```

2,000 cards against a 90-day exam leaves 76 introduction days and needs
27/day. The ceiling is 20. Pacing handed over 20, and the deck card printed
`Pace 20/day, introduced by <date ~24 days past the exam>` — honest, and
entirely passive. Nothing said *this pace does not finish in time*.

**The deadline now wins** (Mufaro's call, over warning-only). Pacing still
shrinks the batch when there is time to spare — that reduction is the point
of it — it just no longer refuses to raise it when there is not. `raised` is
returned on the plan and the deck card says so, because silently exceeding a
number the user set in Settings would make that number a lie.

Two things had to move with it, and both would have made the raise a no-op:

- **`fcBuildQueue`'s `newLimit`** is a second, global slice applied *after*
  the per-deck allowance. Left at the raw setting it trimmed a raised pace
  straight back down. The session now passes `max(setting, paced total)`.
- **The M102 production cap** trimmed the new band too. Introduction is
  deadline-owned, so the cap now applies to the **review band only**. A
  deferred review returns tomorrow at no cost to the plan; a deferred
  introduction pushes the whole schedule against a fixed date — and it would
  spiral, since the untouched backlog raises next session's required rate
  again. `fcCapProductionCards(review, limit)` lost its `fresh` argument.

Pinned by test: a raised pace always finishes before the freeze window
across deck sizes 500-5,000 and horizons of 20-90 days, and the full chain
(pace → session limit → cap) actually serves the raised count.

## Deferred

- **Source sets** (bounded corpus, hard grounding, chapter scoping from the
  PDF outline) — M103. `RetrievalOptions` already carries `sourceIds` and
  `pathPrefixes`, so the plumbing exists; the milestone is the persisted set
  object, the refusal contract, and page-anchored citations.
- **Audio / TTS** — after M103.
- **`ext/workspace-graph`** — retire or leave; awaiting Mufaro's call.
