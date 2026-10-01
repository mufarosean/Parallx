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

- One working branch holds the latest version: `fix/light-mode-and-accent-contrast`
  (until the owner names a new one). Start every task from its tip
  (`git pull` first) and commit to it.
- Commit and push as you go, after each finished step, so nothing lives only
  in one machine or one container. Never end a session with uncommitted work.
- Keep history in one line: no side branches for a task, no rebasing or
  force-pushing what is already pushed. If a side branch is ever needed, fold
  it back into the working branch as soon as the step is done.
- Before starting locally, pull. Before stopping, push.
- `master` trails the working branch and is only ever fast-forwarded to it
  (last on 2026-10-01). Do not build on `master`; work on the working branch.

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
- Checks: `npx tsc --noEmit`, `npx vitest run`, `npm run build`. Known
  failures that predate 2026-10-01: `moAiTagging.test.ts`,
  `mediaOrganizerFtsRebuild.test.ts` (timing), `dashboardYearProgressWidget`,
  `webResearchHistoryLog`.
