# Work queue (Oct 30)

What is left on `docs/IMPROVEMENTS_2026-10-29.md`, split into what I can do
without you and what waits on you. I work down the first list in order,
commit and push after each item, and mark it here.

## I can do these without you

### Chat, memory, AI
1. Done: the context meter's popup shows the memory that rode into the last turn.
2. Done: memory writes leave /rewind checkpoints.
3. One model-call ledger: who called, model, tokens, timings, in one place you can open.
4. Done: the heartbeat notices page edits (one signal per page per ten minutes), not only file changes.
5. Web search without an API key (a no-key fallback when none is set).
6. Done: a generic OpenAI-compatible provider (LM Studio, llama.cpp server, vLLM...).
7. JSON schema instead of `format: 'json'` for the structured calls (can't be
   tried on a real model here: flagged for you to test).

### Canvas
8. Done: the slash menu opens on Text, opens mid-line after a space, finds blocks by alias (h1, ul, todo, ---...).
9. Done: a database view's menu (right-click its tab) has Export as CSV… and Import CSV….

### Atelier
10. Done: one Duplicates page with Exact and Look-alike tabs; photo, GIF and video menus show what applies, in one order.
11. Upscale loads its engine once per batch.

### Budget
12. Done: two or more of your own picks for a payee file it with no AI; fewer go into the prompt as past choices.

### Workbench and design system
13. Done: Ctrl+P finds settings, tools and themes, not only files.
14. Done: an Undo toast in the kit; moving a page to Trash offers Undo.
15. Done: Help › Copy Diagnostics (versions, tools on, model, recent errors, paths and keys hidden).
16. Done: old size variables (`--parallx-fontSize`, `--parallx-radius`) moved onto `--px-*`.
17. The empty editor shows Start (recent pages, files, new page).

## Waiting on you

- Per-routine "ask me first", and whether routine runs count as unattended
  (the consent gap found Oct 30).
- Settings: merge the nine AI pages and four Agents pages?
- Flashcards Previous without undoing; where study notes live.
- The AI's voice (default voice, Voice section).
- Ctrl+N makes a New Page? Flashcards on by default? Navigation in sidebar
  or editor? The Gmail filter default.
- Explorer: how files should look. Activity bar redesign (7 mockups).
- Anything AI that must be tried on your real model (Act in Creations, the
  relevance floor value, chat names, PDF Ask).
- Bigger moves best agreed first: Electron upgrade, MCP rework, mind maps in
  their own tab, CLIP photo search, a first run that asks three things.
