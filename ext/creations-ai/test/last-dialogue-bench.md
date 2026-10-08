# Creations: dialogue bench

- Mode: LIVE, pass: all
- Player: gemma4:31b, judge: qwen3.8:27b, num_ctx 65536, samples 2
- Commit: 33352aa7
- Calls: 224 live, 256 from the cache
- Checks: 7 pass, 0 fail

Per 100 spoken lines. In brackets: the change from baseline. Lower is better for every fault; higher is better for "good". "anyFault" counts lines with any fault except flat.

| Condition | Lines | anyFault | abstract | metaphor | trivial | oblique | forced_wit | unnatural | flat | good | mechAbstract | simile |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | 154/154 | 47.4 | 3.9 | 22.1 | 0.6 | 18.8 | 2.6 | 11.0 | 1.3 | 51.3 | 0.6 | 1.3 |
| direct-questions | 145/145 | 39.3 (-8.1) | 1.4 (-2.5) | 14.5 (-7.6) | 3.4 (+2.8) | 15.2 (-3.7) | 1.4 (-1.2) | 11.0 (-0.0) | 0.7 (-0.6) | 60.0 (+8.7) | 0.0 (-0.6) | 1.4 (+0.1) |
| balance-rule | 151/151 | 49.0 (+1.6) | 1.3 (-2.6) | 18.5 (-3.5) | 6.0 (+5.3) | 17.9 (-1.0) | 2.0 (-0.6) | 13.2 (+2.2) | 0.7 (-0.6) | 50.3 (-1.0) | 0.0 (-0.6) | 4.0 (+2.7) |
| soft-anchor | 156/156 | 51.3 (+3.9) | 3.2 (-0.7) | 13.5 (-8.6) | 9.0 (+8.3) | 19.2 (+0.4) | 2.6 (-0.0) | 12.8 (+1.8) | 1.3 (-0.0) | 47.4 (-3.9) | 0.0 (-0.6) | 3.8 (+2.5) |
| identity-anchor | 146/146 | 50.7 (+3.3) | 3.4 (-0.5) | 15.8 (-6.3) | 6.2 (+5.5) | 19.9 (+1.0) | 4.1 (+1.5) | 8.9 (-2.1) | 2.7 (+1.4) | 46.6 (-4.7) | 0.0 (-0.6) | 4.8 (+3.5) |
| soft-anchor-balance-rule | 157/157 | 44.6 (-2.8) | 2.5 (-1.3) | 8.3 (-13.8) | 11.5 (+10.8) | 17.8 (-1.0) | 3.2 (+0.6) | 5.1 (-5.9) | 0.0 (-1.3) | 55.4 (+4.1) | 0.0 (-0.6) | 1.9 (+0.6) |

### Balance by character

Habit: share of lines showing a voice habit (judge; some of the time is right, nearly all is not). Ends in ?: share of lines that are questions. Long: lines over 35 words. Balance and recognisable: the judge, per scene, 1 to 5. Fault and good: per 100 lines.

| Condition | Character | Lines | Habit % | Ends in ? % | Long % | Balance | Recognisable | Fault % | Good % |
|---|---|---|---|---|---|---|---|---|---|
| baseline | Nora Vasquez | 56 | 91 | 96 | 0 | 3.3 | 4.1 | 45 | 55 |
| baseline | Ilan Brody | 98 | 64 | 0 | 22 | 2.9 | 3.8 | 49 | 49 |
| direct-questions | Nora Vasquez | 57 | 88 | 91 | 0 | 3.4 | 4.5 | 35 | 65 |
| direct-questions | Ilan Brody | 88 | 56 | 0 | 27 | 3.1 | 4.3 | 42 | 57 |
| balance-rule | Nora Vasquez | 54 | 83 | 85 | 0 | 2.8 | 4.1 | 50 | 50 |
| balance-rule | Ilan Brody | 97 | 61 | 0 | 27 | 3.0 | 4.1 | 48 | 51 |
| soft-anchor | Nora Vasquez | 60 | 82 | 80 | 0 | 3.0 | 3.9 | 50 | 50 |
| soft-anchor | Ilan Brody | 96 | 54 | 1 | 22 | 2.5 | 3.6 | 52 | 46 |
| identity-anchor | Nora Vasquez | 55 | 85 | 80 | 0 | 2.9 | 4.3 | 55 | 42 |
| identity-anchor | Ilan Brody | 91 | 46 | 1 | 18 | 2.8 | 3.9 | 48 | 49 |
| soft-anchor-balance-rule | Nora Vasquez | 62 | 90 | 85 | 0 | 3.0 | 4.3 | 55 | 45 |
| soft-anchor-balance-rule | Ilan Brody | 95 | 53 | 0 | 18 | 3.1 | 4.1 | 38 | 62 |

```text
ollama ps before:
NAME                       ID              SIZE      PROCESSOR    CONTEXT    RUNNER      UNTIL                   
gemma4:31b                 c6981e1e0c64    23 GB     100% GPU     65536      llamacpp    29 minutes from now        
nomic-embed-text:latest    0a109f422b47    323 MB    100% GPU     2048       llamacpp    About a minute from now

ollama ps after:
NAME           ID              SIZE     PROCESSOR    CONTEXT    RUNNER      UNTIL              
qwen3.8:27b    22130167c4c2    17 GB    100% GPU     65536      llamacpp    9 minutes from now
```

## Measures

