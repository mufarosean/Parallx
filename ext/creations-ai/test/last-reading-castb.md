# Creations: reading bench

- Mode: LIVE, pass: play
- Player: gemma4:31b, judge: qwen3.8:27b, num_ctx 65536, samples 1
- Commit: 3d1eb483
- Calls: 75 live, 0 from the cache
- Checks: 11 pass, 2 fail, 8 skipped

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
| baseline | 73 | 3.6 | 48% | 3.4 | 0% | 0% | 27% | 0.0 | 61% | 0 | 0 |

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
| Repetition | baseline.motif | motif echoes across all scenes | 0 | record only |
| Repetition | baseline.novelty | turns bringing in something new, by thirds (mean) | 1.00 / 1.00 / 1.00 | record only |

## Checks

### Results

| Id | Check | Result | Detail |
|---|---|---|---|
| baseline.bar | meets every provisional bar | FAIL | takesUp, answers, deadEnds, moves, tells, wentSomewhere, distinct, positive, negative, styleHit |
| baseline.empty | every turn kept a reply | FAIL | 1 turns answered nothing |

### Wiring

| Id | Check | Result | Detail |
|---|---|---|---|
| baseline.rules | its rules are in the prompt | PASS |  |
| baseline#1 terse-florid.scene | the situation is in the first turn's request | PASS | A crate of books for Beatrix came in on  |
| baseline#1 terse-florid.turns | the two took turns | PASS | Beatrix Oyelaran > Dag Ruud > Beatrix Oyelaran > Dag Ruud > Beatrix Oyelaran > Dag Ruud > Beatrix Oyelaran > Dag Ruud > Beatrix Oyelaran > Dag Ruud > Beatrix Oyelaran > Dag Ruud > Beatrix Oyelaran |
| baseline#1 child-formal.scene | the situation is in the first turn's request | PASS | Pip has brought in a brass plate she too |
| baseline#1 child-formal.turns | the two took turns | PASS | Henrik Saalbach > Pip Marlow > Henrik Saalbach > Pip Marlow > Henrik Saalbach > Pip Marlow > Henrik Saalbach > Pip Marlow > Henrik Saalbach > Pip Marlow > Henrik Saalbach > Pip Marlow > Henrik Saalbach |
| baseline#1 second-language.scene | the situation is in the first turn's request | PASS | Lucía has come down before her cafe shif |
| baseline#1 second-language.turns | the two took turns | PASS | Dag Ruud > Lucía Ferreira > Dag Ruud > Lucía Ferreira > Dag Ruud > Lucía Ferreira > Dag Ruud > Lucía Ferreira > Dag Ruud > Lucía Ferreira > Dag Ruud > Lucía Ferreira |
| baseline#1 sisters.scene | the situation is in the first turn's request | PASS | The developer's offer for the cafe is on |
| baseline#1 sisters.turns | the two took turns | PASS | Jen Hadley > Mo Hadley > Jen Hadley > Mo Hadley > Jen Hadley > Mo Hadley > Jen Hadley > Mo Hadley > Jen Hadley > Mo Hadley > Jen Hadley > Mo Hadley > Jen Hadley |
| baseline#1 strangers-b.scene | the situation is in the first turn's request | PASS | Beatrix has come in for coffee with a bo |
| baseline#1 strangers-b.turns | the two took turns | PASS | Lucía Ferreira > Beatrix Oyelaran > Lucía Ferreira > Beatrix Oyelaran > Lucía Ferreira > Beatrix Oyelaran > Lucía Ferreira > Beatrix Oyelaran > Lucía Ferreira > Beatrix Oyelaran > Lucía Ferreira > Beatrix Oyelaran > Lucía Ferreira |

## Skipped

-  judge baseline#1 terse-florid: no cached judge output for "EXCHANGE: baseline#1 terse-florid"
-  judge baseline#1 child-formal: no cached judge output for "EXCHANGE: baseline#1 child-formal"
-  judge baseline#1 second-language: no cached judge output for "EXCHANGE: baseline#1 second-language"
-  judge baseline#1 sisters: no cached judge output for "EXCHANGE: baseline#1 sisters"
-  judge baseline#1 strangers-b: no cached judge output for "EXCHANGE: baseline#1 strangers-b"
-  anchor chekhov-lady-with-the-dog: no cached judge output for "SCENE: anchor chekhov-lady-with-the-dog"
-  anchor joyce-the-dead: no cached judge output for "SCENE: anchor joyce-the-dead"
-  anchor austen-persuasion: no cached judge output for "SCENE: anchor austen-persuasion"

## Calls

