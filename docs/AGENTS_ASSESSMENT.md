# Agents and autonomy: second assessment (2026-10-02)

Question: is the system well defined and well designed, and what does
"spawning agents" actually do on one RTX 5090 running `qwen3.8:27b` at a 160K
context through Ollama?

Sources: four code surveys of this repository (file and line references
below), Ollama's own source (main at b0c1ca4, 2026-10-01), the model's
published config, community benchmarks, and the measurements already in
`docs/ai/CHAT_CONTEXT_WINDOW.md`. Speed figures are community numbers,
roughly ±30%.

## Verdict

**Not well defined, and only partly well designed.**

The pieces are good. These are worth keeping:
- the workflow engine and its arbiter (budget, mutex, cooldown, held runs
  recorded);
- the approval model;
- context compaction;
- the token budget lanes;
- the per-workspace stores.

What is missing is a definition of what an agent *is*, and a runtime that knows
it is sharing one GPU. Today the word "agent" names five unrelated things.
Background runs borrow whatever the visible chat happens to be using. On your
hardware, every run queues behind every other with no priorities, and stopping
a run does not stop the GPU.

## 1. Definition: what is unclear

| Problem | Where | Effect |
|---|---|---|
| "Agent" means five things: chat mode, the agent cards in AI Settings, anonymous helpers (`sessions_spawn`), delegated agent tasks, and the heartbeat | `chatTypes.ts:152`, `agentSection.ts`, `subagentTools.ts`, `agentTypes.ts`, `openclawHeartbeatExecutor.ts` | No single object to name, configure, schedule or watch |
| Agent cards edit 3 of their 9 stored fields; the model override is resolved and never used | `agentSection.ts:192`, `openclawAgentResolver.ts:61` | Settings that look real but do nothing |
| Edits to the Workspace and Canvas cards have no effect; the Chat card's overlay applies to every background run | `registerOpenclawParticipants.ts:41`, background turns set no participant | Changing "Chat" silently changes the heartbeat, routines and helpers |
| A new agent appears only after a reload, and can only be called by a hidden id | `registerOpenclawParticipants.ts:20`, `agentSection.ts:259` | Custom agents are effectively unusable |
| Delegated agent tasks (what the Agents run tab watches) are only created in test mode, and never call a model | `chat/main.ts:878`, `agentExecutionService.ts:35` | A whole subsystem with no production caller |
| A routine's model and context size are stored but never read; helpers drop their model | `backgroundPromptRunner.ts:162-165`, `main.ts:1857` | "A 5am report does not need 160K" is promised in the editor but not delivered |
| Nothing is keyed to a named agent: memory, runs and permissions are global | `agentMemoryService.ts`, `mindService.ts` | No persistence per agent; the proposal's core is absent |

## 2. Design: what is risky

Ordered by how much it hurts on a local GPU.

1. **Cancel does not reach the GPU.** The agent loop calls the model without
   the cancel signal (`openclawAttempt.ts:981`; the provider can abort,
   `ollamaProvider.ts:537`, but never gets a signal). It only stops reading
   when a chunk arrives, and nothing checks during a long prompt evaluation.
   Stop, the 120s helper timeout and the 240–300s background timeout all leave
   the generation running on the GPU, holding the single slot. On a timeout
   the helper's promise rejects but its turn runs to completion
   (`openclawSubagentSpawn.ts:596`).
2. **Background runs share global, mutable state.** The model and context size
   come from whatever the visible chat last set (`languageModelsService.ts:346`,
   the provider-wide override, `ollamaProvider.ts:486`). Switching chats
   mid-run changes the model under a running heartbeat or routine. Settings
   changes write context 0, which falls back to the model maximum of 262K.
3. **No scheduler for the GPU.** The app fires concurrent requests and assumes
   "Ollama handles concurrency" (`ARCHITECTURE.md:705`).
   - Only the heartbeat checks whether you are chatting, only for the visible
     chat, and only when it starts (`main.ts:2201`).
   - Routines, scheduled-job catch-up (fires all due jobs at once,
     `openclawCronService.ts:640`), dashboard AI widgets (2 at a time) and
     indexing never check.
   - There are no priorities: your message can wait behind a background run's
     full-context prompt.
