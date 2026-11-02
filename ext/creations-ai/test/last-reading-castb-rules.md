# Creations: reading bench

- Mode: LIVE, pass: play
- Player: gemma4:31b, judge: qwen3.8:27b, num_ctx 65536, samples 1
- Commit: 3d1eb483
- Calls: 75 live, 0 from the cache
- Checks: 11 pass, 1 fail, 8 skipped

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
| baseline | 72 | 2.9 | 50% | 3.3 | 0% | 0% | 34% | 0.0 | 42% | 0 | 0 |

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
| baseline#1 terse-florid.scene | the situation is in the first turn's request | PASS | A crate of books for Beatrix came in on  |
| baseline#1 terse-florid.turns | the two took turns | PASS | Beatrix Oyelaran > Dag Ruud > Beatrix Oyelaran > Dag Ruud > Beatrix Oyelaran > Dag Ruud > Beatrix Oyelaran > Dag Ruud > Beatrix Oyelaran > Dag Ruud > Beatrix Oyelaran > Dag Ruud > Beatrix Oyelaran |
| baseline#1 child-formal.scene | the situation is in the first turn's request | PASS | Pip has brought in a brass plate she too |
| baseline#1 child-formal.turns | the two took turns | PASS | Henrik Saalbach > Pip Marlow > Henrik Saalbach > Pip Marlow > Henrik Saalbach > Pip Marlow > Henrik Saalbach > Pip Marlow > Henrik Saalbach > Pip Marlow > Henrik Saalbach > Pip Marlow > Henrik Saalbach |
| baseline#1 second-language.scene | the situation is in the first turn's request | PASS | Lucía has come down before her cafe shif |
| baseline#1 second-language.turns | the two took turns | PASS | Dag Ruud > Lucía Ferreira > Dag Ruud > Lucía Ferreira > Dag Ruud > Lucía Ferreira > Dag Ruud > Lucía Ferreira > Dag Ruud > Lucía Ferreira > Dag Ruud > Lucía Ferreira > Dag Ruud |
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
| baseline#1 terse-florid t0 turn | player | 25.8 | 3043 | 1372 |
| baseline#1 terse-florid t1 turn | player | 40.5 | 3230 | 2192 |
| baseline#1 terse-florid t2 turn | player | 59.5 | 3427 | 3286 |
| baseline#1 terse-florid t3 turn | player | 41.0 | 3491 | 2245 |
| baseline#1 terse-florid t4 turn | player | 68.4 | 3650 | 3769 |
| baseline#1 terse-florid t5 turn | player | 57.9 | 3767 | 3172 |
| baseline#1 terse-florid t5 memory | player | 16.5 | 1077 | 874 |
| baseline#1 terse-florid t6 turn | player | 74.1 | 3902 | 3185 |
| baseline#1 terse-florid t7 turn | player | 18.1 | 4186 | 898 |
| baseline#1 terse-florid t8 turn | player | 19.1 | 4363 | 963 |
| baseline#1 terse-florid t9 turn | player | 45.1 | 4395 | 2412 |
| baseline#1 terse-florid t10 turn | player | 64.6 | 4561 | 3499 |
| baseline#1 terse-florid t11 turn | player | 34.3 | 4574 | 1805 |
| baseline#1 terse-florid t11 memory | player | 19.3 | 1196 | 1048 |
| baseline#1 terse-florid t12 turn | player | 70.8 | 4728 | 2769 |
| baseline#1 child-formal t0 turn | player | 52.6 | 2985 | 2881 |
| baseline#1 child-formal t1 turn | player | 31.7 | 3118 | 1698 |
| baseline#1 child-formal t2 turn | player | 18.0 | 3276 | 961 |
| baseline#1 child-formal t3 turn | player | 25.1 | 3398 | 1351 |
| baseline#1 child-formal t4 turn | player | 28.4 | 3495 | 1543 |
| baseline#1 child-formal t5 turn | player | 26.5 | 3682 | 1422 |
| baseline#1 child-formal t5 memory | player | 19.2 | 1023 | 1037 |
| baseline#1 child-formal t6 turn | player | 46.7 | 3744 | 1500 |
| baseline#1 child-formal t7 turn | player | 15.7 | 4121 | 756 |
| baseline#1 child-formal t8 turn | player | 21.6 | 4205 | 1109 |
| baseline#1 child-formal t9 turn | player | 27.2 | 4321 | 1471 |
| baseline#1 child-formal t10 turn | player | 35.4 | 4413 | 1867 |
| baseline#1 child-formal t11 turn | player | 33.3 | 4549 | 1812 |
| baseline#1 child-formal t11 memory | player | 14.7 | 1275 | 779 |
| baseline#1 child-formal t12 turn | player | 80.1 | 4640 | 3539 |
| baseline#1 second-language t0 turn | player | 9.6 | 2977 | 458 |
| baseline#1 second-language t1 turn | player | 18.2 | 3112 | 937 |
| baseline#1 second-language t2 turn | player | 25.1 | 3194 | 1364 |
| baseline#1 second-language t3 turn | player | 45.0 | 3265 | 2473 |
| baseline#1 second-language t4 turn | player | 41.1 | 3308 | 2249 |
| baseline#1 second-language t5 turn | player | 13.6 | 3385 | 698 |
| baseline#1 second-language t5 memory | player | 16.5 | 669 | 899 |
| baseline#1 second-language t6 turn | player | 32.8 | 3360 | 874 |
| baseline#1 second-language t7 turn | player | 32.9 | 3691 | 1730 |
| baseline#1 second-language t8 turn | player | 17.8 | 3670 | 897 |
| baseline#1 second-language t9 turn | player | 13.0 | 3756 | 629 |
| baseline#1 second-language t10 turn | player | 27.3 | 3752 | 1483 |
| baseline#1 second-language t11 turn | player | 12.9 | 3842 | 662 |
| baseline#1 second-language t11 memory | player | 11.0 | 686 | 586 |
| baseline#1 second-language t12 turn | player | 29.0 | 3831 | 974 |
| baseline#1 sisters t0 turn | player | 18.4 | 2909 | 946 |
| baseline#1 sisters t1 turn | player | 40.6 | 3065 | 2205 |
| baseline#1 sisters t2 turn | player | 46.3 | 3203 | 2548 |
| baseline#1 sisters t3 turn | player | 17.5 | 3299 | 922 |
| baseline#1 sisters t4 turn | player | 27.4 | 3408 | 1483 |
| baseline#1 sisters t5 turn | player | 20.7 | 3507 | 1098 |
| baseline#1 sisters t5 memory | player | 20.8 | 951 | 1128 |
| baseline#1 sisters t6 turn | player | 36.5 | 3564 | 830 |
| baseline#1 sisters t7 turn | player | 17.8 | 3960 | 869 |
| baseline#1 sisters t8 turn | player | 15.6 | 4099 | 763 |
| baseline#1 sisters t9 turn | player | 14.0 | 4195 | 732 |
| baseline#1 sisters t10 turn | player | 25.5 | 4299 | 1314 |
| baseline#1 sisters t11 turn | player | 35.9 | 4379 | 1958 |
| baseline#1 sisters t11 memory | player | 18.6 | 1166 | 992 |
| baseline#1 sisters t12 turn | player | 33.9 | 4452 | 757 |
| baseline#1 strangers-b t0 turn | player | 15.7 | 2987 | 803 |
| baseline#1 strangers-b t1 turn | player | 33.8 | 3174 | 1823 |
| baseline#1 strangers-b t2 turn | player | 11.4 | 3349 | 582 |
| baseline#1 strangers-b t3 turn | player | 41.7 | 3464 | 2281 |
| baseline#1 strangers-b t4 turn | player | 16.3 | 3596 | 855 |
| baseline#1 strangers-b t5 turn | player | 29.9 | 3734 | 1604 |
| baseline#1 strangers-b t5 memory | player | 17.9 | 1125 | 966 |
| baseline#1 strangers-b t6 turn | player | 36.4 | 3840 | 994 |
| baseline#1 strangers-b t7 turn | player | 20.4 | 4263 | 1016 |
| baseline#1 strangers-b t8 turn | player | 12.5 | 4376 | 582 |
| baseline#1 strangers-b t9 turn | player | 25.5 | 4507 | 1320 |
| baseline#1 strangers-b t10 turn | player | 32.4 | 4673 | 1694 |
| baseline#1 strangers-b t11 turn | player | 23.4 | 4774 | 1190 |
| baseline#1 strangers-b t11 memory | player | 20.8 | 1360 | 1136 |
| baseline#1 strangers-b t12 turn | player | 37.6 | 4823 | 828 |
