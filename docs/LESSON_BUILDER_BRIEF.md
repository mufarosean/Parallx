# Lesson Builder Brief — exam material into forms you can study

Written 2026-09-05 from the GitHub landscape review
(docs/research/GitHub_Landscape_2026-09.md). Mufaro: *OpenMAIC is what I
actually need, the ability to make exam content into digestible content
in varied forms.* THU-MAIC/OpenMAIC is MIT, so its prompts and scene
schemas are open to learn from. Its runtime (a Next.js server on
LangGraph) is the wrong shape to embed; the pipeline is rebuilt as a
Parallx extension over surfaces that already exist.

Status: brief only. Post-polish (docs/POLISH.md). Generic by design: any
material into study forms. The exam is one use; the vision rule (never
domain-specific features) holds.

---

## What OpenMAIC does (read from the repo 2026-09-05)

Two stages. Extractors turn PDF, Word, PowerPoint, audio, video, images
or web results into text. An outline stage streams a curriculum
(`app/api/generate/scene-outlines-stream`). Each outline item then
becomes a scene from a registry (`generate/scene-content`,
`generate/scene-actions`):

- **Slides** with narration, spotlight and laser pointer.
- **Quiz** with single choice, multiple choice and short answer, graded
  by a separate route (`api/quiz-grade`).
- **Interactive simulation**: AI-written HTML hosted in a sandboxed
  iframe (`InteractiveIframeHost`).
- **Project-based learning**: the learner picks a role and works with AI
  agents toward milestones (`scene-renderers/pbl`).
- **Deep interactive mode** adds 3D, process simulations, small games,
  mind maps and an in-browser coding environment.

Around it: an agent roster (`generate/agent-profiles`, a teacher plus AI
classmates who debate and ask), resumable jobs you can steer mid-way
(`agent/sessions`), offline HTML export, video export through a render
service, twenty built-in skills, and one `skills/openmaic/SKILL.md` so a
coding agent can drive the whole thing.

---

## What exists in Parallx (verified 2026-09-05)

| OpenMAIC piece | Parallx today |
| --- | --- |
| Extractors | `documentExtractionService` over the Docling bridge with pdf-parse, mammoth and SheetJS fallbacks |
| Outline | Concept maps: the model writes an outline, the app draws it, editing means editing the text (the governing rule, proven twice) |
| Slides / explainer | Canvas pages with KaTeX through `ui/renderMarkdown`; page templates in canvasTemplates.ts |
| Quiz | The `quiz` canvas template (each heading a question, answers in the list, "ask the AI to mark this page") and M102 production recall in flashcards |
| Flashcards | ext/flashcards: `fcGenerateCards` from a page or a PDF page range, page-grounded (`sourceUri`, `sourcePage`, jump to the PDF page), FSRS-6, deadline pacing, leech loop |
| Explorables with checks | ext/concept-lab: `defineModule` explorables whose defaults are the paper's own worked example and whose `checks` are machine-verified; a curriculum ladder with `foundations` and `bridges`. Hand-authored, exam-specific |
| Coding scene | M96 notebooks (real .ipynb over a stdio kernel host) |
| Practice sheets | M99 worksheets (Univer, lazy bundle) |
| Sandboxed AI-written HTML | Dashboard HTML widgets run as sandboxed iframes; the custom-block brief (parked) specifies the same isolation for blocks |
| Personas | M89 voice registry |
| Resumable jobs with traces | The workflow runner: runs are documents |
| Narration / TTS | None found in src or ext |

The pieces are built. What is missing is the pipeline that turns one
source and one goal into a set of forms, and the registry that says what
a form is.

---

## The model

