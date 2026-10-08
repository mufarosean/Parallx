# Creations: dialogue bench

- Mode: LIVE, pass: all
- Player: gemma4:31b, judge: qwen3.8:27b, num_ctx 65536, samples 2
- Commit: 92e751ad
- Calls: 160 live, 0 from the cache
- Checks: 2 pass, 0 fail

Per 100 spoken lines. In brackets: the change from baseline. Lower is better for every fault; higher is better for "good". "anyFault" counts lines with any fault except flat.

| Condition | Lines | anyFault | abstract | metaphor | trivial | oblique | forced_wit | unnatural | flat | good | mechAbstract | simile |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | 154/154 | 68.2 | 3.2 | 19.5 | 7.1 | 24.7 | 3.9 | 29.9 | 8.4 | 29.9 | 0.6 | 1.3 |
| direct-questions | 145/145 | 57.2 (-10.9) | 1.4 (-1.9) | 16.6 (-2.9) | 12.4 (+5.3) | 17.2 (-7.4) | 2.1 (-1.8) | 18.6 (-11.2) | 4.1 (-4.3) | 41.4 (+11.5) | 0.0 (-0.6) | 1.4 (+0.1) |

```text
ollama ps before:
NAME                       ID              SIZE      PROCESSOR    CONTEXT    RUNNER      UNTIL               
qwen3.8:27b                22130167c4c2    18 GB     100% GPU     163840     llamacpp    21 minutes from now    
nomic-embed-text:latest    0a109f422b47    323 MB    100% GPU     2048       llamacpp    21 minutes from now

ollama ps after:
NAME           ID              SIZE     PROCESSOR    CONTEXT    RUNNER      UNTIL              
qwen3.8:27b    22130167c4c2    17 GB    100% GPU     65536      llamacpp    9 minutes from now
```

## Measures

| Section | Id | Measure | Value | Bar |
|---|---|---|---|---|
| Results | baseline.anyFault | lines with a fault, per 100 | 68.182 |  |
| Results | baseline.good | lines that sound like a person, per 100 | 29.87 |  |
| Results | direct-questions.anyFault | lines with a fault, per 100 | 57.241 |  |
| Results | direct-questions.good | lines that sound like a person, per 100 | 41.379 |  |

## Checks

### Wiring

| Id | Check | Result | Detail |
|---|---|---|---|
| baseline.rules | its rules are in the prompt | PASS |  |
| direct-questions.rules | its rules are in the prompt | PASS |  |

## Samples

### Worst lines: baseline: flagged lines

```text
[oblique] "Do you have a prescription or are you just early?"  (Deflects a simple greeting with a procedural question that ignores the social cue.)
[oblique] "Is that why you are wearing a scarf with a crest on it?"  (Answers a question about a match with a question about clothing; roundabout and evasive.)
[oblique, forced_wit] "Does the score change the price of your medication?"  (A non-sequitur that tries to be clever by connecting sports to pharmacy pricing; unnatural.)
[oblique, unnatural] "Is this a conversation about food, or do you have a script in your pocket?"  (Over-analyzes a casual question about breakfast; sounds like a therapy session or a script.)
[unnatural, flat] "Why are you still standing here?"  (Aggressive and abrupt without context; doesn't answer the question or fit a normal interaction.)
[oblique] "Is the bus running on time today?"  (Deflects a farewell with an unrelated logistical question; avoids the social moment.)
[trivial] "Selling... he sells the bricks."  (Dodge to a trivial detail (bricks) to avoid the emotional weight of the news.)
[unnatural] "My grandmother had a neighbor in Leeds. Mr. Gable. He had a shop for forty years, sold buttons and thread. One day a man in a suit came with a paper. Gable did not want to go. He stayed until the locks were changed from the outside."  (A long, polished anecdote about a neighbor in Leeds is too structured and literary for a spontaneous reaction.)
[metaphor] "A *shanda*... to sell a place that knows how to hold a door shut."  (Personifying the place as knowing how to hold a door shut is a poetic metaphor, not natural speech.)
[oblique] "Does the man in the suit have a name."  (Asking for the name of the 'man in the suit' (a generic archetype) is a roundabout way of asking who the buyer is.)
[flat] "March."  (Just repeating the word 'March' is empty and generic; it doesn't convey a specific reaction.)
[unnatural] "There was a man who came to my grandmother. He had a safe from the old country, rusted shut from the salt air. He waited three winters for the right tool to arrive from Germany. He said the wait made the gold inside feel heavier."  (Another long, polished story about a safe and gold is too elaborate and wise for a moment of shock.)
```

