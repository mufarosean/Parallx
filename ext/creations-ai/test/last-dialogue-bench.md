# Creations: dialogue bench

- Mode: LIVE, pass: all
- Player: gemma4:31b, judge: qwen3.8:27b, num_ctx 65536, samples 2
- Commit: 2b972a93
- Calls: 128 live, 192 from the cache
- Checks: 6 pass, 0 fail

Per 100 spoken lines. In brackets: the change from baseline. Lower is better for every fault; higher is better for "good". "anyFault" counts lines with any fault except flat.

| Condition | Lines | anyFault | abstract | metaphor | trivial | oblique | forced_wit | unnatural | flat | good | mechAbstract | simile |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | 154/154 | 50.0 | 5.2 | 19.5 | 1.9 | 23.4 | 3.2 | 6.5 | 1.3 | 48.7 | 0.6 | 1.3 |
| direct-questions | 145/145 | 40.7 (-9.3) | 2.8 (-2.4) | 10.3 (-9.1) | 2.8 (+0.8) | 22.1 (-1.3) | 2.8 (-0.5) | 6.9 (+0.4) | 0.0 (-1.3) | 59.3 (+10.6) | 0.0 (-0.6) | 1.4 (+0.1) |
| soft-anchor-balance-rule | 157/157 | 45.2 (-4.8) | 1.9 (-3.3) | 8.3 (-11.2) | 7.6 (+5.7) | 21.7 (-1.7) | 3.8 (+0.6) | 5.7 (-0.8) | 0.6 (-0.7) | 54.1 (+5.4) | 0.0 (-0.6) | 1.9 (+0.6) |
| soft-anchor-direct-balance | 164/164 | 38.4 (-11.6) | 1.8 (-3.4) | 7.9 (-11.6) | 3.7 (+1.7) | 20.7 (-2.6) | 0.6 (-2.6) | 6.7 (+0.2) | 1.2 (-0.1) | 60.4 (+11.7) | 0.0 (-0.6) | 1.8 (+0.5) |

### Balance by character

Answered: share of replies that answer what they were asked (judge; a quip after the answer still counts). Habit: share of lines showing a voice habit (judge; some of the time is right, nearly all is not). Ends in ?: share of lines that are questions. Long: lines over 35 words. Balance and recognisable: the judge, per scene, 1 to 5. Fault and good: per 100 lines.

| Condition | Character | Lines | Answered % | Habit % | Ends in ? % | Long % | Balance | Recognisable | Fault % | Good % |
|---|---|---|---|---|---|---|---|---|---|---|
| baseline | Nora Vasquez | 56 | 19 | 93 | 96 | 0 | 2.8 | 4.0 | 57 | 43 |
| baseline | Ilan Brody | 98 | 84 | 44 | 0 | 22 | 2.9 | 3.8 | 46 | 52 |
| direct-questions | Nora Vasquez | 57 | 10 | 88 | 91 | 0 | 2.9 | 4.1 | 54 | 46 |
| direct-questions | Ilan Brody | 88 | 93 | 53 | 0 | 27 | 3.5 | 4.6 | 32 | 68 |
| soft-anchor-balance-rule | Nora Vasquez | 62 | 25 | 87 | 85 | 0 | 2.9 | 4.5 | 53 | 47 |
| soft-anchor-balance-rule | Ilan Brody | 95 | 64 | 45 | 0 | 18 | 3.3 | 4.1 | 40 | 59 |
| soft-anchor-direct-balance | Nora Vasquez | 61 | 31 | 92 | 87 | 0 | 3.0 | 4.3 | 48 | 52 |
| soft-anchor-direct-balance | Ilan Brody | 103 | 97 | 37 | 0 | 24 | 3.4 | 4.1 | 33 | 65 |

```text
ollama ps before:
NAME           ID              SIZE     PROCESSOR    CONTEXT    RUNNER      UNTIL               
qwen3.8:27b    22130167c4c2    17 GB    100% GPU     131072     llamacpp    29 minutes from now

ollama ps after:
NAME    ID    SIZE    PROCESSOR    CONTEXT    RUNNER    UNTIL
```

## Measures

