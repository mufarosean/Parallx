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
| baseline | 97 | 3.1 | 68% | 7.5 | 0% | 0% | 29% | 0.0 | 62% | 0 | 0 |

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
| Repetition | baseline.motif | motif echoes across all scenes | 0 | record only |
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
| baseline#1 sisters-sam.scene | the situation is in the first turn's request | PASS | The developer's offer for the cafe is on |
| baseline#1 sisters-sam.turns | the two took turns | PASS | Jen Hadley > Mo Hadley > Jen Hadley > Mo Hadley > Jen Hadley > Mo Hadley > Jen Hadley > Mo Hadley > Jen Hadley > Mo Hadley > Jen Hadley > Mo Hadley > Jen Hadley |

## Skipped

-  judge baseline#1 sisters-sam: no cached judge output for "EXCHANGE: baseline#1 sisters-sam"
-  anchor chekhov-lady-with-the-dog: no cached judge output for "SCENE: anchor chekhov-lady-with-the-dog"
-  anchor joyce-the-dead: no cached judge output for "SCENE: anchor joyce-the-dead"
-  anchor austen-persuasion: no cached judge output for "SCENE: anchor austen-persuasion"

## Calls

| Label | Role | Seconds | Prompt tok | Output tok |
|---|---|---|---|---|
| baseline#1 sisters-sam t0 turn | player | 43.3 | 3002 | 1961 |
| baseline#1 sisters-sam t1 turn | player | 47.3 | 3169 | 2175 |
| baseline#1 sisters-sam t2 turn | player | 16.2 | 3331 | 653 |
| baseline#1 sisters-sam t3 turn | player | 43.4 | 3482 | 2014 |
| baseline#1 sisters-sam t4 turn | player | 24.9 | 3540 | 1104 |
| baseline#1 sisters-sam t5 turn | player | 15.7 | 3702 | 670 |
| baseline#1 sisters-sam t5 memory | player | 26.8 | 1065 | 1228 |
| baseline#1 sisters-sam t6 turn | player | 46.8 | 3827 | 895 |
| baseline#1 sisters-sam t7 turn | player | 60.8 | 4192 | 2726 |
| baseline#1 sisters-sam t8 turn | player | 22.3 | 4368 | 970 |
| baseline#1 sisters-sam t9 turn | player | 51.4 | 4531 | 2310 |
| baseline#1 sisters-sam t10 turn | player | 17.8 | 4674 | 721 |
| baseline#1 sisters-sam t11 turn | player | 42.4 | 4830 | 1870 |
| baseline#1 sisters-sam t11 memory | player | 33.0 | 1511 | 1504 |
| baseline#1 sisters-sam t12 turn | player | 56.5 | 5000 | 988 |
