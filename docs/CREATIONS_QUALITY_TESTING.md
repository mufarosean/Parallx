# Creations AI: quality testing guide

Written 2026-10-08. How to test the quality of character creation,
roleplay and Directions with a real model, what to measure, which published
benchmarks to borrow from, and in what order to do it. Read
`docs/CREATIONS_AI.md` first for what each feature does.

## Build the world feature first?

No. Test first, then build it. Four reasons:

- **A baseline is the point.** World beats change every roleplay reply. If
  they land before anything is measured, there is nothing to compare
  against, and no way to tell whether they made the story better or just
  different.
- **The tests give the world feature its pass bar.** The two problems it is
  meant to fix are measurable now: the story collapsing to two people
  (how often a turn brings in anyone or anything new) and motifs that
  repeat (the chiming clock). Measured today, those numbers become what the
  world feature has to beat.
- **Directions is unproven with a real model.** It has only run against a
  stand-in. If its options turn out generic on the local model, the world
  feature, which uses the same kind of call, inherits the problem. Fix it
  once, in the smaller feature.
- **The harness is behind.** The last measured run was 2026-09-20. Most of
  what changed since then has never been measured at all (the table
  below). That debt grows with every feature added on top.

Design the roleplay runs so the world feature can slot in later: the same
scenarios, the same metrics, one switch.

## What has changed since the last measured run

The last live quality run (`ext/creations-ai/test/last-creations-quality.md`)
was 2026-09-20 on qwen3.8:27b: 134 pass, 3 fail. The roleplay benchmark
(`last-quality-report.md`) and the behaviour suite (`last-live-report.md`)
last ran in July, on another model.

| Change | Built | Measured live |
|---|---|---|
| Studio: sheet from a concept, Twist from sources, reroll, Try A Line | 09-20 | Yes, 09-20 |
| Roleplay memory file, quoted earlier turns, no summariser | 09-20, fixed 10-04 | No |
| Card is the start, memory is the present; Timeline tail in every prompt | 10-05 | No |
| Dialogue rules ("How People Talk") | 10-05 | No |
| Supporting cast, voiced inside a turn | 10-05 | No |
| Pitch Ideas (four takes before the sheet) | 10-05 | No |
| Example dialogue drawn from drives, secret and relationships | 10-05 | No |
| Character Seeds table and Roll The Dice (want, fear, secret) | 10-05 | No |
| Quoted phrases in Voice are register, not lines ("Might say") | 10-05 | No |
| Sheet structure (Appearance in five labelled sections) and Complete | 10-06 | No |
| Connected people, and People In Their Lives in chat | 10-06 | No |
| Regenerate with a direction | 10-07 | No |
| Directions (four notes per character) | 10-07 | Stand-in model only |

## Three layers

1. **Wiring, no model.** Does the right text reach the model, and does the
   app do the right thing with the reply? Deterministic, runs in seconds,
   must always pass. This layer exists:
   ```
   npx vitest run tests/unit/creations
   xvfb-run -a node tests/probes/creations-directions-probe.mjs <outDir>
   node tests/probes/creations-redesign-probe.mjs <outDir>
   ```
   The directions probe needs port 11434 free, so stop Ollama first.
2. **Measured quality, real model, scripted.** The same cases every run,
   scored by mechanical checks and by a judge model, written to a report.
   Partly exists; most of the work in this guide is extending it.
3. **Play sessions.** You play, then fill in a short score sheet. This is
   the ground truth the other two are calibrated against. Nothing else
   tells you whether it is fun.

## Before any live run

### Repair the behaviour suite

`ext/creations-ai/test/run-live-tests.mjs --mock` failed six hard checks
until 2026-10-08. A mock run cannot fail on the model, so they were the
harness falling behind the app. Repaired:

| Check | Cause | Fix |
|---|---|---|
| S7.1 | The button's title is now "Regenerate this turn, with a direction if you like", and it opens a box for a direction. | Match the title's start; press the box's Regenerate. |
| S5.1 to S5.4, S6.3 | After a reply the app sends a background memory-extraction request, and the harness read the last request sent, which was that one. | `sendAndWait` returns the request whose last user message carries the sent text; the regenerate step skips memory requests. |

All hard checks pass in mock mode.