| Section | Id | Measure | Value | Bar |
|---|---|---|---|---|
| Results | baseline.anyFault | lines with a fault, per 100 | 50 |  |
| Results | baseline.good | lines that sound like a person, per 100 | 48.701 |  |
| Results | direct-questions.anyFault | lines with a fault, per 100 | 40.69 |  |
| Results | direct-questions.good | lines that sound like a person, per 100 | 59.31 |  |
| Results | soft-anchor-balance-rule.anyFault | lines with a fault, per 100 | 45.223 |  |
| Results | soft-anchor-balance-rule.good | lines that sound like a person, per 100 | 54.14 |  |
| Results | soft-anchor-direct-balance.anyFault | lines with a fault, per 100 | 38.415 |  |
| Results | soft-anchor-direct-balance.good | lines that sound like a person, per 100 | 60.366 |  |

## Checks

### Wiring

| Id | Check | Result | Detail |
|---|---|---|---|
| baseline.rules | its rules are in the prompt | PASS |  |
| direct-questions.rules | its rules are in the prompt | PASS |  |
| soft-anchor-balance-rule.rules | its rules are in the prompt | PASS |  |
| soft-anchor-balance-rule.anchor | the softened voice reminder is in the prompt | PASS |  |
| soft-anchor-direct-balance.rules | its rules are in the prompt | PASS |  |
| soft-anchor-direct-balance.anchor | the softened voice reminder is in the prompt | PASS |  |

## Samples

### Worst lines: baseline: flagged lines

```text
[oblique] "Do you have a prescription or are you just early?"  (Dodges the 'rough night' question with a transactional query.)
[oblique] "Is that why you are wearing a scarf with a crest on it?"  (Answers a yes/no question with a question about a scarf.)
[oblique, trivial] "Does the score change the price of your medication?"  (Deflects personal interest with a clinical, irrelevant question.)
[oblique] "Is this a conversation about food, or do you have a script in your pocket?"  (Refuses to answer the breakfast question by questioning the intent.)
[oblique, unnatural] "Why are you still standing here?"  (Aggressive deflection; 'why are you standing here' is not a natural response to a breakfast question.)
[oblique] "Is the bus running on time today?"  (Ignores the goodbye to ask an unrelated logistical question.)
[trivial] "Selling... he sells the bricks."  (Dodge to a trivial detail (bricks) instead of acknowledging the loss.)
[metaphor] "A *shanda*... to sell a place that knows how to hold a door shut."  ('Place that knows how to hold a door shut' is a poetic personification, not natural speech.)
[metaphor] "There was a man who came to my grandmother. He had a safe from the old country, rusted shut from the salt air. He waited three winters for the right tool to arrive from Germany. He said the wait made the gold inside feel heavier."  (The line 'wait made the gold inside feel heavier' is a poetic metaphor, not a real person's thought.)
[oblique] "Is it a long March, or a short one."  (Asking if March is 'long or short' is a nonsensical, roundabout way to ask for the date.)
[oblique] "What do I want."  (Echoing the question back ('What do I want') is a dodge, not an answer.)
[metaphor] "It is *mishegas* to think a man can carry his walls. We see where the keys fit. We wait."  ('Carry his walls' is a metaphorical phrase; 'We see where the keys fit' is also abstract/oblique.)
```

### Worst lines: direct-questions: flagged lines

```text
[oblique] "Did I ask about the fuel?"  (Dodge with a rhetorical question that doesn't make sense as a response to 'is that a yes?'; feels like a deflection rather than a real person's reaction.)
[oblique] "Lie is a heavy word. My sister... she is *meshuggeneh* about the hours I work."  (Deflects the accusation of lying by critiquing the word choice rather than addressing the act.)
[abstract] "My grandmother had a box. She kept everything in it. Keys, letters, old coins. She would *kvetch* if someone touched the lid, even if they just wanted to see the wood."  (Uses a story about a box to avoid answering the direct question about trust/anger.)
[abstract, unnatural] "Sometimes the lid stays closed because the things inside are just... things. Not worth the noise of talking about them."  (Philosophical generalization about 'things' and 'noise'; sounds like a quote, not a locksmith.)
[oblique] "Who was checking the lock?"  (Deflects a direct accusation with a counter-question instead of addressing the lock.)
[oblique] "Did you have a reason to be in the alley at four in the morning?"  (Ignores the fact the door was left open to interrogate Sam's presence.)
[oblique] "Did you see a shadow?"  (Does not address the security risk; pivots to a specific visual detail.)
[forced_wit, oblique] "Or are you just practicing your patrol?"  (Sarcastic jab that feels performative and dodges the 'anyone could walk in' point.)
[trivial, oblique] "Are you keeping a log?"  (Fixates on the 'log' detail to avoid acknowledging the repeated failure.)
[oblique] "Is there a reason you are still here?"  (Ignores the frequency of the issue to question Sam's motive for staying.)
[oblique] "Are you volunteering to lock it?"  (Refuses to state her own action; deflects by asking if Sam will do it.)
[forced_wit, oblique] "Or are you just here to tell me how to run a shop?"  (Defensive quip that avoids answering what she will do about the door.)
```

