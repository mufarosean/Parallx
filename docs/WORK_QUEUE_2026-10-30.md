# Work queue (Oct 30)

What is left on `docs/IMPROVEMENTS_2026-10-29.md`, split into what I can do
without you and what waits on you. I work down the first list in order,
commit and push after each item, and mark it here.

## I can do these without you

### Chat, memory, AI
1. Done: the context meter's popup shows the memory that rode into the last turn.
2. Done: memory writes leave /rewind checkpoints.
3. Done: one model-call ledger: who called, model, tokens, timings and outcome, in one place you can open (AI: Show Model Calls).
4. Done: the heartbeat notices page edits (one signal per page per ten minutes), not only file changes.
5. Done: web search works with no API key (DuckDuckGo when no Brave key is set).
6. Done: a generic OpenAI-compatible provider (LM Studio, llama.cpp server, vLLM...).
7. Done: the structured calls send their JSON schema (Linking pages; Budget's
   four stages; Creations' act brief, test drive, story memory, chat memory,
   Since Then). Studio keeps plain JSON. Not tried on a real model here.

### Canvas
8. Done: the slash menu opens on Text, opens mid-line after a space, finds blocks by alias (h1, ul, todo, ---...).
9. Done: a database view's menu (right-click its tab) has Export as CSV… and Import CSV….

### Atelier
10. Done: one Duplicates page with Exact and Look-alike tabs; photo, GIF and video menus show what applies, in one order.
11. Done: Upscale loads its engine once per batch (one SeedVR2 run for all the photos; needs a try on your card).

### Budget
12. Done: two or more of your own picks for a payee file it with no AI; fewer go into the prompt as past choices.

### Workbench and design system
13. Done: Ctrl+P finds settings, tools and themes, not only files.
14. Done: an Undo toast in the kit; moving a page to Trash offers Undo.
15. Done: Help › Copy Diagnostics (versions, tools on, model, recent errors, paths and keys hidden).
16. Done: old size variables (`--parallx-fontSize`, `--parallx-radius`) moved onto `--px-*`.
17. Done: the empty editor is Start: New Page, Open File…, the last six pages and files opened, then the shortcuts.

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
