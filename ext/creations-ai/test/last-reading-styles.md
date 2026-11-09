# Creations: reading bench

- Mode: LIVE, pass: play
- Player: gemma4:31b, judge: session, num_ctx 65536, samples 1
- Commit: d0740b05
- Calls: 120 live, 0 from the cache
- Checks: 31 pass, 4 fail, 24 skipped

Per variant, over its scenes and samples. Percentages are of character replies; in brackets, the change from baseline. The bar is provisional: calibrate it against your own marks before trusting it (--calibration-sheet).

| Variant | Replies | Takes up % | Answers % | Gives % | Dead ends /100 | Thinks % | Moves % | Tells /100 | Went somewhere (1-5) | Distinct (1-5) | Rubric + (0-10) | Rubric - (0-10) | Style told % | vs baseline |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | 0 | - | - | - | - | - | - | - | - | - | - | - | - | - |
| natural-rp | 0 | - | - | - | - | - | - | - | - | - | - | - | - | - |
| screenplay | 0 | - | - | - | - | - | - | - | - | - | - | - | - | - |
| casual-rp | 0 | - | - | - | - | - | - | - | - | - | - | - | - | - |

### Rubric by criterion (0-10; for a negative criterion lower is better)

| Variant | Believable dialogue | Nuanced characters | Emotionally engaging | Emotionally complex | Coherent | Sentences flow naturally | Overall reader engagement | Tell-don't-show | Purple prose | Forced poetry or metaphor | Meandering | Amateurish |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | - | - | - | - | - | - | - | - | - | - | - | - |
| natural-rp | - | - | - | - | - | - | - | - | - | - | - | - |
| screenplay | - | - | - | - | - | - | - | - | - | - | - | - |
| casual-rp | - | - | - | - | - | - | - | - | - | - | - | - |

(reading-anchors.md has no filled anchors yet: the brief says how to add them)

### Style identification (the judge was shown one reply and the list of styles in this run)

| Variant | Shown as | Told apart % | What told the judge |
|---|---|---|---|
| baseline | Immersive RP | - |  |
| natural-rp | Natural RP (Benchmark Winner) | - |  |
| screenplay | Screenplay | - |  |
| casual-rp | Casual RP | - |  |

### The page, mechanically

| Variant | Words/reply | Paragraphs/reply | Speech share | Questions /10 lines | Replies showing a thought | First person | Past tense | "said" /reply | Ends with a question | Stock tells | Dashes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | 82 | 2.3 | 55% | 3.9 | 0% | 0% | 13% | 0.0 | 59% | 0 | 0 |
| natural-rp | 71 | 1.6 | 69% | 4.4 | 0% | 0% | 21% | 0.0 | 96% | 0 | 0 |
| screenplay | 50 | 3.5 | 100% | 5.2 | 4% | 23% | 34% | 0.0 | 41% | 0 | 0 |
| casual-rp | 39 | 2.6 | 74% | 2.8 | 0% | 32% | 33% | 0.0 | 33% | 0 | 0 |

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
| Results | natural-rp.takesUp | takesUp | NaN | >= 90 |
| Results | natural-rp.answers | answers | NaN | >= 80 |
| Results | natural-rp.deadEnds | deadEnds | NaN | <= 10 per 100 |
| Results | natural-rp.moves | moves | NaN | >= 60 |
| Results | natural-rp.tells | tells | NaN | <= 10 per 100 |
| Results | natural-rp.wentSomewhere | wentSomewhere | NaN | >= 4 |
| Results | natural-rp.distinct | distinct | NaN | >= 4 |
| Results | natural-rp.positive | positive | NaN | >= 7 |
| Results | natural-rp.negative | negative | NaN | <= 3 |
| Results | natural-rp.styleHit | styleHit | NaN | >= 80 |
| Results | screenplay.takesUp | takesUp | NaN | >= 90 |
| Results | screenplay.answers | answers | NaN | >= 80 |
| Results | screenplay.deadEnds | deadEnds | NaN | <= 10 per 100 |
| Results | screenplay.moves | moves | NaN | >= 60 |
| Results | screenplay.tells | tells | NaN | <= 10 per 100 |
| Results | screenplay.wentSomewhere | wentSomewhere | NaN | >= 4 |
| Results | screenplay.distinct | distinct | NaN | >= 4 |
| Results | screenplay.positive | positive | NaN | >= 7 |
| Results | screenplay.negative | negative | NaN | <= 3 |
| Results | screenplay.styleHit | styleHit | NaN | >= 80 |
| Results | casual-rp.takesUp | takesUp | NaN | >= 90 |
| Results | casual-rp.answers | answers | NaN | >= 80 |
| Results | casual-rp.deadEnds | deadEnds | NaN | <= 10 per 100 |
| Results | casual-rp.moves | moves | NaN | >= 60 |
| Results | casual-rp.tells | tells | NaN | <= 10 per 100 |
| Results | casual-rp.wentSomewhere | wentSomewhere | NaN | >= 4 |
| Results | casual-rp.distinct | distinct | NaN | >= 4 |
| Results | casual-rp.positive | positive | NaN | >= 7 |
| Results | casual-rp.negative | negative | NaN | <= 3 |
| Results | casual-rp.styleHit | styleHit | NaN | >= 80 |
| Repetition | baseline.motif | motif echoes across all scenes | 0 | record only |
| Repetition | baseline.novelty | turns bringing in something new, by thirds (mean) | 1.00 / 1.00 / 1.00 | record only |
| Repetition | natural-rp.motif | motif echoes across all scenes | 0 | record only |
| Repetition | natural-rp.novelty | turns bringing in something new, by thirds (mean) | 1.00 / 1.00 / 1.00 | record only |
| Repetition | screenplay.motif | motif echoes across all scenes | 5 | record only |
| Repetition | screenplay.novelty | turns bringing in something new, by thirds (mean) | 1.00 / 1.00 / 0.89 | record only |
| Repetition | casual-rp.motif | motif echoes across all scenes | 0 | record only |
| Repetition | casual-rp.novelty | turns bringing in something new, by thirds (mean) | 0.89 / 1.00 / 1.00 | record only |

