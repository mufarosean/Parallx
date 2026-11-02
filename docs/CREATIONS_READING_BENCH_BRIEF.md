# Creations reading bench: the brief for the study machine

Instructions for a Claude Code session on the machine that has Ollama and the
models. The point: find out whether Creations writes scenes that read like a
book and conversations that go somewhere, with numbers that can be trusted,
and make the styles that get it there. Everything runs headless through the
real extension code (`ext/creations-ai/test/`); nothing touches your own
workspaces or chats. Read `docs/CREATIONS_QUALITY_TESTING.md` Part 5 first.

## Conditions

- Player: `gemma4:31b` at `--num-ctx 131072`, the model and size Creations is
  played with. Judge: `qwen3.8:27b` (another family; a model rates its own
  writing higher). Both installed, Ollama running, nothing else on the card.
- Work on `dev`, pulled first. Commit and push after every step that changes
  a file; the cache under the temp folder is not in git, so note its path.
- Never run two harnesses at once: one GPU, one request at a time.
- Everything the bench writes is under `ext/creations-ai/test/` and the
  cache; it creates and removes its own scratch workspace.

## Step 1: wiring, no model (minutes)

```
node ext/creations-ai/test/run-reading-bench.mjs --mock --samples 1 --turns 6 --report /tmp/reading-mock.md
```
Every check except the provisional bars must pass. If one fails, fix the
harness before spending GPU time.

## Step 2: baseline, one sample (about an hour)

```
node ext/creations-ai/test/run-reading-bench.mjs --only baseline --samples 1 --num-ctx 131072 --pass play
node ext/creations-ai/test/run-reading-bench.mjs --only baseline --samples 1 --num-ctx 131072 --pass judge
```
Play first, then judge, so each model loads once. Read the report's Samples:
the exchanges the judge failed, with its reason, and the best scene whole.
Before any number, read them as a reader. If the judge's reasons are wrong
in more than two of twelve, stop and calibrate (step 3).

## Step 3: calibrate the judge (half an hour of your reading)

```
node ext/creations-ai/test/run-reading-bench.mjs --only baseline --samples 1 --replay --calibration-sheet
```
Mark the twenty exchanges in `ext/creations-ai/test/reading-calibration.md`
(y or n for takes up, gives, thinks, moves), then:
```
node ext/creations-ai/test/run-reading-bench.mjs --only baseline --samples 1 --replay --calibrate
```
Keep a criterion only at 80 percent agreement or better. For one below, read
the disagreements, rewrite that criterion's definition in `EXCHANGE_JUDGE`
(the judge prompt in `run-reading-bench.mjs`), rerun `--pass judge` with
`--fresh`, and calibrate again. Commit the sheet with the marks.

## Step 4: anchors (twenty minutes)

Fill `ext/creations-ai/test/reading-anchors.md` with the three scenes it
names, from Project Gutenberg, public-domain editions only. Then
`--pass judge --only baseline` again: the anchors are scored on the same
rubric. If an anchor scores under 7 on the positive criteria, the judge or
the rubric is wrong, not the book; fix that before judging the model
against it.

## Step 5: the variants (an evening)

```
node ext/creations-ai/test/run-reading-bench.mjs --samples 2 --num-ctx 131072 --pass play
node ext/creations-ai/test/run-reading-bench.mjs --samples 2 --num-ctx 131072 --pass judge
```
Read the Results table against baseline. The questions, in order:
1. Do the conversation rules alone raise takes-up, answers and gives, and
   lower dead ends? If yes, they belong in the shipped How People Talk.
2. Does the novel style read as a novel: is it told apart from Immersive RP
   at 80 percent or better, with past tense and "said" in its shape, and is
   "thinks" up without "tells" going up? Compare novel with
   novel-no-thinking: that difference is what the thinking rule does.
3. Does the strangers scene pass its checklist in the winning variant?
4. Head to head: does the winner beat baseline on "the two talk to each
   other" and "the scene goes somewhere" with strength 3 or more, both
   orders?
5. Is the winner within two points of the anchors on the positive rubric?

Then iterate: one change per new variant in `reading-variants.md`, rerun
with `--only baseline,<new>`. A variant already in the cache costs nothing;
a changed variant is a new case. Stop when a variant meets every bar, or
when two rounds move nothing, and write down which.

## Step 6: ship what won

- A winning style becomes a preset in `ext/creations-ai/writing-style.js`
  (a new key; never rename one), with the dialogue bench's trigger-word
  warning in mind: no quoted phrases in it.
- Rules that won on their own go into `DEFAULT_DIALOGUE_RULES` in
  `ext/creations-ai/main.js`.
- Rerun the dialogue bench and `run-roleplay-sessions.mjs --samples 1` on
  the shipped text: the new style must not lose what those measure
  (line faults, motif echoes, memory).
- Commit the reports (`last-reading-bench.md` and the others) with the
  change, and add a row to the table at the top of
  `docs/CREATIONS_QUALITY_TESTING.md`.

## What to report back

The Results table for baseline and the winner, the calibration agreement
per criterion, the anchor scores, the worst three exchanges before and
after with the judge's reason, and the one scene you would show someone to
say "this reads". Then the honest line: does it meet the bar, and if not,
which number is furthest and what the samples say is causing it.