A mock run rewrites `last-live-report.md`; restore it with
`git checkout ext/creations-ai/test/` unless the run is meant to be kept.
The other two harnesses pass in mock mode:
```
node ext/creations-ai/test/run-creations-quality.mjs --mock --report <scratch>.md
node ext/creations-ai/test/run-quality-suite.mjs --mock
```

### Fix the conditions

- **Player model.** The model you actually play with. The last run used
  qwen3.8:27b at num_ctx 8192. The behaviour and roleplay suites still
  default to qwen3.5-uncensored; pass `--model`.
- **Judge model.** Never the player model: models rate their own writing
  higher. Use a local model of another family. A cloud judge is stronger
  and is fine for synthetic test characters only, never your real chats.
  The judge lives only in the harness. Nothing in the app ever calls it.
- **Calibrate the judge before trusting it.** Score 20 items yourself, run
  the judge on the same 20, and keep a judge criterion only where it agrees
  with you most of the time. The author of RP-Bench reports their judge
  disagreed with real users about half the time. Mechanical checks need no
  calibration, so prefer them wherever one exists.
- **Variance.** Three samples per case, with the app's own temperatures.
  Report the median and the worst. One sample says nothing about a
  creative model.
- **Replay.** Cache every raw output, as the creations harness already
  does with `--cache` and `--replay`, so a new check can rescore an old run
  without a model call.
- **Record** the model, num_ctx, `ollama ps` before and after, and the git
  commit at the top of every report.

## Part 1: Character creation

Extend `run-creations-quality.mjs`. It already builds the real prompts from
`studio-core.js` and scores a sheet from a concept, a Twist from sources,
a reroll, Try A Line, story beats and the Tables grammar. Keep all of it.
Add one section per feature below. Use at least six concepts: two plain
("a retired forensic accountant who hears music in ledgers"), two from a
Wikipedia link with a Twist, one connected to an existing character, one
from Roll The Dice.

**Pitch Ideas**
- Four pitches come back, each with name, tagline, hook, contradiction and
  a line.
- The four are different. Mechanical: no two share a name, and pairwise
  word overlap of the hooks stays low. Embedding similarity through the
  local `nomic-embed-text` is a better measure if available.
- Write This One carries the chosen pitch: its name and its hook's key
  nouns appear in the sheet.

**Sheet structure**
- Appearance comes back as five paragraphs labelled Overview, Height and
  build, Face, Clothes, Physicality, in that order. Use the app's own
  `sectionsPresent`.
- Record three rates: complete on the first try, complete after the one
  automatic completion, still showing "Missing:". The last should be
  near zero.
- The completion rewrite keeps the existing sections word for word.

**Connected people**
- The connected character's name is spelled exactly as on their card.
- Relationships names every connected person.
- Nothing contradicts the connected card. Judge, with both cards side by
  side.
- None of the connected card's Secrets appears. Mechanical: distinctive
  words from that field must not show up.
- The link button adds exactly one line to the other card, never twice.

**Dice and example dialogue**
- Rolled Want, Fear and Secret appear in Drives and Secrets.
- Example dialogue has three situations, each traceable to a drive, the
  secret or a relationship. Judge.
- The character never names their own values. Mechanical: flag abstract
  nouns ("peace", "solitude", "freedom", "honor", "loyalty") as the subject
  of a sentence in their lines. The list goes in the harness, editable.

**Voice**
- Voice has one "Might say" example.
- In five Try A Line samples, that exact phrase appears at most once and
  never opens a line.

