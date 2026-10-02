# Agent runtime: one engine, priorities, pause-and-resume (design, 2026-10-02)

Goal: chat always comes first; background agents yield and **resume**, never
lose their work to a chat turn; no lags from reloads, queues or orphaned
generations; nothing hard-coded to one model or one Ollama configuration (a
MoE at full context, a dense 27B at 160K, a cloud model, all work).

Builds on `docs/AGENTS_ASSESSMENT.md` (the problems) and
`docs/AGENTS_PROPOSAL.md` (the agent model).

## Principles

1. **Every model call goes through one broker.** Chat, routines, the heartbeat,
   helpers, inline AI, dashboards, extensions (`parallx.lm`), embeddings. No
   caller talks to Ollama directly.
2. **Learn the machine, don't configure it.** The broker discovers what the
   server can do (does this model run requests in parallel, does it fit on
   the GPU, what context is loaded) from Ollama's own answers and from what it
   observes, per model. No Ollama settings required, no caps baked in.
3. **Preempt, don't cancel.** A background run that gives way to chat is
   *paused*, and picks up exactly where it was. Only you (Stop, Pause) or its
   own limits end a run.
4. **A chat turn owns the engine for the whole turn**, tool steps included,
   not just one model call at a time.
5. **Runs pin their settings at start.** Model and context are decided when
   the run begins and don't change under it.

## 1. The broker (`IModelEngineBroker`, core service)

Every call is a ticket:

```
{ runId, kind, priority, model, numCtx?, messages, options, signal, onPreempt }
```

Priority classes, highest first:

| Class | Who | Notes |
|---|---|---|
| **interactive** | your chat turn, inline canvas AI, extension calls made from a click | holds a lease for the whole turn |
| **resumed** | a run you just answered (approval, steering note) | you're looking at it |
| **scheduled** | routines, the heartbeat, scheduled jobs | |
| **helper** | runs spawned by a background run | a helper spawned *by your chat turn* is interactive: you're waiting |
| **maintenance** | embeddings and indexing, warm-ups | yields to everything |

The broker keeps one queue per model and grants slots by priority, then age.

### The interactive lease

When you send a message, the chat turn takes a lease on the engine. It holds
it across the turn's tool steps and model calls, and lets it go when the turn
ends, plus a short grace period (default 4 s, or as long as you are typing).
While a lease is held:

- background tickets wait, and running ones are preempted (below);
- nothing else enters the model between your turn's steps. Without the lease a
  background call could slip in and overwrite the prompt cache your next step
  needs.

This is what "chat tool priority mid turn" needs: the lease covers the whole
turn, not one request.

### Preemption, with resume

Agent runs are loops of steps: model call, tools, model call. That is the
natural checkpoint. Every step's messages are already recorded in the run's
session.

When an interactive lease arrives and a background call is on the engine:

| Background call is… | Broker does | Cost |
|---|---|---|
| waiting in the queue | holds it | none |
| reading its prompt (before the first token) | aborts the HTTP request for real; the ticket goes back to the queue | prefill redone later |
| generating, and nearly done (estimate ≤ 2 s at the measured speed) | lets it finish, then grants chat | ≤ 2 s for you |
| generating, longer than that | aborts; the step's partial text is dropped; the ticket requeues | the step is redone later |

The run never sees a cancel. Its model call simply resolves later: the broker
retries transparently when the call hadn't streamed yet, and signals
`Preempted` otherwise, and the agent loop resets that one step's partial
output and calls again. The run's state shows **Waiting for the model (behind
your chat)**, and it resumes at the same step when the lease ends.

Runs keep three clocks: steps used, output tokens used, and *working* time.
Time spent paused doesn't count against a run's limits, so preemption can't
make it time out.

### Real cancel

The model call gets the run's signal (today it doesn't:
`openclawAttempt.ts:981`), and abort closes the HTTP request. Stop,
preemption and a run's own limits all free the engine immediately. No
generation continues unseen.

## 2. Learning the machine

Per model, the broker keeps an **engine profile**, refreshed from Ollama and
from observation:

| What | How | Used for |
|---|---|---|
| Loaded and where | `/api/ps`: `size_vram` vs `size`, context length | "on GPU" / "partly on CPU (slower)" in the engine chip; whether a second model can sit beside it |
| Architecture | `/api/show` → `general.architecture` | a starting guess for parallelism |
| Runs in parallel? | observed: when two calls to the same model overlap, did the second start streaming before the first finished? | how many of this model's tickets to grant at once (starts at 1, rises only when proven) |
| Speeds | measured prefill and generation tokens/s per model and context | the "nearly done" estimate; time hints in the Agents view |
| Co-residence | after loading a second model, did the first get evicted? | whether a "quick" model can run beside the main one, or must take turns |

A MoE that runs at full context with parallel slots gets parallel grants
because it proved it can. A model the server serializes gets one at a time.
Neither needs a setting.

## 3. No reload thrash, no caps

The broker tracks each model's **loaded shape** (model + context size), the
thing that, when it changes, makes Ollama reload.

- **Interactive calls set the shape.** You choose the context, the chip shows
  it; nothing caps it.
- **Background and helper calls use the loaded shape.** If they need less room,
  they get a smaller *prompt budget* instead of a different context size,
  which would force a reload. If they need more than is loaded, they wait for
  an idle engine before reloading, and never during a lease.
- **Every caller names a size,** so a call that names none can never trigger
  Ollama's own default and a surprise reload. This includes extensions; the
  broker fills it in.
- **The error fallback that tries other installed models goes.** In its place:
  a clear "the model didn't fit" with the profile's facts.

## 4. Spawning, defined

A spawn is a **child run**, with a brief, a parent, an agent (from the agent
proposal) and a model tier (main or quick).

- **Its priority comes from who is waiting.** A child of your chat turn is
  interactive and shares the turn's lease; a child of a routine is a helper.
- **Concurrency is the broker's call.** On a model that runs one at a time,
  children run one after another, and the parent waits, as Claude Code
  subagents do. On a model that proved parallel, or on a quick-tier model
  sitting beside the main one, they really overlap.
- **Small, stable prompts.** A child gets its agent's instructions plus the
  brief, nothing else. The stable part comes first, so the server's prompt
  cache can reuse it across children.
- **A child returns a result,** not a transcript dump. The parent sees its
  status: queued, working, waiting for the model, done, failed.
- **Every child gets a recorded transcript.** It's linked from the parent's
  step and from History, and can be watched live.
- **Limits:** depth 2, a per-parent child count, and the three clocks above.

## 5. Faster

| Lag today | Fix |
|---|---|
| Model reloads (262K vs 160K vs 16K) | loaded-shape rule (§3) |
| Your message waits behind a background prompt | lease + preemption (§1) |
| Stop or timeout doesn't free the engine | real cancel (§1) |
| Background runs re-read huge prompts | small background budgets; stable prompt prefixes |
| Background runs with no end | output cap per class (e.g. 4K for background, none for chat) and working-time limits |
| Indexing fights chat for the GPU | maintenance class: runs only when the engine is idle |
| Switching chats changes a running routine's model | runs pin model and context at start (principle 5) |

## 6. What you see

- **Agents › Now:** each run shows Working, Waiting for the model, Waiting for
  you, or Paused. A paused-for-chat run says so and resumes on its own.
- **The engine chip:**
  - the model;
  - its context;
  - "on GPU" or "partly on CPU";
  - "2 waiting" when background work is queued behind you.
- **History:** a run that was preempted shows the pause in its timeline.

## 7. Build order

1. **Broker core:** tickets, priority queue, one-at-a-time default, real abort,
   interactive lease. Route chat, background prompts, heartbeat, routines,
   helpers and inline AI through it.
2. **Preempt and resume:** `Preempted` handling in the agent loop (reset the
   step, retry); working-time clocks; run states in Agents.
3. **Loaded shape and pinning:** per-run model and context pinned at start;
   background prompt budgets; every call names a size; remove the
   other-model fallback.
4. **Engine profiles:** `/api/ps` and `/api/show`, observed parallelism and
   speeds, the engine chip status, a maintenance class for embeddings.
5. **Spawning as child runs,** feeding into the agent proposal's phases.

Each step: unit tests for the broker (priority order, lease, preemption
decisions, resume), a fake streaming provider for timing, and an in-app check.
