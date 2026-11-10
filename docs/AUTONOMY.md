# Autonomy: the redesign

Written 2026-11-10 after the daily quote routine failed in three different
ways in one morning. This is a design for Mufaro's yes. Nothing in it is
built, and nothing is agreed until he says so.

## What happened, and what it showed

On 2026-11-10 one small job (find a quote, record it, show it) was touched by
three separate actors, none of which knew about the others:

- The routine ran the right prompt and was refused at the write. A run the
  user starts is trusted; the same routine on its own schedule is not.
- The heartbeat, a second loop, read two stale chat plans, did the job the
  old way, and wrote a badly sourced quote to the retired page.
- The dashboard widget holds its own copy of the same job with its own
  refresh.

The refused run was logged as "ok". The refusal said "rejected by user" when
no user was asked. Nothing notified him. The reminder about the stale plan
had been closed before and came back.

## What exists today (read in full before writing this)

About 55,000 lines touch autonomy. The parts:

| Part | What it does | Verdict |
| --- | --- | --- |
| Cron service | The first scheduler, ported from OpenClaw. His `cron.json` is empty | Dead weight |
| Workflows | Routines as node graphs, with their own schedule | The one scheduler worth keeping, simplified |
| Widget refresh scheduler | A third scheduler, per dashboard widget | Duplicate |
| Heartbeat runner, executor, deterministic lane, triggers, watches file | A model review every few minutes plus rule checks (stalled plans, overdue tasks) | Acts on work it does not own; nags; costs a model call per beat |
| Mind: beliefs, predictions scored by Brier, surprise, sequence predictor, skill probe, capability meter, nag governor, action ledger, habit detector, reflection | "Learning" | Records clicks and guesses the next file. 444 KB of predictions, no insight |
| Permission service, policy decision point, autonomy dial (4 levels), feature flags, pattern memory, approval service, task rail, follow-ups | Who may do what | Five overlapping gates. Flags in his workspace say the heartbeat is off while it runs |
| Autonomy log, autonomy event log, activity journal, activity log | Four records of what happened | No one of them can undo anything |
| Surface router | Where output goes | All his outputs are switched off, so nothing reached him |

The pattern: each problem got a new layer, and each layer made the others
less true. The redesign removes layers; it does not add one.

## The bar

- **Claude Code**: unattended runs do not stop to ask. Every file edit is
  checkpointed and can be rewound. Trust comes from undo, not from prompts.
- **OpenClaw** (the system the heartbeat was ported from): two loops with
  two jobs. Scheduled jobs do work in their own isolated run. The heartbeat
  only checks a short list and says nothing when nothing is wrong. Heavy work
  never belongs in the heartbeat.
- **ChatGPT Pulse**: learning is a once-a-day piece of real thinking over
  what the person has been doing, delivered as a short set of cards, steered
  by the person's feedback on each card.

## Principles (his words, made rules)

1. **Power, then reversal.** The AI gets the power the work needs. The user
   gets the power to see and reverse anything it did. Approval is not the
   safety system; the record and undo are.
2. **One owner per job.** A job lives in exactly one place. Nothing else
   does it, repeats it, or reminds about it.
3. **Once means once.** A daily routine runs once a day whenever the app is
   next open, knows it ran, and is never confused by a manual run.
4. **Say it when it matters.** A notification when the AI acted, when
   something failed, when something needs him. Silence otherwise.
5. **Thinking where it counts.** No model call on a timer for nothing. The
   model thinks when it does a job and when it reflects, with thinking on.
6. **Learning means insight.** An observation about how he works, with its
   evidence, turned into a suggestion he can accept, edit or dismiss.
7. **Fewer parts.** Three parts, each one thing.

## The design: three parts

### 1. Routines: the only place work is defined

A routine is a prompt, a trigger, and where its result shows. A dashboard
widget that refreshes is a routine whose result shows in that widget: the
widget stops having its own prompt and timer. The quote job becomes one
routine, shown in one widget.

**Schedule by period, not by clock tick.** A daily routine set for 05:20
means: once per day, at or after 05:20. The rule the scheduler follows:

- When the app is open and the time is past the slot, and this period has
  no successful run, run it. Laptop off at 05:20, opened at 08:00: it runs
  at 08:00.
- A successful run satisfies the period however it started: schedule, the
  widget's Refresh, Run Now, or chat. If he ran it by hand at 05:00, the
  05:20 slot is already satisfied.
- A second manual run the same day just runs, because he asked. It is
  recorded and changes nothing about tomorrow.
- A failed run does not satisfy the period. It retries a small fixed number
  of times, then notifies him with the reason. It never logs "ok".
- "Next run" shown in the app is computed from the same record, so it
  cannot disagree with what happened.

Every run uses the model he chose for the routine, thinking on, in its own
isolated session, and ends in exactly one result: done, or failed with why.

### 2. The Record: everything the AI did, each with Undo

