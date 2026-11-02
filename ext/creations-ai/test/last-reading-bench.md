# Creations: reading bench

- Mode: LIVE, pass: judge
- Player: gemma4:31b, judge: session, num_ctx 131072, samples 1
- Commit: c6a2c657
- Calls: 8 live, 35 from the cache
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
| baseline | 90 | 4.4 | 37% | 2.8 | 0% | 0% | 25% | 0.0 | 30% | 0 | 0 |

```text
ollama ps before:
NAME          ID              SIZE     PROCESSOR    CONTEXT    RUNNER      UNTIL              
gemma4:31b    c6981e1e0c64    23 GB    100% GPU     131072     llamacpp    9 minutes from now

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
| baseline.empty | every turn kept a reply | FAIL | 35 turns answered nothing |

### Wiring

| Id | Check | Result | Detail |
|---|---|---|---|
| baseline.rules | its rules are in the prompt | PASS |  |
| baseline#1 strangers.scene | the place and the situation are in the first turn's request | PASS | the A&E waiting room at St Jude's; Nora Vasquez is waiting for her friend I |
| baseline#1 strangers.turns | the two took turns | PASS | Joan Pike > Nora Vasquez > Joan Pike > Nora Vasquez > Joan Pike > Nora Vasquez |
| baseline#1 storm.scene | the place and the situation are in the first turn's request | PASS | the Albion Street pharmacy; The radio has just said the storm reache |
| baseline#1 storm.turns | the two took turns | PASS | Ilan Brody > Nora Vasquez > Ilan Brody > Nora Vasquez > Ilan Brody > Nora Vasquez |
| baseline#1 news.scene | the place and the situation are in the first turn's request | PASS | Ilan's locksmith shop; Ilan has had a letter this morning: his  |
| baseline#1 news.turns | the two took turns | PASS | Nora Vasquez > Ilan Brody > Nora Vasquez > Ilan Brody > Nora Vasquez > Ilan Brody |
| baseline#1 favour.scene | the place and the situation are in the first turn's request | PASS | the Albion Street pharmacy; The chain has offered to sell Nora the s |
| baseline#1 favour.turns | the two took turns | PASS | Ilan Brody > Nora Vasquez > Ilan Brody > Nora Vasquez > Ilan Brody > Nora Vasquez |
| baseline#1 argument.scene | the place and the situation are in the first turn's request | PASS | the Albion Street pharmacy; An insurance assessor came in today aski |
| baseline#1 argument.turns | the two took turns | PASS | Ilan Brody > Nora Vasquez > Ilan Brody > Nora Vasquez > Ilan Brody > Nora Vasquez |

## Skipped

-  judge baseline#1 strangers: awaiting the session judge: _@_.prompt.md
-  judge baseline#1 storm: awaiting the session judge: _@_.prompt.md
-  judge baseline#1 news: awaiting the session judge: _w_@_.prompt.md
-  judge baseline#1 favour: awaiting the session judge: _@_.prompt.md
-  judge baseline#1 argument: awaiting the session judge: _@_.prompt.md
-  anchor chekhov-lady-with-the-dog: awaiting the session judge: _-_-w_-_-_@_.prompt.md
-  anchor joyce-the-dead: awaiting the session judge: _-_-_@_.prompt.md
-  anchor austen-persuasion: awaiting the session judge: _-_@_.prompt.md