**Does the sheet survive into chat?** Borrowed from InCharacter. Open a
chat with each new character and ask ten interview questions ("What do
you do when someone lies to you?"). The judge reads only the Personality
and Drives fields and guesses each answer's direction before seeing it,
then scores agreement. A character whose answers could belong to anyone
fails, however good the sheet reads.

## Part 2: Roleplay

Extend `run-quality-suite.mjs`. It already plays a fixed 9-turn session
through the real extension and measures repeated phrases, same openings,
vocabulary, sentence rhythm, length drift and stock phrases. Its last
report caught "the gas jet hisses" three times: the chiming clock,
measured. Keep all of it, and make three changes.

**1. Longer sessions with a user emulator.** Borrowed from PingPong and
CoSER. A second model plays your character from a short brief and a
situation, so sessions run 30 turns without a script. Keep the fixed
9-turn script as a regression check alongside.

**2. Four standard scenarios**, each a seeded workspace with cards, a
thread, and lines planted at known turns:

| Scenario | Tests |
|---|---|
| Two leads in one room, no plot given | Collapse to two people, motif repetition. The world feature's baseline. |
| Two leads, a supporting cast of two, People In Their Lives on both cards | Minor characters voiced only inside turns, never their own. |
| Three planted facts at turns 3 to 5: a place, a promise, an object | Memory after they leave the live window. The garage-becomes-driveway bug. |
| Card says married; the chat ends the marriage at turn 8 | Memory beats the card: at turn 20, still divorced. |

**3. New measures.** Mechanical unless marked judge.
- **Motif echo.** A concrete noun phrase in three or more of any five
  replies in a row, not counting character names. Count and list them.
  This is the world feature's main target.
- **Collapse.** Per turn: does it bring in a person, place, object or
  event not seen before? Report the share of turns that do, by thirds of
  the session. Falling to near zero is the two-person collapse.
- **Speaker leaks.** Writing another character's or your character's
  words or thoughts. Supporting cast lines inside a turn are allowed; a
  supporting cast member getting a turn of their own is a leak.
- **Dialogue rules.** Characters naming their values, abstract nouns as
  subjects, as in Part 1.
- **Voice phrase reuse.** The "Might say" phrase more than once per scene.
- **Memory recall.** At turn 25, a line from your character that leans on
  each planted fact ("Back to level two, then?"). Judge: is the reply
  consistent with the fact? Also judge the memory file itself against the
  transcript: invented facts are worse than missing ones. Check the file
  was updated after every sixth story reply.
- **Whole session, judge.** CoSER's four dimensions: storyline
  consistency, human-likeness, character fidelity, storyline quality.
  Each starts at 100 and loses points per flaw found, and the judge must
  quote the flaw. Quoted flaws are what make the scores fixable.

Leave em dashes, length drift and stock phrases as they are; they work.

## Part 3: Directions

Two harness sections and a play-session measure. The harness calls the
pure `buildDirectorPrompt` and `parseDirections` from `director.js` on
scenes taken from the roleplay scenarios, so the context matches what the
app sends.

**Does it work at all**
- Format: share of calls that read into four options per character with
  all four kinds. Below 95 percent, the prompt or the reader needs work.
- Latency on the real model: time to the first option and to the last.
  This decides whether it feels instant.

**Is each option right**
- **Kind.** The judge gets an option without its label and says which of
  Deepen, Push, Complicate, Move it is. Agreement with the label below
  80 percent means the four kinds blur together.
- **Different.** Within one character, pairwise similarity of the four.
  Across five asks on the same scene, how often the same idea comes back.
  This is the "Echoes in AI" plot-diversity measure applied to one scene.
- **Grounded.** Each option names something from the scene, memory or
  sheet. Mechanical: a content word shared with the context. The judge
  flags options that contradict the memory.
- **Only their move.** The judge flags options that decide how someone
  else answers.
- **Fresh.** No option restates one of the last notes used.

**Does a pick work**
- Generate the turn from each option. Judge: did the turn do what the
  note said, and stay in the character's voice?
- **Does it make the story better?** Run the emulator scenarios twice: once
  with the emulator picking a random direction every other turn, once
  without. A judge compares the two transcripts blind, both orders, and
  says which story is better. Head-to-head comparison is how EQ-Bench
  ranks creative writing, because judges are steadier at comparing than
  at scoring alone.

**Does the player use it** (play sessions, the measure that matters most)
- For each ask, note whether you picked an option, picked and edited one,
  or ignored the card. A pick rate below a third of asks means the
  options are not good enough, whatever the harness says.

## Part 4: Play sessions

Five sessions of 30 minutes or more: the four standard scenarios with
your own character, and one freestyle. Afterwards, one line per item,
1 to 5, plus the turn numbers of anything that went wrong.

| Item | 1 means | 5 means |
|---|---|---|
| The world felt bigger than the two of us | Nothing exists off the page | People and places came up unasked |
| Characters sounded like their cards | Generic voice | I could tell who spoke without the name |
| It remembered | Forgot the setting or a promise | Brought back something from long ago, right |
| Nothing nagged | A word or image kept returning | No repetition I noticed |
| The story moved | Circled in place | Something changed every few turns |
| Directions helped | Ignored every card | Picked most times, barely edited |

Keep the score sheets as `docs/creations-playtests/<date>-<scenario>.md`,
with the thread id, so the chat can be reopened. Compare the scores with
the harness numbers for the same session. Where they disagree, trust
yours and fix the measure.

## Published benchmarks: what to borrow

None of these can run against Creations as they are. They test raw models
with their own prompts, and the point here is to test Creations' prompts
on your model. Borrow their methods and rubrics.

| Benchmark | What it does | What to borrow |
|---|---|---|
| CoSER (2025) | 30-turn dialogues as book characters; a judge scores four dimensions by deducting for each flaw found | The four dimensions and flaw-by-flaw deduction for whole sessions |
| PingPong | A player model, a model emulating the user, and several judges scoring consistency, entertainment and fluency | The user emulator, and averaging more than one judge |
| RMTBench (2025) | Multi-turn sessions built from what the user wants, not from the character | Scenarios written as user intentions ("wants to confess something") |
| InCharacter (ACL 2024) | Interviews role-playing agents with psychological scales to check personality fidelity | The interview test for whether a sheet survives into chat |
| TimeChara | Checks whether a character leaks events they should not know yet | The leak test for a hidden story direction, later |
| LoCoMo (2024) | Questions about facts from very long conversations | Planted facts and recall probes for the memory file |
| EQ-Bench Creative Writing v3 and Longform | Repetition and "slop" counts, rubric scoring, head-to-head Elo | Repetition and slop measures; head-to-head comparison for A/B runs |
| Echoes in AI (PNAS 2025) | Measures how often the same plot idea recurs across generations | Echo rate across repeated Directions asks |
| RP-Bench (community) | 27 dimensions including respecting user agency and using lore; adversarial multi-turn mode | The agency dimension, and its warning about judges |

## The harnesses (built 2026-10-08)

Parts 1 to 3 are three harnesses in `ext/creations-ai/test/`, sharing
`harness-common.mjs` (model calls, cache, measures, report) and
`scenarios.mjs` (the four scenarios and the Directions scenes):

| Harness | Covers |
|---|---|
| `run-creation-checks.mjs` | Part 1: pitches, Appearance structure and completion, connected people, dice, example dialogue, voice, the interview |
| `run-directions-checks.mjs` | Part 3: format, latency, kind, difference, echo across asks, grounding, other people's moves, freshness |
| `run-roleplay-sessions.mjs` | Part 2, plus Part 3's "does a pick work" and "does it make the story better" (they need the real chat) |

Run them all with one command:
```
node ext/creations-ai/test/run-all-quality.mjs           # live, hours
node ext/creations-ai/test/run-all-quality.mjs --mock    # wiring, seconds
```
It runs every player pass first, then every judge pass, so the play model
and the judge each load once. Every harness plays with gemma4:31b at
num_ctx 65536, the model and size Creations is played with, and judges with
qwen3.8:27b (another family; a model rates its own writing higher). Outputs are cached by
label: a stopped run picks up where it was, and `--replay` on any harness
rescores without a model. The user emulator is the play model with its own
prompt, so play never swaps models. Rough length at three samples: about
1,200 calls, five to seven hours; `--samples 1` takes about a third.

Still owed: the judge calibration (20 items scored by hand against the
judge's verdicts), which needs the first live run's judge output.

## Dialogue tuning

Characters often say what no person would: abstract ideas as if they were
things ("trust is a door"), metaphors and aphorisms, fixing on trivia,
roundabout "clever" questions where a person would just ask, wit forced into
a moment that does not want it. The shipped "How People Talk" rules aim at
this and had never been measured. `run-dialogue-bench.mjs` measures it and
compares changes.

**The measure.** Eight everyday scenes (small talk, bad news, a favour, a lie
found out, an argument, praise, practical questions, a personal question),
four lines from Sam each, played through the real chat. A dialogue judge
reads every spoken line with what was said to the character, and flags only
what applies: abstract, metaphor, trivial, oblique, forced wit, unnatural,
flat. It also marks lines that sound like a real person, wit included when it
lands, so a change that makes dialogue dry shows up as fewer good lines and
more flat ones. Reported per 100 lines, against baseline, with the flagged
lines quoted. A mechanical count of abstract-noun subjects and similes sits
beside it.

**The levers**, one per variant in `ext/creations-ai/test/dialogue-variants.md`
(plain text, no code), all real settings of the app:

| Lever | In the app |
|---|---|
| Rules | Settings, "How People Talk" (`dialogueRules`): shipped, none, or new text |
| Temperature | the character's temperature |
| Preset | the chat's writing style override |
| Style | the custom writing style text |
| Reminder | a line added to the character's Reminder |
| Example dialogue | on or off |

`--ablate` adds one variant per shipped rule with that rule left out, to find
a rule that does harm. One suspect: "People answer the question they heard,
not the one that was asked" may be what makes characters dodge plain
questions (not confirmed).

**Trigger words.** `--triggers` runs one plain character, then once per word
in the variants file ("poetic", "witty", "enigmatic", "full of metaphors"...)
added to her Voice, and ranks the words by how much worse they make her
sound. What comes out can become a Studio warning, or words the Studio
avoids writing.

**Calibration first.** `--replay --calibration-sheet` writes
`dialogue-calibration.md`: 40 lines to mark with letters. `--replay
--calibrate` reports how often the judge agrees with you, per fault. Trust
a fault only where it agrees 80 percent of the time or more.

**An iteration.** Add a variant with one change, run
`node ext/creations-ai/test/run-dialogue-bench.mjs --only baseline,<name>`,
read the table and the flagged lines, keep the change if faults fall
without good lines falling or flat lines rising. Then the winning text goes
into the app's shipped rules.

Rough length: a variant is 32 replies per sample, about 15 minutes on
gemma4:31b; the default two samples of three variants is about an hour and
a half, `--ablate` adds about two and a half hours, `--triggers` about four.

## Order of work

1. Repair the six drifted checks in the behaviour suite. Done 2026-10-08.
2. Add the Part 1 sections. Built as `run-creation-checks.mjs`; run it live and
   keep the report.
3. Add the Part 3 sections, the cheapest real test of Directions. Built as
   `run-directions-checks.mjs`. Fix the
   prompt or the reader if format or kind agreement misses.
4. Extend the roleplay suite: emulator, four scenarios, new measures, the
   session judge. Built as `run-roleplay-sessions.mjs`. Calibrate the judge on 20 hand-scored items. Run it live:
   this is the baseline.
5. Play the five sessions. Fix the worst three problems found, and re-run
   the harness to check nothing else moved.
6. Then build the world feature, with motif echo and collapse from the
   baseline as its pass bar, and the same scenarios with world beats on.

## First pass bars

Starting points. Tighten them once a baseline exists.

| Measure | Bar |
|---|---|
| Creations quality checks (existing) | No new failures against 09-20 |
| Appearance sections still missing after Complete | Under 5 percent of sheets |
| Connected names spelled right, secrets kept | Every time |
| Directions read into four per character | 95 percent of calls |
| Directions kind agreement with the judge | 80 percent |
| Speaker leaks per 30-turn session | Zero |
| Planted facts recalled correctly at turn 25 | Two of three |
| Motif echoes per 30-turn session | Record only. The world feature's bar. |
| Turns bringing in something new, last third | Record only. The world feature's bar. |
| Directions pick rate in play | A third of asks or more |

## Sources

- [CoSER, as described in RMTBench's related work](https://arxiv.org/html/2507.20352v2)
- [RMTBench](https://arxiv.org/pdf/2507.20352)
- [PingPong](https://arxiv.org/html/2409.06820v4)
- [InCharacter](https://arxiv.org/html/2310.17976v4)
- [LoCoMo: very long-term conversational memory](https://arxiv.org/abs/2402.17753)
- [EQ-Bench Creative Writing v3](https://eqbench.com/creative_writing.html)
- [EQ-Bench Longform Creative Writing](https://eqbench.com/creative_writing_longform.html)
- [Echoes in AI: plot diversity](https://arxiv.org/html/2501.00273v2)
- [RP-Bench](https://github.com/LeviTheWeasel/rp-benchmark)
- [FURINA, a customizable role-playing benchmark](https://arxiv.org/pdf/2510.06800)
