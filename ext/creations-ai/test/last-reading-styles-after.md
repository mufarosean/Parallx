# Creations: reading bench

- Mode: LIVE, pass: play
- Player: gemma4:31b, judge: session, num_ctx 65536, samples 1
- Commit: f8f25794
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
| baseline | 50 | 3.0 | 74% | 2.9 | 0% | 0% | 0% | 0.0 | 56% | 0 | 0 |
| natural-rp | 69 | 1.4 | 70% | 0.1 | 0% | 0% | 13% | 0.0 | 4% | 0 | 0 |
| screenplay | 39 | 2.1 | 100% | 2.6 | 4% | 40% | 36% | 0.0 | 26% | 0 | 0 |
| casual-rp | 44 | 2.6 | 69% | 2.4 | 0% | 0% | 10% | 0.0 | 26% | 0 | 0 |

```text
ollama ps before:
NAME          ID              SIZE     PROCESSOR    CONTEXT    RUNNER      UNTIL              
gemma4:31b    c6981e1e0c64    23 GB    100% GPU     65536      llamacpp    6 minutes from now

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
| Repetition | baseline.motif | motif echoes across all scenes | 1 | record only |
| Repetition | baseline.novelty | turns bringing in something new, by thirds (mean) | 1.00 / 1.00 / 1.00 | record only |
| Repetition | natural-rp.motif | motif echoes across all scenes | 0 | record only |
| Repetition | natural-rp.novelty | turns bringing in something new, by thirds (mean) | 1.00 / 1.00 / 1.00 | record only |
| Repetition | screenplay.motif | motif echoes across all scenes | 1 | record only |
| Repetition | screenplay.novelty | turns bringing in something new, by thirds (mean) | 1.00 / 1.00 / 1.00 | record only |
| Repetition | casual-rp.motif | motif echoes across all scenes | 0 | record only |
| Repetition | casual-rp.novelty | turns bringing in something new, by thirds (mean) | 0.89 / 1.00 / 0.89 | record only |

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
| baseline#1 terse-florid t0 turn | player | 16.4 | 3383 | 829 |
| baseline#1 terse-florid t1 turn | player | 39.9 | 3450 | 2180 |
| baseline#1 terse-florid t2 turn | player | 42.2 | 3637 | 2291 |
| baseline#1 terse-florid t3 turn | player | 48.0 | 3630 | 2671 |
| baseline#1 terse-florid t4 turn | player | 28.8 | 3776 | 1527 |
| baseline#1 terse-florid t5 turn | player | 19.3 | 3746 | 1044 |
| baseline#1 terse-florid t5 memory | player | 19.5 | 766 | 1081 |
| baseline#1 terse-florid t6 turn | player | 49.6 | 3875 | 1622 |
| baseline#1 terse-florid t7 turn | player | 22.7 | 4147 | 1180 |
| baseline#1 terse-florid t8 turn | player | 28.1 | 4295 | 1478 |
| baseline#1 sisters t0 turn | player | 50.1 | 3212 | 2763 |
| baseline#1 sisters t1 turn | player | 14.2 | 3325 | 716 |
| baseline#1 sisters t2 turn | player | 33.3 | 3487 | 1797 |
| baseline#1 sisters t3 turn | player | 50.4 | 3525 | 2801 |
| baseline#1 sisters t4 turn | player | 12.4 | 3609 | 594 |
| baseline#1 sisters t5 turn | player | 54.4 | 3673 | 3024 |
| baseline#1 sisters t5 memory | player | 21.2 | 819 | 1179 |
| baseline#1 sisters t6 turn | player | 35.5 | 3763 | 722 |
| baseline#1 sisters t7 turn | player | 13.9 | 4121 | 683 |
| baseline#1 sisters t8 turn | player | 14.1 | 4239 | 686 |
| baseline#1 strangers-b t0 turn | player | 51.5 | 3326 | 2835 |
| baseline#1 strangers-b t1 turn | player | 45.9 | 3471 | 2517 |
| baseline#1 strangers-b t2 turn | player | 20.6 | 3589 | 1068 |
| baseline#1 strangers-b t3 turn | player | 14.7 | 3695 | 735 |
| baseline#1 strangers-b t4 turn | player | 40.7 | 3750 | 2163 |
| baseline#1 strangers-b t5 turn | player | 43.5 | 3898 | 2293 |
| baseline#1 strangers-b t5 memory | player | 19.6 | 826 | 1066 |
| baseline#1 strangers-b t6 turn | player | 36.1 | 3875 | 826 |
| baseline#1 strangers-b t7 turn | player | 34.9 | 4286 | 1849 |
| baseline#1 strangers-b t8 turn | player | 28.1 | 4346 | 1464 |
| natural-rp#1 terse-florid t0 turn | player | 31.1 | 2971 | 1602 |
| natural-rp#1 terse-florid t1 turn | player | 28.0 | 3036 | 1463 |
| natural-rp#1 terse-florid t2 turn | player | 38.6 | 3232 | 2056 |
| natural-rp#1 terse-florid t3 turn | player | 58.6 | 3234 | 3259 |
| natural-rp#1 terse-florid t4 turn | player | 26.7 | 3410 | 1413 |
| natural-rp#1 terse-florid t5 turn | player | 37.6 | 3428 | 2061 |
| natural-rp#1 terse-florid t5 memory | player | 14.8 | 857 | 796 |
| natural-rp#1 terse-florid t6 turn | player | 67.2 | 3530 | 2879 |
| natural-rp#1 terse-florid t7 turn | player | 46.3 | 3804 | 2529 |
| natural-rp#1 terse-florid t8 turn | player | 38.0 | 3951 | 2055 |
| natural-rp#1 sisters t0 turn | player | 28.7 | 2800 | 1555 |
| natural-rp#1 sisters t1 turn | player | 45.9 | 2915 | 2532 |
| natural-rp#1 sisters t2 turn | player | 35.0 | 3115 | 1904 |
| natural-rp#1 sisters t3 turn | player | 42.2 | 3210 | 2346 |
| natural-rp#1 sisters t4 turn | player | 56.8 | 3323 | 3124 |
| natural-rp#1 sisters t5 turn | player | 36.7 | 3404 | 2033 |
| natural-rp#1 sisters t5 memory | player | 22.0 | 1007 | 1214 |
| natural-rp#1 sisters t6 turn | player | 57.3 | 3503 | 1918 |
| natural-rp#1 sisters t7 turn | player | 20.8 | 3913 | 1078 |
| natural-rp#1 sisters t8 turn | player | 42.8 | 4049 | 2320 |
| natural-rp#1 strangers-b t0 turn | player | 16.5 | 2914 | 855 |
| natural-rp#1 strangers-b t1 turn | player | 54.4 | 3059 | 3003 |
| natural-rp#1 strangers-b t2 turn | player | 36.9 | 3157 | 2006 |
| natural-rp#1 strangers-b t3 turn | player | 44.8 | 3283 | 2453 |
| natural-rp#1 strangers-b t4 turn | player | 49.2 | 3377 | 2701 |
| natural-rp#1 strangers-b t5 turn | player | 15.2 | 3502 | 765 |
| natural-rp#1 strangers-b t5 memory | player | 25.0 | 904 | 1401 |
| natural-rp#1 strangers-b t6 turn | player | 60.3 | 3536 | 1918 |
| natural-rp#1 strangers-b t7 turn | player | 40.4 | 3959 | 2188 |
| natural-rp#1 strangers-b t8 turn | player | 70.6 | 4053 | 3880 |
| screenplay#1 terse-florid t0 turn | player | 14.9 | 2678 | 770 |
| screenplay#1 terse-florid t1 turn | player | 24.1 | 2726 | 1293 |
| screenplay#1 terse-florid t2 turn | player | 17.2 | 2896 | 897 |
| screenplay#1 terse-florid t3 turn | player | 7.6 | 2875 | 383 |
| screenplay#1 terse-florid t4 turn | player | 13.1 | 3010 | 652 |
| screenplay#1 terse-florid t5 turn | player | 36.4 | 2969 | 2023 |
| screenplay#1 terse-florid t5 memory | player | 16.8 | 684 | 929 |
| screenplay#1 terse-florid t6 turn | player | 26.9 | 3072 | 506 |
| screenplay#1 terse-florid t7 turn | player | 12.4 | 3313 | 618 |
| screenplay#1 terse-florid t8 turn | player | 15.3 | 3430 | 779 |
| screenplay#1 sisters t0 turn | player | 14.1 | 2507 | 732 |
| screenplay#1 sisters t1 turn | player | 10.4 | 2627 | 513 |
| screenplay#1 sisters t2 turn | player | 15.9 | 2777 | 857 |
| screenplay#1 sisters t3 turn | player | 12.3 | 2813 | 640 |
| screenplay#1 sisters t4 turn | player | 11.1 | 2917 | 575 |
| screenplay#1 sisters t5 turn | player | 12.5 | 2963 | 642 |
| screenplay#1 sisters t5 memory | player | 18.0 | 817 | 988 |
| screenplay#1 sisters t6 turn | player | 28.8 | 3014 | 575 |
| screenplay#1 sisters t7 turn | player | 13.5 | 3356 | 663 |
| screenplay#1 sisters t8 turn | player | 12.7 | 3444 | 631 |
| screenplay#1 strangers-b t0 turn | player | 14.0 | 2621 | 720 |
| screenplay#1 strangers-b t1 turn | player | 12.8 | 2755 | 652 |
| screenplay#1 strangers-b t2 turn | player | 26.3 | 2836 | 1452 |
| screenplay#1 strangers-b t3 turn | player | 43.4 | 2926 | 2411 |
| screenplay#1 strangers-b t4 turn | player | 43.6 | 2993 | 2418 |
| screenplay#1 strangers-b t5 turn | player | 14.6 | 3069 | 767 |
| screenplay#1 strangers-b t5 memory | player | 19.8 | 731 | 1100 |
| screenplay#1 strangers-b t6 turn | player | 67.7 | 3085 | 2684 |
| screenplay#1 strangers-b t7 turn | player | 13.5 | 3447 | 668 |
| screenplay#1 strangers-b t8 turn | player | 23.2 | 3506 | 1226 |
| casual-rp#1 terse-florid t0 turn | player | 13.4 | 2928 | 673 |
| casual-rp#1 terse-florid t1 turn | player | 21.4 | 3015 | 1130 |
| casual-rp#1 terse-florid t2 turn | player | 14.5 | 3203 | 733 |
| casual-rp#1 terse-florid t3 turn | player | 10.3 | 3189 | 533 |
| casual-rp#1 terse-florid t4 turn | player | 18.9 | 3344 | 972 |
| casual-rp#1 terse-florid t5 turn | player | 12.5 | 3325 | 658 |
| casual-rp#1 terse-florid t5 memory | player | 16.1 | 788 | 886 |
| casual-rp#1 terse-florid t6 turn | player | 28.5 | 3437 | 616 |
| casual-rp#1 terse-florid t7 turn | player | 10.2 | 3684 | 479 |
| casual-rp#1 terse-florid t8 turn | player | 14.7 | 3817 | 733 |
| casual-rp#1 sisters t0 turn | player | 14.4 | 2757 | 738 |
| casual-rp#1 sisters t1 turn | player | 20.1 | 2855 | 1065 |
| casual-rp#1 sisters t2 turn | player | 12.7 | 2998 | 666 |
| casual-rp#1 sisters t3 turn | player | 12.6 | 3031 | 656 |
| casual-rp#1 sisters t4 turn | player | 10.5 | 3118 | 528 |
| casual-rp#1 sisters t5 turn | player | 13.8 | 3162 | 718 |
| casual-rp#1 sisters t5 memory | player | 20.9 | 796 | 1142 |
| casual-rp#1 sisters t6 turn | player | 33.4 | 3245 | 670 |
| casual-rp#1 sisters t7 turn | player | 14.9 | 3564 | 741 |
| casual-rp#1 sisters t8 turn | player | 12.5 | 3618 | 609 |
| casual-rp#1 strangers-b t0 turn | player | 15.0 | 2871 | 773 |
| casual-rp#1 strangers-b t1 turn | player | 13.8 | 3018 | 703 |
| casual-rp#1 strangers-b t2 turn | player | 11.7 | 3114 | 572 |
| casual-rp#1 strangers-b t3 turn | player | 11.9 | 3211 | 622 |
| casual-rp#1 strangers-b t4 turn | player | 18.4 | 3260 | 943 |
| casual-rp#1 strangers-b t5 turn | player | 11.0 | 3361 | 568 |
| casual-rp#1 strangers-b t5 memory | player | 19.8 | 799 | 1092 |
| casual-rp#1 strangers-b t6 turn | player | 44.1 | 3367 | 1280 |
| casual-rp#1 strangers-b t7 turn | player | 13.4 | 3753 | 655 |
| casual-rp#1 strangers-b t8 turn | player | 25.6 | 3815 | 1358 |