4. **Context size differences reload the model.** Ollama restarts the runner
   whenever `num_ctx` differs from the loaded one. Several callers name
   different sizes:
   - chat with no pick, or after a settings change: 262K;
   - Budget: 16K;
   - Flashcards and Creations: their own sizes.

   Each reload moves about 18 GB and throws away the prompt cache. At 262K, 16
   of 66 layers spill to system RAM (`CHAT_CONTEXT_WINDOW.md:42`).
5. **Unbounded runs.**
   - No output cap: `maxTokens` defaults to 0 and `?? 4096` does not catch it
     (`aiSettingsDefaults.ts:30`).
   - `think:true` is always on for agent turns.
   - The heartbeat and scheduled jobs have no turn timeout, so a stuck turn
     blocks every later beat.
6. **Error fallback can load other models.** An out-of-memory or "failed to
   load" error makes the turn retry on other installed models at the same size
   (`openclawTurnRunner.ts:279`). On a full card that evicts the main model.
7. **Indexing competes blindly.** It runs `nomic-embed-text` beside a model
   that already uses about 29 of 32.6 GB, with no awareness of chat turns.

## 3. What spawning agents does on your machine

**The model.** `qwen3.8:27b` is a hybrid: 48 of its 64 layers use linear
attention (a fixed-size state, no growing cache), and only 16 layers keep a
full attention cache (4 KV heads, head size 256). That is why 160K fits at
all: the cache is about 64 KiB per token, so 160K is about 10 GiB at fp16
(5.3 GiB at q8_0). A dense 32B would need about 40 GiB. Measured on your card
(`CHAT_CONTEXT_WINDOW.md:33`): 15 GB weights + 10 GB cache + about 3 GB
(vision, draft, buffers) = 29.2 of 32.6 GB.

**One at a time, always.** Ollama forces one request at a time for this model
family (`server/sched.go` sets `numParallel=1` for qwen35 / qwen3next, "model
architecture does not currently support parallel requests"). Raising
`OLLAMA_NUM_PARALLEL` does nothing for it, and couldn't fit anyway (each slot
would need its own 160K cache). So:

- **A helper is a queued job.** When Chat spawns one, it waits in Ollama's queue
  until the slot is free, then runs its whole turn.
  - A parent's helpers run one after another, because the parent waits on each
    `sessions_spawn`.
  - "Up to 5 helpers at once" really means 5 in a row.
- **Each run is a full prompt.** The system prompt (about 10% of the budget),
  retrieved context (up to 30%) and the run's own history are assembled and
  evaluated from scratch.
  - **Short prompt:** prefill runs at about 3,000–3,900 tokens/s, so a 20K-token
    prompt starts answering in about 5–7 s.
  - **Long prompt:** about 100K tokens takes roughly 35–60 s before the first
    word.
  - **Generation:** about 70 tokens/s at short depth, about 50–65 tokens/s deep
    in a long context.
- **Switching conversations costs a re-read.** With one slot, alternating between
  your chat and an agent's conversation overwrites the slot's cache. The
  hybrid model's cache checkpoints are also fragile in current llama.cpp. So
  coming back to a long chat after an agent ran usually means re-reading the
  whole prompt: tens of seconds for a long chat.
- **Real parallelism needs a second model.** A small model (about 4B at Q4 with
  16–32K context, about 3–4 GB) can sit beside the 27B and genuinely run at
  the same time, if the 27B leaves room. With fp16 cache it doesn't leave room:
  Ollama only co-loads a model that fits in 80% of free memory, so the second
  model evicts the 27B (a reload, 18 GB moved). With a q8_0 cache it does
  (about 25–26 GB for the 27B).
- **Stopping a run doesn't free the slot.** A cancelled or timed-out run keeps
  generating until it finishes, with no output cap, while your next message
  waits behind it.