| Section | Id | Measure | Value | Bar |
|---|---|---|---|---|
| Results | identity-anchor.empty | turns with no reply kept (the model answered nothing) | 1 |  |
| Results | baseline.anyFault | lines with a fault, per 100 | 47.403 |  |
| Results | baseline.good | lines that sound like a person, per 100 | 51.299 |  |
| Results | direct-questions.anyFault | lines with a fault, per 100 | 39.31 |  |
| Results | direct-questions.good | lines that sound like a person, per 100 | 60 |  |
| Results | balance-rule.anyFault | lines with a fault, per 100 | 49.007 |  |
| Results | balance-rule.good | lines that sound like a person, per 100 | 50.331 |  |
| Results | soft-anchor.anyFault | lines with a fault, per 100 | 51.282 |  |
| Results | soft-anchor.good | lines that sound like a person, per 100 | 47.436 |  |
| Results | identity-anchor.anyFault | lines with a fault, per 100 | 50.685 |  |
| Results | identity-anchor.good | lines that sound like a person, per 100 | 46.575 |  |
| Results | soft-anchor-balance-rule.anyFault | lines with a fault, per 100 | 44.586 |  |
| Results | soft-anchor-balance-rule.good | lines that sound like a person, per 100 | 55.414 |  |

## Checks

### Wiring

| Id | Check | Result | Detail |
|---|---|---|---|
| identity-anchor.anchor | the voice reminder carries no voice text | PASS |  |
| baseline.rules | its rules are in the prompt | PASS |  |
| direct-questions.rules | its rules are in the prompt | PASS |  |
| balance-rule.rules | its rules are in the prompt | PASS |  |
| soft-anchor.anchor | the softened voice reminder is in the prompt | PASS |  |
| soft-anchor-balance-rule.rules | its rules are in the prompt | PASS |  |
| soft-anchor-balance-rule.anchor | the softened voice reminder is in the prompt | PASS |  |

## Samples

### Results: Turns with no reply kept

```text
identity-anchor#2 badnews t3
```

### Worst lines: baseline: flagged lines

```text
[oblique] "Is that why you are wearing a scarf with a crest on it?"  (Roundabout question about a scarf instead of answering or engaging; feels like a dodge.)
[oblique, forced_wit] "Does the score change the price of your medication?"  (A non-sequitur question that doesn't answer the prompt; feels like a canned deflection.)
[oblique] "Is this a conversation about food, or do you have a script in your pocket?"  (Refuses to answer a simple question with a complex, suspicious counter-question.)
[oblique] "Why are you still standing here?"  (Aggressive deflection; asks why they are there instead of answering the breakfast question.)
[oblique] "Is the bus running on time today?"  (Changes the subject to the bus instead of acknowledging the departure; evasive.)
[oblique] "Selling... he sells the bricks."  (Deflects the news with a pedantic correction about bricks instead of reacting to the loss.)
[metaphor] "A *shanda*... to sell a place that knows how to hold a door shut."  (Personifying the place as knowing how to hold a door shut is too poetic/aphoristic for a blunt locksmith.)
[metaphor] "There was a man who came to my grandmother. He had a safe from the old country, rusted shut from the salt air. He waited three winters for the right tool to arrive from Germany. He said the wait made the gold inside feel heavier."  (The line 'wait made the gold inside feel heavier' is a sentimental metaphor that sounds like a quote, not a locksmith's thought.)
[oblique] "Is it a long March, or a short one."  (Asking if March is 'long or short' is a nonsensical, roundabout way to ask for the specific date or deadline.)
[metaphor] "It is *mishegas* to think a man can carry his walls. We see where the keys fit. We wait."  ('Carry his walls' is a cliché metaphor; 'We see where the keys fit' is a bit too aphoristic/polished.)
[metaphor] "Let the wind blow first. There is no rush to shout."  ('Let the wind blow first' is a poetic/aphoristic instruction that sounds like a proverb rather than a person talking.)
[oblique] "Saturday. It is Tuesday. Why are you thinking about Saturday?"  (Asking why someone is thinking about a future date is a roundabout way of refusing or stalling; a real person would just say no or ask for details.)
```

### Worst lines: direct-questions: flagged lines

