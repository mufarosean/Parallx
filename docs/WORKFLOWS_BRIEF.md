# Workflows Brief — making autonomy visible

Written 2026-08-27 from the observation that started it: *the cron and
heartbeat systems feel obscure, which is a large part of why I have not
been using them.* That is not a UI complaint. It is a diagnosis, and the
fix is structural.

---

## The diagnosis

Read what a scheduled job can actually carry today
(`src/openclaw/openclawCronService.ts`):

```ts
interface ICronPayload {
  readonly systemEvent?: Record<string, unknown>;
  readonly agentTurn?: string;
}
```

That is the whole vocabulary. **An automation in Parallx is a prompt on a
timer.** You cannot see what it will do before it runs, you cannot reason
about what happens when two of them come due together, and the only way
to change its behaviour is to reword a sentence and hope.

The heartbeat has the mirror problem — it is split in half, and neither
half is legible:

- Seven built-in checks (stalled plan, review-queue triage, overdue
  follow-up, sync failure, morning digest, AGENTS staleness…) live in
  `heartbeatTriggers.ts` as **code**, tuned by three numbers in Settings
  (`stallDays`, `reviewQueueSize`, `overdueDays`) and a set of cooldown
  constants nobody can see (7d, 3d, 3d, 6h, 30d).
- Everything else lives in `.parallx/HEARTBEAT.md` as **free-text
  bullets** the model evaluates against collected facts.

So the app's standing behaviour is half hard-coded and half prose. There
is no third thing — no place where a behaviour is *specified*, visible,
composable and editable. That missing third thing is a workflow.

---

## What already exists (this is the good news)

Almost none of this is new construction. The parts are built:

| Need | Already in-tree |
| --- | --- |
| Time triggers | `CronService` + `AutomationScheduleSpec` (daily / weekly / interval / once / cron), already shared by Planner Automations and the AI Hub |
| Condition triggers | `heartbeatTriggers.ts` — findings, a cooldown ledger with retention, rising-edge state keys |
| Event triggers | Activity journal with typed actor/verb/source unions and a filtered `query()` |
| Action palette | Tool registry + enablement, and Phase B's command bus (`executeCommandFrom` stamps origin) |
| Subroutines | `SkillLoaderService` — and `SkillKind` is **already** `'tool' \| 'workflow'`, with typed `ISkillParameter`s |
| The node catalogue | Phase C's `IIntrospectionService`: `describeTools`, `commands`, `keybindings`, `settings`, `services` |
| Gating | M90's initiator-based consent (user-initiated approved, autonomous on a dial) + `agentApprovalService`, `agentPolicyService` |
| Restraint | `mind/nagGovernor.ts`, `mind/actionLedger.ts`, `reflectionScheduler.ts` |
| Observability | Journal taps, `autonomyEventLog`, `autonomyReplayCommand` |

What is missing is not capability. It is a **composition model** and a
**surface**.

---

## The model

A workflow is a directed graph of typed nodes plus an arbitration policy.
Five node families, each mapping onto something that exists:

**Triggers** — start a run. Schedule (the existing spec), heartbeat
finding, journal event (filtered by verb/actor/source), file or folder
appearance, workspace condition (review queue over N, exam within M
days), manual, or command invocation. A workflow with a manual trigger is
also a palette entry — the same graph, run on demand.

**Reads** — gather facts, no side effects, always safe to run. Workspace
queries, canvas pages, database rows, flashcard due counts, planner
state, introspection reads, a web fetch.

**Judgment** — the model, asked a *bounded* question with a typed answer
shape. This is the only nondeterministic family and it should be the
rarest. A skill is a judgment node with parameters — skills already carry
`kind: 'workflow'`, so a skill is a subroutine with a signature.

**Actions** — the side effects. Run a tool, execute a command (origin
stamped as the workflow), write a page, create cards, add planner tasks,
notify, email. Every action node routes through consent.

**Control** — branch on a condition, gate on approval, **cooldown**
(the heartbeat ledger, generalised and made reusable instead of five
hard-coded constants), throttle, mutex, priority.

### The arbiter

The part that answers "how do they interact?". Workflows do not merely
run; the system decides *whether* and *when*:

- every workflow declares a **class** — quiet / attention-seeking /
  destructive — and the class sets its default gating;
- an **attention budget**: how many times a day the app may interrupt
  you at all, across every workflow (`nagGovernor` already holds this
  idea, scoped to one caller);
