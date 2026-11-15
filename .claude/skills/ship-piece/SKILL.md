---
name: ship-piece
description: The order of work for one piece of Parallx, from the request to the push, so it can be trusted without the owner checking it. Use at the start of a piece of app code and again before saying it is done.
---
# One piece, start to finish

The owner does not check each feature; he finds out when he uses it. So a piece is done only when something other than its builder has tried to break it, and the test of it was fixed before the builder began.

What this order rests on (read 2026-11-15): models asked to pass a check they cannot honestly pass change the check about half the time, mostly by editing the tests, and almost never when the tests are out of their hands (ImpossibleBench); about half of agent changes that pass their tests would not be merged by a maintainer (METR); a reviewer asked to find problems always finds some, so fixing every finding adds layers (Anthropic's own guidance); a model judging work in the session that made it is a worse judge (arXiv 2603.04582).

## Before building

1. **Check the app for what exists.** Search `ext/`, `src/built-in/` and `docs/` for what already does this, under other names too.
2. **The acceptance probe, first.** `tests/probes/<piece>-acceptance.mjs`, written from the request by the `app-verifier` agent (or the `acceptance-first` workflow when he has asked for a workflow), not by whoever builds. Its header says `@acceptance`. Every check for the new behaviour fails on the app as it is. The builder does not edit this file; if a check is wrong, the verifier changes it and the reason goes in the reply.

## Building

3. Build to the probe and the house rules. One piece only.

## Before saying it is done

4. **Checks.** `npm run typecheck`, `npx vitest run`, `npm run build`. All pass. The stop hook runs the typecheck and the ratchets on changed code, but the full suite is yours to run.
5. **The acceptance probe passes**, unedited. A new unit test is seen to fail on the code as it was.
6. **The audits, after any UI work.** `keyboard-audit-probe.mjs`, `touch-drag-probe.mjs` (both report 0) and `visual-consistency-probe.mjs` (no new finding on the screens the piece touches).
7. **Independent review.** `correctness-reviewer`, `modularity-reviewer`, `access-reviewer` and `app-verifier` read the diff without your account of it; `skeptic` then tries to refute each finding. With a workflow asked for, `review-piece` does all of it. Fix only what the skeptic reproduced and says matters. Report the rest; do not act on it.
8. **Nothing weakened.** No assertion removed, test skipped, ratchet baseline raised, error silenced or acceptance probe edited to get a pass. The stop hook names each one to the owner; if one is right to change, say which and why.
9. **The claims.** `claim-checker` reads the summary and the master list entry against the code. Seen on the real app, seen with a stand-in, read in code and assumed are four different things; say which.
10. **The record and the push.** The piece's entry in `docs/MASTER_LIST.md` (what shipped, how it was checked, what was decided for him to overrule, what only his machine can show). `git pull`, commit to `dev`, push.

## Then stop

One piece to a session. The next piece starts in a new session from the master list: a long session's context is compacted, and the model is at its weakest right after.

## What to say at the end

What is built; what checked it and what that found; what was fixed; what was reported and left; any check that was changed and why; what was not run and why.