## Checks

### Results

| Id | Check | Result | Detail |
|---|---|---|---|
| baseline.bar | meets every provisional bar | FAIL | takesUp, answers, deadEnds, moves, tells, wentSomewhere, distinct, positive, negative, styleHit |
| natural-rp.bar | meets every provisional bar | FAIL | takesUp, answers, deadEnds, moves, tells, wentSomewhere, distinct, positive, negative, styleHit |
| screenplay.bar | meets every provisional bar | FAIL | takesUp, answers, deadEnds, moves, tells, wentSomewhere, distinct, positive, negative, styleHit |
| casual-rp.bar | meets every provisional bar | FAIL | takesUp, answers, deadEnds, moves, tells, wentSomewhere, distinct, positive, negative, styleHit |

### Wiring

| Id | Check | Result | Detail |
|---|---|---|---|
| baseline.rules | its rules are in the prompt | PASS |  |
| natural-rp.preset | the natural-rp preset is in the prompt | PASS |  |
| natural-rp.rules | its rules are in the prompt | PASS |  |
| screenplay.preset | the screenplay preset is in the prompt | PASS |  |
| screenplay.rules | its rules are in the prompt | PASS |  |
| casual-rp.preset | the casual-rp preset is in the prompt | PASS |  |
| casual-rp.rules | its rules are in the prompt | PASS |  |
| baseline#1 terse-florid.scene | the place and the situation are in the first turn's request | PASS | the harbour office at Kelder Quay; A crate of books for Beatrix came in on  |
| baseline#1 terse-florid.turns | the two took turns | PASS | Beatrix Oyelaran > Dag Ruud > Beatrix Oyelaran > Dag Ruud > Beatrix Oyelaran > Dag Ruud > Beatrix Oyelaran > Dag Ruud > Beatrix Oyelaran |
| baseline#1 sisters.scene | the place and the situation are in the first turn's request | PASS | the Quay Cafe, the back room; The developer's offer for the cafe is on |
| baseline#1 sisters.turns | the two took turns | PASS | Jen Hadley > Mo Hadley > Jen Hadley > Mo Hadley > Jen Hadley > Mo Hadley > Jen Hadley > Mo Hadley > Jen Hadley |
| baseline#1 strangers-b.scene | the place and the situation are in the first turn's request | PASS | the Quay Cafe; Beatrix has come in for coffee with a bo |
| baseline#1 strangers-b.turns | the two took turns | PASS | Lucía Ferreira > Beatrix Oyelaran > Lucía Ferreira > Beatrix Oyelaran > Lucía Ferreira > Beatrix Oyelaran > Lucía Ferreira > Beatrix Oyelaran > Lucía Ferreira |
| natural-rp#1 terse-florid.scene | the place and the situation are in the first turn's request | PASS | the harbour office at Kelder Quay; A crate of books for Beatrix came in on  |
| natural-rp#1 terse-florid.turns | the two took turns | PASS | Beatrix Oyelaran > Dag Ruud > Beatrix Oyelaran > Dag Ruud > Beatrix Oyelaran > Dag Ruud > Beatrix Oyelaran > Dag Ruud > Beatrix Oyelaran |
| natural-rp#1 sisters.scene | the place and the situation are in the first turn's request | PASS | the Quay Cafe, the back room; The developer's offer for the cafe is on |
| natural-rp#1 sisters.turns | the two took turns | PASS | Jen Hadley > Mo Hadley > Jen Hadley > Mo Hadley > Jen Hadley > Mo Hadley > Jen Hadley > Mo Hadley > Jen Hadley |
| natural-rp#1 strangers-b.scene | the place and the situation are in the first turn's request | PASS | the Quay Cafe; Beatrix has come in for coffee with a bo |
| natural-rp#1 strangers-b.turns | the two took turns | PASS | Lucía Ferreira > Beatrix Oyelaran > Lucía Ferreira > Beatrix Oyelaran > Lucía Ferreira > Beatrix Oyelaran > Lucía Ferreira > Beatrix Oyelaran > Lucía Ferreira |
| screenplay#1 terse-florid.scene | the place and the situation are in the first turn's request | PASS | the harbour office at Kelder Quay; A crate of books for Beatrix came in on  |
| screenplay#1 terse-florid.turns | the two took turns | PASS | Beatrix Oyelaran > Dag Ruud > Beatrix Oyelaran > Dag Ruud > Beatrix Oyelaran > Dag Ruud > Beatrix Oyelaran > Dag Ruud > Beatrix Oyelaran |
| screenplay#1 sisters.scene | the place and the situation are in the first turn's request | PASS | the Quay Cafe, the back room; The developer's offer for the cafe is on |
| screenplay#1 sisters.turns | the two took turns | PASS | Jen Hadley > Mo Hadley > Jen Hadley > Mo Hadley > Jen Hadley > Mo Hadley > Jen Hadley > Mo Hadley > Jen Hadley |
| screenplay#1 strangers-b.scene | the place and the situation are in the first turn's request | PASS | the Quay Cafe; Beatrix has come in for coffee with a bo |
| screenplay#1 strangers-b.turns | the two took turns | PASS | Lucía Ferreira > Beatrix Oyelaran > Lucía Ferreira > Beatrix Oyelaran > Lucía Ferreira > Beatrix Oyelaran > Lucía Ferreira > Beatrix Oyelaran > Lucía Ferreira |
| casual-rp#1 terse-florid.scene | the place and the situation are in the first turn's request | PASS | the harbour office at Kelder Quay; A crate of books for Beatrix came in on  |
| casual-rp#1 terse-florid.turns | the two took turns | PASS | Beatrix Oyelaran > Dag Ruud > Beatrix Oyelaran > Dag Ruud > Beatrix Oyelaran > Dag Ruud > Beatrix Oyelaran > Dag Ruud > Beatrix Oyelaran |
| casual-rp#1 sisters.scene | the place and the situation are in the first turn's request | PASS | the Quay Cafe, the back room; The developer's offer for the cafe is on |
| casual-rp#1 sisters.turns | the two took turns | PASS | Jen Hadley > Mo Hadley > Jen Hadley > Mo Hadley > Jen Hadley > Mo Hadley > Jen Hadley > Mo Hadley > Jen Hadley |
| casual-rp#1 strangers-b.scene | the place and the situation are in the first turn's request | PASS | the Quay Cafe; Beatrix has come in for coffee with a bo |
| casual-rp#1 strangers-b.turns | the two took turns | PASS | Lucía Ferreira > Beatrix Oyelaran > Lucía Ferreira > Beatrix Oyelaran > Lucía Ferreira > Beatrix Oyelaran > Lucía Ferreira > Beatrix Oyelaran > Lucía Ferreira |

