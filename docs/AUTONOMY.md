# Autonomy: the redesign

Written 2026-11-10 after the daily quote routine failed in three different
ways in one morning; rewritten the same day after reading the primary
sources for the four ideas worth taking. This is a design for Mufaro's yes.
Nothing in it is built, and nothing is agreed until he says so.

## The aim

An AI that works in the background of a private, local workspace: does the
jobs it was given, notices what needs doing, prepares things before he asks,
learns how he works, and can be given real power because everything it does
can be seen and reversed. It must not break when a person touches it: app
closed, laptop asleep, model down, a crash mid-run, an edit made while it
works.

## What happened, and what it showed

On 2026-11-10 one small job (find a quote, record it, show it) was touched
by three actors that did not know about each other. The routine ran the
right prompt and was refused at the write, because a scheduled run is
trusted less than a click. The heartbeat read two stale chat plans, did the
job the old way and wrote a badly sourced quote to the retired page. The
dashboard widget holds a third copy of the job. The refused run was logged
"ok", the refusal said "rejected by user" when nobody was asked, and
nothing notified him.

## What exists today

About 55,000 lines touch autonomy: three schedulers (cron service, routines,
widget refresh), a heartbeat in five files, a ten-module "mind" that stores
click timestamps and guesses the next file touched, five overlapping
permission gates, feature flags that disagree with behaviour, and four logs
none of which can undo anything. State lives in JSON files and one large
blob of workspace state. Each problem got a new layer and each layer made
the others less true. All of it is replaced; none of it is built on.

## The four ideas, where each falls short, and what Parallx does instead

Read from the primary sources on 2026-11-10 (links at the end).

### 1. Checkpointing (Claude Code)

**What it is.** A checkpoint before every turn; rewind restores the files
the AI edited. Unattended runs do not stop to ask.

**Where it falls short.** Only edits made through the file tools are
tracked. Shell changes, background subagents and anything outside the
session are not. It covers code files, nothing else.

**Parallx.** The app owns everything the AI can touch: pages, database
rows, planner, dashboards, workspace files. So every AI write goes through
one gateway, and a **run is one checkpoint over all of it**. That gives two
things no one else has:

- **A run is atomic.** It lands whole or it is rewound. A crash, a model
  failure or a timeout mid-run leaves the workspace exactly as it was.
- **Undo a run, or one change in it,** from the Record, days later. If he
  has edited the same thing since, Undo shows both versions and he chooses;
  it never overwrites his work.