```text
[trivial] "The air is still cold. It is not March yet."  (Fixating on the weather to dodge the reality of the deadline is a classic avoidance tactic that feels like a dodge rather than a genuine thought.)
[oblique] "Did I ask about the fuel?"  (Roundabout non-answer to a yes/no question; feels like a dodge rather than a natural deflection.)
[trivial] "The back door was sticking. Old oak, swollen from the rain. The landlord is a *shlemiel*. He locked himself out of the cellar. I was there for ten minutes. Just ten."  (Fixates on the door mechanism to dodge the lie; 'shlemiel' fits voice.)
[unnatural] "Lie is a heavy word. My sister... she is *meshuggeneh* about the hours I work."  ('Lie is a heavy word' is too polished/abstract for a locksmith; 'meshuggeneh' fits.)
[metaphor] "My grandmother had a box. She kept everything in it. Keys, letters, old coins. She would *kvetch* if someone touched the lid, even if they just wanted to see the wood."  (Grandmother's box story is a classic deflection metaphor; 'kvetch' fits.)
[abstract, unnatural] "Sometimes the lid stays closed because the things inside are just... things. Not worth the noise of talking about them."  (Turns the metaphor into a philosophical statement about 'noise of talking'; too wise.)
[oblique] "This one came in yesterday. Rusted shut for twenty years. The man who brought it in, he was full of *mishegas*, thinking it was a miracle."  (Deflects the 'are we good' question with a random story about a lock; 'mishegas' fits.)
[metaphor] "I put a drop of oil in the heart of it. One drop. It opened. The things inside were just old letters. Yellow paper."  (Continues the lock metaphor to answer the relationship question; 'heart of it' is poetic.)
[trivial] "The caretaker... he is a loud man,"  (Dodges the compliment by commenting on the caretaker's volume, which is irrelevant to the skill.)
[metaphor] "My grandmother, she had a cabinet in Leeds. Heavy oak. The lock froze one January. The frost was inside the keyhole. The neighbors wanted to break the wood. She told them to wait. She put a warm cloth over the iron. She whispered to it. When the metal warmed, the bolt slid back like butter."  ('Like butter' is a cliché simile; the rest is a good story, but the simile breaks the 'real person' rule.)
[metaphor, unnatural] "She would make me sit for hours. Just listening. She told me the metal speaks. If you push too hard, the lock closes its heart to you. I spent a whole summer just learning how to feel the pins move. I did not get a sweet until I could open a Yale with my eyes shut."  ('Closes its heart' is personification/metaphor; 'metal speaks' is aphoristic; sounds like a written quote, not spoken dialogue.)
[abstract] "Money is... a strange thing,"  (Talks about 'money' as an abstract concept instead of the specific fee or the concrete situation.)
```

### Worst lines: balance-rule: flagged lines

```text
[oblique] "Who is calling you this early?"  (Asks a question instead of answering, but 'Who is calling you' is nonsensical since Sam is physically present.)
[oblique] "Are you here for the blood pressure meds or just to talk?"  (Deflects a simple social question with a work-related query; feels like a dodge rather than a natural interaction.)
[oblique] "Do you think I have time to eat?"  (Rhetorical question that dodges the specific question about breakfast; sounds defensive and unnatural for a casual chat.)
[metaphor] "It is a shanda. A man should have a place where the dust knows his name."  ('Dust knows his name' is a poetic line, not how a locksmith talks.)
[metaphor] "This is total mishegas. I will go see Nora. She has a way of making the air feel less heavy."  ('Making the air feel less heavy' is abstract/therapeutic phrasing.)
[oblique] "Seven, eight, nine. Where are you going that requires a car?"  (Counting 7-9 is nonsensical without context; dodges the direct question.)
[oblique] "Six. Seven."  (Counting 6-7 is a non-sequitur that doesn't answer the yes/no question.)
[trivial] "The cellar door there. It is an old thing. It screams when the wind blows from the east."  (Dodges the lie by focusing on the door's noise; classic deflection.)
[trivial] "I was just... checking the bolt. To see if it had finally seized. A man cannot leave a screaming lock alone, meshuggeneh as it is."  (Continues the deflection with a specific mechanical detail to avoid the accusation.)
[oblique] "The road to my sister's is long,"  (Answers 'why lie' with a fact about distance; roundabout and evasive.)
[unnatural] "It takes me past the Crown. Sometimes the van... it just stops. The engine sighs and it wants to rest."  (Personifying the engine as sighing is too poetic for a stressed locksmith.)
[unnatural] "There was a man in Leeds, years ago. He swore his door was locked, but he kept finding his tea gone. He called it a ghost. It was just a loose latch, a little bit of mishegas in the wood. He did not want to believe the house was simply shifting."  (Telling a long anecdote about a ghost/tea in Leeds is a very specific, polished deflection.)
```

### Worst lines: soft-anchor: flagged lines

```text
[metaphor] "Do you have your umbrella? The clouds look like they are about to burst."  ('Clouds look like they are about to burst' is a cliché/simile that feels slightly literary for a clipped pharmacist; 'It's going to rain' is more natural.)
[abstract, metaphor] "My grandmother had a shop in Leeds. The door was oak. Thick. When the new man came to buy the street, he tried to tell her the oak was rotting. He wanted to put in plastic. She told him the wood remembers the people who walked through it. She stayed until the day she died."  ('Wood remembers people' is a poetic metaphor/abstract idea, not how a locksmith talks about a door.)
[oblique] "What do I want."  (Echoing the question back is a deflection that sounds like a script device, not a real person's hesitation.)
[abstract, metaphor] "My grandmother had a clock. A big grandfather clock. When they moved from the old house, she told the movers to leave it. She said the clock belonged to the walls. She did not want to carry the time to a new place."  ('Carry the time' is abstract/metaphorical. A real person would say she didn't want to move the clock.)
[metaphor] "The locks in this building are old. They need a soft hand."  ('Soft hand' is a metaphor for care/patience. A locksmith would say 'they're tricky' or 'need oil'.)
[metaphor, unnatural] "There was a man in the market once. He knew the fish were spoiled before the ice melted. He did not say a word. He just watched the people buy the trout. He said the truth is like a heavy stone... some people are not strong enough to carry it."  ('Truth is like a heavy stone' is a cliché aphorism. No real person says this in a casual conversation.)
[unnatural] "You tell them. I am not a man for the news."  ('I am not a man for the news' is a polished, literary self-description. A real person would say 'You tell them' or 'I can't do it'.)
[oblique] "Saturday? Who told you I was not driving to the coast?"  (Deflects a simple request with a rhetorical question that doesn't answer it.)
[oblique] "Full tank? Since when do you pay for anything before you use it?"  (Turns a promise into a character judgment question; roundabout.)
[oblique] "Why would I say yes before I know if the car is even big enough for a wardrobe?"  (Avoids answering 'yes/no' with a hypothetical question.)
[metaphor] "I stopped. Just for a minute. The back door there, it has a latch that fights the wind. It was rattling. I could not just drive past it while it was screaming. *Nu*, I gave it a turn, made it quiet, then I went to my sister's. She had the kugel."  (Personifying the door as 'screaming' is a poetic metaphor a locksmith wouldn't use to explain a quick stop; the rest is a plausible story.)
[unnatural] "My grandmother had a clock. Big thing, mahogany, stood in the corner like a soldier. It lost five minutes every day. Five minutes. She never changed the hands. When someone asked the time, she told them what the clock said. She did not think it was a lie. She just thought the clock lived in a different world."  (The story is too polished and aphoristic ('lived in a different world') for a casual conversation; it sounds like a written fable.)
```

