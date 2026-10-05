# Handoff: where the work stands

Last updated 2026-10-05. Branch `fix/light-mode-and-accent-contrast`, tip
`0fdbebd1` or later. Working tree clean, everything pushed. tsc, the full
vitest suite (7474 tests) and `npm run build` all pass.

Read `CLAUDE.md` first: git rules, the first principle (the app is only
what the user turned on), house rules, copy rules, checks.

## Done in the last session

- Modularity audit (`docs/MODULARITY_AUDIT_2026-10-04.md`): every item
  fixed or ok. Optional tools reach the main process through one door
  (`optionalBridges.invoke` / `.on`, allow-listed in
  `electron/optionalBridges.cjs`). `coreToolMentionsRatchet.test.ts` stops
  the core from learning about optional tools again.
- One app time zone: `assistantTimeZone()` in `src/services/localTime.ts`,
  `api.env.timeZone`, setting `chat.timeZone` under Settings › General.
  Defaults to the computer's zone.
- Character Studio: Rewrite takes an optional direction.
- Canvas image and media insert popups: Cancel button; Escape works after
  a file pick.
- Creations roleplay (`ext/creations-ai/`):
  - Memory (Facts and Timeline) writes every sixth reply, uses JSON mode
    and the chat's context window; "Update Now" in the Memory panel shows
    the result. Code: `extractionDue` / `parseExtractionReply` in
    `chat-memory.js`, `_maybeAutoExtractMemory` in `main.js`.
  - Cut-off replies: Ollama's `done_reason` reaches the chunk as
    `doneReason`; a reply cut off for length shows a toast with Continue.
  - Context window: the Ctx picker's "Auto" used to fall back to a hidden
    shipped default of 8192, which left about 700 tokens for the reply
    with a long card. Auto now means: chat pick > size set in Settings >
    the model's own length (`lm.getModelInfo`). Budget and `num_ctx` are
    the same number (`resolveContextWindow`). A stored 8192 the user never
    chose reads as Auto. The picker shows e.g. "Auto (40K)".

## Cloud setup

- `npm ci` in a cloud container: set `ONNXRUNTIME_NODE_INSTALL=skip`
  (its download resets through the proxy). Do not skip Electron's binary:
  `optionalBridgesLazy.test.ts` requires `electron` and fails without it.

## Lessons to keep

- Do not change what the roleplay model sees (prompt assembly, history
  trimming) without checking history retention. A "reply reserve" that
  dropped old history broke continuity and was reverted (`b7fad86b`);
  `tests/unit/creationsReplyRoom.test.ts` guards it. Confirm with the
  owner before touching roleplay prompt assembly again.
- Answer "why" questions directly: name the line and who set the value.

## Context window: settled

- The owner tested the fix: it works (qwen 3.8 27B at 64K, picked in Ctx).
  Decided: no cap and no change to what Auto resolves to.
- Auto's "model length" is the provider's estimate (`_extractContextLength`
  in `ollamaProvider.ts`: the larger of the file's `context_length` and a
  RoPE-based guess, capped at 256K), e.g. 128K for qwen3:8b. Known and
  accepted; a slow model is answered by picking a size in Ctx.
- The Ctx picker's "Auto (…)" label follows a model change.

## Cloud setup

- `npm ci` in a cloud container: set `ONNXRUNTIME_NODE_INSTALL=skip`
  (its download resets through the proxy). Do not skip Electron's binary:
  `optionalBridgesLazy.test.ts` requires `electron` and fails without it.

## Lessons to keep

- Do not change what the roleplay model sees (prompt assembly, history
  trimming) without checking history retention. A "reply reserve" that
  dropped old history broke continuity and was reverted (`b7fad86b`);
  `tests/unit/creationsReplyRoom.test.ts` guards it. Confirm with the
  owner before touching roleplay prompt assembly again.
- Answer "why" questions directly: name the line and who set the value.

## Waiting on the owner

- The owner is testing the context window fix. Watch for: replies still
  cut off (check the diagnostics' window size), or slow generation on
  models with a huge reported length. Ask the owner before adding any cap.
- Found after the fix: "the model's own length" (`lm.getModelInfo`
  `contextLength`) is not the length the model file declares. The Ollama
  provider (`_extractContextLength` in `ollamaProvider.ts`) takes the larger
  of the file's `context_length` and a guess from the RoPE base, capped at
  256K. So Auto is 128K for qwen3:8b (file says 40,960) and qwen2.5:7b
  (32,768), and 256K for qwen3 2507 / 3.x. The core chat's Auto uses the
  same number. Options put to the owner: Auto uses the declared length
  (needs the provider to report it separately), cap Auto, or leave it and
  pick a size in Ctx. Not changed: it decides how much history the model
  sees.
- The Ctx picker's "Auto (…)" label now follows a model change (it showed
  the previous model's size).

## Open, not started

- Parked by the owner: canvas date-property time zone (in the audit doc).
- Blocks 8: AI block, agent output block, dashboard widget block, budget
  block, runnable snippet.
- S3: persistent agents research and design proposal.
- D: toward Notion (mentions/backlinks, property types, CSV import).
- Story Writer (`story.js`) and Studio (`studio.js`) send no `num_ctx` when
  no size is picked; they could use the same resolver as the chat.