- **priority** ordering when several come due in the same beat;
- **mutex groups** so two workflows cannot both rewrite the planner;
- **cooldowns** per workflow and per finding key, with the ledger
  semantics the heartbeat already proved: stamp on delivery SUCCESS, so
  a failure retries next beat.

### Runs are documents

Every run produces a trace: which nodes fired, what each returned, where
it branched, what was gated and by whom. The journal already stamps
origin; `autonomyReplayCommand` already proves replay is a concept the
app accepts. Watching a run animate through the graph is both the
debugger and the reason this is enjoyable to use.

---

## What this buys, concretely

The built-in heartbeat checks **stop being code**. UC1 "stalled plan"
becomes a three-node graph — *plan step untouched N days* → *cooldown 7d*
→ *notify* — that you can open, read, retune, disable, or fork. The
obscurity dissolves because there is nothing hidden left: the app's
standing behaviour is a set of documents in the same place as yours.

An existing cron job migrates as a two-node graph (schedule → agent turn)
and stays working. Nothing has to be rewritten to start.

---

## Where it lives (added 2026-08-30)

Two surfaces, not one — a graph cannot be edited in a bottom panel, and a
run feed should not cost a full tab:

- **The Autonomy Log panel becomes the Workflows panel.** Its own header
  comment already says "background runs land here"; it already carries
  the Heartbeat / Cron / Mind enable rows, the Live/Patterns tabs, and it
  is a plain panel-view contribution over autonomyLogService + the rail +
  pattern memory + feature flags — so the reshape is content, not
  plumbing. Tab one lists workflows the way ChatGPT's Scheduled Tasks
  page lists tasks: name, trigger summary, enabled toggle, last result,
  next run, with a template gallery in the empty state (the current "try
  one" buttons, grown up). Tab two is today's live feed, grouped by
  workflow. The Heartbeat/Cron/Mind header rows dissolve into stock
  workflow rows — the enable toggles stop being a separate system.
- **The editor opens as a pane**, like the database editor: full canvas,
  node palette at the side, run controls in the header. Opening a run
  from the panel shows the SAME graph read-only with the trace painted
  on it.
- **Mind is not a workflow.** Beliefs and noticed routines are a
  different kind of thing; whether its row stays in this panel or moves
  to the AI hub is an open question, but it must not be forced into the
  node model.

## What n8n proves (researched 2026-08-30)

Adopt:

- **Triggers are a distinct node kind**, and a workflow with no active
  trigger is a draft, not a bug.
- **Cluster nodes** — n8n's AI agent is a ROOT node with tools, model
  and memory attached as SUB-nodes hanging off it. This is exactly
  "skills and tools as nodes in the workflow": the graph shows what the
  agent may reach *before* it runs. Adopt wholesale for the judgment
  family — an Agent node's allowed tools are its visible children, not a
  hidden config.
- **Data pinning** — freeze a node's output while building downstream.
  For local-model workflows this is the difference between usable and
  maddening: you wire the formatter against a pinned answer instead of
  re-running a 30-second model call on every test.
- **Test vs production runs**, plus partial execution ("run to here").
- **Executions are first-class.** Per-workflow history; opening a run
  shows the graph with each node's input/output; retry a failed run from
  the failed node, choosing the original or the current workflow
  version. Our seams already exist: autonomyLogService for the feed,
  autonomyReplayCommand for the precedent.
- **Per-node retry-on-fail** (count + delay) and an on-error hook — a
  designated workflow that fires when another one fails.
- **Sticky notes on the canvas** — documentation that travels with the
  graph.

Skip:

- Queue mode, horizontal scaling, webhook infrastructure: one desktop.
- The credentials vault — M90's consent model is our gate; per-service
  credential objects are cloud-product furniture.
- **Per-item data piping.** n8n pipes ARRAYS of items through edges and
  maps expressions across them; it is the single hardest thing to learn
  in the product and the main source of broken workflows. See D5.

## One canvas, two tenants (added 2026-08-30)

The workflow editor needs a pan/zoom surface with draggable nodes, typed
ports, curved edges, selection, and undo. The mindmap
(docs/MINDMAP_BRIEF.md) needs the same surface minus ports and
execution. Build ONE node-canvas primitive — src/ui/, no domain
knowledge, gate-clean — and instantiate it twice. The mindmap is the
cheaper tenant and ships first: it proves the canvas with no runner
attached, and the workflow editor then inherits a debugged surface
instead of debuting on the app's most ambitious feature.

*(2026-08-30: the primitive exists — `src/ui/nodeCanvas.ts`, tenant one
is the mindmap editor. The workflow editor builds on it as tenant two.)*

## The decisions (Mufaro's)

**Status (2026-08-30): D1–D5 decided — every recommendation accepted as
written.** The one question still open is where Mind's row lands (see
*Where it lives*); it stays in the panel until decided.


