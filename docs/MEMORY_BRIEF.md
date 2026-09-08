# Memory Brief — memory as an editable artifact

Written 2026-09-05 from the GitHub landscape review
(docs/research/GitHub_Landscape_2026-09.md). Mufaro's pick from Tier 1:
*memory as an editable artifact.* The repos that converge on this idea
are claude-mem, obsidian-mind, EverOS and TencentDB Agent Memory. None of
their code transfers; the shape does.

Status: brief only. Post-polish (docs/POLISH.md).

---

## The diagnosis

Parallx memory is already markdown. That is the good news and the reason
this brief is small. The bad news is that nobody can see it.

- The agent curates `.parallx/memory/MEMORY.md`, a bounded index (2,500
  chars) of one-line pointers to per-topic lesson files at
  `.parallx/memory/lessons/<slug>.md` (M81 Phase 8). Daily files are
  append-only logs. `USER.md` is the identity file (1,500 chars).
- Three tools own it: `memory_read`, `memory_search`, `memory_write`
  (src/built-in/chat/tools/memoryTools.ts). Caps are enforced before the
  write; an over-cap write returns the file so the agent must consolidate.
- Session summaries are appended to the daily file and embedded into the
  vector index for recall into new sessions under a token budget, with
  decay and eviction (src/services/memoryService.ts).
- Mind holds beliefs with provenance through `mind_remember` and a
  tamper-evident ledger; it has a panel. Per-task working memory lives in
  agentMemoryService (goal / assumption / plan / evidence / attempt /
  artifact, capped per category).

What is missing, verified 2026-09-05:

1. **No surface.** `ls src/built-in` has no memory view; ai-settings has
   no memory rows. The only way to read or fix what the agent believes
   about you is to open hidden files in the explorer. Mind has a panel;
   memory does not.
2. **No provenance.** A lesson does not say which session, day or journal
   event produced it. When a lesson is wrong there is no path back to the
   evidence, so the fix is delete-and-hope.
3. **No consolidation.** Lessons are curated at write time by whichever
   turn wrote them. Nothing merges duplicates, promotes a fact that
   recurs across daily files, or archives a lesson nothing has touched
   in months. Mind has a daily reflection cadence
   (mind/reflectionScheduler.ts); memory has none.
4. **No forget marker.** The journal redacts before store; chat has no
   "do not remember this" gesture.

---

## What the repos teach (and what to skip)

| Repo | Adopt | Skip |
| --- | --- | --- |
| claude-mem (Apache-2.0) | Progressive disclosure: a 50 to 100 token index first, a timeline second, full detail only for filtered ids (their measured tenfold token saving). `<private>` tags to exclude content from storage | Their hosted observer service; Chroma |
| obsidian-mind (MIT) | Hooks do plumbing, the agent does judgment: classification and indexing are deterministic; only content decisions are the model's. An injection-size meter shown every session | Cross-repo MCP server; performance-review notes |
| EverOS (Apache-2.0) | Markdown is the source of truth, SQLite and vectors are indexes; offline "memory evolution" between sessions merges episode clusters and refines profiles | Multi-agent tenancy dimensions |
| TencentDB Agent Memory | Four layers with a deterministic path down: L0 raw, L1 atomic facts, L2 scenario blocks, L3 persona. Summaries are collapsible, never irreversible | Team-level hub; Mermaid offloading |

Parallx already has every layer's storage: L0 is the activity journal and
the M91 transcripts; L1 is the daily file; L2 is the lessons folder; L3 is
`USER.md`. What is missing is the links between layers, one consolidation
pass, and a place to look.

---

## The model

**Files stay the truth.** `.parallx/memory/` is portable, git-diffable and
already agent-writable. The surface renders these files; it does not
migrate them into SQLite or canvas pages. (The retired mindmap program is
the reminder: a second source of truth is how content drifts.)

**A Memory view in the AI hub.** Three tabs over the existing
workspaceMemoryService methods (listLessons, parseMemoryIndex,
readDailyMemory, readUserFile): Lessons (the index, each row opens the
file in the editor, with Archive and Delete), Days (the daily files,
newest first), and About You (`USER.md`). Every row shows its provenance
chips (below) and a Wrong action that archives the lesson and stamps the
correction into today's daily file so the agent learns the negative. The
Mind panel's readout stays where it is; this is memory, not beliefs.

**Provenance is required, not optional.** `memory_write` stamps every
lesson with frontmatter `sources:` naming the session id and date it came
from; the daily-file line a lesson was promoted from carries the lesson
slug. A lesson without a source is refused, the same way the mindmap
grounding rail should have refused an unsourced map. The view turns
sources into chips that open the M91 transcript read-only.

**Consolidation is a stock workflow, not code.** A daily workflow
(schedule, facts, mission) whose mission is: read yesterday's daily file,
promote facts that recur across three or more days into a lesson, merge
lessons that say the same thing, archive lessons untouched for 90 days,
and report what changed as the run's trace. This is the second proof that
heartbeat-style behaviour belongs in the workflow engine
(docs/WORKFLOWS_BRIEF.md: "the built-in heartbeat checks stop being
code"). It runs under the autonomous consent posture, so any deletion is
an archive, never a hard delete.

**Disclosure is prompt shaping, not new storage.** `memory_search`
already returns index lines; `memory_read` already returns one file. The
work is the middle layer (a "what happened around this" answer from the
journal's query by date) and an eval that shows the agent reaching for
the index before the file. Add the obsidian-mind meter: the chat header
shows how many tokens of memory rode into this turn.

**Forgetting is a gesture.** A message action "Do not remember this"
marks the turn; summarisation and `memory_write` skip marked turns. The
journal's redact-before-store rule already exists for the store side.

---

## Decisions (Mufaro's)

**D1 — Files or database?** Recommendation: files stay the truth, the
view is a renderer. No migration.

**D2 — Where does the view live?** Recommendation: a tab in the AI hub
next to the Mind readout, not a sidebar view. Memory is consulted, not
watched.

**D3 — Consolidation as a stock workflow or as a service?**
Recommendation: stock workflow. It is visible, tunable and disableable
for free, and it is a real second tenant for the engine.

**D4 — Provenance required?** Recommendation: required. Optional rails
are not rails.

**D5 — Should consolidation ever hard-delete?** Recommendation: no.
Archive only; the user deletes.

---

## Execution order (each step ships alone)

1. Provenance stamping in `memory_write` and the lesson frontmatter;
   refuse unsourced lessons. Migration: existing lessons get
   `sources: [legacy]`.
2. The Memory view over existing service methods, with Archive, Delete,
   Wrong, and provenance chips. Probe-captured before it is shown.
3. The consolidation stock workflow in workflowLibrary, disabled by
   default, with its trace as the audit.
4. The token meter in the chat header and the disclosure eval scenario in
   tests/ai-eval.
5. The forget gesture.

## Non-goals and risks

- No new vector store, no cloud sync, no second memory format.
- Do not resurrect regex extraction of preferences or concepts; M81
  removed it on purpose because it produced noise the agent then trusted.
- Risk: consolidation by a local model rewrites a good lesson badly. The
  workflow archives the old version and the trace shows the diff; nothing
  is lost, and Wrong is one click.
- Risk: the view makes memory feel like a to-do list to groom. Keep it
  read-mostly; the agent does the grooming.
