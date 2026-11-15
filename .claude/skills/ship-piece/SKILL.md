---
name: ship-piece
description: The order of work for finishing one piece of Parallx so it can be trusted without the owner checking it: checks, independent review, proof in the real app, the record, the push. Use when a piece of app code is built and before saying it is done.
---
# Shipping a piece

The owner does not check each feature; he finds out when he uses it. So a piece is done only when something other than its builder has tried to break it.

## Order

1. **Checks.** `npm run typecheck`, `npx vitest run`, `npm run build`. All pass; there are no known failures. A stop hook runs the typecheck and the ratchets on changed code, but the full suite is yours to run.
2. **Proof in the real app.** A probe in `tests/probes/` that does what a person does and reads the result back (the `run-hidden` skill). Include the hard cases: empty, twice, another tab, closed and opened, tool off.
3. **The audits, after any UI work.** `keyboard-audit-probe.mjs` and `touch-drag-probe.mjs`; both report 0.
4. **Independent review.** The reviewers in `.claude/agents/` read the diff without your account of it: `correctness-reviewer`, `modularity-reviewer`, `access-reviewer`, and `app-verifier` for the real app. Every finding goes to `skeptic` before it is acted on. When the owner has asked for a workflow (or ultracode is on), run the saved `review-piece` workflow, which does all of this in one go; otherwise spawn the reviewers that fit the change.
5. **Fix what survived**, then run step 1 again and the probe again.
6. **The claims.** Before the summary or the master list entry is written, `claim-checker` reads it against the code. "New" is checked against what the app already has. Seen on the real app, seen with a stand-in, read in code and assumed are four different things; say which.
7. **The record.** The piece's entry in `docs/MASTER_LIST.md`: what shipped, how it was checked, what was decided for him to overrule, what is not done, what only his machine can show.
8. **The push.** Commit to `dev`, `git pull` first, push. No side branches.

## What to say at the end

What is built, what was checked and by what, what failed and was fixed, what was not run and why. No "done" for anything only the builder looked at.
