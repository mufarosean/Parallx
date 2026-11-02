# Creations: reading bench

- Mode: LIVE, pass: play
- Player: gemma4:31b, judge: qwen3.8:27b, num_ctx 65536, samples 1
- Commit: c6a2c657
- Calls: 75 live, 0 from the cache
- Checks: 6 pass, 7 fail, 8 skipped

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
| baseline | 91 | 4.9 | 52% | 5.0 | 3% | 0% | 66% | 0.1 | 88% | 0 | 0 |

```text
ollama ps before:
NAME    ID    SIZE    PROCESSOR    CONTEXT    RUNNER    UNTIL

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
| baseline.empty | every turn kept a reply | FAIL | 2 turns answered nothing |

### Wiring

| Id | Check | Result | Detail |
|---|---|---|---|
| baseline.rules | its rules are in the prompt | PASS |  |
| baseline#1 strangers.scene | the place and the situation are in the first turn's request | FAIL | the A&E waiting room at St Jude's; Nora Vasquez is waiting for her friend I |
| baseline#1 strangers.turns | the two took turns | PASS | Joan Pike > Nora Vasquez > Joan Pike > Nora Vasquez > Joan Pike > Nora Vasquez > Joan Pike > Nora Vasquez > Joan Pike > Nora Vasquez > Joan Pike > Nora Vasquez > Joan Pike |
| baseline#1 storm.scene | the place and the situation are in the first turn's request | FAIL | the Albion Street pharmacy; The radio has just said the storm reache |
| baseline#1 storm.turns | the two took turns | PASS | Ilan Brody > Nora Vasquez > Ilan Brody > Nora Vasquez > Ilan Brody > Nora Vasquez > Ilan Brody > Nora Vasquez > Ilan Brody > Nora Vasquez > Ilan Brody > Nora Vasquez |
| baseline#1 news.scene | the place and the situation are in the first turn's request | FAIL | Ilan's locksmith shop; Ilan has had a letter this morning: his  |
| baseline#1 news.turns | the two took turns | PASS | Nora Vasquez > Ilan Brody > Nora Vasquez > Ilan Brody > Nora Vasquez > Ilan Brody > Nora Vasquez > Ilan Brody > Nora Vasquez > Ilan Brody > Nora Vasquez > Ilan Brody > Nora Vasquez |
| baseline#1 favour.scene | the place and the situation are in the first turn's request | FAIL | the Albion Street pharmacy; The chain has offered to sell Nora the s |
| baseline#1 favour.turns | the two took turns | PASS | Ilan Brody > Nora Vasquez > Ilan Brody > Nora Vasquez > Ilan Brody > Nora Vasquez > Ilan Brody > Nora Vasquez > Ilan Brody > Nora Vasquez > Ilan Brody > Nora Vasquez |
| baseline#1 argument.scene | the place and the situation are in the first turn's request | FAIL | the Albion Street pharmacy; An insurance assessor came in today aski |
| baseline#1 argument.turns | the two took turns | PASS | Ilan Brody > Nora Vasquez > Ilan Brody > Nora Vasquez > Ilan Brody > Nora Vasquez > Ilan Brody > Nora Vasquez > Ilan Brody > Nora Vasquez > Ilan Brody > Nora Vasquez > Ilan Brody |

## Skipped

-  judge baseline#1 strangers: no cached judge output for "EXCHANGE: baseline#1 strangers"
-  judge baseline#1 storm: no cached judge output for "EXCHANGE: baseline#1 storm"
-  judge baseline#1 news: no cached judge output for "EXCHANGE: baseline#1 news"
-  judge baseline#1 favour: no cached judge output for "EXCHANGE: baseline#1 favour"
-  judge baseline#1 argument: no cached judge output for "EXCHANGE: baseline#1 argument"
-  anchor chekhov-lady-with-the-dog: no cached judge output for "SCENE: anchor chekhov-lady-with-the-dog"
-  anchor joyce-the-dead: no cached judge output for "SCENE: anchor joyce-the-dead"
-  anchor austen-persuasion: no cached judge output for "SCENE: anchor austen-persuasion"

## Calls

| Label | Role | Seconds | Prompt tok | Output tok |
|---|---|---|---|---|
| baseline#1 strangers t0 turn | player | 21.0 | 2413 | 700 |
| baseline#1 strangers t1 turn | player | 15.0 | 2608 | 762 |
| baseline#1 strangers t2 turn | player | 11.7 | 2694 | 608 |
| baseline#1 strangers t3 turn | player | 15.0 | 2854 | 786 |
| baseline#1 strangers t4 turn | player | 16.0 | 2896 | 846 |
| baseline#1 strangers t5 turn | player | 17.1 | 3069 | 898 |
| baseline#1 strangers t5 memory | player | 22.8 | 968 | 1239 |
| baseline#1 strangers t6 turn | player | 35.6 | 3078 | 667 |
| baseline#1 strangers t7 turn | player | 33.1 | 3527 | 1719 |
| baseline#1 strangers t8 turn | player | 16.6 | 3545 | 839 |
| baseline#1 strangers t9 turn | player | 24.3 | 3717 | 1318 |
| baseline#1 strangers t10 turn | player | 17.8 | 3757 | 939 |
| baseline#1 strangers t11 turn | player | 37.6 | 3925 | 2032 |
| baseline#1 strangers t11 memory | player | 17.6 | 1186 | 940 |
| baseline#1 strangers t12 turn | player | 31.3 | 3941 | 721 |
| baseline#1 storm t0 turn | player | 16.7 | 2559 | 855 |
| baseline#1 storm t1 turn | player | 14.3 | 2760 | 732 |
| baseline#1 storm t2 turn | player | 29.8 | 2952 | 1629 |
| baseline#1 storm t3 turn | player | 13.7 | 3085 | 712 |
| baseline#1 storm t4 turn | player | 19.9 | 3217 | 1060 |
| baseline#1 storm t5 turn | player | 32.5 | 3387 | 1759 |
| baseline#1 storm t5 memory | player | 18.8 | 1195 | 1004 |
| baseline#1 storm t6 turn | player | 37.9 | 3463 | 1030 |
| baseline#1 storm t7 turn | player | 28.0 | 3923 | 1448 |
| baseline#1 storm t8 turn | player | 10.3 | 4074 | 472 |
| baseline#1 storm t9 turn | player | 23.9 | 4074 | 1331 |
| baseline#1 storm t10 turn | player | 49.2 | 4271 | 2701 |
| baseline#1 storm t11 turn | player | 31.8 | 4418 | 1662 |
| baseline#1 storm t12 turn | player | 29.0 | 4535 | 1575 |
| baseline#1 storm t12 memory | player | 22.8 | 1563 | 1222 |
| baseline#1 news t0 turn | player | 92.8 | 2571 | 3878 |
| baseline#1 news t1 turn | player | 28.1 | 2709 | 1501 |
| baseline#1 news t2 turn | player | 18.1 | 2923 | 964 |
| baseline#1 news t3 turn | player | 18.1 | 3014 | 963 |
| baseline#1 news t4 turn | player | 17.1 | 3176 | 903 |
| baseline#1 news t5 turn | player | 24.2 | 3312 | 1294 |
| baseline#1 news t5 memory | player | 16.9 | 1140 | 898 |
| baseline#1 news t6 turn | player | 40.5 | 3418 | 1285 |
| baseline#1 news t7 turn | player | 21.8 | 3799 | 1110 |
| baseline#1 news t8 turn | player | 21.5 | 3983 | 1109 |
| baseline#1 news t9 turn | player | 20.8 | 4106 | 1110 |
| baseline#1 news t10 turn | player | 31.3 | 4252 | 1695 |
| baseline#1 news t11 turn | player | 21.3 | 4347 | 1132 |
| baseline#1 news t11 memory | player | 21.7 | 1429 | 1166 |
| baseline#1 news t12 turn | player | 57.0 | 4511 | 1928 |
| baseline#1 favour t0 turn | player | 84.7 | 2561 | 4681 |
| baseline#1 favour t1 turn | player | 2.4 | 2744 | 51 |
| baseline#1 favour t2 turn | player | 17.4 | 2744 | 969 |
| baseline#1 favour t3 turn | player | 19.9 | 2903 | 1060 |
| baseline#1 favour t4 turn | player | 31.9 | 3010 | 1733 |
| baseline#1 favour t5 turn | player | 19.5 | 3131 | 1040 |
| baseline#1 favour t6 turn | player | 17.4 | 3225 | 912 |
| baseline#1 favour t6 memory | player | 16.6 | 1061 | 877 |
| baseline#1 favour t7 turn | player | 33.6 | 3396 | 916 |
| baseline#1 favour t8 turn | player | 18.5 | 3717 | 914 |
| baseline#1 favour t9 turn | player | 21.8 | 3828 | 1122 |
| baseline#1 favour t10 turn | player | 24.8 | 3996 | 1340 |
| baseline#1 favour t11 turn | player | 33.0 | 4082 | 1794 |
| baseline#1 favour t12 turn | player | 29.7 | 4246 | 1608 |
| baseline#1 favour t12 memory | player | 19.5 | 1221 | 1046 |
| baseline#1 argument t0 turn | player | 37.9 | 2554 | 983 |
| baseline#1 argument t1 turn | player | 14.4 | 2783 | 735 |
| baseline#1 argument t2 turn | player | 22.0 | 2960 | 1180 |
| baseline#1 argument t3 turn | player | 18.2 | 3106 | 964 |
| baseline#1 argument t4 turn | player | 21.0 | 3207 | 1125 |
| baseline#1 argument t5 turn | player | 20.5 | 3367 | 1087 |
| baseline#1 argument t5 memory | player | 19.4 | 1177 | 1040 |
| baseline#1 argument t6 turn | player | 36.3 | 3464 | 906 |
| baseline#1 argument t7 turn | player | 13.0 | 3889 | 603 |
| baseline#1 argument t8 turn | player | 33.8 | 4036 | 1796 |
| baseline#1 argument t9 turn | player | 15.4 | 4156 | 811 |
| baseline#1 argument t10 turn | player | 28.6 | 4289 | 1547 |
| baseline#1 argument t11 turn | player | 21.9 | 4429 | 1164 |
| baseline#1 argument t11 memory | player | 25.3 | 1438 | 1348 |
| baseline#1 argument t12 turn | player | 50.0 | 4511 | 1338 |