## Skipped

-  judge baseline#1 terse-florid: no cached judge output for "EXCHANGE: baseline#1 terse-florid"
-  judge baseline#1 sisters: no cached judge output for "EXCHANGE: baseline#1 sisters"
-  judge baseline#1 strangers-b: no cached judge output for "EXCHANGE: baseline#1 strangers-b"
-  judge natural-rp#1 terse-florid: no cached judge output for "EXCHANGE: natural-rp#1 terse-florid"
-  judge natural-rp#1 sisters: no cached judge output for "EXCHANGE: natural-rp#1 sisters"
-  judge natural-rp#1 strangers-b: no cached judge output for "EXCHANGE: natural-rp#1 strangers-b"
-  judge screenplay#1 terse-florid: no cached judge output for "EXCHANGE: screenplay#1 terse-florid"
-  judge screenplay#1 sisters: no cached judge output for "EXCHANGE: screenplay#1 sisters"
-  judge screenplay#1 strangers-b: no cached judge output for "EXCHANGE: screenplay#1 strangers-b"
-  judge casual-rp#1 terse-florid: no cached judge output for "EXCHANGE: casual-rp#1 terse-florid"
-  judge casual-rp#1 sisters: no cached judge output for "EXCHANGE: casual-rp#1 sisters"
-  judge casual-rp#1 strangers-b: no cached judge output for "EXCHANGE: casual-rp#1 strangers-b"
-  pair natural-rp#1 terse-florid: no cached judge output for "PAIR: natural-rp#1 terse-florid AB"
-  pair natural-rp#1 sisters: no cached judge output for "PAIR: natural-rp#1 sisters AB"
-  pair natural-rp#1 strangers-b: no cached judge output for "PAIR: natural-rp#1 strangers-b AB"
-  pair screenplay#1 terse-florid: no cached judge output for "PAIR: screenplay#1 terse-florid AB"
-  pair screenplay#1 sisters: no cached judge output for "PAIR: screenplay#1 sisters AB"
-  pair screenplay#1 strangers-b: no cached judge output for "PAIR: screenplay#1 strangers-b AB"
-  pair casual-rp#1 terse-florid: no cached judge output for "PAIR: casual-rp#1 terse-florid AB"
-  pair casual-rp#1 sisters: no cached judge output for "PAIR: casual-rp#1 sisters AB"
-  pair casual-rp#1 strangers-b: no cached judge output for "PAIR: casual-rp#1 strangers-b AB"
-  anchor chekhov-lady-with-the-dog: no cached judge output for "SCENE: anchor chekhov-lady-with-the-dog"
-  anchor joyce-the-dead: no cached judge output for "SCENE: anchor joyce-the-dead"
-  anchor austen-persuasion: no cached judge output for "SCENE: anchor austen-persuasion"