### Worst lines: soft-anchor-balance-rule: flagged lines

```text
[oblique] "Is the delivery truck already at the back door?"  (Dodges the question about her night with an unrelated operational query.)
[oblique] "Who won?"  (Asks a question instead of answering if she saw it.)
[oblique] "Was it a blowout or did it actually go to overtime?"  (Asks a question instead of answering if she saw it.)
[oblique] "Do you think the cafe on the corner still has those cinnamon rolls?"  (Asks a question instead of stating what she is eating.)
[oblique] "Or are you planning on eating a protein bar in the car?"  (Asks a question instead of stating what she is eating.)
[oblique] "Did you check the temperature on the vaccine fridge?"  (Ignores the goodbye to ask a work-related question.)
[oblique] "Who is coming in at eight-fifteen?"  (Ignores the goodbye to ask a work-related question.)
[metaphor] "It is a long walk to March. Too many days to think about where to put the tools."  ('Long walk to March' is a poetic metaphor a locksmith wouldn't naturally use; sounds like a quote.)
[unnatural] "My grandmother had a box for her needles. She carried it every time she moved. Small, cedar wood. It smelled of old forests and dust. She told me the needles knew where they belonged, even if the house changed."  (The detail 'smelled of old forests' is overly literary/polished; dodges the direct question 'what do you want to do'.)
[oblique] "Does your mother have a lot of plants?"  (Dodge is too evasive for a simple yes/no; feels like a deflection rather than a question.)
[oblique] "The Crown has a cellar door,"  (Dodges the accusation of lying by pointing out a physical detail (cellar door) that doesn't explain why he was there, rather than addressing the lie.)
[unnatural] "Old iron. Rusted shut since the war, maybe. Landlord thinks it is a ghost. I had to shlep my bag from the van just to see if the bolt was actually thrown."  (The story about the 'ghost' door and shlepping the bag is overly dramatic and polished for a quick excuse; it feels like a constructed anecdote rather than a real person's immediate reaction.)
```

### Worst lines: soft-anchor-direct-balance: flagged lines

```text
[oblique] "Did it end before the sun came up?"  (Asking if it ended before sunrise is a nonsensical/oblique way to ask who won or if she watched it; dodges the plain question.)
[trivial] "Do you actually have a reason to be in here, or are you just avoiding your job?"  (Dodges the breakfast question entirely to attack his presence; feels like a deflection rather than a natural reaction to a simple query.)
[trivial] "The Crown has a door that sticks,"  (Dodges the lie by focusing on a trivial mechanical detail.)
[oblique] "My bubbe had a tea tin,"  (Starts a story instead of answering the direct question 'Why lie?')
[oblique] "My cousin Mo always wanted the full story,"  (Deflects the request for truth with an anecdote about a cousin.)
[metaphor] "He would ask the baker why the bread was burnt, or why the postman was late. He spent his whole life with a head full of things that did not change the taste of the toast."  ('Head full of things that did not change the taste of the toast' is a polished aphorism, not natural speech.)
[trivial] "The tea is probably cold by now,"  (Dodges the emotional question 'Are we good?' with a comment on tea temperature.)
[oblique] "My grandmother had a neighbor who would apologize for twenty years over a broken fence. One day the fence fell over on its own and he finally stopped talking about it."  (Another story instead of a direct answer to 'Are we good?')
[oblique] "Who saw it?"  (Deflects a direct accusation with a question instead of addressing the act.)
[oblique] "Did something go missing, or did you just feel the need to check the latch at midnight?"  (Turns a statement of fact into a probing question about Sam's motives.)
[oblique] "What would they have taken?"  (Ignores the security risk to ask a hypothetical question.)
[oblique] "And you've been keeping a tally?"  (Deflects the pattern of behavior by questioning Sam's tracking of it.)
```

## Calls

