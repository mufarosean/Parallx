# Creations: reading bench

- Mode: LIVE, pass: play
- Player: gemma4:31b, judge: qwen3.8:27b, num_ctx 65536, samples 1
- Commit: c6a2c657
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
| baseline | 62 | 4.9 | 50% | 5.5 | 0% | 0% | 19% | 0.1 | 92% | 0 | 0 |

```text
ollama ps before:
NAME          ID              SIZE     PROCESSOR    CONTEXT    RUNNER      UNTIL              
gemma4:31b    c6981e1e0c64    23 GB    100% GPU     65536      llamacpp    8 minutes from now

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
| baseline#1 news.scene | the situation is in the first turn's request | PASS | Ilan has had a letter this morning: his  |
| baseline#1 news.turns | the two took turns | PASS | Nora Vasquez > Ilan Brody > Nora Vasquez > Ilan Brody > Nora Vasquez > Ilan Brody > Nora Vasquez > Ilan Brody > Nora Vasquez > Ilan Brody > Nora Vasquez > Ilan Brody > Nora Vasquez |

## Skipped

-  judge baseline#1 news: no cached judge output for "EXCHANGE: baseline#1 news"
-  anchor chekhov-lady-with-the-dog: no cached judge output for "SCENE: anchor chekhov-lady-with-the-dog"
-  anchor joyce-the-dead: no cached judge output for "SCENE: anchor joyce-the-dead"
-  anchor austen-persuasion: no cached judge output for "SCENE: anchor austen-persuasion"

## Calls

| Label | Role | Seconds | Prompt tok | Output tok |
|---|---|---|---|---|
| baseline#1 news t0 turn | player | 31.6 | 2757 | 1669 |
| baseline#1 news t1 turn | player | 30.0 | 2888 | 1617 |
| baseline#1 news t2 turn | player | 46.6 | 3048 | 2567 |
| baseline#1 news t3 turn | player | 24.7 | 3107 | 1333 |
| baseline#1 news t4 turn | player | 26.7 | 3262 | 1440 |
| baseline#1 news t5 turn | player | 20.9 | 3322 | 1102 |
| baseline#1 news t5 memory | player | 23.0 | 981 | 1254 |
| baseline#1 news t6 turn | player | 56.9 | 3450 | 1863 |
| baseline#1 news t7 turn | player | 56.3 | 3813 | 3040 |
| baseline#1 news t8 turn | player | 22.1 | 3876 | 1144 |
| baseline#1 news t9 turn | player | 15.7 | 3957 | 769 |
| baseline#1 news t10 turn | player | 14.0 | 4064 | 733 |
| baseline#1 news t11 turn | player | 21.6 | 4145 | 1097 |
| baseline#1 news t11 memory | player | 16.8 | 1082 | 912 |
| baseline#1 news t12 turn | player | 31.9 | 4192 | 807 |