One record replaces the four logs. Each entry: who (which routine or chat),
when, what changed, and Undo.

**Authority.** There is one question for any action: can it be undone?

- **Undoable** (edit a page, add or change a database row, create a page,
  edit a workspace file, change a planner task, render a widget): runs, for
  chat and for routines alike. The change is captured so Undo restores the
  state before it. Pages already keep revisions; rows and pages already go
  to trash; file edits gain a snapshot. A tool states how it is undone when
  it is registered; a tool with no undo is treated as the next kind.
- **Cannot be undone, or leaves the machine** (permanent delete, shell
  commands, sending email, posting to the web): the only actions that ask.
  A routine that needs one is granted it once, when he saves the routine,
  in plain words. After that the routine never asks.

This removes the three permission levels, the four-level dial, the feature
flags, pattern memory, the approval service and the difference between
"you clicked" and "it was scheduled". Web content stays data, never
instructions; that guard is about injection, not distrust of the AI.

### 3. The Pulse: observes, learns, and acts on its own judgment

The heartbeat and the mind are replaced by one part with three halves of one loop: it records, it reflects, and it acts.

**Recording (no model).** The app notes meaningful interactions as they
happen: commands run, settings changed, layout adjusted, routines run by
hand, what he accepted, dismissed or undid. Not tabs clicked, not files
guessed.

**Reflection (one real thinking pass a day).** Once a day, when the app is
idle, the model reads the day's interactions, the workspace's context and
its own earlier insights, and writes to one place he can open: Insights.
Each insight has three lines:

- what it saw, with the evidence ("resized the primary sidebar within a
  minute of launch on 6 of the last 7 days")
- what it thinks that means ("the sidebar's launch width is wrong for you")
- what it suggests ("remember the width", or "a layout preset feature", or
  "run this at 05:20 as a routine")

He accepts, edits or dismisses each one. An accepted routine suggestion
becomes a routine in one step. A dismissed insight never returns. His
choices are part of what the next reflection reads, so it learns what kind
of suggestion he values.

**The pulse (the autonomous actor).** Corrected 2026-11-10 after Mufaro's
challenge: a routine is a scheduled prompt, which is automation, not
autonomy. Autonomy is the AI deciding for itself that something is worth
doing, and doing it. So the pulse stays, rebuilt on the same record:

- It wakes when something meaningful changes (a routine failed, a deadline
  moved close, a new file landed, an insight was accepted), with a slow
  fallback beat. Never a model call on a short timer for nothing.
- It sees the whole picture: every routine and its last result, the Record,
  Insights, the workspace's pages, tasks and calendar.
- It may act, with the same power as any other run, under the same rule:
  what it does is recorded, undoable, and notified. A routine failed this
  morning; the pulse reads why, fixes what it can, runs it again and tells
  him.
- It knows who owns what. It never redoes a job a routine already did
  today, never follows an old chat plan, never raises the same thing twice.
- What it chooses to do and how he reacts (kept, undone, dismissed) is what
  the reflection learns from. Initiative he undoes shrinks; initiative he
  keeps grows.

W i n d o w s   S u b s y s t e m   f o r   L i n u x   h a s   n o   i n s t a l l e d   d i s t r i b u t i o n s . 
 
 Y o u   c a n   r e s o l v e   t h i s   b y   i n s t a l l i n g   a   d i s t r i b u t i o n   w i t h   t h e   i n s t r u c t i o n s   b e l o w : 
 
 
 
 U s e   ' w s l . e x e   - - l i s t   - - o n l i n e '   t o   l i s t   a v a i l a b l e   d i s t r i b u t i o n s 
 
 a n d   ' w s l . e x e   - - i n s t a l l   < D i s t r o > '   t o   i n s t a l l . 
 
 ### Notifications

Three reasons, one channel, always on: a routine acted (one quiet line,
with Undo), something failed (with why), something needs him. They also sit
in Needs You until handled.

## What is deleted

The cron service, the widget refresh scheduler, the heartbeat runner,
executor, deterministic lane, triggers and watches file, the mind folder
(beliefs, predictions, surprise, skill probe, capability meter, nag
governor, action ledger, sequence predictor), pattern memory, task rail,
follow-ups, the autonomy feature flags, the autonomy dial, the three extra
logs. The habit detector's one good idea (a thing done at the same time most
days) moves into Recording.

## Order of work

Each step ships whole, with its tests, and the old part it replaces is
removed in the same step.

1. The Record and Undo, and authority by reversibility.
2. One scheduler with the period rule; widgets become routine results.
3. Notifications and Needs You.
4. The Observer: recording, reflection, Insights.
5. Remove what is left of the old system; migrate his routine and widget.

## Open questions for him

- Should a routine that acted notify every time, or only on the first run
  and on failure?
- Insights: a page in the workspace he can edit, or a tab in Agents?
- Reflection time: when the app has been idle, or a set hour?
