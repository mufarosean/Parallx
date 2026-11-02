# Creations reading bench: how to run it

For a Claude Code session on the machine with Ollama. The question it
answers: when two characters talk to each other in a chat, does the scene
read like a book? What it measures is in `docs/CREATIONS_QUALITY_TESTING.md`
Part 5 and at the top of `ext/creations-ai/test/run-reading-bench.mjs`. It
runs headless through the real extension code in its own scratch workspace;
the owner's workspaces and chats are never touched.

## The flow it plays

The owner's own: two characters in one chat, the model writing each reply
in turn (`/ai @"Name"`, which is what the chat's buttons send), no Scene
panel, the situation given in the opening line as a player would type it,
at the context size the chat plays at. Five scenes, twelve replies each,
one nudge from Sam at reply 6.

## Run it

- `gemma4:31b` installed, Ollama running, nothing else using the card.
  Never run two harnesses at once.
- `git pull` on `dev` first. Commit and push after every step that changes
  a file.

```
node ext/creations-ai/test/run-reading-bench.mjs --num-ctx 65536 --plain --only baseline --samples 1 --pass play --cache ext/creations-ai/test/.reading-cache.json
```

About half an hour: five scenes, 65 replies, around 20 seconds each on
gemma4:31b at 65536 (the brief once said 131072; at that size the model
fills the card and every reply takes two to three times as long as the
owner sees in play). The cache keeps every reply, so a stopped run
resumes; it stays out of git. `--scenes news,favour` plays only those.

## Judge it

The judge is you, the session, by reading: print the five scenes from the
cache and read each as a reader would, against what the scene was written
to catch (strangers who never exchange names; a line said and dropped; news
with no reaction; a want made once and never pressed; anger with no
subtext), and against the faults the first run showed on 2026-11-01: a
question asked and never answered, a voice habit in every reply (a count,
a story), a bystander ordered about instead of an answer given, the nudge
echoed for six replies, nothing new entering. Say plainly what reads and
what does not, with the lines.

The judge tables in the report (takes up, answers, dead ends, the rubric,
the anchors) are optional and also yours: `--pass judge --judge session`
writes every judge prompt to `ext/creations-ai/test/.reading-cache.judge/`,
you answer each with the JSON it asks for in `<name>.answer.json` beside
it, and the same command run again fills the report. Fill them when a
number is needed to compare two runs; the reading comes first.

## Change the app, then run it again

A fault that is the prompt's goes into the shipped text, never a per-model
override: `DEFAULT_DIALOGUE_RULES` in `ext/creations-ai/main.js` (How
People Talk) for how people answer each other, `WRITING_PRESETS` in
`ext/creations-ai/writing-style.js` for the page (never rename a key).
Run the same scenes again with a new `--cache` file and read both. Keep a
change when the scenes read better; say so with the lines, or say they do
not. Then `npx vitest run tests/unit/creationsGrowthAndDialogue.test.ts`
(it pins the rules' phrases and the settings migration), commit, push, and
add a row to the table at the top of `docs/CREATIONS_QUALITY_TESTING.md`.

## Variants

`reading-variants.md` holds alternative styles and rule sets; the bench
plays every variant named in `--only` on the same scenes and compares each
with baseline in the report. Use it only when a specific question needs
two texts side by side; one change per variant.
