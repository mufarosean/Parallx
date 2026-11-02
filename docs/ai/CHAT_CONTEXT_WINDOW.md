# Chat context window

How a chat's context size is chosen, what the context meter shows, and the
open issues in how the size is kept. Written 2026-09-11 from the code; the
open issues were found by reading it and have not been seen in use.

## How the size is chosen today

The `Ctx` dropdown under the chat input sets a chat's context size.

- A pick is saved on the chat (`contextWindowOverride`, kept in
  `chat_sessions.context_window_override`). It is also written into a single
  provider-wide override on the Ollama provider (`setContextLengthOverride`).
  See `ChatWidget` in `src/built-in/chat/widgets/chatWidget.ts`: the picker's
  `onPick`, and `setSession`, which pushes the chat's own value (or 0) each
  time a chat is shown.
- With no pick and no workspace default, the size is the one the model is
  already loaded at (Ollama's `/api/ps`), so Auto never makes Ollama load the
  model again at its full length; while nothing is loaded, the size last
  named for the model, else its own length capped at 65536
  (`OllamaProvider.AUTO_MAX_CONTEXT`; Creations caps its own Auto the same). A 256K model's context cache at its full length
  runs past a 32 GB card into system memory, and a turn then takes minutes:
  seen 2026-11-02, when a warm-up remembered at 262144 reloaded Qwen3.8 at
  every launch and the broker ran every 128K thread at it. A size the user
  names (the chat's Ctx, a thread's Context, a workspace default) is kept as
  is, above the cap too. The Ollama provider loads nothing at launch; the
  embedding service warms its own model when indexing starts
  (`ensureModel`). The launch warm-up of the chat model (2026-09-11
  to 2026-11-02) loaded the model the chat last ran with, and the user's first
  request, for another model at another size, waited behind that load for
  minutes or until it timed out.
- **A size the app chose is measured** (`ollamaContextFit.ts`). While such a
  request runs, the provider reads `/api/ps`: a model loaded at that size
  with less on the card than it takes has spilled into system memory. From
  Ollama's own numbers (the load's size, what sat on the card, the weights
  from `/api/tags`) it works out the largest context that fits, aborts the
  attempt, sends it again once at that size, and keeps the fit per model in
  the chat's global state (`chat.contextFits`) for every later Auto. A load
  that sits on the card is kept as fitting at its size. A size the user
  names is never measured or changed. The order for a sizeless request:
  the loaded size, the measured fit, the last size named for the model (kept
  across restarts, `chat.lastSizes`: what the user runs that model at), and
  for a model never run, its length capped at 65536. That bound is from
  this machine: a 31B model at 131072 is reported by Ollama as on the card
  and generates at 4 tokens a second, the driver having spilled it unseen,
  which no number from Ollama shows; at 65536 it runs at 50. The ps-based
  fit catches a spill Ollama reports, not that one.
- A call that names no size runs at the engine's loaded size (the engine
  broker's loaded shape, `docs/AGENT_RUNTIME_DESIGN.md` §3); a call that
  names one keeps it and becomes the loaded shape. A request never leaves
  without `num_ctx`: Ollama's own default for a sizeless request is whatever
  its app setting says, 262144 on the owner's machine.
- Each turn, the runtime reads that provider-wide value, not the chat's own
  field. `buildOpenclawTurnContext` (`src/openclaw/participants/openclawDefaultParticipant.ts`)
  calls `getModelContextLength()`, which reaches `OllamaProvider.getCachedContextLength`.
  That function returns the override when it is set. Otherwise it returns the
  model's length as Ollama reports it, and 0 if none is known yet. A 0 becomes
  8,192.
- The resulting number is the turn's token budget. It is sent to Ollama as
  `num_ctx`, and compaction runs at 80% of it (85% inside a tool loop). The
  context meter divides by the same number (`ChatDataService.getContextLength`).

Evidence that the pick reaches the model: with `Ctx: 160K`, `ollama ps` listed
`qwen3.8:27b` at context 163840, and Ollama's `llama-server.exe` was running
with `-c 163840` (2026-09-11).

## What Ollama's log shows (2026-09-11)

- **Graphics memory at `Ctx: 160K`.** For `qwen3.8:27b`, Ollama reserved:
  - 15.0 GB for the weights;
  - 10.0 GB for the 160K context cache;
  - about 3 GB more: the vision module (up to 1.1 GB), the speculative-draft
    cache (0.6 GB), recurrent state (0.7 GB) and working buffers.

  Measured per process, that came to 29.2 GB of the RTX 5090's 32.6 GB.
  `ollama ps` reported 18 GB. The context cache grows with the context size,
  so a smaller `Ctx` frees graphics memory in proportion.