### Worst lines: direct-questions: flagged lines

```text
[oblique] "Did the world end, or did someone just lose a game? What do you want?"  (Roundabout question instead of just saying she didn't watch or doesn't care.)
[trivial] "Why are you asking? One coffee. One piece of toast. Do you have a script?"  (Repeating the trivial breakfast details to dodge the social cue is unnatural.)
[unnatural, flat] "My grandmother had a cousin in Leeds. He had a bakery. Small place, smelled of yeast and burnt sugar. One day a man in a suit comes and tells him the land is for a new road. The cousin spent three days sitting on his flour sacks. He did not move until the trucks arrived to pull the walls down."  (A long, polished anecdote about a cousin in Leeds is a 'little speech' that no real person would deliver in response to news about their own building; it feels like a literary device rather than speech.)
[trivial, oblique] "The landlord is *meshuggeneh*. This place has old bricks. They do not like to move."  (Focusing on the bricks 'not liking to move' is a trivial, personified dodge that avoids addressing the actual problem of the sale; it's an oblique non-answer.)
[unnatural, flat] "My bubbe had a clock. Big thing. Dark wood. It stopped every March. She told me the gears grew tired of the winter. She would wait until the first primrose appeared in the garden, then she would give it a wind. Only then would it start ticking again."  (Another long, polished anecdote about a clock and primroses is therapy-speak/literary narration, not how a locksmith would react to a deadline.)
[trivial, oblique] "The air is still cold. It is not March yet."  (Saying 'it is not March yet' is a trivial, logical dodge that ignores the urgency of the deadline; it's an oblique non-answer.)
[unnatural, flat] "There was a man. He had a safe. Heavy thing, cast iron, bolted to the floor of a basement in Leeds. He wanted to move it to a new house. He hired four men. They pulled. They pushed. They sweated until their shirts were soaked through. The safe did not move an inch. It liked the basement. It had decided that was where it belonged."  (A detailed story about a safe in Leeds is a 'little speech' that feels like a quote or a literary metaphor, not a real person's reaction to a question about their own shop.)
[unnatural, flat] "My uncle Mortie found a bird with a broken wing. He kept it in a shoebox for a month. He did not tell his wife because he thought the bird was a secret. But the bird grew. It started to scream. Then the whole house knew."  (A story about an uncle's bird in a shoebox is a polished, aphoristic anecdote that sounds like a fable, not a real person's response to a practical question.)
[oblique] "Did I ask about the fuel?"  (Deflects a direct yes/no question with a rhetorical counter-question; sounds evasive and unnatural.)
[oblique] "What time are the keys back on this counter? And who is driving?"  (Ignores the direct 'yes/no' question to restate conditions; sounds like a bureaucratic dodge rather than a natural response.)
[trivial] "The Crown. Yes."  (Repeating the location name to dodge the accusation is a deflection tactic, not a natural reaction.)
[unnatural] "The back door was sticking. Old oak, swollen from the rain. The landlord is a *shlemiel*. He locked himself out of the cellar. I was there for ten minutes. Just ten."  (The detailed excuse about the landlord and the oak door sounds like a rehearsed alibi, not spontaneous speech.)
```

## Calls