**Input.** A source the extraction service can read (a paper, a chapter,
a canvas page, a PDF page range) and a goal in a sentence ("understand
Clark's method", "revise chapter 4 for the exam in thirty days").

**Stage 1, the outline.** The agent writes a study outline as a canvas
page. The outline is the truth for everything downstream: editing the
plan means editing that page, and regenerating a form never rewrites the
outline. Each outline item names the forms it wants.

**Stage 2, forms from a registry.** A form is something Parallx already
renders, with a generator and a grounding rule. v1 registry:

| Form | Renders as | Generator | Grounding |
| --- | --- | --- | --- |
| Explainer | Canvas page (KaTeX, callouts, worked example) | Agent turn with the source slice inside the prompt | `sourceUri` + page range in page metadata |
| Concept map | conceptMap block | Outline text | Source page id required |
| Flashcards | Deck in ext/flashcards | `fcGenerateCards` | Already page-grounded |
| Quiz | `quiz` template page | Agent turn; marking by a separate grader turn | Source paragraph cited per question |
| Walkthrough | Canvas page with predict-then-reveal blocks (the Concept Lab pattern made generic: the paper's own worked example, one step hidden at a time) | Agent turn | Source example cited |
| Practice sheet | Worksheet | Agent writes the cells | Source table cited |
| Classmate debate | A chat mode with two personas (teacher, sceptic) seeded from the outline item | Voice registry | Outline item in the prompt |
| Explorable (later) | Custom block in a sandboxed iframe | Agent writes code plus params plus data | Custom-block brief |

New forms register the same way an extension registers a block or a
widget; the registry is the contribution point, not a switch statement.

**Grounding is structural.** Every generator receives the source slice
inside its prompt and refuses a source it has not read (the M85
read-before-edit registry). Every form records where it came from and can
jump there. This is the mindmap lesson applied before the first line is
written: an optional source parameter is not a rail.

**Grading is blind.** Adopt Engram's rule (nagisanzenin/engram, MIT): the
turn that marks a quiz or a production-recall answer never sees the
lesson that taught it, only the question, the rubric and the answer.
Every grade is a receipt stored with the attempt. Pacing changes quote
the receipts.

**Generation is a workflow run.** Building a lesson is a long job. Run it
through the workflow runner so it is resumable, traceable and steerable:
one run per outline, one node per form, the trace shows what was
generated from which pages. Cancel and resume come for free.

**The study loop closes on what exists.** Forms feed deadline pacing
(M101), production recall (M102) and the leech loop (M98). The lesson
builder makes material; the flashcards extension already schedules it.

---

## What to skip from OpenMAIC

The narrated lecture theatre and TTS, 3D scenes, video export, avatars,
the Next.js server, and the project role-play scene in v1. The lesson
theatre is their product; the forms are ours.

---

## Decisions (Mufaro's)

**L1 — v1 forms.** Recommendation: explainer, concept map, flashcards,
quiz, walkthrough. All five render on surfaces that exist today.

**L2 — Where does the outline live?** Recommendation: a canvas page with
a `lesson` template, so it prints and is editable in place.

**L3 — Classmate debate.** Recommendation: v2, as a chat mode, no new
surface.

**L4 — Blind grader.** Recommendation: adopt for quiz marking and
production recall together; one grader, two callers.

**L5 — Explorables.** Recommendation: wait for the custom-block brief to
unpark. The walkthrough form covers most of the value meanwhile.

**L6 — Generation runner.** Recommendation: the workflow runner, not a
bespoke job queue.

---

## Execution order (each step ships alone)

1. The form registry and the `lesson` outline template; explainer and
   concept map forms (both are a prompt plus an existing renderer).
2. Flashcards and quiz forms wired to the existing generator and
   template; the blind grader.
3. The walkthrough form: predict-then-reveal blocks, generic.
4. Generation as a workflow run with per-form nodes and trace.
5. Practice sheet and classmate debate.
6. Explorables when custom blocks land.

## Non-goals and risks

- No lecture playback, no voice, no video.
- No exam-specific content in the extension. Concept Lab keeps its
  hand-authored modules; the builder generates from the user's sources.
- Risk: local models generate ungrounded explainers. Structural grounding
  and the tests/ai-eval harness (real Ollama, rubric-scored scenarios)
  are the defence; add lesson scenarios before shipping.
- Risk: token cost per lesson. One form per node lets the user pick
  forms; the trace shows cost per form.
