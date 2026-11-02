# Creations: reading bench

- Mode: LIVE, pass: play
- Player: gemma4:31b, judge: session, num_ctx 65536, samples 1
- Commit: 522f5cd9
- Calls: 15 live, 0 from the cache
- Checks: 3 pass, 1 fail, 4 skipped

Per variant, over its scenes and samples. Percentages are of character replies; in brackets, the change from baseline. The bar is provisional: calibrate it against your own marks before trusting it (--calibration-sheet).

| Variant | Replies | Takes up % | Answers % | Gives % | Dead ends /100 | Thinks % | Moves % | Tells /100 | Went somewhere (1-5) | Distinct (1-5) | Rubric + (0-10) | Rubric - (0-10) | Style told % | vs baseline |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | 0 | - | - | - | - | - | - | - | - | - | - | - | - | - |

### Rubric by criterion (0-10; for a negative criterion lower is better)

| Variant | Believable dialogue | Nuanced characters | Emotionally engaging | Emotionally complex | Coherent | Sentences flow naturally | Overall reader engagement | Tell-don't-show | Purple prose | Forced poetry or metaphor | Meandering | Amateurish |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | - | - | - | - | - | - | - | - | - | - | - | - |

(reading-anchors.md has no filled anchors yet: the brief says how to add them)

### Style identification (the judge was shown one reply and the list of styles in this run)

| Variant | Shown as | Told apart % | What told the judge |
|---|---|---|---|
| baseline | Immersive RP | - |  |

### The page, mechanically

| Variant | Words/reply | Paragraphs/reply | Speech share | Questions /10 lines | Replies showing a thought | First person | Past tense | "said" /reply | Ends with a question | Stock tells | Dashes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | 78 | 4.2 | 39% | 2.8 | 0% | 0% | 61% | 0.0 | 46% | 0 | 0 |

```text
ollama ps before:
NAME          ID              SIZE     PROCESSOR    CONTEXT    RUNNER      UNTIL              
gemma4:31b    c6981e1e0c64    23 GB    100% GPU     65536      llamacpp    9 minutes from now

ollama ps after:
NAME          ID              SIZE     PROCESSOR    CONTEXT    RUNNER      UNTIL              
gemma4:31b    c6981e1e0c64    23 GB    100% GPU     65536      llamacpp    9 minutes from now
```

## Measures

| Section | Id | Measure | Value | Bar |
|---|---|---|---|---|
| Results | baseline.takesUp | takesUp | NaN | >= 90 |
| Results | baseline.answers | answers | NaN | >= 80 |
| Results | baseline.deadEnds | deadEnds | NaN | <= 10 per 100 |
| Results | baseline.moves | moves | NaN | >= 60 |
| Results | baseline.tells | tells | NaN | <= 10 per 100 |
| Results | baseline.wentSomewhere | wentSomewhere | NaN | >= 4 |
| Results | baseline.distinct | distinct | NaN | >= 4 |
| Results | baseline.positive | positive | NaN | >= 7 |
| Results | baseline.negative | negative | NaN | <= 3 |
| Results | baseline.styleHit | styleHit | NaN | >= 80 |
| Repetition | baseline.motif | motif echoes across all scenes | 1 | record only |
| Repetition | baseline.novelty | turns bringing in something new, by thirds (mean) | 1.00 / 1.00 / 1.00 | record only |

## Checks

### Results

| Id | Check | Result | Detail |
|---|---|---|---|
| baseline.bar | meets every provisional bar | FAIL | takesUp, answers, deadEnds, moves, tells, wentSomewhere, distinct, positive, negative, styleHit |

### Wiring

| Id | Check | Result | Detail |
|---|---|---|---|
| baseline.rules | its rules are in the prompt | PASS |  |
| baseline#1 counter-comic.scene | the situation is in the first turn's request | PASS | Bernie Glass was admitted after a fall o |
| baseline#1 counter-comic.turns | the two took turns | PASS | Bernie Kowalski > Margaret Higgins > Bernie Kowalski > Margaret Higgins > Bernie Kowalski > Margaret Higgins > Bernie Kowalski > Margaret Higgins > Bernie Kowalski > Margaret Higgins > Bernie Kowalski > Margaret Higgins > Bernie Kowalski |

## Skipped

-  judge baseline#1 counter-comic: no cached judge output for "EXCHANGE: baseline#1 counter-comic"
-  anchor chekhov-lady-with-the-dog: no cached judge output for "SCENE: anchor chekhov-lady-with-the-dog"
-  anchor joyce-the-dead: no cached judge output for "SCENE: anchor joyce-the-dead"
-  anchor austen-persuasion: no cached judge output for "SCENE: anchor austen-persuasion"

## Calls

| Label | Role | Seconds | Prompt tok | Output tok |
|---|---|---|---|---|
| baseline#1 counter-comic t0 turn | player | 29.2 | 3491 | 1303 |
| baseline#1 counter-comic t1 turn | player | 25.3 | 3614 | 1074 |
| baseline#1 counter-comic t2 turn | player | 22.7 | 3876 | 992 |
| baseline#1 counter-comic t3 turn | player | 52.4 | 3913 | 2434 |
| baseline#1 counter-comic t4 turn | player | 21.6 | 4177 | 945 |
| baseline#1 counter-comic t5 turn | player | 67.1 | 4184 | 3043 |
| baseline#1 counter-comic t5 memory | player | 24.5 | 1133 | 1169 |
| baseline#1 counter-comic t6 turn | player | 45.6 | 4377 | 995 |
| baseline#1 counter-comic t7 turn | player | 34.4 | 4573 | 1482 |
| baseline#1 counter-comic t8 turn | player | 23.2 | 4803 | 979 |
| baseline#1 counter-comic t9 turn | player | 22.5 | 4771 | 1019 |
| baseline#1 counter-comic t10 turn | player | 34.6 | 4992 | 1543 |
| baseline#1 counter-comic t11 turn | player | 39.9 | 4969 | 1851 |
| baseline#1 counter-comic t11 memory | player | 15.4 | 1115 | 686 |
| baseline#1 counter-comic t12 turn | player | 34.5 | 5193 | 798 |