- **Model reloads.** On 2026-09-10 and 2026-09-11 the same model was loaded
  many times at 262,144 tokens (its maximum), alternating with 163,840.
  `qwen3.6:latest` was also loaded at 262,144 in between, and each switch
  unloads and reloads a model. At 262,144, 16 of the 66 layers and 4 GB of the
  context cache went to system RAM (`offloaded 50/66 layers to GPU`), which
  is slower. Traced the same day: Ollama's own Context Length setting is
  262,144 (its app settings), so any request that names no size loads the
  model at its full length. Two sources did that:
  - **Parallx's launch warm-up.** It loaded the first model Ollama lists, with
    no size. It now warms the model and size the chat last used, and every
    request names a size (`OllamaProvider`: `setWarmupTarget`, and the
    last-size fallback in `sendChatRequest`).
  - **A live test in the unit suite.** `tests/unit/autonomyValueProbe.test.ts`
    sent two requests to `qwen3.6:latest` on every full test run: 345 and 695
    tokens, no size, and no cap on length. The first ran until its
    110-second timeout. The test now runs only when `PROBE_MODEL` names a
    model.

## The context meter (fixed 2026-09-11)

The percentage under the chat input (`src/built-in/chat/widgets/chatTokenStatusBar.ts`):

- **Base:** the size the model reported for the most recent answer
  (`promptTokens`, which already reflects any compaction) plus that answer's
  length (`completionTokens`). Only the message just sent, and the answer
  while it streams, are estimated on top.
- **Saved:** these counts are kept with each answer
  (`chat_messages.prompt_tokens`, `completion_tokens`), so a reopened chat
  shows the real number.
- **Before any count exists** (a new chat, or one saved before 2026-09-11):
  it estimates at characters ÷ 4. History counts only up to 30% of the window,
  the most the context engine sends (`computeElasticBudget`,
  `src/openclaw/openclawTokenBudget.ts`). Compaction never rewrites the chat's
  visible history, so estimating all of it overstated the size. That is what
  showed 100% after a compaction, and again after a restart.

## Open issues

All three come from the provider-wide override standing in for the chat's
own choice. None of them changes what the dropdown shows.

### 1. Changing a setting resets the context size

- **Any AI Settings change.** `UnifiedAIConfigService` fires its change event
  on every change (`_fireChange`), and also when a workspace's AI settings
  load (`loadWorkspaceConfig`). The listener in `src/built-in/chat/main.ts`
  (after the default model is set) writes Settings → Model → Default Context
  Length into the override, or 0, which means the model's maximum. Whether
  the load-time event lands before or after a restored chat pushes its own
  size has not been checked.
- **Any `chat.*` setting change:** font size, font family, default mode, or
  the Ollama address. The configuration listener next to `applyFontSettings`
  in `src/built-in/chat/main.ts` reads `chat.contextLength`. That key is
  deliberately unregistered (`src/tools/builtinManifests.ts`), so it reads 0,
  and the size falls back to the model's maximum.
- **What happens:** until the user switches chats or picks a size again, each
  turn asks Ollama for a different context than the one picked. For a large
  local model that means more graphics memory, which can make it spill out of
  the card and slow down. Compaction also comes later than expected. The meter
  follows the new number, so it does not look wrong.

### 2. Default Context Length does nothing for chats

Settings → Model → Default Context Length says it sizes new chats. It is
applied once at startup (`setContextLengthOverride(configuredContextLength)`
in `src/built-in/chat/main.ts`). Showing any chat without a size of its own
then writes 0 (`ChatWidget.setSession`), so chats run at the model's maximum.

### 3. Claude with `Ctx` on Default gets an 8,192-token budget

For a Claude model, `getModelContextLength()` still asks the Ollama provider
(`ChatDataService.getModelContextLength`). Ollama does not know the model, so
nothing is cached and it returns 0. The turn then falls back to 8,192
(`buildOpenclawTurnContext`), and compaction runs at about 6,500 tokens. The
meter's own lookup returns 0 too, so it shows 0%. Claude's real limits
(1,000,000 or 200,000 tokens) are already known to `LanguageModelsService`,
but this path doesn't use them. Picking a size in the dropdown avoids the
problem.

## Proposed fix

One resolver for a chat's context size, read by the turn budget, `num_ctx`
and the meter alike:

1. the chat's own pick (`contextWindowOverride`);
2. otherwise Default Context Length;
3. otherwise the model's real limit, from `LanguageModelsService` (Claude
   included);
4. otherwise 8,192.

Settings changes would then stop writing the provider-wide override. The
resolver would need tests for each issue above.