| Label | Role | Seconds | Prompt tok | Output tok |
|---|---|---|---|---|
| soft-anchor-direct-balance#1 smalltalk t1 turn | player | 24.5 | 1818 | 812 |
| soft-anchor-direct-balance#1 smalltalk t2 turn | player | 19.9 | 2049 | 1039 |
| soft-anchor-direct-balance#1 smalltalk t3 turn | player | 14.1 | 2180 | 728 |
| soft-anchor-direct-balance#1 smalltalk t4 turn | player | 21.1 | 2270 | 1097 |
| soft-anchor-direct-balance#1 badnews t1 turn | player | 21.8 | 1780 | 1058 |
| soft-anchor-direct-balance#1 badnews t2 turn | player | 16.0 | 2069 | 816 |
| soft-anchor-direct-balance#1 badnews t3 turn | player | 23.2 | 2327 | 1190 |
| soft-anchor-direct-balance#1 badnews t4 turn | player | 20.2 | 2529 | 1025 |
| soft-anchor-direct-balance#1 favour t1 turn | player | 15.5 | 1804 | 720 |
| soft-anchor-direct-balance#1 favour t2 turn | player | 16.4 | 2014 | 836 |
| soft-anchor-direct-balance#1 favour t3 turn | player | 18.7 | 2129 | 677 |
| soft-anchor-direct-balance#1 favour t4 turn | player | 14.6 | 2228 | 749 |
| soft-anchor-direct-balance#1 lie t1 turn | player | 30.8 | 1785 | 1540 |
| soft-anchor-direct-balance#1 lie t2 turn | player | 63.2 | 2036 | 1616 |
| soft-anchor-direct-balance#1 lie t3 turn | player | 17.3 | 2259 | 836 |
| soft-anchor-direct-balance#1 lie t4 turn | player | 20.1 | 2462 | 1038 |
| soft-anchor-direct-balance#1 argument t1 turn | player | 14.1 | 1806 | 643 |
| soft-anchor-direct-balance#1 argument t2 turn | player | 21.4 | 2011 | 1084 |
| soft-anchor-direct-balance#1 argument t3 turn | player | 13.0 | 2174 | 653 |
| soft-anchor-direct-balance#1 argument t4 turn | player | 19.0 | 2323 | 965 |
| soft-anchor-direct-balance#1 praise t1 turn | player | 25.5 | 1780 | 1258 |
| soft-anchor-direct-balance#1 praise t2 turn | player | 42.7 | 2066 | 1129 |
| soft-anchor-direct-balance#1 praise t3 turn | player | 22.0 | 2318 | 1142 |
| soft-anchor-direct-balance#1 praise t4 turn | player | 70.7 | 2529 | 2391 |
| soft-anchor-direct-balance#1 practical t1 turn | player | 31.8 | 1804 | 542 |
| soft-anchor-direct-balance#1 practical t2 turn | player | 16.7 | 1982 | 856 |
| soft-anchor-direct-balance#1 practical t3 turn | player | 15.6 | 2157 | 806 |
| soft-anchor-direct-balance#1 practical t4 turn | player | 15.9 | 2298 | 822 |
| soft-anchor-direct-balance#1 personal t1 turn | player | 19.2 | 1781 | 936 |
| soft-anchor-direct-balance#1 personal t2 turn | player | 18.9 | 2083 | 978 |
| soft-anchor-direct-balance#1 personal t3 turn | player | 18.4 | 2362 | 954 |
| soft-anchor-direct-balance#1 personal t4 turn | player | 21.1 | 2613 | 1087 |
| soft-anchor-direct-balance#2 smalltalk t1 turn | player | 31.0 | 1818 | 650 |
| soft-anchor-direct-balance#2 smalltalk t2 turn | player | 33.9 | 2076 | 749 |
| soft-anchor-direct-balance#2 smalltalk t3 turn | player | 20.7 | 2212 | 1057 |
| soft-anchor-direct-balance#2 smalltalk t4 turn | player | 15.9 | 2364 | 816 |
| soft-anchor-direct-balance#2 badnews t1 turn | player | 52.0 | 1780 | 868 |
| soft-anchor-direct-balance#2 badnews t2 turn | player | 20.4 | 2103 | 1060 |
| soft-anchor-direct-balance#2 badnews t3 turn | player | 28.1 | 2391 | 1441 |
| soft-anchor-direct-balance#2 badnews t4 turn | player | 25.1 | 2600 | 1301 |
| soft-anchor-direct-balance#2 favour t1 turn | player | 55.1 | 1804 | 873 |
| soft-anchor-direct-balance#2 favour t2 turn | player | 14.9 | 1973 | 773 |
| soft-anchor-direct-balance#2 favour t3 turn | player | 13.7 | 2114 | 710 |
| soft-anchor-direct-balance#2 favour t4 turn | player | 37.0 | 2236 | 1938 |
| soft-anchor-direct-balance#2 lie t1 turn | player | 54.5 | 1785 | 1468 |
| soft-anchor-direct-balance#2 lie t2 turn | player | 20.2 | 2024 | 1027 |
| soft-anchor-direct-balance#2 lie t3 turn | player | 20.0 | 2243 | 1037 |
| soft-anchor-direct-balance#2 lie t4 turn | player | 25.6 | 2471 | 1325 |
| soft-anchor-direct-balance#2 argument t1 turn | player | 43.4 | 1806 | 816 |
| soft-anchor-direct-balance#2 argument t2 turn | player | 15.3 | 1992 | 785 |
| soft-anchor-direct-balance#2 argument t3 turn | player | 17.0 | 2142 | 885 |
| soft-anchor-direct-balance#2 argument t4 turn | player | 21.3 | 2288 | 793 |
| soft-anchor-direct-balance#2 praise t1 turn | player | 33.4 | 1780 | 1693 |
| soft-anchor-direct-balance#2 praise t2 turn | player | 43.8 | 2023 | 978 |
| soft-anchor-direct-balance#2 praise t3 turn | player | 20.3 | 2271 | 1055 |
| soft-anchor-direct-balance#2 praise t4 turn | player | 27.6 | 2515 | 1439 |
| soft-anchor-direct-balance#2 practical t1 turn | player | 19.4 | 1804 | 960 |
| soft-anchor-direct-balance#2 practical t2 turn | player | 12.9 | 1977 | 665 |
| soft-anchor-direct-balance#2 practical t3 turn | player | 14.8 | 2091 | 763 |
| soft-anchor-direct-balance#2 practical t4 turn | player | 33.9 | 2204 | 1784 |
| soft-anchor-direct-balance#2 personal t1 turn | player | 20.9 | 1781 | 1040 |
| soft-anchor-direct-balance#2 personal t2 turn | player | 18.0 | 2080 | 934 |
| soft-anchor-direct-balance#2 personal t3 turn | player | 32.6 | 2296 | 1718 |
| soft-anchor-direct-balance#2 personal t4 turn | player | 21.5 | 2438 | 1073 |
| baseline#1 smalltalk judge3 | judge | 12.1 | 934 | 487 |
| baseline#1 badnews judge3 | judge | 6.2 | 1367 | 953 |
| baseline#1 favour judge3 | judge | 4.6 | 970 | 634 |
| baseline#1 lie judge3 | judge | 6.5 | 1375 | 968 |
| baseline#1 argument judge3 | judge | 3.6 | 975 | 495 |
| baseline#1 praise judge3 | judge | 5.2 | 1350 | 808 |
| baseline#1 practical judge3 | judge | 3.0 | 852 | 400 |
| baseline#1 personal judge3 | judge | 5.9 | 1342 | 913 |
| baseline#2 smalltalk judge3 | judge | 2.6 | 868 | 316 |
| baseline#2 badnews judge3 | judge | 5.8 | 1502 | 908 |
| baseline#2 favour judge3 | judge | 4.4 | 966 | 614 |
| baseline#2 lie judge3 | judge | 6.6 | 1413 | 1027 |
| baseline#2 argument judge3 | judge | 4.6 | 978 | 631 |
| baseline#2 praise judge3 | judge | 5.1 | 1213 | 741 |
| baseline#2 practical judge3 | judge | 5.6 | 934 | 719 |
| baseline#2 personal judge3 | judge | 5.6 | 1271 | 833 |
| direct-questions#1 smalltalk judge3 | judge | 2.7 | 865 | 298 |
| direct-questions#1 badnews judge3 | judge | 4.3 | 1303 | 696 |
| direct-questions#1 favour judge3 | judge | 4.1 | 996 | 595 |
| direct-questions#1 lie judge3 | judge | 4.8 | 1204 | 684 |
| direct-questions#1 argument judge3 | judge | 4.6 | 943 | 639 |
| direct-questions#1 praise judge3 | judge | 6.2 | 1379 | 860 |
| direct-questions#1 practical judge3 | judge | 4.7 | 966 | 631 |
| direct-questions#1 personal judge3 | judge | 4.2 | 1165 | 572 |
| direct-questions#2 smalltalk judge3 | judge | 4.2 | 914 | 534 |
| direct-questions#2 badnews judge3 | judge | 6.3 | 1392 | 987 |
| direct-questions#2 favour judge3 | judge | 4.9 | 942 | 657 |
| direct-questions#2 lie judge3 | judge | 4.3 | 1185 | 607 |
| direct-questions#2 argument judge3 | judge | 4.4 | 979 | 626 |
| direct-questions#2 praise judge3 | judge | 6.5 | 1399 | 983 |
| direct-questions#2 practical judge3 | judge | 3.0 | 871 | 355 |
| direct-questions#2 personal judge3 | judge | 6.6 | 1389 | 1023 |
| soft-anchor-balance-rule#1 smalltalk judge3 | judge | 3.9 | 971 | 574 |
| soft-anchor-balance-rule#1 badnews judge3 | judge | 44.1 | 1209 | 680 |
| soft-anchor-balance-rule#1 favour judge3 | judge | 3.7 | 969 | 560 |
| soft-anchor-balance-rule#1 lie judge3 | judge | 5.3 | 1064 | 768 |
| soft-anchor-balance-rule#1 argument judge3 | judge | 5.6 | 1049 | 844 |
| soft-anchor-balance-rule#1 praise judge3 | judge | 6.4 | 1345 | 984 |
| soft-anchor-balance-rule#1 practical judge3 | judge | 2.5 | 855 | 332 |
| soft-anchor-balance-rule#1 personal judge3 | judge | 6.6 | 1285 | 1007 |
| soft-anchor-balance-rule#2 smalltalk judge3 | judge | 4.0 | 940 | 568 |
| soft-anchor-balance-rule#2 badnews judge3 | judge | 4.4 | 1257 | 674 |
| soft-anchor-balance-rule#2 favour judge3 | judge | 4.5 | 1007 | 646 |
| soft-anchor-balance-rule#2 lie judge3 | judge | 6.9 | 1364 | 1082 |
| soft-anchor-balance-rule#2 argument judge3 | judge | 48.7 | 956 | 554 |
| soft-anchor-balance-rule#2 praise judge3 | judge | 4.7 | 1214 | 685 |
| soft-anchor-balance-rule#2 practical judge3 | judge | 2.8 | 826 | 379 |
| soft-anchor-balance-rule#2 personal judge3 | judge | 6.0 | 1359 | 1022 |
| soft-anchor-direct-balance#1 smalltalk judge3 | judge | 3.0 | 871 | 405 |
| soft-anchor-direct-balance#1 badnews judge3 | judge | 4.9 | 1278 | 763 |
| soft-anchor-direct-balance#1 favour judge3 | judge | 3.3 | 954 | 499 |
| soft-anchor-direct-balance#1 lie judge3 | judge | 5.6 | 1245 | 853 |
| soft-anchor-direct-balance#1 argument judge3 | judge | 4.6 | 981 | 686 |
| soft-anchor-direct-balance#1 praise judge3 | judge | 6.0 | 1402 | 887 |
| soft-anchor-direct-balance#1 practical judge3 | judge | 3.8 | 932 | 552 |
| soft-anchor-direct-balance#1 personal judge3 | judge | 6.4 | 1448 | 1028 |
| soft-anchor-direct-balance#2 smalltalk judge3 | judge | 2.4 | 857 | 280 |
| soft-anchor-direct-balance#2 badnews judge3 | judge | 5.3 | 1372 | 830 |
| soft-anchor-direct-balance#2 favour judge3 | judge | 6.1 | 1080 | 900 |
| soft-anchor-direct-balance#2 lie judge3 | judge | 28.2 | 1364 | 1012 |
| soft-anchor-direct-balance#2 argument judge3 | judge | 4.0 | 957 | 560 |
| soft-anchor-direct-balance#2 praise judge3 | judge | 5.4 | 1314 | 846 |
| soft-anchor-direct-balance#2 practical judge3 | judge | 5.6 | 930 | 737 |
| soft-anchor-direct-balance#2 personal judge3 | judge | 56.4 | 1283 | 901 |
