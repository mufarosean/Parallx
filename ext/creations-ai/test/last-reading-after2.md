# Creations: reading bench

- Mode: LIVE, pass: play
- Player: gemma4:31b, judge: qwen3.8:27b, num_ctx 65536, samples 1
- Commit: c6a2c657
- Calls: 30 live, 0 from the cache
- Checks: 5 pass, 1 fail, 5 skipped

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
| baseline | 87 | 5.4 | 48% | 4.5 | 0% | 0% | 18% | 0.1 | 77% | 0 | 0 |

```text
ollama ps before:
NAME          ID              SIZE     PROCESSOR    CONTEXT    RUNNER      UNTIL              
gemma4:31b    c6981e1e0c64    23 GB    100% GPU     65536      llamacpp    7 minutes from now

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
| baseline#1 favour.scene | the situation is in the first turn's request | PASS | The chain has offered to sell Nora the s |
| baseline#1 favour.turns | the two took turns | PASS | Ilan Brody > Nora Vasquez > Ilan Brody > Nora Vasquez > Ilan Brody > Nora Vasquez > Ilan Brody > Nora Vasquez > Ilan Brody > Nora Vasquez > Ilan Brody > Nora Vasquez > Ilan Brody |

## Skipped

-  judge baseline#1 news: no cached judge output for "EXCHANGE: baseline#1 news"
-  judge baseline#1 favour: no cached judge output for "EXCHANGE: baseline#1 favour"
-  anchor chekhov-lady-with-the-dog: no cached judge output for "SCENE: anchor chekhov-lady-with-the-dog"
-  anchor joyce-the-dead: no cached judge output for "SCENE: anchor joyce-the-dead"
-  anchor austen-persuasion: no cached judge output for "SCENE: anchor austen-persuasion"

## Calls

| Label | Role | Seconds | Prompt tok | Output tok |
|---|---|---|---|---|
| baseline#1 news t0 turn | player | 17.8 | 2649 | 902 |
| baseline#1 news t1 turn | player | 23.5 | 2843 | 1213 |
| baseline#1 news t2 turn | player | 15.8 | 3095 | 818 |
| baseline#1 news t3 turn | player | 19.4 | 3218 | 1032 |
| baseline#1 news t4 turn | player | 17.8 | 3397 | 936 |
| baseline#1 news t5 turn | player | 19.2 | 3473 | 1013 |
| baseline#1 news t5 memory | player | 17.1 | 1248 | 909 |
| baseline#1 news t6 turn | player | 32.6 | 3618 | 823 |
| baseline#1 news t7 turn | player | 26.4 | 3958 | 1347 |
| baseline#1 news t8 turn | player | 15.5 | 4118 | 760 |
| baseline#1 news t9 turn | player | 23.6 | 4174 | 1274 |
| baseline#1 news t10 turn | player | 31.6 | 4312 | 1714 |
| baseline#1 news t11 turn | player | 18.3 | 4407 | 954 |
| baseline#1 news t11 memory | player | 22.4 | 1300 | 1208 |
| baseline#1 news t12 turn | player | 39.0 | 4563 | 874 |
| baseline#1 favour t0 turn | player | 19.9 | 2639 | 1028 |
| baseline#1 favour t1 turn | player | 23.9 | 2852 | 1265 |
| baseline#1 favour t2 turn | player | 14.5 | 3007 | 763 |
| baseline#1 favour t3 turn | player | 20.8 | 3149 | 1112 |
| baseline#1 favour t4 turn | player | 20.5 | 3282 | 1098 |
| baseline#1 favour t5 turn | player | 30.0 | 3408 | 1612 |
| baseline#1 favour t5 memory | player | 17.9 | 1118 | 957 |
| baseline#1 favour t6 turn | player | 36.1 | 3454 | 980 |
| baseline#1 favour t7 turn | player | 53.4 | 3866 | 2869 |
| baseline#1 favour t8 turn | player | 17.4 | 3921 | 868 |
| baseline#1 favour t9 turn | player | 17.8 | 4057 | 946 |
| baseline#1 favour t10 turn | player | 17.3 | 4186 | 910 |
| baseline#1 favour t11 turn | player | 17.2 | 4293 | 904 |
| baseline#1 favour t11 memory | player | 15.5 | 1252 | 809 |
| baseline#1 favour t12 turn | player | 35.3 | 4406 | 1062 |