| Label | Role | Seconds | Prompt tok | Output tok |
|---|---|---|---|---|
| baseline#1 terse-florid t0 turn | player | 25.6 | 3140 | 863 |
| baseline#1 terse-florid t1 turn | player | 22.4 | 3250 | 1143 |
| baseline#1 terse-florid t2 turn | player | 38.7 | 3467 | 2018 |
| baseline#1 terse-florid t3 turn | player | 16.1 | 3521 | 825 |
| baseline#1 terse-florid t4 turn | player | 33.2 | 3701 | 1717 |
| baseline#1 terse-florid t5 turn | player | 16.9 | 3758 | 865 |
| baseline#1 terse-florid t5 memory | player | 19.2 | 1015 | 977 |
| baseline#1 terse-florid t6 turn | player | 44.0 | 3873 | 1233 |
| baseline#1 terse-florid t7 turn | player | 15.8 | 4159 | 750 |
| baseline#1 terse-florid t8 turn | player | 19.2 | 4307 | 959 |
| baseline#1 terse-florid t9 turn | player | 36.5 | 4331 | 1913 |
| baseline#1 terse-florid t10 turn | player | 18.3 | 4527 | 903 |
| baseline#1 terse-florid t11 turn | player | 52.4 | 4553 | 2808 |
| baseline#1 terse-florid t11 memory | player | 18.3 | 1166 | 994 |
| baseline#1 terse-florid t12 turn | player | 45.0 | 4741 | 1383 |
| baseline#1 child-formal t0 turn | player | 21.1 | 3033 | 1111 |
| baseline#1 child-formal t1 turn | player | 15.4 | 3176 | 783 |
| baseline#1 child-formal t2 turn | player | 31.7 | 3374 | 1733 |
| baseline#1 child-formal t3 turn | player | 15.2 | 3472 | 796 |
| baseline#1 child-formal t4 turn | player | 19.7 | 3582 | 1046 |
| baseline#1 child-formal t5 turn | player | 32.8 | 3706 | 1777 |
| baseline#1 child-formal t5 memory | player | 20.8 | 1020 | 1130 |
| baseline#1 child-formal t6 turn | player | 35.6 | 3775 | 783 |
| baseline#1 child-formal t7 turn | player | 19.6 | 4200 | 984 |
| baseline#1 child-formal t8 turn | player | 21.9 | 4310 | 1113 |
| baseline#1 child-formal t9 turn | player | 18.5 | 4423 | 921 |
| baseline#1 child-formal t10 turn | player | 26.9 | 4553 | 1392 |
| baseline#1 child-formal t11 turn | player | 14.1 | 4633 | 673 |
| baseline#1 child-formal t11 memory | player | 26.2 | 1264 | 1439 |
| baseline#1 child-formal t12 turn | player | 48.2 | 4762 | 1121 |
| baseline#1 second-language t0 turn | player | 12.4 | 3068 | 618 |
| baseline#1 second-language t1 turn | player | 26.9 | 3243 | 1427 |
| baseline#1 second-language t2 turn | player | 50.1 | 3315 | 2764 |
| baseline#1 second-language t3 turn | player | 35.1 | 3315 | 1958 |
| baseline#1 second-language t4 turn | player | 19.4 | 3384 | 1027 |
| baseline#1 second-language t5 turn | player | 17.1 | 3469 | 895 |
| baseline#1 second-language t6 turn | player | 20.1 | 3500 | 1068 |
| baseline#1 second-language t6 memory | player | 18.4 | 776 | 1007 |
| baseline#1 second-language t7 turn | player | 36.9 | 3611 | 996 |
| baseline#1 second-language t8 turn | player | 50.7 | 3913 | 2735 |
| baseline#1 second-language t9 turn | player | 27.9 | 3942 | 1462 |
| baseline#1 second-language t10 turn | player | 24.0 | 4033 | 1242 |
| baseline#1 second-language t11 turn | player | 31.2 | 4061 | 1650 |
| baseline#1 second-language t12 turn | player | 15.7 | 4153 | 769 |
| baseline#1 second-language t12 memory | player | 12.5 | 846 | 673 |
| baseline#1 sisters t0 turn | player | 27.5 | 2980 | 787 |
| baseline#1 sisters t1 turn | player | 40.8 | 3139 | 2211 |
| baseline#1 sisters t2 turn | player | 11.2 | 3332 | 573 |
| baseline#1 sisters t3 turn | player | 48.6 | 3410 | 2669 |
| baseline#1 sisters t4 turn | player | 14.7 | 3538 | 765 |
| baseline#1 sisters t5 turn | player | 21.1 | 3642 | 1118 |
| baseline#1 sisters t5 memory | player | 15.0 | 1057 | 795 |
| baseline#1 sisters t6 turn | player | 35.5 | 3722 | 1106 |
| baseline#1 sisters t7 turn | player | 19.6 | 4100 | 978 |
| baseline#1 sisters t8 turn | player | 18.6 | 4259 | 935 |
| baseline#1 sisters t9 turn | player | 24.3 | 4383 | 1311 |
| baseline#1 sisters t10 turn | player | 35.5 | 4539 | 1870 |
| baseline#1 sisters t11 turn | player | 16.3 | 4631 | 852 |
| baseline#1 sisters t11 memory | player | 23.3 | 1371 | 1265 |
| baseline#1 sisters t12 turn | player | 75.1 | 4758 | 2786 |
| baseline#1 strangers-b t0 turn | player | 61.0 | 3090 | 3343 |
| baseline#1 strangers-b t1 turn | player | 27.9 | 3261 | 1477 |
| baseline#1 strangers-b t2 turn | player | 11.6 | 3399 | 598 |
| baseline#1 strangers-b t3 turn | player | 12.6 | 3536 | 646 |
| baseline#1 strangers-b t4 turn | player | 15.9 | 3640 | 819 |
| baseline#1 strangers-b t5 turn | player | 14.9 | 3764 | 773 |
| baseline#1 strangers-b t5 memory | player | 21.4 | 1032 | 1164 |
| baseline#1 strangers-b t6 turn | player | 79.6 | 3860 | 3211 |
| baseline#1 strangers-b t7 turn | player | 17.7 | 4291 | 871 |
| baseline#1 strangers-b t8 turn | player | 29.6 | 4403 | 1556 |
| baseline#1 strangers-b t9 turn | player | 49.4 | 4530 | 2652 |
| baseline#1 strangers-b t10 turn | player | 17.5 | 4604 | 864 |
| baseline#1 strangers-b t11 turn | player | 26.2 | 4699 | 1335 |
| baseline#1 strangers-b t11 memory | player | 22.8 | 1249 | 1251 |
| baseline#1 strangers-b t12 turn | player | 37.9 | 4771 | 729 |