## Calls

| Label | Role | Seconds | Prompt tok | Output tok |
|---|---|---|---|---|
| baseline#1 terse-florid t0 turn | player | 26.9 | 3288 | 1392 |
| baseline#1 terse-florid t1 turn | player | 24.0 | 3415 | 1247 |
| baseline#1 terse-florid t2 turn | player | 18.4 | 3639 | 912 |
| baseline#1 terse-florid t3 turn | player | 19.3 | 3666 | 1018 |
| baseline#1 terse-florid t4 turn | player | 14.7 | 3833 | 699 |
| baseline#1 terse-florid t5 turn | player | 17.2 | 3815 | 895 |
| baseline#1 terse-florid t5 memory | player | 19.9 | 943 | 1077 |
| baseline#1 terse-florid t6 turn | player | 36.9 | 3957 | 838 |
| baseline#1 terse-florid t7 turn | player | 15.9 | 4228 | 769 |
| baseline#1 terse-florid t8 turn | player | 38.9 | 4382 | 1907 |
| baseline#1 sisters t0 turn | player | 13.6 | 3117 | 661 |
| baseline#1 sisters t1 turn | player | 22.2 | 3252 | 1143 |
| baseline#1 sisters t2 turn | player | 16.4 | 3447 | 834 |
| baseline#1 sisters t3 turn | player | 15.1 | 3557 | 756 |
| baseline#1 sisters t4 turn | player | 22.3 | 3700 | 1162 |
| baseline#1 sisters t5 turn | player | 16.7 | 3775 | 846 |
| baseline#1 sisters t5 memory | player | 23.8 | 1064 | 1244 |
| baseline#1 sisters t6 turn | player | 44.6 | 3896 | 1030 |
| baseline#1 sisters t7 turn | player | 30.5 | 4293 | 1513 |
| baseline#1 sisters t8 turn | player | 17.8 | 4420 | 851 |
| baseline#1 strangers-b t0 turn | player | 16.6 | 3231 | 816 |
| baseline#1 strangers-b t1 turn | player | 21.2 | 3402 | 1062 |
| baseline#1 strangers-b t2 turn | player | 24.0 | 3551 | 1243 |
| baseline#1 strangers-b t3 turn | player | 13.4 | 3674 | 658 |
| baseline#1 strangers-b t4 turn | player | 16.7 | 3780 | 826 |
| baseline#1 strangers-b t5 turn | player | 19.7 | 3931 | 998 |
| baseline#1 strangers-b t5 memory | player | 17.7 | 1071 | 915 |
| baseline#1 strangers-b t6 turn | player | 60.5 | 4041 | 2252 |
| baseline#1 strangers-b t7 turn | player | 26.5 | 4447 | 1311 |
| baseline#1 strangers-b t8 turn | player | 17.7 | 4573 | 850 |
| natural-rp#1 terse-florid t0 turn | player | 36.6 | 2924 | 1911 |
| natural-rp#1 terse-florid t1 turn | player | 53.4 | 3018 | 2814 |
| natural-rp#1 terse-florid t2 turn | player | 37.2 | 3241 | 1924 |
| natural-rp#1 terse-florid t3 turn | player | 43.2 | 3251 | 2290 |
| natural-rp#1 terse-florid t4 turn | player | 36.9 | 3433 | 1900 |
| natural-rp#1 terse-florid t5 turn | player | 33.5 | 3419 | 1763 |
| natural-rp#1 terse-florid t5 memory | player | 16.3 | 918 | 850 |
| natural-rp#1 terse-florid t6 turn | player | 33.1 | 3568 | 827 |
| natural-rp#1 terse-florid t7 turn | player | 39.4 | 3810 | 2042 |
| natural-rp#1 terse-florid t8 turn | player | 31.1 | 3980 | 1648 |
| natural-rp#1 sisters t0 turn | player | 17.6 | 2753 | 925 |
| natural-rp#1 sisters t1 turn | player | 67.7 | 2896 | 3756 |
| natural-rp#1 sisters t2 turn | player | 25.4 | 3086 | 1350 |
| natural-rp#1 sisters t3 turn | player | 42.5 | 3175 | 2364 |
| natural-rp#1 sisters t4 turn | player | 20.8 | 3293 | 1082 |
| natural-rp#1 sisters t5 turn | player | 25.4 | 3400 | 1388 |
| natural-rp#1 sisters t5 memory | player | 21.1 | 1067 | 1161 |
| natural-rp#1 sisters t6 turn | player | 57.2 | 3530 | 1960 |
| natural-rp#1 sisters t7 turn | player | 39.6 | 3937 | 2143 |
| natural-rp#1 sisters t8 turn | player | 37.0 | 4076 | 1995 |
| natural-rp#1 strangers-b t0 turn | player | 36.4 | 2867 | 1995 |
| natural-rp#1 strangers-b t1 turn | player | 17.3 | 3023 | 905 |
| natural-rp#1 strangers-b t2 turn | player | 15.8 | 3142 | 806 |
| natural-rp#1 strangers-b t3 turn | player | 22.1 | 3264 | 1207 |
| natural-rp#1 strangers-b t4 turn | player | 32.3 | 3322 | 1737 |
| natural-rp#1 strangers-b t5 turn | player | 30.7 | 3487 | 1691 |
| natural-rp#1 strangers-b t5 memory | player | 21.3 | 945 | 1180 |
| natural-rp#1 strangers-b t6 turn | player | 63.4 | 3524 | 2304 |
| natural-rp#1 strangers-b t7 turn | player | 39.7 | 3954 | 2149 |
| natural-rp#1 strangers-b t8 turn | player | 59.6 | 3981 | 3265 |
| screenplay#1 terse-florid t0 turn | player | 18.1 | 2645 | 956 |
| screenplay#1 terse-florid t1 turn | player | 21.1 | 2729 | 1121 |
| screenplay#1 terse-florid t2 turn | player | 28.9 | 2920 | 1563 |
| screenplay#1 terse-florid t3 turn | player | 21.3 | 2949 | 1165 |
| screenplay#1 terse-florid t4 turn | player | 80.9 | 3092 | 4481 |
| screenplay#1 terse-florid t5 turn | player | 28.0 | 3104 | 1542 |
| screenplay#1 terse-florid t5 memory | player | 16.0 | 857 | 867 |
| screenplay#1 terse-florid t6 turn | player | 31.7 | 3199 | 807 |
| screenplay#1 terse-florid t7 turn | player | 25.5 | 3497 | 1364 |
| screenplay#1 terse-florid t8 turn | player | 22.9 | 3623 | 1204 |
| screenplay#1 sisters t0 turn | player | 16.2 | 2474 | 853 |
| screenplay#1 sisters t1 turn | player | 10.7 | 2593 | 528 |
| screenplay#1 sisters t2 turn | player | 15.1 | 2760 | 808 |
| screenplay#1 sisters t3 turn | player | 20.6 | 2812 | 1106 |
| screenplay#1 sisters t4 turn | player | 22.9 | 2954 | 1243 |
| screenplay#1 sisters t5 turn | player | 11.5 | 3020 | 587 |
| screenplay#1 sisters t5 memory | player | 20.3 | 943 | 1113 |
| screenplay#1 sisters t6 turn | player | 35.3 | 3119 | 806 |
| screenplay#1 sisters t7 turn | player | 16.0 | 3479 | 808 |
| screenplay#1 sisters t8 turn | player | 22.6 | 3592 | 1188 |
| screenplay#1 strangers-b t0 turn | player | 14.1 | 2588 | 722 |
| screenplay#1 strangers-b t1 turn | player | 12.7 | 2764 | 644 |
| screenplay#1 strangers-b t2 turn | player | 27.5 | 2852 | 1517 |
| screenplay#1 strangers-b t3 turn | player | 42.8 | 2954 | 2363 |
| screenplay#1 strangers-b t4 turn | player | 47.6 | 2996 | 2631 |
| screenplay#1 strangers-b t5 turn | player | 14.8 | 3084 | 781 |
| screenplay#1 strangers-b t5 memory | player | 17.6 | 780 | 971 |
| screenplay#1 strangers-b t6 turn | player | 41.2 | 3085 | 1300 |
| screenplay#1 strangers-b t7 turn | player | 15.0 | 3426 | 754 |
| screenplay#1 strangers-b t8 turn | player | 36.2 | 3448 | 1967 |
| casual-rp#1 terse-florid t0 turn | player | 12.4 | 2877 | 617 |
| casual-rp#1 terse-florid t1 turn | player | 14.4 | 2944 | 725 |
| casual-rp#1 terse-florid t2 turn | player | 15.7 | 3137 | 797 |
| casual-rp#1 terse-florid t3 turn | player | 13.7 | 3105 | 724 |
| casual-rp#1 terse-florid t4 turn | player | 31.4 | 3258 | 1687 |
| casual-rp#1 terse-florid t5 turn | player | 9.8 | 3214 | 497 |
| casual-rp#1 terse-florid t5 memory | player | 15.8 | 718 | 865 |
| casual-rp#1 terse-florid t6 turn | player | 30.0 | 3317 | 724 |
| casual-rp#1 terse-florid t7 turn | player | 11.8 | 3543 | 574 |
| casual-rp#1 terse-florid t8 turn | player | 11.3 | 3690 | 547 |
| casual-rp#1 sisters t0 turn | player | 11.8 | 2706 | 595 |
| casual-rp#1 sisters t1 turn | player | 11.7 | 2809 | 581 |
| casual-rp#1 sisters t2 turn | player | 13.1 | 2946 | 668 |
| casual-rp#1 sisters t3 turn | player | 10.9 | 2978 | 519 |
| casual-rp#1 sisters t4 turn | player | 12.9 | 3052 | 650 |
| casual-rp#1 sisters t5 turn | player | 50.5 | 3096 | 2780 |
| casual-rp#1 sisters t5 memory | player | 19.7 | 720 | 1079 |
| casual-rp#1 sisters t6 turn | player | 34.9 | 3114 | 822 |
| casual-rp#1 sisters t7 turn | player | 20.9 | 3478 | 1075 |
| casual-rp#1 sisters t8 turn | player | 11.9 | 3602 | 576 |
| casual-rp#1 strangers-b t0 turn | player | 13.1 | 2820 | 663 |
| casual-rp#1 strangers-b t1 turn | player | 15.5 | 2956 | 800 |
| casual-rp#1 strangers-b t2 turn | player | 10.0 | 3043 | 511 |
| casual-rp#1 strangers-b t3 turn | player | 13.6 | 3129 | 717 |
| casual-rp#1 strangers-b t4 turn | player | 15.3 | 3172 | 810 |
| casual-rp#1 strangers-b t5 turn | player | 14.2 | 3284 | 743 |
| casual-rp#1 strangers-b t5 memory | player | 18.1 | 759 | 1002 |
| casual-rp#1 strangers-b t6 turn | player | 31.7 | 3288 | 728 |
| casual-rp#1 strangers-b t7 turn | player | 14.2 | 3637 | 702 |
| casual-rp#1 strangers-b t8 turn | player | 14.7 | 3648 | 738 |
