# Creations: reading bench

- Mode: LIVE, pass: play
- Player: gemma4:31b, judge: session, num_ctx 65536, samples 1
- Commit: 522f5cd9
- Calls: 60 live, 0 from the cache
- Checks: 9 pass, 1 fail, 7 skipped

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
| baseline | 84 | 4.0 | 45% | 3.5 | 0% | 0% | 44% | 0.0 | 52% | 0 | 0 |

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
| Repetition | baseline.motif | motif echoes across all scenes | 2 | record only |
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
| baseline#1 counter-comic.turns | the two took turns | PASS | Bernie Glass > Beatrice Holloway > Bernie Glass > Beatrice Holloway > Bernie Glass > Beatrice Holloway > Bernie Glass > Beatrice Holloway > Bernie Glass > Beatrice Holloway > Bernie Glass > Beatrice Holloway > Bernie Glass |
| baseline#1 chatty-formal.scene | the situation is in the first turn's request | PASS | Howard Finch is the fare, over from the  |
| baseline#1 chatty-formal.turns | the two took turns | PASS | Howard Finch > Paddy O'Shea > Howard Finch > Paddy O'Shea > Howard Finch > Paddy O'Shea > Howard Finch > Paddy O'Shea > Howard Finch > Paddy O'Shea > Howard Finch > Paddy O'Shea > Howard Finch |
| baseline#1 child-villain.scene | the situation is in the first turn's request | PASS | Leo Finch has his lost-and-found shoebox |
| baseline#1 child-villain.turns | the two took turns | PASS | Arthur Penhaligon > Leo Finch > Arthur Penhaligon > Leo Finch > Arthur Penhaligon > Leo Finch > Arthur Penhaligon > Leo Finch > Arthur Penhaligon > Leo Finch > Arthur Penhaligon > Leo Finch > Arthur Penhaligon |
| baseline#1 terse-loud.scene | the situation is in the first turn's request | PASS | Andrzej Nowak has come over on the suppl |
| baseline#1 terse-loud.turns | the two took turns | PASS | Andrzej Nowak > Solveig Dahl > Andrzej Nowak > Solveig Dahl > Andrzej Nowak > Solveig Dahl > Andrzej Nowak > Solveig Dahl > Andrzej Nowak > Solveig Dahl > Andrzej Nowak > Solveig Dahl > Andrzej Nowak |

## Skipped

-  judge baseline#1 counter-comic: no cached judge output for "EXCHANGE: baseline#1 counter-comic"
-  judge baseline#1 chatty-formal: no cached judge output for "EXCHANGE: baseline#1 chatty-formal"
-  judge baseline#1 child-villain: no cached judge output for "EXCHANGE: baseline#1 child-villain"
-  judge baseline#1 terse-loud: no cached judge output for "EXCHANGE: baseline#1 terse-loud"
-  anchor chekhov-lady-with-the-dog: no cached judge output for "SCENE: anchor chekhov-lady-with-the-dog"
-  anchor joyce-the-dead: no cached judge output for "SCENE: anchor joyce-the-dead"
-  anchor austen-persuasion: no cached judge output for "SCENE: anchor austen-persuasion"

## Calls