| Label | Role | Seconds | Prompt tok | Output tok |
|---|---|---|---|---|
| baseline#1 smalltalk t1 turn | player | 39.2 | 1712 | 990 |
| baseline#1 smalltalk t2 turn | player | 13.9 | 1936 | 704 |
| baseline#1 smalltalk t3 turn | player | 14.4 | 2102 | 724 |
| baseline#1 smalltalk t4 turn | player | 16.2 | 2262 | 822 |
| baseline#1 badnews t1 turn | player | 27.0 | 1674 | 1330 |
| baseline#1 badnews t2 turn | player | 22.7 | 2018 | 1152 |
| baseline#1 badnews t3 turn | player | 25.2 | 2253 | 1297 |
| baseline#1 badnews t4 turn | player | 21.5 | 2521 | 1111 |
| baseline#1 favour t1 turn | player | 16.1 | 1698 | 757 |
| baseline#1 favour t2 turn | player | 15.1 | 1898 | 776 |
| baseline#1 favour t3 turn | player | 16.4 | 2061 | 847 |
| baseline#1 favour t4 turn | player | 14.6 | 2214 | 748 |
| baseline#1 lie t1 turn | player | 18.5 | 1679 | 894 |
| baseline#1 lie t2 turn | player | 24.5 | 1983 | 1276 |
| baseline#1 lie t3 turn | player | 26.2 | 2266 | 1360 |
| baseline#1 lie t4 turn | player | 20.6 | 2450 | 1064 |
| baseline#1 argument t1 turn | player | 17.4 | 1700 | 820 |
| baseline#1 argument t2 turn | player | 21.9 | 1975 | 1136 |
| baseline#1 argument t3 turn | player | 17.3 | 2139 | 892 |
| baseline#1 argument t4 turn | player | 21.6 | 2320 | 1121 |
| baseline#1 praise t1 turn | player | 18.9 | 1674 | 912 |
| baseline#1 praise t2 turn | player | 23.0 | 1936 | 1185 |
| baseline#1 praise t3 turn | player | 31.1 | 2178 | 1608 |
| baseline#1 praise t4 turn | player | 22.4 | 2392 | 1104 |
| baseline#1 practical t1 turn | player | 21.7 | 1698 | 1055 |
| baseline#1 practical t2 turn | player | 16.9 | 1888 | 876 |
| baseline#1 practical t3 turn | player | 14.4 | 2056 | 741 |
| baseline#1 practical t4 turn | player | 57.2 | 2193 | 3002 |
| baseline#1 personal t1 turn | player | 18.5 | 1675 | 899 |
| baseline#1 personal t2 turn | player | 24.5 | 1998 | 1280 |
| baseline#1 personal t3 turn | player | 22.5 | 2204 | 1166 |
| baseline#1 personal t4 turn | player | 37.5 | 2420 | 1963 |
| baseline#2 smalltalk t1 turn | player | 14.7 | 1712 | 702 |
| baseline#2 smalltalk t2 turn | player | 13.6 | 1893 | 702 |
| baseline#2 smalltalk t3 turn | player | 10.6 | 2008 | 538 |
| baseline#2 smalltalk t4 turn | player | 16.5 | 2115 | 856 |
| baseline#2 badnews t1 turn | player | 19.7 | 1674 | 965 |
| baseline#2 badnews t2 turn | player | 21.3 | 2063 | 1107 |
| baseline#2 badnews t3 turn | player | 24.9 | 2357 | 1298 |
| baseline#2 badnews t4 turn | player | 18.8 | 2610 | 975 |
| baseline#2 favour t1 turn | player | 14.1 | 1698 | 663 |
| baseline#2 favour t2 turn | player | 17.1 | 1910 | 889 |
| baseline#2 favour t3 turn | player | 22.8 | 2067 | 1192 |
| baseline#2 favour t4 turn | player | 16.2 | 2198 | 837 |
| baseline#2 lie t1 turn | player | 20.9 | 1679 | 1010 |
| baseline#2 lie t2 turn | player | 18.3 | 1970 | 948 |
| baseline#2 lie t3 turn | player | 19.6 | 2216 | 1015 |
| baseline#2 lie t4 turn | player | 20.2 | 2448 | 1049 |
| baseline#2 argument t1 turn | player | 29.6 | 1700 | 1487 |
| baseline#2 argument t2 turn | player | 15.3 | 1895 | 741 |
| baseline#2 argument t3 turn | player | 16.5 | 2053 | 855 |
| baseline#2 argument t4 turn | player | 18.1 | 2166 | 939 |
| baseline#2 praise t1 turn | player | 20.9 | 1674 | 1010 |
| baseline#2 praise t2 turn | player | 24.3 | 1988 | 1275 |
| baseline#2 praise t3 turn | player | 23.3 | 2241 | 1141 |
| baseline#2 praise t4 turn | player | 20.0 | 2472 | 956 |
| baseline#2 practical t1 turn | player | 15.6 | 1698 | 717 |
| baseline#2 practical t2 turn | player | 16.4 | 1904 | 818 |
| baseline#2 practical t3 turn | player | 15.7 | 2078 | 775 |
| baseline#2 practical t4 turn | player | 18.6 | 2241 | 925 |
| baseline#2 personal t1 turn | player | 20.6 | 1675 | 955 |
| baseline#2 personal t2 turn | player | 27.9 | 1937 | 1376 |
| baseline#2 personal t3 turn | player | 19.8 | 2113 | 954 |
| baseline#2 personal t4 turn | player | 21.3 | 2312 | 1059 |
| direct-questions#1 smalltalk t1 turn | player | 15.0 | 1750 | 671 |
| direct-questions#1 smalltalk t2 turn | player | 13.1 | 1945 | 647 |
| direct-questions#1 smalltalk t3 turn | player | 31.7 | 2077 | 1596 |
| direct-questions#1 smalltalk t4 turn | player | 17.1 | 2181 | 810 |
| direct-questions#1 badnews t1 turn | player | 35.3 | 1712 | 1723 |
| direct-questions#1 badnews t2 turn | player | 29.1 | 2016 | 1429 |
| direct-questions#1 badnews t3 turn | player | 24.5 | 2218 | 1189 |
| direct-questions#1 badnews t4 turn | player | 19.1 | 2469 | 953 |
| direct-questions#1 favour t1 turn | player | 21.1 | 1736 | 988 |
| direct-questions#1 favour t2 turn | player | 31.2 | 1940 | 1560 |
| direct-questions#1 favour t3 turn | player | 16.7 | 2111 | 797 |
| direct-questions#1 favour t4 turn | player | 13.6 | 2211 | 667 |
| direct-questions#1 lie t1 turn | player | 26.1 | 1717 | 1257 |
| direct-questions#1 lie t2 turn | player | 20.0 | 1981 | 975 |
| direct-questions#1 lie t3 turn | player | 34.2 | 2185 | 1718 |
| direct-questions#1 lie t4 turn | player | 24.5 | 2369 | 1173 |
| direct-questions#1 argument t1 turn | player | 19.0 | 1738 | 875 |
| direct-questions#1 argument t2 turn | player | 14.6 | 1937 | 722 |
| direct-questions#1 argument t3 turn | player | 22.4 | 2098 | 1117 |
| direct-questions#1 argument t4 turn | player | 16.1 | 2202 | 798 |
| direct-questions#1 praise t1 turn | player | 29.0 | 1712 | 1407 |
| direct-questions#1 praise t2 turn | player | 19.1 | 1983 | 928 |
| direct-questions#1 praise t3 turn | player | 21.9 | 2201 | 1107 |
| direct-questions#1 praise t4 turn | player | 27.6 | 2478 | 1387 |
| direct-questions#1 practical t1 turn | player | 14.6 | 1736 | 669 |
| direct-questions#1 practical t2 turn | player | 15.5 | 1924 | 782 |
| direct-questions#1 practical t3 turn | player | 13.5 | 2069 | 672 |
| direct-questions#1 practical t4 turn | player | 16.4 | 2175 | 821 |
| direct-questions#1 personal t1 turn | player | 26.2 | 1713 | 1282 |
| direct-questions#1 personal t2 turn | player | 22.5 | 1971 | 1104 |
| direct-questions#1 personal t3 turn | player | 15.8 | 2174 | 794 |
| direct-questions#1 personal t4 turn | player | 34.5 | 2392 | 1743 |
| direct-questions#2 smalltalk t1 turn | player | 28.6 | 1750 | 1390 |
| direct-questions#2 smalltalk t2 turn | player | 13.5 | 1952 | 637 |
| direct-questions#2 smalltalk t3 turn | player | 16.8 | 2089 | 838 |
| direct-questions#2 smalltalk t4 turn | player | 46.3 | 2201 | 2350 |
| direct-questions#2 badnews t1 turn | player | 21.3 | 1712 | 999 |
| direct-questions#2 badnews t2 turn | player | 18.8 | 2019 | 949 |
| direct-questions#2 badnews t3 turn | player | 25.6 | 2238 | 1289 |
| direct-questions#2 badnews t4 turn | player | 33.1 | 2495 | 1670 |
| direct-questions#2 favour t1 turn | player | 28.8 | 1736 | 1407 |
| direct-questions#2 favour t2 turn | player | 13.7 | 1917 | 649 |
| direct-questions#2 favour t3 turn | player | 11.6 | 2038 | 574 |
| direct-questions#2 favour t4 turn | player | 13.5 | 2124 | 671 |
| direct-questions#2 lie t1 turn | player | 39.2 | 1717 | 1946 |
| direct-questions#2 lie t2 turn | player | 24.3 | 1948 | 1201 |
| direct-questions#2 lie t3 turn | player | 38.6 | 2142 | 1944 |
| direct-questions#2 lie t4 turn | player | 20.9 | 2318 | 995 |
| direct-questions#2 argument t1 turn | player | 23.1 | 1738 | 1090 |
| direct-questions#2 argument t2 turn | player | 15.5 | 1929 | 763 |
| direct-questions#2 argument t3 turn | player | 13.9 | 2056 | 695 |
| direct-questions#2 argument t4 turn | player | 16.5 | 2190 | 814 |
| direct-questions#2 praise t1 turn | player | 19.2 | 1712 | 888 |
| direct-questions#2 praise t2 turn | player | 19.2 | 2057 | 954 |
| direct-questions#2 praise t3 turn | player | 19.5 | 2331 | 964 |
| direct-questions#2 praise t4 turn | player | 32.9 | 2516 | 1645 |
| direct-questions#2 practical t1 turn | player | 15.6 | 1736 | 720 |
| direct-questions#2 practical t2 turn | player | 32.6 | 1951 | 1638 |
| direct-questions#2 practical t3 turn | player | 17.3 | 2110 | 820 |
| direct-questions#2 practical t4 turn | player | 13.4 | 2244 | 659 |
| direct-questions#2 personal t1 turn | player | 23.3 | 1713 | 1093 |
| direct-questions#2 personal t2 turn | player | 27.1 | 2017 | 1355 |
| direct-questions#2 personal t3 turn | player | 29.6 | 2257 | 1477 |
| direct-questions#2 personal t4 turn | player | 18.4 | 2477 | 937 |
| baseline#1 smalltalk judge | judge | 13.0 | 644 | 392 |
| baseline#1 badnews judge | judge | 4.9 | 1075 | 622 |
| baseline#1 favour judge | judge | 3.3 | 680 | 401 |
| baseline#1 lie judge | judge | 5.3 | 1083 | 748 |
| baseline#1 argument judge | judge | 3.7 | 685 | 454 |
| baseline#1 praise judge | judge | 5.6 | 1058 | 811 |
| baseline#1 practical judge | judge | 2.8 | 562 | 324 |
| baseline#1 personal judge | judge | 5.6 | 1050 | 808 |
| baseline#2 smalltalk judge | judge | 2.4 | 578 | 253 |
| baseline#2 badnews judge | judge | 4.7 | 1210 | 594 |
| baseline#2 favour judge | judge | 5.9 | 676 | 722 |
| baseline#2 lie judge | judge | 7.0 | 1121 | 994 |
| baseline#2 argument judge | judge | 3.8 | 688 | 488 |
| baseline#2 praise judge | judge | 4.0 | 921 | 521 |
| baseline#2 practical judge | judge | 3.9 | 644 | 479 |
| baseline#2 personal judge | judge | 4.5 | 979 | 662 |
| direct-questions#1 smalltalk judge | judge | 2.0 | 575 | 201 |
| direct-questions#1 badnews judge | judge | 4.6 | 1011 | 591 |
| direct-questions#1 favour judge | judge | 3.4 | 706 | 430 |
| direct-questions#1 lie judge | judge | 4.0 | 912 | 431 |
| direct-questions#1 argument judge | judge | 4.0 | 653 | 481 |
| direct-questions#1 praise judge | judge | 5.1 | 1087 | 698 |
| direct-questions#1 practical judge | judge | 4.3 | 676 | 518 |
| direct-questions#1 personal judge | judge | 3.0 | 873 | 338 |
| direct-questions#2 smalltalk judge | judge | 3.4 | 624 | 370 |
| direct-questions#2 badnews judge | judge | 5.8 | 1100 | 817 |
| direct-questions#2 favour judge | judge | 3.2 | 652 | 429 |
| direct-questions#2 lie judge | judge | 4.6 | 893 | 594 |
| direct-questions#2 argument judge | judge | 3.7 | 689 | 466 |
| direct-questions#2 praise judge | judge | 6.0 | 1107 | 825 |
| direct-questions#2 practical judge | judge | 2.7 | 581 | 285 |
| direct-questions#2 personal judge | judge | 3.3 | 1097 | 430 |
