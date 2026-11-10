# Autonomy: the redesign

Written 2026-11-10 after the daily quote routine failed in three different
ways in one morning. Rewritten the same day after every source was read
again from its primary page and dated. This is a design for Mufaro's yes.
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
blob of workspace state. The heartbeat was ported from an OpenClaw design
that OpenClaw has since retired. All of it is replaced; none of it is built
on.

## The evidence, and how far each piece can be trusted

Every row was read from its primary page on 2026-11-10. "Verbatim" means the
sentence was quoted from the page; "abstract only" means the full text was
not read and no detail beyond the abstract is relied on.

| Source | Date | Read | What it establishes |
| --- | --- | --- | --- |
| Claude Code docs: checkpointing, permission modes, scheduled tasks | Current docs; newest "What's new" entry seen is the week of 2026-08-31 | Verbatim | Checkpoints cover only files edited by the file tools ("A file that only Bash commands changed isn't tracked"). Auto mode: "A separate classifier model reviews actions before they run"; it blocks "Irreversibly destroying files that existed before the session"; after 3 blocks in a row it goes back to asking. "Auto mode reduces permission prompts but does not guarantee safety." Their local scheduled loop has "No catch-up for missed fires." |
| OpenClaw docs: heartbeat, automation, how scheduling works | Docs undated; latest release 2026-11-08. When the heartbeat was retired could not be dated | Verbatim | "Heartbeat monitoring now uses ordinary automation jobs." What remains is one "Proactive check" job, every 30 minutes, idle-only, replying `NO_REPLY` when there is nothing to say. Overdue jobs are "rescheduled instead of replayed immediately"; an interrupted run "gets one fresh retry". |
| "Remember When It Matters: Proactive Memory Agent" (Meta AI, arXiv 2607.08716) | 2026-07-09, v1 | Verbatim | A memory agent beside the working agent; it intervenes "only when a remembered item is likely to affect the next action". Gains of 2.4 to 8.3 points on two benchmarks. Its failures are "primarily calibration errors rather than failures of memory storage". It runs on a fixed interval; learning when to invoke memory is left as future work. |
| "Anticipate and Learn" / ProAct (Shanghai Jiao Tong, Tencent, arXiv 2605.25971) | 2026-05-26, v2 | Verbatim | Idle time is used to predict needs, score each (relevance, gap, added value, timeliness, equal weights, act at 60 of 100), do the work, then push, queue or store. On its benchmark: 14.8% fewer turns, 11.7% less user effort. The authors: "These results come from a closed-world synthetic benchmark"; in 82 of 192 scenarios where it anticipated, "user effort does not decrease"; "Additional searches can introduce low-value pushes." |
| "Safe to Resume? Breaking Execution Continuity of Agent Execution via Rollback" (arXiv 2608.29381) | 2026-08-29, v1 | Abstract only | A warning for this design: "a faithfully restored checkpoint may resume an execution whose states, assumptions, and external effects never coexisted in any valid history." Demonstrated results include double payment and unauthorized mail forwarding. |
| "AgentRewind" (arXiv 2608.14380) and "When Can Agents Safely Checkpoint, Fork, Restore, and Merge?" (arXiv 2608.22928) | 2026-08-14, 2026-08-24, v1 | Abstract only | Checkpointing the agent's context together with its environment, and returning to an earlier point carrying what the failed attempt learned, is current research. An edit to history "cannot undo an earlier authorization or sent tool request". |
| "ProAgentBench" (arXiv 2602.04482) | 2026-02-09, v2 | Abstract only | On 500+ hours of real user sessions: long-term memory and history improve the prediction of when help is wanted, and real data beats synthetic. |
| ChatGPT Pulse | Not verified | Could not be read (the pages refuse automated readers) | Nothing. It is not part of the basis for this design. |

A search for work from September to November 2026 found nothing newer on
these questions. That is a search result, not proof that nothing exists.

**What the evidence says, plainly.**

- Nobody has shown anticipation working on a real person's real work. The
  best paper is synthetic and admits it often does not reduce effort.
- Nobody grades the agent's judgment against what the person then did.
- Undo exists only for code files. Research on rewinding an agent's whole
  environment is three months old, and its sharpest finding is a danger:
  rolling back and resuming can replay things that already left the system.