**D1 — Replace, or sit above?** Recommendation: **sit above.** Cron stays
the timer, the heartbeat lane stays the evaluator; both become *emitters*
into the workflow runner rather than being rewritten. Lowest risk, and
the migration is additive.

**D2 — Must a workflow be able to contain no model at all?**
Recommendation: **yes, and that should be the default shape.** Local
models get concepts wrong; anything that turns a wrong answer into a
persisted artifact is a bug generator. Deterministic nodes first, model
last, and the editor should make a model node look like the expensive
choice it is. (`heartbeatDeterministicLane.ts` is the precedent.)

**D3 — Where does approval attach?** Recommendation: **per action node,
defaulting from the workflow's class.** The graph then shows you exactly
where it will stop and ask.

**D4 — Is the graph the truth?** Recommendation: **no — a JSON spec is
the truth and the graph is a view.** Workflows stay diffable,
committable, and writable by the AI; the canvas never becomes the only
door.

**D5 — What does an edge carry?** Recommendation: **one typed payload**
(a fact bundle; a node that produces many things produces a list inside
one payload) — not n8n-style item arrays with per-item expression
mapping. Our workflows are "watch my workspace and act", not bulk ETL;
the mapping semantics item-arrays buy are the complexity that made n8n
hard to learn.

---

## Execution order (each step ships alone)

1. **The spec + a headless runner.** No UI. Prove it by executing today's
   cron jobs through it as two-node graphs.
2. **The node palette from introspection** — tools, commands, skills
   enumerated from `IIntrospectionService` rather than a hand-written
   list that rots.
3. **The editor surface** — its own pane, like the database editor, on
   the shared node canvas (see *One canvas, two tenants*) — plus the
   Autonomy Log → Workflows panel reshape.
4. **The arbiter** — class, attention budget, priority, mutex, cooldown.
5. **Migrate the seven heartbeat checks to stock workflows**, shipped
   enabled, editable, with the current constants as their defaults.
6. **Run traces + replay in the graph.**
7. **Skills as subroutine nodes**, using the parameters they already
   declare.

## Non-goals and risks

- **Not Zapier.** The value is that it is local, over your own data, with
  your own agent. Cloud connectors are not the point and should not
  become the roadmap.
- **The model is the least reliable node.** See D2. A workflow that
  writes study material from a model's judgement without a gate is the
  failure mode to design against.
- **Do not let the graph become the only way in.** Spec first, UI second.
- **Eyes-on.** Anything that changes what the app does while you are not
  looking needs a session with the app open before it ships enabled.

---

## Suggestions audit (added 2026-09-05) — what exists, and what OpenHuman adds

Prompted by the GitHub landscape review
(docs/research/GitHub_Landscape_2026-09.md). OpenHuman (GPL-3.0, pattern
only) shows agents proposing automations on a canvas for human approval.
The first draft of the review called this unbuilt in Parallx. It is
built. Recorded here so the mistake is not repeated.

### What exists (verified in code 2026-09-05)

| Step | Where |
| --- | --- |
| Habit detection: an action recurring on 3+ of the last 14 days within a 75-minute spread. Habit material is opening an editor or focusing a view; commands are excluded until command execution carries an initiator (self-echo guard) | src/openclaw/mind/habitDetector.ts |
| Propose once: Mind hands over newly confirmed habits and persists the "proposed" marker | mindService.takePendingHabitProposals |
| Drain only when a suggestion can actually land (workflow service present, or heartbeat enabled for the chat-offer fallback) | src/built-in/chat/main.ts, drainHabitProposalsIfViable / proposeHabit |
| The suggestion is a disabled WorkflowDoc, `source: 'suggested'`, `suggestedFrom` as the dedupe key: daily schedule at the typical time, today's facts, one agent turn whose mission is "prepare the moment" and leave a "Ready: ..." canvas page | src/services/workflows/workflowSuggestions.ts |
| The panel shows a "Suggested by the AI" section with Review (opens the editor), Add (source becomes user, enabled), Dismiss (deleted, never suggested again) | src/built-in/autonomy-log/main.ts, renderSuggestedRow |

Shipped in commit 24c8cd2f ("habits you approve").

