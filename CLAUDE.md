# Working on Parallx

## How the owner works

- One person works on this project. Work is linear: one thing at a time,
  finished, then the next.
- Assume every task builds on the latest version of the app. There is no
  parallel work to keep apart.
- Work moves between Claude Code in the cloud and Claude Code in VS Code on
  the owner's machine. Whichever one picks up next must start from exactly
  where the last one stopped.

## Git rules that follow from that

- One working branch holds the latest version: `dev`
  (until the owner names a new one). Start every task from its tip
  (`git pull` first) and commit to it.
- Commit and push as you go, after each finished step, so nothing lives only
  in one machine or one container. Never end a session with uncommitted work.
- Keep history in one line: no side branches for a task, no rebasing or
  force-pushing what is already pushed. If a side branch is ever needed, fold
  it back into the working branch as soon as the step is done.
- Before starting locally, pull. Before stopping, push. That means every
  branch with a commit, not only the working one: a commit on a local side
  branch exists for no other machine until it is pushed.
- "Is anything on branch X not in the working branch?" is answered by
  content, with full history, for both copies of X:
  - Cloud checkouts are shallow, so run `git fetch --unshallow` first. Without
    it, unrelated-looking histories give wrong answers.
  - Compare with `git cherry -v <working> <X>`. `-` means the change is
    already in the working branch, `+` means it is not. Folded-in work usually
    carries new commit hashes, so hashes alone mislead. A `+` whose diff
    differs only in context lines (same change, other surrounding lines) is
    also already in.
  - Check the local X and `origin/X` separately, and say which one the answer
    is about. Locally, `git log origin/X..X` lists commits never pushed; push
    them before calling X folded in.
- `master` trails the working branch and is only ever fast-forwarded to it
  (last on 2026-10-05, at `2e1e8719`). Do not build on `master`; work on the working branch.

## The first principle: the app is only what the user turned on

Parallx is modular, local and private, and users trust it because of that.
Its complexity grows with what each user enables: someone who uses it only
for pages and PDFs gets exactly that. So:

- The core (workbench, canvas, chat, settings, dashboard) knows no optional
  tool or extension. Tools that can be turned off include the optional
  built-ins (Planner, Worksheets, Agents and the rest whose manifest has
  no `required: true`) and every extension in `ext/` (Atelier, Budget,
  Browser, Flashcards, Web Research...).
- Everything a tool adds comes from the tool while it runs, through a
  contribution point: page blocks (`api.canvas.registerBlock`), dashboard
  widgets, AI tools (`api.chat.registerTool`), settings (its manifest's
  `configuration`, or a settings panel it registers), commands, menus,
  skills, prompts, icons, styles. Turned off, all of it goes, at once,
  without a restart. Data it saved is kept for when it is turned on again.
- Nothing runs for a tool that is off: no IPC work, timers, network
  requests, background jobs or services started for it at boot.
- No core copy, prompt, template or default names a tool the user may not
  have. If the core needs something from a tool, it defines a generic
  contribution point and the tool registers into it; never the reverse.
- When a contribution point is missing, build it; do not special-case one
  tool in the core. `docs/MODULARITY_AUDIT_2026-10-04.md` lists where the
  app still breaks this rule and what is fixed.

## House rules worth knowing first

- UI uses the app's own system: `--px-*` tokens (`src/theme/px-tokens.css`),
  the kit (`src/ui/kit.ts`, `api.ui.*` for extensions), icons from the icon
  registry. Anything genuinely new is registered there (a Tier 3 component
  block), never a stray value. `docs/PARALLX_EXTENSION_AUTHORING_FOR_AI.md`
  §6 has the rules; the compliance tests in `tests/unit/*Compliance.test.ts`
  and `extStyleRatchet.test.ts` enforce them.
- Copy: Title Case for actions and titles, sentence case for section labels
  and hints, no uppercase micro-labels, no em dashes in labels, `…` when an
  action opens a dialog.
- Checks: `npx tsc --noEmit`, `npx vitest run`, `npm run build`. All of
  them pass; there are no known failures. A failing test is the app's
  problem whoever caused it: find the cause and fix it, never list it
  as known. Tests must not depend on the machine's speed or time zone.