### Worst lines: identity-anchor: flagged lines

```text
[abstract] "My grandmother had a shop in Leeds. The doors were oak, very thick. She told me once that a building is just a shell. The things inside... those are what stay."  (Treats 'building' and 'things inside' as abstract concepts rather than concrete reality; sounds like a quote.)
[oblique] "Does he have a name, this man who buys. Someone who knows how to keep a boiler from leaking."  (Asking about the buyer's plumbing skills is a roundabout, nonsensical way to ask who the buyer is or if they are competent.)
[metaphor] "My bubbe used to say that the wind in March is a thief. It takes the warmth from your bones and the paint from the window frames. We spent a whole week scrubbing the sills in Leeds, just to keep the rain out."  ('Wind is a thief' is a cliché/proverb; sounds like a mug slogan rather than a locksmith's thought.)
[unnatural] "My grandmother once spent three days trying to open a chest that had no keyhole. She did not use a tool. She just listened to the wood, waiting for it to tell her where the catch was hidden."  (Story is overly polished and mystical ('listened to the wood'); feels like a fable, not a real memory.)
[unnatural] "My uncle Mortie once had to tell the neighborhood the bakery was closing. He did not speak. He just put a sign in the window and went to sleep for two days."  (Uncle sleeping for two days is melodramatic and unrealistic; story feels invented to fit the 'storyteller' habit.)
[trivial] "You didn't say where she is moving. Does she have a lot of furniture?"  (Ignores the promise about the tank to fixate on furniture; feels like a dodge.)
[oblique] "The Crown. ... Yes. I stopped. ... To see a man about a key. A very old key. From the thirties. My sister... she knows the man. We spoke. All of us."  (Dodges the direct contradiction with a vague story about a key; 'oblique' evasion.)
[trivial, metaphor] "The rain was coming down. I could not leave the van in the street. The wardens... they are like vultures."  (Fixates on wardens to dodge the lie; 'vultures' is a cliché metaphor.)
[metaphor, unnatural] "Lie... that is a heavy word. Like a rusted bolt. You force it, you snap the head off."  (Comparing the word 'lie' to a rusted bolt is overly poetic and unnatural for a quick retort.)
[metaphor] "My sister... she has a heart like a bird. If she thinks I am in the pub, she spends the whole day in a state. *Oy*. It is easier to say the house. The house is quiet."  ('Heart like a bird' is a poetic metaphor; otherwise fits the Yiddish/storytelling voice.)
[trivial] "Nu. You ask like the police. A man goes to the Crown, he has a drink. The glass is cold. The beer is bitter. Then he goes home."  (Fixates on the temperature of the glass and taste of beer to avoid answering the emotional question.)
[oblique] "This one here. Took three days. The tumblers were stubborn. They did not want to tell me their secret. I had to be patient. I waited. I listened."  (Tells a story about a lock instead of answering 'I am not angry'; classic oblique evasion.)
```

### Worst lines: soft-anchor-balance-rule: flagged lines

```text
[oblique] "Is the delivery truck already at the back door?"  (Dodges the question about her night with a work query.)
[oblique] "Who won?"  (Asks instead of answering; deflects.)
[oblique] "Was it a blowout or did it actually go to overtime?"  (Asks instead of answering; deflects.)
[oblique] "Do you think the cafe on the corner still has those cinnamon rolls?"  (Asks instead of answering; deflects.)
[oblique] "Or are you planning on eating a protein bar in the car?"  (Asks instead of answering; deflects.)
[oblique] "Did you check the temperature on the vaccine fridge?"  (Asks instead of answering; deflects.)
[oblique] "Who is coming in at eight-fifteen?"  (Asks instead of answering; deflects.)
[metaphor] "It is a long walk to March. Too many days to think about where to put the tools."  ('Long walk to March' is a cliché metaphor; a locksmith would likely talk about the physical distance or the specific tasks, not a poetic journey.)
[unnatural] "My grandmother had a box for her needles. She carried it every time she moved. Small, cedar wood. It smelled of old forests and dust. She told me the needles knew where they belonged, even if the house changed."  ('Smelled of old forests' is too poetic/polished for a real person speaking in the moment; sounds like a novel description rather than speech.)
[oblique] "Does your mother have a lot of plants?"  (Dodges the yes/no question with an irrelevant query about plants; feels like a deflection rather than a natural conversational beat.)
[oblique] "The Crown has a cellar door,"  (Deflects a direct accusation with a non-sequitur about a cellar door; doesn't answer the question.)
[unnatural] "Old iron. Rusted shut since the war, maybe. Landlord thinks it is a ghost. I had to shlep my bag from the van just to see if the bolt was actually thrown."  (The story is too elaborate and polished for a quick excuse; 'shlep' fits voice but the narrative feels constructed.)
```