- The one product that had a separate heartbeat removed it. A blind check
  on a timer is not the frontier; it is what was left behind.

So the frontier is open exactly where Parallx has an advantage no one else
has: the app owns the whole workspace, locally, so it can checkpoint
everything, see real interactions, and measure every result against what he
actually does.

## The design

Four parts. Each is one thing.

### 1. The engine: one place that runs all background work

His routines and the AI's own initiative run on the same engine, with the
same record, the same undo and the same notifications. There is no second
loop. (OpenClaw's lesson, and the only thing taken from it.)

**A job has one owner.** A dashboard widget that refreshes is a routine
whose result shows in that widget. Nothing else does that job, repeats it,
or reminds about it.

**Schedules are periods, not clock ticks.** "Daily at 05:20" means once per
day, at or after 05:20:

- Past the slot with no successful run this period: run. Laptop off at
  05:20, opened at 08:00: it runs at 08:00.
- A successful run satisfies the period however it started: schedule,
  widget, Run Now, chat.
- A second manual run the same day runs because he asked, and changes
  nothing about tomorrow.
- A failed or interrupted run does not satisfy the period. It is retried
  from the start with what the failure taught; after a small fixed number
  of tries he is told, with the reason.
- "Next run" is computed from the same record, so it cannot disagree with
  what happened. Nothing is ever logged "ok" that did not land.

One autonomous run at a time, only while the app is idle; his chat always
goes first.

### 2. The Record: power, then reversal

Every AI write, from chat, a routine or the AI's own initiative, goes
through one gateway. A run is one checkpoint over everything it touched:
pages, database rows, planner, dashboards, workspace files. This goes past
Claude Code's checkpoints, which cover only edited code files.

- **A run is atomic.** It lands whole or it is rewound. A crash, a timeout
  or a model failure leaves the workspace as it was.
- **Undo a run, or one change in it,** from the Record, days later. If he
  has edited the same thing since, Undo shows both versions and he chooses.
- **A rewound run never resumes; it starts again.** This is the answer to
  the rollback danger above. A retry begins from a clean state and is told
  what the failed attempt already did.
- **What left the machine is never pretended away.** An email sent, a
  command run, a web post made is recorded the moment it happens and stays
  in the Record through any rewind. A retry sees it and does not do it
  twice.

**Authority follows reversibility.** There is one question for any action:
can the checkpoint reverse it?

- Yes: it runs, for scheduled work exactly as for a click.
- No (permanent delete, shell commands, anything leaving the machine): it
  asks. A routine is granted such an action once, in plain words, when he
  saves it. If one comes up ungranted, the run finishes everything else and
  that single action waits for him, with a notification.

A tool states how its writes are reversed when it registers, so extensions'
tools take part. A tool that does not say is treated as irreversible. Web
content stays data, never instructions.

### 3. Memory: what the AI knows, with its evidence

Written at the end of every run and at reflection, never on a per-step
timer (the Meta paper's cost), and every entry carries where it came from
(the Meta paper's weakness is overconfident guesses).

- **Procedure, per job.** What this job tried, what failed, what worked.
  This morning's run lost steps to a site that refuses the fetch; the next
  run starts already knowing which sources work.
- **Knowledge of him and of the workspace.** How he works, what he prefers,
  what the workspace now holds. This replaces the `AGENTS.md` nobody keeps
  true.
- **Governed by him.** Every entry is readable and editable in one place.
  One he corrects or dismisses is gone for good. One that nothing confirms
  fades.
- **Used when it would change the next action,** and otherwise silent.

**The briefing.** Every autonomous run starts from the same briefing, built
fresh from the app's state: who he is, what the workspace is now, every
job with its last result, today's Record, what is waiting on him, this
job's procedure, and the job itself.

### 4. Initiative: anticipate, act, and be graded by him

This is the part that makes it autonomy and not automation. It replaces the
heartbeat. It is not a check on a timer.

**It wakes on meaning or on predicted need:** a run failed, a deadline came
close, something he waits on arrived, an insight was accepted, or a
recorded pattern says he is about to want something.

**It reads his real interactions,** not his chat text: commands run,
settings changed, layout adjusted, jobs run by hand, what he opens first
each day, what he keeps, undoes or dismisses.

**Once a day it reflects,** one real thinking pass on his model with
thinking on. It writes Insights, each with three lines: what it saw and the
evidence ("resized the primary sidebar within a minute of launch on 6 of
the last 7 days"), what that means, what it suggests (remember the width; a
layout preset; a routine).

**It weighs before it spends.** Each candidate is weighed on relevance, the
gap it fills, the value it adds and timeliness (ProAct's gate), and each
result is pushed, queued or kept silently. At most one push in a window.

**It may act,** on the engine, under the Record: fix and re-run a failed
job, prepare what is coming so it is ready before he asks.

**It is graded by what he does next.** This is what no published system
does. Every insight and every act ends in a verdict he gives without extra
work: accepted, used, edited, undone, dismissed, ignored. Those verdicts
move the line for each kind of initiative. What he keeps grows; what he
undoes shrinks. The weighing is therefore tuned on his real behaviour, not
on a benchmark.

## What he sees

One place, Agents, with four views:

- **Now**: what is running, what needs him, what is next.
- **Routines**: the jobs, each with its schedule, last result and granted
  powers.
- **Record**: everything the AI did, newest first, each with Undo.
- **Insights**: what it has learned and suggests, each with its evidence
  and Accept, Edit, Dismiss; and the memory behind it.

Notifications, always on, for three reasons only: the AI acted (one quiet
line with Undo), something failed (with why), something needs him.

## Robustness: the rules that cannot be broken

State lives in the workspace database, not JSON files, under one writer.

| What happens | What the system does |
| --- | --- |
| App closed or laptop asleep at the slot | Runs at next open, once |
| Crash, power loss or timeout mid-run | Run marked interrupted, its changes rewound, started again from clean |
| A retry after something already left the machine | The retry is told; it is not sent twice |
| Model unavailable | Run fails with that reason, retries with backoff, then tells him |
| He edits the same page while a run works | Merged by block; on a true conflict his edit wins and the run's version is offered |
| Two things due at once | One at a time, in order; chat goes first |
| The same job reachable two ways | One owner; the period rule makes a second automatic run impossible |
| A run finds nothing to do | Ends "nothing to do", silent, recorded |
| An irreversible action that was not granted | Everything else finishes; that action waits in Now, with a notification |
| Memory or an insight is wrong | He corrects or dismisses it once; it does not return |

Every row is a test that runs unattended, with a controlled clock and
injected crashes, before a step is called done. Judgment (insights,
initiative) is checked on his real model, never a mock.

## What is deleted

The cron service, the widget refresh scheduler, the heartbeat's five files
and its watches file, the mind folder, pattern memory, task rail,
follow-ups, the autonomy feature flags, the four-level dial, the three
permission levels, the approval service, and three of the four logs.

## Order of work

Each step ships whole with its tests, and removes the old part it replaces.

1. The write gateway, run checkpoints, the Record with Undo, authority by
   reversibility.
2. The engine: period schedules, atomic runs, clean retries; widgets become
   routine results; his quote routine and widget migrated.
3. Notifications and the Now view.
4. Memory and the briefing.
5. Initiative: wake on meaning, act, ownership.
6. Reflection, Insights, anticipation, and the verdict loop.
7. Remove what is left of the old system.

## Open questions for him

- A routine that acted: notify every time, or only on first run, failure
  and anything unusual?
- Reflection: when the app has been idle, or at a set hour?
- Before there are verdicts to learn from: should initiative only suggest,
  or act on what is clearly reversible?

## Sources

- https://code.claude.com/docs/en/checkpointing
- https://code.claude.com/docs/en/permission-modes
- https://code.claude.com/docs/en/routines
- https://code.claude.com/docs/en/scheduled-tasks
- https://docs.openclaw.ai/gateway/heartbeat
- https://docs.openclaw.ai/automation
- https://docs.openclaw.ai/automation/cron-jobs/how-it-works
- https://arxiv.org/abs/2607.08716
- https://arxiv.org/abs/2605.25971
- https://arxiv.org/abs/2608.29381
- https://arxiv.org/abs/2608.14380
- https://arxiv.org/abs/2608.22928
- https://arxiv.org/abs/2602.04482