| Label | Role | Seconds | Prompt tok | Output tok |
|---|---|---|---|---|
| baseline#1 counter-comic t0 turn | player | 17.9 | 3299 | 815 |
| baseline#1 counter-comic t1 turn | player | 15.8 | 3498 | 706 |
| baseline#1 counter-comic t2 turn | player | 41.6 | 3624 | 2063 |
| baseline#1 counter-comic t3 turn | player | 43.1 | 3771 | 2122 |
| baseline#1 counter-comic t4 turn | player | 28.0 | 3855 | 1357 |
| baseline#1 counter-comic t5 turn | player | 36.2 | 3972 | 1764 |
| baseline#1 counter-comic t5 memory | player | 17.6 | 1019 | 843 |
| baseline#1 counter-comic t6 turn | player | 54.2 | 4018 | 1807 |
| baseline#1 counter-comic t7 turn | player | 22.5 | 4333 | 1012 |
| baseline#1 counter-comic t8 turn | player | 19.1 | 4392 | 860 |
| baseline#1 counter-comic t9 turn | player | 20.4 | 4517 | 973 |
| baseline#1 counter-comic t10 turn | player | 19.8 | 4621 | 940 |
| baseline#1 counter-comic t11 turn | player | 20.1 | 4770 | 954 |
| baseline#1 counter-comic t11 memory | player | 10.6 | 1139 | 481 |
| baseline#1 counter-comic t12 turn | player | 59.9 | 4830 | 2439 |
| baseline#1 chatty-formal t0 turn | player | 16.8 | 3555 | 755 |
| baseline#1 chatty-formal t1 turn | player | 19.2 | 3818 | 884 |
| baseline#1 chatty-formal t2 turn | player | 14.4 | 4036 | 674 |
| baseline#1 chatty-formal t3 turn | player | 18.6 | 4202 | 882 |
| baseline#1 chatty-formal t4 turn | player | 34.2 | 4358 | 1673 |
| baseline#1 chatty-formal t5 turn | player | 23.5 | 4519 | 1110 |
| baseline#1 chatty-formal t5 memory | player | 25.4 | 1351 | 1250 |
| baseline#1 chatty-formal t6 turn | player | 43.3 | 4622 | 856 |
| baseline#1 chatty-formal t7 turn | player | 25.0 | 5176 | 1122 |
| baseline#1 chatty-formal t8 turn | player | 19.9 | 5282 | 931 |
| baseline#1 chatty-formal t9 turn | player | 33.9 | 5445 | 1717 |
| baseline#1 chatty-formal t10 turn | player | 18.7 | 5577 | 885 |
| baseline#1 chatty-formal t11 turn | player | 66.4 | 5734 | 3471 |
| baseline#1 chatty-formal t11 memory | player | 22.7 | 1646 | 1196 |
| baseline#1 chatty-formal t12 turn | player | 43.1 | 5906 | 982 |
| baseline#1 child-villain t0 turn | player | 15.9 | 3543 | 718 |
| baseline#1 child-villain t1 turn | player | 15.6 | 3656 | 680 |
| baseline#1 child-villain t2 turn | player | 23.1 | 3866 | 1063 |
| baseline#1 child-villain t3 turn | player | 19.1 | 3922 | 829 |
| baseline#1 child-villain t4 turn | player | 19.2 | 4061 | 795 |
| baseline#1 child-villain t5 turn | player | 66.3 | 4158 | 3033 |
| baseline#1 child-villain t5 memory | player | 24.2 | 1024 | 1094 |
| baseline#1 child-villain t6 turn | player | 45.6 | 4269 | 933 |
| baseline#1 child-villain t7 turn | player | 21.0 | 4621 | 825 |
| baseline#1 child-villain t8 turn | player | 46.5 | 4768 | 1997 |
| baseline#1 child-villain t9 turn | player | 17.5 | 4827 | 755 |
| baseline#1 child-villain t10 turn | player | 39.6 | 4965 | 1805 |
| baseline#1 child-villain t11 turn | player | 17.8 | 5039 | 789 |
| baseline#1 child-villain t11 memory | player | 25.0 | 1219 | 1128 |
| baseline#1 child-villain t12 turn | player | 62.0 | 5150 | 1620 |
| baseline#1 terse-loud t0 turn | player | 20.2 | 3620 | 847 |
| baseline#1 terse-loud t1 turn | player | 15.9 | 3637 | 640 |
| baseline#1 terse-loud t2 turn | player | 22.9 | 3911 | 958 |
| baseline#1 terse-loud t3 turn | player | 25.3 | 3863 | 1136 |
| baseline#1 terse-loud t4 turn | player | 28.1 | 4070 | 1295 |
| baseline#1 terse-loud t5 turn | player | 38.0 | 4036 | 1651 |
| baseline#1 terse-loud t5 memory | player | 23.7 | 901 | 1037 |
| baseline#1 terse-loud t6 turn | player | 38.4 | 4239 | 647 |
| baseline#1 terse-loud t7 turn | player | 30.0 | 4477 | 1283 |
| baseline#1 terse-loud t8 turn | player | 16.8 | 4686 | 677 |
| baseline#1 terse-loud t9 turn | player | 41.6 | 4678 | 1938 |
| baseline#1 terse-loud t10 turn | player | 18.9 | 4883 | 844 |
| baseline#1 terse-loud t11 turn | player | 16.6 | 4868 | 722 |
| baseline#1 terse-loud t11 memory | player | 13.3 | 1108 | 585 |
| baseline#1 terse-loud t12 turn | player | 30.5 | 5066 | 774 |