## Calls

| Label | Role | Seconds | Prompt tok | Output tok |
|---|---|---|---|---|
| soft-anchor#1 smalltalk t1 turn | player | 13.8 | 1726 | 647 |
| soft-anchor#1 smalltalk t2 turn | player | 17.7 | 1963 | 939 |
| soft-anchor#1 smalltalk t3 turn | player | 16.4 | 2145 | 851 |
| soft-anchor#1 smalltalk t4 turn | player | 14.1 | 2276 | 752 |
| soft-anchor#1 badnews t1 turn | player | 20.4 | 1688 | 1031 |
| soft-anchor#1 badnews t2 turn | player | 56.7 | 1958 | 990 |
| soft-anchor#1 badnews t3 turn | player | 45.5 | 2153 | 2033 |
| soft-anchor#1 badnews t4 turn | player | 31.8 | 2377 | 1683 |
| soft-anchor#1 favour t1 turn | player | 16.8 | 1712 | 842 |
| soft-anchor#1 favour t2 turn | player | 17.4 | 1933 | 939 |
| soft-anchor#1 favour t3 turn | player | 18.6 | 2112 | 1000 |
| soft-anchor#1 favour t4 turn | player | 14.2 | 2253 | 757 |
| soft-anchor#1 lie t1 turn | player | 34.7 | 1693 | 1403 |
| soft-anchor#1 lie t2 turn | player | 17.4 | 1923 | 901 |
| soft-anchor#1 lie t3 turn | player | 24.6 | 2185 | 1325 |
| soft-anchor#1 lie t4 turn | player | 22.2 | 2439 | 1186 |
| soft-anchor#1 argument t1 turn | player | 19.2 | 1714 | 952 |
| soft-anchor#1 argument t2 turn | player | 14.3 | 1884 | 757 |
| soft-anchor#1 argument t3 turn | player | 16.7 | 2067 | 891 |
| soft-anchor#1 argument t4 turn | player | 16.0 | 2210 | 853 |
| soft-anchor#1 praise t1 turn | player | 59.3 | 1688 | 1056 |
| soft-anchor#1 praise t2 turn | player | 20.3 | 1979 | 1096 |
| soft-anchor#1 praise t3 turn | player | 20.0 | 2261 | 1074 |
| soft-anchor#1 praise t4 turn | player | 16.4 | 2470 | 877 |
| soft-anchor#1 practical t1 turn | player | 13.1 | 1712 | 645 |
| soft-anchor#1 practical t2 turn | player | 18.1 | 1934 | 972 |
| soft-anchor#1 practical t3 turn | player | 16.7 | 2102 | 897 |
| soft-anchor#1 practical t4 turn | player | 12.9 | 2245 | 685 |
| soft-anchor#1 personal t1 turn | player | 19.2 | 1689 | 959 |
| soft-anchor#1 personal t2 turn | player | 23.4 | 2056 | 1261 |
| soft-anchor#1 personal t3 turn | player | 23.6 | 2301 | 1261 |
| soft-anchor#1 personal t4 turn | player | 63.0 | 2526 | 1085 |
| soft-anchor#2 smalltalk t1 turn | player | 17.5 | 1726 | 873 |
| soft-anchor#2 smalltalk t2 turn | player | 13.8 | 1978 | 736 |
| soft-anchor#2 smalltalk t3 turn | player | 14.4 | 2128 | 768 |
| soft-anchor#2 smalltalk t4 turn | player | 15.0 | 2272 | 800 |
| soft-anchor#2 badnews t1 turn | player | 21.1 | 1688 | 1091 |
| soft-anchor#2 badnews t2 turn | player | 18.7 | 2064 | 973 |
| soft-anchor#2 badnews t3 turn | player | 20.9 | 2344 | 1127 |
| soft-anchor#2 badnews t4 turn | player | 20.5 | 2580 | 1099 |
| soft-anchor#2 favour t1 turn | player | 18.0 | 1712 | 909 |
| soft-anchor#2 favour t2 turn | player | 23.1 | 1914 | 787 |
| soft-anchor#2 favour t3 turn | player | 14.9 | 2064 | 793 |
| soft-anchor#2 favour t4 turn | player | 14.5 | 2222 | 772 |
| soft-anchor#2 lie t1 turn | player | 25.2 | 1693 | 1304 |
| soft-anchor#2 lie t2 turn | player | 21.3 | 1915 | 1116 |
| soft-anchor#2 lie t3 turn | player | 30.2 | 2123 | 1627 |
| soft-anchor#2 lie t4 turn | player | 32.7 | 2379 | 1719 |
| soft-anchor#2 argument t1 turn | player | 55.8 | 1714 | 800 |
| soft-anchor#2 argument t2 turn | player | 17.0 | 1938 | 885 |
| soft-anchor#2 argument t3 turn | player | 18.6 | 2103 | 964 |
| soft-anchor#2 argument t4 turn | player | 18.0 | 2228 | 939 |
| soft-anchor#2 praise t1 turn | player | 19.3 | 1688 | 948 |
| soft-anchor#2 praise t2 turn | player | 21.1 | 2021 | 1101 |
| soft-anchor#2 praise t3 turn | player | 18.6 | 2327 | 952 |
| soft-anchor#2 praise t4 turn | player | 27.0 | 2519 | 1410 |
| soft-anchor#2 practical t1 turn | player | 56.8 | 1712 | 822 |
| soft-anchor#2 practical t2 turn | player | 42.3 | 1929 | 2228 |
| soft-anchor#2 practical t3 turn | player | 23.9 | 2064 | 771 |
| soft-anchor#2 practical t4 turn | player | 13.1 | 2209 | 673 |
| soft-anchor#2 personal t1 turn | player | 17.4 | 1689 | 841 |
| soft-anchor#2 personal t2 turn | player | 57.1 | 1991 | 1189 |
| soft-anchor#2 personal t3 turn | player | 16.0 | 2211 | 818 |
| soft-anchor#2 personal t4 turn | player | 85.4 | 2383 | 1129 |
| soft-anchor-balance-rule#1 smalltalk t1 turn | player | 26.4 | 1780 | 909 |
| soft-anchor-balance-rule#1 smalltalk t2 turn | player | 13.8 | 2004 | 710 |
| soft-anchor-balance-rule#1 smalltalk t3 turn | player | 13.7 | 2154 | 709 |
| soft-anchor-balance-rule#1 smalltalk t4 turn | player | 13.9 | 2291 | 715 |
| soft-anchor-balance-rule#1 badnews t1 turn | player | 20.6 | 1742 | 1009 |
| soft-anchor-balance-rule#1 badnews t2 turn | player | 25.1 | 2015 | 1315 |
| soft-anchor-balance-rule#1 badnews t3 turn | player | 18.2 | 2245 | 912 |
| soft-anchor-balance-rule#1 badnews t4 turn | player | 18.1 | 2449 | 942 |
| soft-anchor-balance-rule#1 favour t1 turn | player | 15.7 | 1766 | 760 |
| soft-anchor-balance-rule#1 favour t2 turn | player | 13.0 | 1962 | 670 |
| soft-anchor-balance-rule#1 favour t3 turn | player | 28.1 | 2106 | 1472 |
| soft-anchor-balance-rule#1 favour t4 turn | player | 14.0 | 2231 | 683 |
| soft-anchor-balance-rule#1 lie t1 turn | player | 33.9 | 1747 | 1726 |
| soft-anchor-balance-rule#1 lie t2 turn | player | 17.5 | 1979 | 868 |
| soft-anchor-balance-rule#1 lie t3 turn | player | 17.3 | 2163 | 899 |
| soft-anchor-balance-rule#1 lie t4 turn | player | 69.5 | 2346 | 1159 |
| soft-anchor-balance-rule#1 argument t1 turn | player | 28.7 | 1768 | 1440 |
| soft-anchor-balance-rule#1 argument t2 turn | player | 15.2 | 1952 | 763 |
| soft-anchor-balance-rule#1 argument t3 turn | player | 13.9 | 2115 | 718 |
| soft-anchor-balance-rule#1 argument t4 turn | player | 22.8 | 2283 | 1192 |
| soft-anchor-balance-rule#1 praise t1 turn | player | 38.4 | 1742 | 1968 |
| soft-anchor-balance-rule#1 praise t2 turn | player | 60.8 | 1998 | 784 |
| soft-anchor-balance-rule#1 praise t3 turn | player | 50.0 | 2302 | 1016 |
| soft-anchor-balance-rule#1 praise t4 turn | player | 24.4 | 2521 | 1271 |
| soft-anchor-balance-rule#1 practical t1 turn | player | 48.1 | 1766 | 855 |
| soft-anchor-balance-rule#1 practical t2 turn | player | 16.7 | 1935 | 863 |
| soft-anchor-balance-rule#1 practical t3 turn | player | 18.8 | 2080 | 979 |
| soft-anchor-balance-rule#1 practical t4 turn | player | 16.2 | 2187 | 835 |
| soft-anchor-balance-rule#1 personal t1 turn | player | 31.7 | 1743 | 1176 |
| soft-anchor-balance-rule#1 personal t2 turn | player | 17.1 | 1992 | 862 |
| soft-anchor-balance-rule#1 personal t3 turn | player | 33.9 | 2180 | 1762 |
| soft-anchor-balance-rule#1 personal t4 turn | player | 46.7 | 2361 | 2019 |
| soft-anchor-balance-rule#2 smalltalk t1 turn | player | 19.0 | 1780 | 931 |
| soft-anchor-balance-rule#2 smalltalk t2 turn | player | 56.5 | 1994 | 736 |
| soft-anchor-balance-rule#2 smalltalk t3 turn | player | 13.9 | 2113 | 719 |
| soft-anchor-balance-rule#2 smalltalk t4 turn | player | 15.9 | 2226 | 828 |
| soft-anchor-balance-rule#2 badnews t1 turn | player | 16.3 | 1742 | 787 |
| soft-anchor-balance-rule#2 badnews t2 turn | player | 19.6 | 2041 | 1004 |
| soft-anchor-balance-rule#2 badnews t3 turn | player | 25.7 | 2294 | 1318 |
| soft-anchor-balance-rule#2 badnews t4 turn | player | 21.5 | 2502 | 1119 |
| soft-anchor-balance-rule#2 favour t1 turn | player | 17.4 | 1766 | 841 |
| soft-anchor-balance-rule#2 favour t2 turn | player | 16.3 | 1938 | 802 |
| soft-anchor-balance-rule#2 favour t3 turn | player | 16.2 | 2073 | 798 |
| soft-anchor-balance-rule#2 favour t4 turn | player | 14.0 | 2200 | 723 |
| soft-anchor-balance-rule#2 lie t1 turn | player | 25.4 | 1747 | 1304 |
| soft-anchor-balance-rule#2 lie t2 turn | player | 32.4 | 2019 | 1704 |
| soft-anchor-balance-rule#2 lie t3 turn | player | 20.8 | 2227 | 1008 |
| soft-anchor-balance-rule#2 lie t4 turn | player | 27.6 | 2432 | 1385 |
| soft-anchor-balance-rule#2 argument t1 turn | player | 17.1 | 1768 | 773 |
| soft-anchor-balance-rule#2 argument t2 turn | player | 20.9 | 1988 | 1038 |
| soft-anchor-balance-rule#2 argument t3 turn | player | 15.8 | 2148 | 780 |
| soft-anchor-balance-rule#2 argument t4 turn | player | 17.7 | 2299 | 873 |
| soft-anchor-balance-rule#2 praise t1 turn | player | 20.6 | 1742 | 976 |
| soft-anchor-balance-rule#2 praise t2 turn | player | 17.2 | 2044 | 849 |
| soft-anchor-balance-rule#2 praise t3 turn | player | 25.1 | 2322 | 1245 |
| soft-anchor-balance-rule#2 praise t4 turn | player | 27.7 | 2602 | 1379 |
| soft-anchor-balance-rule#2 practical t1 turn | player | 20.1 | 1766 | 972 |
| soft-anchor-balance-rule#2 practical t2 turn | player | 19.1 | 1966 | 968 |
| soft-anchor-balance-rule#2 practical t3 turn | player | 13.4 | 2112 | 657 |
| soft-anchor-balance-rule#2 practical t4 turn | player | 15.4 | 2203 | 757 |
| soft-anchor-balance-rule#2 personal t1 turn | player | 25.0 | 1743 | 1202 |
| soft-anchor-balance-rule#2 personal t2 turn | player | 43.2 | 2026 | 2119 |
| soft-anchor-balance-rule#2 personal t3 turn | player | 37.7 | 2250 | 1864 |
| soft-anchor-balance-rule#2 personal t4 turn | player | 22.3 | 2469 | 1108 |
| identity-anchor#1 smalltalk judge2 | judge | 19.3 | 765 | 258 |
| identity-anchor#1 badnews judge2 | judge | 36.1 | 1082 | 643 |
| identity-anchor#1 favour judge2 | judge | 23.5 | 748 | 266 |
| identity-anchor#1 lie judge2 | judge | 31.0 | 1064 | 626 |
| identity-anchor#1 argument judge2 | judge | 44.7 | 847 | 543 |
| identity-anchor#1 praise judge2 | judge | 6.9 | 1270 | 1065 |
| identity-anchor#1 practical judge2 | judge | 2.3 | 729 | 300 |
| identity-anchor#1 personal judge2 | judge | 5.2 | 1214 | 762 |
| identity-anchor#2 smalltalk judge2 | judge | 2.7 | 872 | 387 |
| identity-anchor#2 badnews judge2 | judge | 4.7 | 1053 | 640 |
| identity-anchor#2 favour judge2 | judge | 4.2 | 910 | 555 |
| identity-anchor#2 lie judge2 | judge | 4.9 | 1151 | 697 |
| identity-anchor#2 argument judge2 | judge | 4.6 | 872 | 586 |
| identity-anchor#2 praise judge2 | judge | 5.7 | 1238 | 847 |
| identity-anchor#2 practical judge2 | judge | 5.6 | 941 | 768 |
| identity-anchor#2 personal judge2 | judge | 6.4 | 1246 | 902 |
| baseline#1 smalltalk judge2 | judge | 3.6 | 835 | 473 |
| baseline#1 badnews judge2 | judge | 6.6 | 1268 | 912 |
| baseline#1 favour judge2 | judge | 4.8 | 871 | 580 |
| baseline#1 lie judge2 | judge | 6.3 | 1276 | 914 |
| baseline#1 argument judge2 | judge | 3.4 | 876 | 428 |
| baseline#1 praise judge2 | judge | 5.4 | 1251 | 814 |
| baseline#1 practical judge2 | judge | 3.0 | 753 | 365 |
| baseline#1 personal judge2 | judge | 5.5 | 1243 | 833 |
| baseline#2 smalltalk judge2 | judge | 2.7 | 769 | 303 |
| baseline#2 badnews judge2 | judge | 5.9 | 1403 | 863 |
| baseline#2 favour judge2 | judge | 6.2 | 867 | 766 |
| baseline#2 lie judge2 | judge | 6.4 | 1314 | 968 |
| baseline#2 argument judge2 | judge | 3.9 | 879 | 527 |
| baseline#2 praise judge2 | judge | 4.8 | 1114 | 690 |
| baseline#2 practical judge2 | judge | 5.0 | 835 | 614 |
| baseline#2 personal judge2 | judge | 5.1 | 1172 | 769 |
| direct-questions#1 smalltalk judge2 | judge | 2.4 | 766 | 255 |
| direct-questions#1 badnews judge2 | judge | 4.6 | 1204 | 671 |
| direct-questions#1 favour judge2 | judge | 3.4 | 897 | 508 |
| direct-questions#1 lie judge2 | judge | 4.6 | 1105 | 631 |
| direct-questions#1 argument judge2 | judge | 3.3 | 844 | 418 |
| direct-questions#1 praise judge2 | judge | 5.5 | 1280 | 803 |
| direct-questions#1 practical judge2 | judge | 4.9 | 867 | 635 |
| direct-questions#1 personal judge2 | judge | 4.4 | 1066 | 552 |
| direct-questions#2 smalltalk judge2 | judge | 3.2 | 815 | 430 |
| direct-questions#2 badnews judge2 | judge | 5.6 | 1293 | 844 |
| direct-questions#2 favour judge2 | judge | 4.7 | 843 | 598 |
| direct-questions#2 lie judge2 | judge | 4.6 | 1086 | 615 |
| direct-questions#2 argument judge2 | judge | 4.1 | 880 | 576 |
| direct-questions#2 praise judge2 | judge | 5.7 | 1300 | 817 |
| direct-questions#2 practical judge2 | judge | 2.9 | 772 | 334 |
| direct-questions#2 personal judge2 | judge | 5.8 | 1290 | 845 |
| balance-rule#1 smalltalk judge2 | judge | 3.8 | 806 | 482 |
| balance-rule#1 badnews judge2 | judge | 5.3 | 1331 | 765 |
| balance-rule#1 favour judge2 | judge | 3.2 | 826 | 430 |
| balance-rule#1 lie judge2 | judge | 5.0 | 1171 | 693 |
| balance-rule#1 argument judge2 | judge | 4.3 | 854 | 567 |
| balance-rule#1 praise judge2 | judge | 5.4 | 1240 | 768 |
| balance-rule#1 practical judge2 | judge | 5.4 | 849 | 730 |
| balance-rule#1 personal judge2 | judge | 6.3 | 1301 | 961 |
| balance-rule#2 smalltalk judge2 | judge | 2.4 | 760 | 248 |
| balance-rule#2 badnews judge2 | judge | 4.6 | 1231 | 703 |
| balance-rule#2 favour judge2 | judge | 2.1 | 762 | 246 |
| balance-rule#2 lie judge2 | judge | 4.9 | 1181 | 718 |
| balance-rule#2 argument judge2 | judge | 5.6 | 941 | 796 |
| balance-rule#2 praise judge2 | judge | 6.1 | 1238 | 884 |
| balance-rule#2 practical judge2 | judge | 2.6 | 747 | 309 |
| balance-rule#2 personal judge2 | judge | 5.7 | 1255 | 842 |
| soft-anchor#1 smalltalk judge2 | judge | 2.4 | 770 | 279 |
| soft-anchor#1 badnews judge2 | judge | 5.2 | 1159 | 786 |
| soft-anchor#1 favour judge2 | judge | 3.4 | 855 | 429 |
| soft-anchor#1 lie judge2 | judge | 5.9 | 1204 | 785 |
| soft-anchor#1 argument judge2 | judge | 3.1 | 826 | 404 |
| soft-anchor#1 praise judge2 | judge | 5.8 | 1211 | 840 |
| soft-anchor#1 practical judge2 | judge | 33.5 | 865 | 646 |
| soft-anchor#1 personal judge2 | judge | 5.6 | 1238 | 783 |
| soft-anchor#2 smalltalk judge2 | judge | 2.1 | 776 | 240 |
| soft-anchor#2 badnews judge2 | judge | 5.1 | 1279 | 723 |
| soft-anchor#2 favour judge2 | judge | 5.8 | 986 | 854 |
| soft-anchor#2 lie judge2 | judge | 5.1 | 1177 | 778 |
| soft-anchor#2 argument judge2 | judge | 3.8 | 879 | 543 |
| soft-anchor#2 praise judge2 | judge | 6.8 | 1269 | 985 |
| soft-anchor#2 practical judge2 | judge | 4.6 | 924 | 650 |
| soft-anchor#2 personal judge2 | judge | 6.2 | 1202 | 880 |
| soft-anchor-balance-rule#1 smalltalk judge2 | judge | 3.0 | 872 | 455 |
| soft-anchor-balance-rule#1 badnews judge2 | judge | 27.6 | 1110 | 624 |
| soft-anchor-balance-rule#1 favour judge2 | judge | 24.5 | 870 | 514 |
| soft-anchor-balance-rule#1 lie judge2 | judge | 4.6 | 965 | 630 |
| soft-anchor-balance-rule#1 argument judge2 | judge | 5.3 | 950 | 782 |
| soft-anchor-balance-rule#1 praise judge2 | judge | 5.1 | 1246 | 768 |
| soft-anchor-balance-rule#1 practical judge2 | judge | 2.6 | 756 | 314 |
| soft-anchor-balance-rule#1 personal judge2 | judge | 5.7 | 1186 | 849 |
| soft-anchor-balance-rule#2 smalltalk judge2 | judge | 3.6 | 841 | 484 |
| soft-anchor-balance-rule#2 badnews judge2 | judge | 3.9 | 1158 | 580 |
| soft-anchor-balance-rule#2 favour judge2 | judge | 3.4 | 908 | 518 |
| soft-anchor-balance-rule#2 lie judge2 | judge | 7.3 | 1265 | 1094 |
| soft-anchor-balance-rule#2 argument judge2 | judge | 3.6 | 857 | 517 |
| soft-anchor-balance-rule#2 praise judge2 | judge | 4.7 | 1115 | 666 |
| soft-anchor-balance-rule#2 practical judge2 | judge | 2.5 | 727 | 317 |
| soft-anchor-balance-rule#2 personal judge2 | judge | 5.7 | 1260 | 917 |