So, on this hardware, "agents talking to each other" is a relay, not a
meeting. That's fine; it's also the pattern the research favours. But the
app has to know it: one queue, priorities, real cancel, short prompts for
background work.

## 4. Recommendations

### Ollama settings (today, no code)

| Setting | Value | Why |
|---|---|---|
| `OLLAMA_CONTEXT_LENGTH` | `163840` | Requests that name no size stop reloading at 262K or 32K |
| `OLLAMA_KV_CACHE_TYPE` | `q8_0` | Cache 10 → 5.3 GiB; frees room for a small helper model |
| `OLLAMA_FLASH_ATTENTION` | `1` | Needed for the quantised cache; faster long prefill |
| `OLLAMA_KEEP_ALIVE` | `-1` | The 27B stays loaded (Parallx sends 30m per request, which overrides; fine while you work) |
| `OLLAMA_MAX_LOADED_MODELS` | `3` | 27B + embedding model + an optional small helper |

Use Q4_K_M or Q5_K_M weights. Confirm with `ollama ps` that the 27B shows 100%
GPU.

### App fixes, in order

1. **Real cancel.** Pass the turn's cancel signal into the model call
   (`openclawAttempt.ts:981`) and abort the HTTP request on Stop, timeout or
   preemption. Give the heartbeat and scheduled jobs a turn timeout.
2. **One GPU queue with priorities.** Every model call goes through one queue:
   your chat > approvals you just gave > routines and the heartbeat > helpers >
   indexing. When you send a message, background work in the queue waits, and
   a running background turn is cancelled at its next step and resumed later
   (or, for long prefills, aborted and retried). The Agents view shows
   "waiting for the model".
3. **One context size for the main model.** Every caller sends the same
   `num_ctx` (the user's choice, default 160K), including extensions through
   `parallx.lm`. Background prompts get *smaller* by budget (fewer retrieved
   blocks, no chat history), not by a different `num_ctx`, which would reload
   the model.
4. **Background runs pin their own model and settings** at the start, instead of
   reading the visible chat's. Honour a routine's model; route helpers to a
   "quick" model when one is configured.
5. **Caps.**
   - An output cap for background turns (`num_predict`, e.g. 2–4K).
   - `think` only where asked.
   - Remove the error fallback that loads other models, or limit it to models
     that fit (`/api/ps` `size_vram`).
6. **Indexing yields** when a chat or agent turn is in flight.

## 5. What this means for the agent proposal

The proposal (`docs/AGENTS_PROPOSAL.md`) holds, with these local-first rules
built in:

- **Two engines, named in the open.** The main model (your 27B, one at a time)
  and an optional *quick* model (a small one beside it, for short helper work
  that can run alongside). Each agent picks one, and the editor shows what it
  will cost.
- **Hand-offs are a relay.** `ask_agent` queues the other agent's turn. The
  calling agent waits, as Claude Code subagents do. A quick-model agent may run
  while the main model is busy.
- **Budgets in time as well as tokens.** Each agent has a step limit, an output
  cap and a wall-clock limit, all enforced by real cancel.
- **The Team view shows the queue.** Each agent shows working, waiting for the
  model, or waiting for you. That is the truth on one GPU, and it is what makes
  agents legible.
- **Short, stable prompts for agents.** An agent's prompt is its own
  instructions plus the task. Not the whole chat prompt. That keeps prefill to
  seconds and the prompt cache useful.

## 6. Order of work

1. **Foundation** (before any new agent features): real cancel, the GPU queue
   with priorities, one context size, background runs pinning their settings,
   caps, indexing yield. This is what makes everything after it feel fast on
   your machine.
2. **Phase 1 of the proposal:** agent files, the editor (with its full prompt
   preview and Test Run), and the Team tab with queue state. Clean up or remove
   the AI Settings agent cards and the unused delegated-task subsystem.
3. **Phases 2–4:** routines pick agents, hand-offs as a relay, per-agent notes.
