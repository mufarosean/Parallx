# Creations reading bench: the brief for the study machine

For a Claude Code session on the machine with Ollama. What the bench
measures and the bar it sets are in `docs/CREATIONS_QUALITY_TESTING.md`
Part 5; the measures themselves are listed at the top of
`ext/creations-ai/test/run-reading-bench.mjs`. It runs headless through the
real extension code in its own scratch workspace; your workspaces and chats
are never touched.

## Setup

- `gemma4:31b` (player) and `qwen3.8:27b` (judge) installed, Ollama running,
  nothing else using the card. Never run two harnesses at once.
- `git pull` on `dev` first. Commit and push after every step that changes
  a file.
- Every command below starts with
  `node ext/creations-ai/test/run-reading-bench.mjs --num-ctx 131072 --cache ext/creations-ai/test/.reading-cache.json`
  and adds the flags shown. The cache keeps every model output, so a
  stopped run resumes where it was and a judge pass never replays the
  player; it stays out of git.

## Steps

1. **Wiring.** `--mock --samples 1 --turns 6 --report /tmp/reading-mock.md`.
   Every check passes except the "meets every provisional bar" ones, which
   canned replies cannot. Fix the harness before spending GPU time.
2. **Anchors.** Fill `ext/creations-ai/test/reading-anchors.md` with the
   three scenes it names, from Project Gutenberg, public-domain text only.
   No model needed; the next judge pass scores them.
3. **Baseline.** `--only baseline --samples 1 --pass play` (about an hour),
   then the same with `--pass judge`. Before reading a number, read the
   report's Samples as a reader: the failed exchanges with the judge's
   reasons, the best scene whole. Then check the anchors: one scoring under
   7 on the positive criteria means the rubric or the judge is wrong, not
   the book. A failed "every turn kept a reply" check means the model
   answered nothing on some turns; look at those before anything else.
4. **Calibrate.** `--only baseline --samples 1 --replay --calibration-sheet`
   writes `reading-calibration.md`; mark its twenty exchanges y or n; then
   `--only baseline --samples 1 --replay --calibrate`. Keep a criterion at
   80 percent agreement or better. Below that, rewrite its definition in
   `EXCHANGE_JUDGE` in the bench, rerun `--pass judge --fresh`, calibrate
   again. Commit the marked sheet.
5. **Variants.** `--samples 2 --pass play` (an evening), then `--pass judge`.
   From the Results table, against baseline:
   - Do the conversation rules alone raise takes-up, answers and gives and
     cut dead ends? Then they belong in the shipped rules.
   - Is the novel style told apart from Immersive RP at 80 percent or
     better, with past tense and "said" in its shape, and is "thinks" up
     without "tells" going up? Novel against novel-no-thinking is what the
     thinking rule does on its own.
   - Does the strangers checklist pass in the winner?
   - Does the winner beat baseline head to head on "the two talk to each
     other" and "the scene goes somewhere", strength 3 or more?
   - Is the winner within two points of the anchors?

   Iterate with one change per new variant in `reading-variants.md` and
   `--only baseline,<new>`; an unchanged variant costs nothing. Stop when a
   variant meets every bar, or when two rounds move nothing, and write down
   which.
6. **Ship.** The winning style becomes a new preset key in
   `ext/creations-ai/writing-style.js` (never rename a key; no quoted
   phrases in it). Rules that won on their own go into
   `DEFAULT_DIALOGUE_RULES` in `ext/creations-ai/main.js`. Rerun
   `run-dialogue-bench.mjs` and `run-roleplay-sessions.mjs --samples 1` on
   the shipped text so nothing they measure slips. Commit the reports and
   add a row to the table at the top of `docs/CREATIONS_QUALITY_TESTING.md`.

## Report back

The Results table for baseline and the winner; the calibration agreement
per criterion; the anchor scores; the worst three exchanges before and
after, with the judge's reasons; the one scene you would show someone to
say "this reads". Then the plain answer: does it meet the bar, and if not,
which number is furthest and what the samples say causes it.