A tool states how its writes are reversed when it registers (a contribution
point, so extensions' tools take part). The only actions that ask are the
ones no checkpoint can reverse: permanent delete, shell commands, anything
that leaves the machine. A routine is granted those once, in plain words,
when he saves it. Web content stays data, never instructions.

### 2. The heartbeat (OpenClaw)

**What it is.** A periodic check that reads a short list and stays silent
when nothing is wrong.

**Where it falls short.** OpenClaw itself has retired the heartbeat as a
separate thing: it is now an ordinary job in the one scheduler, idle-only,
answering "no reply" when there is nothing to say. Each check starts with
fresh, blind context. Missed slots are rescheduled, and an interrupted run
gets one retry.

**Parallx.** One engine runs everything: his routines and the pulse. The
pulse is not a second system; it is the AI's own standing job on the same
engine, with the same record, the same undo and the same notifications.

- **Wakes on meaning, not a short timer:** a run failed, a deadline came
  close, something he waits on arrived, an insight was accepted. A slow
  fallback beat covers the rest. It runs when the app is idle and yields to
  his chat.
- **Starts informed, never blind** (the briefing, below).
- **May act.** It can fix and re-run a failed routine, prepare what is
  coming, tidy what it was told to keep tidy. Recorded, undoable, notified.
- **Knows ownership.** A job has one owner. The pulse never redoes a job a
  routine did this period and never follows an old chat plan.

**Schedules are periods, not clock ticks.** "Daily at 05:20" means once per
day, at or after 05:20:

- Past the slot with no successful run this period: run. Laptop off at
  05:20, opened at 08:00: it runs at 08:00.
- A successful run satisfies the period however it started: schedule,
  widget, Run Now, chat.
- A second manual run the same day runs because he asked, and changes
  nothing about tomorrow.
- A failed or interrupted run does not satisfy the period. The pulse reads
  why and retries with what it learned; after a small fixed number of
  tries he is told, with the reason. Nothing is ever logged "ok" that did
  not land.
- "Next run" is computed from the same record, so it cannot disagree with
  what happened.

A dashboard widget that refreshes is a routine whose result shows in that
widget. One job, one definition.

### 3. Proactive memory ("Remember When It Matters")

**What it is.** A separate memory agent beside the working agent. It keeps
a small bank of knowledge (stable facts) and procedure (what was tried, what
failed, what worked) and speaks only when a memory would change the next
action. Silence is the normal answer.

**Where it falls short.** It runs on every step, which is a second model
call each time, and its errors are errors of judgment: overconfident
guesses, repeating what is already known.

**Parallx.** Memory is written at the end of every run and at reflection,
not on every step, and each entry carries its evidence.

- **Procedure, per job.** What this routine tried, what failed and what
  worked. This morning's run lost several steps to a site that refuses the
  fetch; the next run should start already knowing which sources work.
- **Knowledge of him and the workspace.** How he works, what he prefers,
  what the workspace now holds. This replaces the `AGENTS.md` nobody keeps
  true.
- **Governed by his verdicts.** An entry he corrects or dismisses is gone.
  An entry nothing has confirmed for a long time fades. Every entry can be
  read and edited by him in one place.

### 4. Anticipate and learn (ProAct)

**What it is.** In idle time the agent predicts what the person will need
next, scores each candidate on relevance, the gap it fills, the value it
adds and timeliness, does the work for those above a line, and decides for
each result: push it, queue it, or just keep it.

**Where it falls short.** It was measured on synthetic conversations with a
model as judge. Bigger budgets produced more low-value pushes, and in 43%
of the cases where it anticipated correctly the person's effort did not
drop. Its score is never checked against what the person actually did.

**Parallx.** The same loop, graded by reality.

- **Signals are his real interactions**, not chat text: commands run,
  settings changed, layout adjusted, routines run by hand, what he opens
  each morning, what he keeps, undoes or dismisses.
- **Reflection** is one real thinking pass a day, with thinking on. It
  writes **Insights**: what it saw with the evidence ("resized the primary
  sidebar within a minute of launch on 6 of the last 7 days"), what that
  means, what it suggests (remember the width; a layout preset; a routine).
- **Anticipation** is prepared work: the thing he will want is ready
  before he asks, stored quietly, offered at the right moment.
- **The line moves with him.** Every insight and every act of initiative
  ends in his verdict: accepted, used, edited, undone, dismissed. Those
  verdicts set how much of each kind of initiative the pulse takes. What he
  keeps grows; what he undoes shrinks. At most one push in a window; the
  rest wait in the feed.

## The briefing: what every run is told

Today a routine gets the chat prompt and a stale `AGENTS.md`; the pulse gets
"default: ignore" and a list of 15 pages. Neither knows what routines exist
or what they did. Every autonomous run starts from one briefing built fresh
from the app's own state:

- who he is and how he works (memory, accepted insights)
- what this workspace is now
- the state of autonomous work: each routine, its last result, today's
  Record, what is waiting on him
- for this job: its procedure memory
- the job itself, or for the pulse, what woke it

## What he sees

One place, Agents, with four views and nothing else to learn:

- **Now**: what is running, what needs him, what is next.
- **Routines**: the jobs, each with its schedule, its last result and its
  granted powers.
- **Record**: everything the AI did, newest first, each with Undo.
- **Insights**: what it has learned and what it suggests, each with its
  evidence and Accept, Edit, Dismiss.

Notifications, always on, for three reasons only: the AI acted (one quiet
line with Undo), something failed (with why), something needs him.

## Robustness: the rules that cannot be broken

State lives in the workspace database, not JSON files, under one writer.

| What happens | What the system does |
| --- | --- |
| App closed or laptop asleep at the slot | Runs at next open, once |
| Crash, power loss or timeout mid-run | Run marked interrupted, its changes rewound, retried |
| Model unavailable | Run fails with that reason, retries with backoff, then tells him |
| He edits the same page while a run works | The run's change is merged by block; on a true conflict his edit wins and the run's version is offered |
| Two things due at once | One autonomous run at a time, in order; chat always goes first |
| The same job reachable two ways | One owner; the period rule makes a second automatic run impossible |
| A run does nothing useful | Ends "nothing to do", silent, recorded |
| An action that cannot be undone, not granted | The run finishes everything else, and the one action waits in Needs You with a notification |
| Memory or an insight is wrong | He corrects or dismisses it once; it does not return |

Every row is a test that runs unattended, with a controlled clock and
injected crashes, before any step is called done. Judgment (insights, the
pulse's choices) is checked on his real model, never a mock.

## What is deleted

The cron service, the widget refresh scheduler, the heartbeat's five files
and its watches file, the mind folder, pattern memory, task rail,
follow-ups, the autonomy feature flags, the four-level dial, the three
permission levels, the approval service, and three of the four logs.

## Order of work

Each step ships whole with its tests, and removes the old part it replaces.

1. The write gateway, run checkpoints, the Record with Undo, authority by
   reversibility.
2. The one engine: period schedules, atomic runs, recovery; widgets become
   routine results; his quote routine and widget migrated.
3. Notifications and the Now view.
4. The briefing and memory (procedure per job, knowledge of him and the
   workspace).
5. The pulse on the engine: wake on meaning, act, ownership.
6. Reflection, Insights, anticipation, and the verdict loop.
7. Remove what is left of the old system.

## Open questions for him

- A routine that acted: notify every time, or only on first run, failure
  and anything unusual?
- Reflection: when the app has been idle, or at a set hour?
- The pulse's starting initiative before it has verdicts to learn from:
  suggest only, or act on what is clearly reversible?

## Sources

- Claude Code checkpointing: https://code.claude.com/docs/en/checkpointing
- Claude Code permission modes: https://code.claude.com/docs/en/permission-modes
- OpenClaw automation: https://docs.openclaw.ai/automation
- OpenClaw heartbeat (retired into automation jobs): https://docs.openclaw.ai/gateway/heartbeat
- Remember When It Matters: https://arxiv.org/html/2607.08716v1
- Anticipate and Learn (ProAct): https://arxiv.org/html/2605.25971