### What changed 2026-09-06 (sessions, and the agent's door)

Run against the Personal Workspace, the detector had tracked 47 actions
since June and proposed nothing. The cause was structural: the user
works around 5am and again from 6pm to 9pm, so every action's time-of-day
spread was 210 to 366 minutes against a 75-minute tolerance. One spread
over a two-session day looks like scatter. Two things shipped:

| Change | Where |
| --- | --- |
| Sessions: occurrences are grouped by time of day (a gap wider than twice the tolerance opens a new group; midnight is no gap), each group judged on its own. One action can carry a 05:10 habit and a 20:00 habit, each with its own key `action@HH:MM`, proposal and dismissal. Legacy bare markers still cover every session of their action | src/openclaw/mind/habitDetector.ts (`readings`, `habitKey`, `isSameHabitKey`) |
| `workflow_suggest`: the agent files a disabled suggested doc (`suggestedFrom: agent:<key>`), never enables it, dedupes on the key, refuses dismissed keys, three per day. Taught in the chat system prompt (gated on the tool) and the heartbeat review seed | src/built-in/chat/tools/workflowTools.ts, openclawSystemPrompt.ts `buildWorkflowSuggestSection`, openclawHeartbeatExecutor.ts |
| Dismiss is remembered: deleting a suggested doc records its key in workflows.json (`dismissedSuggestions`); the service refuses to file that key again, from a habit or from the agent | src/services/workflows/workflowService.ts |
| Panel copy: "Habits the app noticed, and ideas the assistant drafted from what you asked for." | src/built-in/autonomy-log/main.ts |
| Local time: the detector measured minutes in UTC while the cron grid reads "Daily At HH:MM" in local time, so a 5am habit would have been filed as 10:14. The detector takes a minute-of-day clock; the mind passes `localMinuteOfDay` | habitDetector.ts, mindService.ts |

Not done: sequence-derived and condition-derived suggestions (no
detector, the agent's judgment through the tool covers repeated asks),
and command habits (still waiting on the initiator plumbing, S3).

### The delta

OpenHuman's loop differs in three places, and each is a bounded addition
to what stands, not a new program.

1. **More sources of suggestion.** Today there is one detector (daily
   time-of-day) and it only sees editor-open and view-focus gestures.
   Candidates, cheapest first:
   - *Repeated asks in chat.* The prompt compiler already treats a
     mission as prose. When the same kind of ask recurs (memory_search
     over session summaries finds two earlier turns with the same
     mission), the agent drafts a manual-trigger workflow from the
     mission text and files it as suggested. The user sees "you have
     asked for this three times; here it is as a button".
   - *Sequences.* mind/sequencePredictor learns order ("after A you
     touch B"), not clock. A confirmed sequence becomes an event-trigger
     suggestion: journal event A, then an agent turn that prepares B.
   - *Workspace conditions.* The heartbeat's seven checks are the
     obvious stock rows (still owed from slice 4); once they are
     workflows, the arbiter can suggest enabling one when its condition
     first fires.
   - *Command habits* unlock the moment command execution carries an
     initiator (docs/WORKBENCH_DRIVER_BRIEF.md needs the same plumbing).
2. **An agent-side door.** A `workflow_suggest` tool that writes a
   disabled suggested doc instead of talking about it in chat. Dedupe on
   a key the agent supplies, counted against the attention budget, never
   enabled by the tool. The panel already knows how to show it.
3. **Drafted, not templated, missions.** habitToWorkflow writes template
   prose. For chat- and sequence-derived suggestions the mission comes
   from what was observed, so the draft reads like the user's own words.
   Show the graph thumbnail (workflowThumbnail.ts) in the suggested row
   so a suggestion is legible as a graph before Review.

Skip from OpenHuman: 20-minute polling of connected accounts (Parallx has
the journal), tool-output compression (harness wave 1 owns compaction).

### Decisions

**S1 — Which new source first?** Recommendation: repeated asks in chat.
No new detector, the most visible payoff, and it teaches users what a
workflow is by turning their own sentence into one.

**S2 — Does the agent get `workflow_suggest`?** Recommendation: yes, with
the dedupe key and budget above. It is the same gate the panel already
enforces. SHIPPED 2026-09-06 (see "What changed" above). S1's first
source, repeated asks in chat, rides on it: no detector, the model files
the draft when it notices the repeat.

**S3 — Command initiator plumbing.** Recommendation: do it once, for
habits and for the workbench driver together.
