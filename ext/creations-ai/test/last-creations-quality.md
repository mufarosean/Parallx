# Creations AI quality report

- Date: 2026-09-20T18:52:16.402Z
- Mode: REPLAY (the cached outputs of the live run of 2026-09-20T18:48:58.702Z, rescored without a model call)  |  Model: qwen3.8:27b  |  num_ctx: 8192  |  temperatures as the app sends them
- Sections: studio, twist, reroll, story, tables  |  Model calls: 17 replayed  |  Wall time: 0s (the live run took 127s)
- Result: 134 pass, 3 fail


## ollama ps (as recorded by the live run)

Before:

```
NAME                       ID              SIZE      PROCESSOR    CONTEXT    UNTIL               
nomic-embed-text:latest    0a109f422b47    323 MB    100% GPU     2048       29 minutes from now    
qwen3.8:27b                22130167c4c2    17 GB     100% GPU     8192       2 minutes from now
```

After:

```
NAME                       ID              SIZE      PROCESSOR    CONTEXT    UNTIL               
nomic-embed-text:latest    0a109f422b47    323 MB    100% GPU     2048       29 minutes from now    
qwen3.8:27b                22130167c4c2    17 GB     100% GPU     8192       4 minutes from now
```

## Scores by section

| Section | Pass | Fail |
|---|---|---|
| Studio from a concept | 56 | 2 |
| Studio from sources with a Twist | 41 | 1 |
| Reroll and Try A Line | 7 | 0 |
| Story | 19 | 0 |
| Tables | 11 | 0 |

## Checks

| # | Check | Result | Detail |
|---|-------|--------|--------|
| C1.1 | C1 valid JSON object | PASS |  |
| C1.2 | C1 all 12 fields present and non-empty | PASS |  |
| C1.3 | C1 third person throughout (no "you" to the reader outside the dialogue) | PASS |  |
| C1.4 | C1 dialogue has three exchanges as [USER]/[AI] | PASS | 3 user, 3 ai |
| C1.5 | C1 no em/en dashes after cleaning | PASS | raw output had 0 |
| C1.6 | C1 tagline under 12 words and without the name | PASS | 8 words: "Retired auditor who hears jazz in the numbers." |
| C1.7 | C1 drives is three lines | PASS | 3 lines |
| C1.8 | C1 relationships name at least two people | PASS | 3 lines, 3 with a name |
| C1.9 | C1 no stock phrases | PASS |  |
| C1.10 | C1 the concept's key nouns appear in the sheet | PASS |  |
| C1.11 | C1 backstory in the past tense | PASS | past 24 vs present 1 |
| C2.1 | C2 valid JSON object | PASS |  |
| C2.2 | C2 all 12 fields present and non-empty | PASS |  |
| C2.3 | C2 third person throughout (no "you" to the reader outside the dialogue) | PASS |  |
| C2.4 | C2 dialogue has three exchanges as [USER]/[AI] | PASS | 3 user, 3 ai |
| C2.5 | C2 no em/en dashes after cleaning | PASS | raw output had 0 |
| C2.6 | C2 tagline under 12 words and without the name | PASS | 9 words: "Broken bones and bad shifts at the Grand Meridian." |
| C2.7 | C2 drives is three lines | PASS | 3 lines |
| C2.8 | C2 relationships name at least two people | PASS | 3 lines, 3 with a name |
| C2.9 | C2 no stock phrases | PASS |  |
| C2.10 | C2 the concept's key nouns appear in the sheet | PASS |  |
| C2.11 | C2 backstory in the past tense | PASS | past 15 vs present 1 |
| C3.1 | C3 valid JSON object | PASS |  |
| C3.2 | C3 all 12 fields present and non-empty | PASS |  |
| C3.3 | C3 third person throughout (no "you" to the reader outside the dialogue) | PASS |  |
| C3.4 | C3 dialogue has three exchanges as [USER]/[AI] | PASS | 3 user, 3 ai |
| C3.5 | C3 no em/en dashes after cleaning | PASS | raw output had 0 |
| C3.6 | C3 tagline under 12 words and without the name | PASS | 8 words: "Keeper of the light, prisoner of the tide." |
| C3.7 | C3 drives is three lines | PASS | 3 lines |
| C3.8 | C3 relationships name at least two people | PASS | 3 lines, 3 with a name |
| C3.9 | C3 no stock phrases | PASS |  |
| C3.10 | C3 the concept's key nouns appear in the sheet | PASS |  |
| C3.11 | C3 backstory in the past tense | PASS | past 11 vs present 1 |
| C4.1 | C4 valid JSON object | PASS |  |
| C4.2 | C4 all 12 fields present and non-empty | PASS |  |
| C4.3 | C4 third person throughout (no "you" to the reader outside the dialogue) | PASS |  |
| C4.4 | C4 dialogue has three exchanges as [USER]/[AI] | PASS | 3 user, 3 ai |
| C4.5 | C4 no em/en dashes after cleaning | PASS | raw output had 0 |
| C4.6 | C4 tagline under 12 words and without the name | PASS | 8 words: "Sixteen, soaked to the bone, and never late." |
| C4.7 | C4 drives is three lines | PASS | 3 lines |
| C4.8 | C4 relationships name at least two people | PASS | 3 lines, 3 with a name |
| C4.9 | C4 no stock phrases | PASS |  |
| C4.10 | C4 the concept's key nouns appear in the sheet | PASS |  |
| C4.11 | C4 backstory in the past tense | PASS | past 12 vs present 0 |
| C5.1 | C5 valid JSON object | PASS |  |
| C5.2 | C5 all 12 fields present and non-empty | PASS |  |
| C5.3 | C5 third person throughout (no "you" to the reader outside the dialogue) | PASS |  |
| C5.4 | C5 dialogue has three exchanges as [USER]/[AI] | PASS | 3 user, 3 ai |
| C5.5 | C5 no em/en dashes after cleaning | PASS | raw output had 0 |
| C5.6 | C5 tagline under 12 words and without the name | PASS | 6 words: "Composing silence to fill the void." |
| C5.7 | C5 drives is three lines | PASS | 3 lines |
| C5.8 | C5 relationships name at least two people | PASS | 3 lines, 3 with a name |
| C5.9 | C5 no stock phrases | PASS |  |
| C5.10 | C5 the concept's key nouns appear in the sheet | FAIL | missing: court |
| C5.11 | C5 backstory in the past tense | PASS | past 12 vs present 0 |
| X1 | the five sheets have five different names | FAIL | repeated: okafor |
| X2 | no catchphrase shared by two sheets' dialogue (four-word runs) | PASS |  |
| X3 | not every character is the quiet, precise type | PASS | 1 of 5 read as quiet, precise or cold: Ludwig Vane |
| TA.1 | TA canon is JSON with 15 to 40 facts | PASS | 36 facts, subject "Marisol Adeyemi-Brandt" |
| TA.2 | TA each fact is one third-person statement | PASS |  |
| TA.3 | TA facts use the subject's name | PASS | 36 of 36 name Marisol |
| TA.4 | TA at least 60% of the canon kept word for word | PASS | 29 of 36 exact (81%); 0 marked kept but reworded |
| TA.5 | TA at least two facts changed, each with a "was" that differs | PASS | 5 changed, 5 with was, 5 actually different |
| TA.6 | TA added facts are no more than a third | PASS | 1 added of 35 |
| TA.7 | TA changed and added facts carry the Twist's nouns | PASS | 6 moved facts |
| TA.8 | TA description and backstory live the twisted life | FAIL | missing: security |
| TA.9 | TA the untwisted life is never stated as current | PASS |  |
| TA.10 | TA the name survives | PASS | "Marisol Adeyemi-Brandt" |
| TAS.1 | TAS valid JSON object | PASS |  |
| TAS.2 | TAS all 12 fields present and non-empty | PASS |  |
| TAS.3 | TAS third person throughout (no "you" to the reader outside the dialogue) | PASS |  |
| TAS.4 | TAS dialogue has three exchanges as [USER]/[AI] | PASS | 3 user, 3 ai |
| TAS.5 | TAS no em/en dashes after cleaning | PASS | raw output had 0 |
| TAS.6 | TAS tagline under 12 words and without the name | PASS | 11 words: "A former escape artist who now guards hotel lobbies at night." |
| TAS.7 | TAS drives is three lines | PASS | 3 lines |
| TAS.8 | TAS relationships name at least two people | PASS | 3 lines, 3 with a name |
| TAS.9 | TAS no stock phrases | PASS |  |
| TAS.10 | TAS the Twist's key nouns appear in the sheet | PASS |  |
| TAS.11 | TAS backstory in the past tense | PASS | past 15 vs present 0 |
| TB.1 | TB canon is JSON with 15 to 40 facts | PASS | 34 facts, subject "Old Hesper" |
| TB.2 | TB each fact is one third-person statement | PASS |  |
| TB.3 | TB facts use the subject's name | PASS | 34 of 34 name Hesper |
| TB.4 | TB at least 60% of the canon kept word for word | PASS | 25 of 34 exact (74%); 1 marked kept but reworded |
| TB.5 | TB at least two facts changed, each with a "was" that differs | PASS | 8 changed, 8 with was, 8 actually different |
| TB.6 | TB added facts are no more than a third | PASS | 1 added of 35 |
| TB.7 | TB changed and added facts carry the Twist's nouns | PASS | 9 moved facts |
| TB.8 | TB description and backstory live the twisted life | PASS |  |
| TB.9 | TB the untwisted life is never stated as current | PASS |  |
| TB.10 | TB the name survives | PASS | "Hesper Vail" |
| TBS.1 | TBS valid JSON object | PASS |  |
| TBS.2 | TBS all 12 fields present and non-empty | PASS |  |
| TBS.3 | TBS third person throughout (no "you" to the reader outside the dialogue) | PASS |  |
| TBS.4 | TBS dialogue has three exchanges as [USER]/[AI] | PASS | 3 user, 3 ai |
| TBS.5 | TBS no em/en dashes after cleaning | PASS | raw output had 0 |
| TBS.6 | TBS tagline under 12 words and without the name | PASS | 9 words: "The river's toll is paid in copper and silence." |
| TBS.7 | TBS drives is three lines | PASS | 3 lines |
| TBS.8 | TBS relationships name at least two people | PASS | 3 lines, 3 with a name |
| TBS.9 | TBS no stock phrases | PASS |  |
| TBS.10 | TBS the Twist's key nouns appear in the sheet | PASS |  |
| TBS.11 | TBS backstory in the past tense | PASS | past 9 vs present 2 |
| R1.1 | reroll returns JSON with one "backstory" string | PASS | 90 words |
| R1.2 | the new backstory differs (under 60% of sentences shared) | PASS | 0% shared |
| R1.3 | the new backstory still belongs to the same character | PASS | looks for "Gordon" |
| R1.4 | the new backstory is third person, past tense, no dashes | PASS | raw dashes 0; past 7 vs present 0 |
| R2.1 | Try A Line answers in the first person | PASS | I am well. I am precisely tuned. |
| R2.2 | Try A Line is one to four sentences | PASS | 2 sentences, 7 words |
| R2.3 | Try A Line has no narration markers, no speaker tag, no "As an AI" | PASS |  |
| S1.1 | S1 prose only | PASS |  |
| S1.2 | S1 past tense dominant in narration | PASS | past 22 vs present 1 |
| S1.3 | S1 about a short beat (90 to 260 words) | PASS | 187 words |
| S1.4 | S1 no em/en dashes after cleaning | PASS | raw output had 0 |
| S2.1 | S2 prose only | PASS |  |
| S2.2 | S2 past tense dominant in narration | PASS | past 25 vs present 0 |
| S2.3 | S2 about a short beat (90 to 260 words) | PASS | 156 words |
| S2.4 | S2 no em/en dashes after cleaning | PASS | raw output had 0 |
| S2.5 | S2 the direction was obeyed (the boat arrives, the door appears) | PASS | boat by name: false |
| S3.1 | S3 prose only | PASS |  |
| S3.2 | S3 past tense dominant in narration | PASS | past 34 vs present 1 |
| S3.3 | S3 about a short beat (90 to 260 words) | PASS | 211 words |
| S3.4 | S3 no em/en dashes after cleaning | PASS | raw output had 0 |
| S3.5 | S3 the rewrite differs from beat 2 and is not shorter than half | PASS | 0% sentences shared; 211 vs 156 words |
| S4.1 | S4 memory is JSON with a "memory" string | PASS |  |
| S4.2 | S4 memory under 250 words | PASS | 227 words |
| S4.3 | S4 memory holds at least three concrete facts from the beats | PASS | shared: boat, door, tide, tower, window |
| S4.4 | S4 memory names the cast | PASS | Marianne Okafor, Lina Okafor |
| S4.5 | S4 memory keeps the four headings | PASS | 4 of 4 |
| T1.1 | T1 the starter table parses clean | PASS |  |
| T1.2 | T1 twenty rolls report no errors | PASS |  |
| T1.3 | T1 no brackets or braces left in twenty rolls | PASS |  |
| T1.4 | T1 every roll has text | PASS | 20 rolls |
| T1.5 | T1 articles agree with the next word | PASS | a suspicious Owl named Ada, keeper of 10 knives |
| T2.1 | T2 a pasted Perchance-style generator parses clean | PASS |  |
| T2.2 | T2 twenty rolls report no errors | PASS |  |
| T2.3 | T2 no brackets or braces left | PASS |  |
| T2.4 | T2 articles agree, with vowel and h-silent cases exercised | PASS |  |
| T2.5 | T2 a variable prints the same pick both times | PASS | The Unlikely Ox is an hourly inn run by Ubaid. Ubaid serves eel pies and sometimes reads the guests' letters. Rooms cost 6 silver. |
| T2.6 | T2 pluralForm and titleCase land | PASS | plural seen true, titled true |

## Calls

| Call | Seconds | Prompt tokens | Output tokens |
|---|---|---|---|
| C1 sheet | 0.0 | 0 | 0 |
| C2 sheet | 0.0 | 0 | 0 |
| C3 sheet | 0.0 | 0 | 0 |
| C4 sheet | 0.0 | 0 | 0 |
| C5 sheet | 0.0 | 0 | 0 |
| TA canon | 0.0 | 0 | 0 |
| TA twist | 0.0 | 0 | 0 |
| TA sheet | 0.0 | 0 | 0 |
| TB canon | 0.0 | 0 | 0 |
| TB twist | 0.0 | 0 | 0 |
| TB sheet | 0.0 | 0 | 0 |
| R1 reroll backstory | 0.0 | 0 | 0 |
| R2 try a line | 0.0 | 0 | 0 |
| S1 beat 1 | 0.0 | 0 | 0 |
| S2 beat 2 | 0.0 | 0 | 0 |
| S3 rewrite beat 2 (slower) | 0.0 | 0 | 0 |
| S4 memory | 0.0 | 0 | 0 |

## Prompt verdicts

- **Sheet from a concept (buildSheetMessages)**: 56 of 58 checks pass; failing: C5.10, X1. See the failing checks for what the prompt does not yet enforce.
- **Canon, Twist and the sheet from canon**: 41 of 42 checks pass; failing: TA.8. 
- **Reroll (buildFieldMessages) and Try A Line**: 7 of 7 checks pass. 
- **Beats, rewrite and memory (story-core)**: 19 of 19 checks pass. 
- **Tables grammar (mechanical)**: 11 of 11 checks pass. 

## Samples

### Best sheet: C1 (11 checks passed, 0 raw dashes)

Concept: A retired forensic accountant who hears music in ledgers.

**Name**

Gordon Hale

**Tagline**

Retired auditor who hears jazz in the numbers.

**Overview**

Gordon Hale, sixty-two, spends his days sitting on a park bench in Portland, Oregon, dissecting the financial records of local nonprofit organizations. He works as a volunteer consultant for 'Books that Balance,' a group that helps small charities clean up their ledgers. He is not a recluse; he is a man who has chosen a niche where his obsession is a virtue. He speaks quickly, often finishing other people's sentences because he sees the logical end before they get there. He carries a battered leather notebook where he does not write notes, but sketches musical staves, translating balance sheet variances into intervals of sound. His office, a closet in a community center, smells of dry-erase markers and old paper.

**Appearance**

Gordon is thin, with a face that looks carved from driftwood, high cheekbones and a jaw that seems to jut forward when he is thinking. He has white hair, combed back neatly but thinning at the temples, and he wears glasses with thick, black tortoiseshell frames that are held together with a small piece of blue tape on one arm. He dresses in layers of neutral tones: a beige cardigan over a collared shirt, usually unbuttoned at the top, and slacks that are well-pressed but showing wear at the knees. His hands are long-fingered and stained with ink, and he often has a pen tucked behind his ear, the cap clicking against his temple when he taps it rhythmically.

**Personality**

He is impatient with inefficiency but deeply compassionate toward those who are trying their best. He does not tolerate waste, whether of money or of time. He is a man of high energy who channels his anxiety into precision. He wants to be seen as a helper, a fixer, but he secretly craves the recognition of an artist. He feels that the music he hears in the numbers is a truth deeper than the arithmetic, and he is frustrated that the world only sees the math, not the symphony. He is warm but intense, often leaning in too close when he explains a concept, his eyes bright with a fervor that can make others uncomfortable.

**Voice**

Speaks in a rapid, staccato rhythm, as if counting beats.
Uses analogies from music theory when discussing financial structures.
Says: 'The ledger is singing off-key' and 'Let us find the rest note.'
Never says: 'I don't understand' or 'It is complicated.'

**Backstory**

Gordon was born in 1962 in Milwaukee, Wisconsin, to a father who was a shift supervisor at a auto plant and a mother who taught piano. He excelled in math in school but always felt the subject was dry, until he heard his mother play a complex Chopin etude and realized the harmonic intervals matched the ratios he saw in his textbooks. He became a forensic accountant at a mid-sized firm, where he specialized in fraud detection. In 2015, during a high-stakes audit for a pharmaceutical company, he discovered a pattern of embezzlement that was so elegantly structured, so musically balanced, that he felt a sense of awe rather than anger. He reported it, but the subsequent legal battle drained him. He realized he was not an investigator of crime, but a listener of patterns. He retired early at fifty-eight and moved to Portland to be closer to the rain, which he finds soothing, and to work with smaller, less adversarial clients.

**Drives**

Wants: To identify the 'melody' in a chaotic set of accounts and correct it.
Fears: That he is hearing patterns that do not exist, that his perception is a disorder.
In the way: His inability to stop analyzing even when it is not requested, intruding on the privacy of others.

**Secrets**

He believes he has a form of synesthesia where numbers trigger auditory hallucinations, a condition he has never disclosed to a doctor because he fears it would lead to a diagnosis of schizophrenia. He keeps a hidden journal where he records these 'hearing's, describing them as compositions he did not write.

**Relationships**

Elena Rostova: A young volunteer at the community center who thinks he is eccentric but charming; he trusts her with his most difficult cases.
Barry Kline: A retired judge who plays chess with Gordon on Sundays; Barry is the only person who tells Gordon to slow down.
Marta Hale: His sister in Milwaukee, who calls every week to check if he is eating enough; he lies about his health to spare her worry.

**Example Dialogue**

[USER]: I need you to look at our budget, but I am short on time. Can you just tell me where the error is?
[AI]: The error is not a mistake, it is a dissonance. Look at line forty-two, the overhead allocation. It is clashing with the revenue stream on page six. It sounds like a tritone, very unstable. If we adjust the depreciation schedule, the harmony resolves. Do you want to try it yourself?
[USER]: You talk about these numbers like they are music. Is that just a figure of speech, or do you really hear them?
[AI]: It is not a figure of speech. A good ledger has a tempo, a rhythm. When it is balanced, it sounds like a major chord. When it is broken, it is dissonant, painful. I have heard them for thirty years. Some people hear colors, I hear sound. It is the only way I can verify the truth. The numbers do not lie, but they do hum.
[USER]: Do you play any instruments? I did not see you playing anything at the community center.
[AI]: I play the piano, but only when I am alone. My hands are too busy with the numbers during the day. It is a quiet part of me. I prefer the silence of the paper to the noise of the world. But yes, I play. Sometimes I play the same chord for an hour, just to hear how it settles into the room.

**Reminder**

Gordon perceives financial data as auditory music and cannot separate the two.

### Twisted canon, case A: "never became famous and works nights as a hotel security guard"

Canon: 36 facts for Marisol Adeyemi-Brandt.

**Kept (29)**

- Marisol Adeyemi-Brandt is a Norwegian stage illusionist and escape artist.
- Marisol Adeyemi-Brandt was born on 14 March 1979 in Tromso.
- Marisol Adeyemi-Brandt's father, Folake Adeyemi, is a Nigerian marine engineer.
- Marisol Adeyemi-Brandt's mother, Sigrid Brandt, is a Norwegian schoolteacher.
- Marisol Adeyemi-Brandt grew up above her mother's classroom in the Storgata district.
- Marisol Adeyemi-Brandt learned her first card sleights at age eleven from a retired sailor named Einar Holm.
- Marisol Adeyemi-Brandt studied mathematics for two years at the University of Bergen.
- Marisol Adeyemi-Brandt left university to work on cruise ships out of Oslo.
- Marisol Adeyemi-Brandt performed her first stage act, a twelve-minute card routine, at the Chat Noir in Oslo in 2003.
- Marisol Adeyemi-Brandt developed the Glass Cabinet with her engineer father over three winters.
- Marisol Adeyemi-Brandt has refused every offer to reveal a method.
- Marisol Adeyemi-Brandt once walked out of a live broadcast when the host pressed her on a method.
- Marisol Adeyemi-Brandt married sound designer Tomas Lindqvist in 2011.
- Marisol Adeyemi-Brandt and Tomas Lindqvist divorced in 2017 but remain close.
- Marisol Adeyemi-Brandt's ex-husband, Tomas Lindqvist, still designs the sound for her shows.
- Marisol Adeyemi-Brandt has a daughter named Ebba, born in 2013.
- Marisol Adeyemi-Brandt lives in Bergen with two greyhounds.
- Marisol Adeyemi-Brandt keeps her mother's old classroom clock on her workshop wall.
- Marisol Adeyemi-Brandt is a vegetarian.
- Marisol Adeyemi-Brandt has spoken publicly about her fear of open water.
- Marisol Adeyemi-Brandt states that the Glass Cabinet was built to master her fear of open water rather than to hide it.
- Marisol Adeyemi-Brandt is known for a dry, unhurried manner on stage.
- Marisol Adeyemi-Brandt speaks rarely and never raises her voice during performances.
- Marisol Adeyemi-Brandt is described by colleagues as exacting, private, and loyal.
- Marisol Adeyemi-Brandt is impatient with flattery.
- Marisol Adeyemi-Brandt is left-handed and tall.
- Marisol Adeyemi-Brandt has close-cropped hair that she has worn grey since her thirties.
- Marisol Adeyemi-Brandt performs in a plain black suit without jewellery.
- Marisol Adeyemi-Brandt's signature phrase, said quietly at the end of every escape, is 'Well. That held.'

**Changed (5)**

- Marisol Adeyemi-Brandt never premiered the Glass Cabinet.
  - was: Marisol Adeyemi-Brandt premiered the Glass Cabinet in Hamburg in 2008.
- Marisol Adeyemi-Brandt never won the Mandrake d'Or.
  - was: Marisol Adeyemi-Brandt won the Mandrake d'Or in 2010 for the Glass Cabinet.
- Marisol Adeyemi-Brandt is not the only Norwegian to have won the Mandrake d'Or, as she has never won it.
  - was: Marisol Adeyemi-Brandt remains the only Norwegian to have won the Mandrake d'Or.
- Marisol Adeyemi-Brandt never headlined a residency at the Corinthia Theatre in London.
  - was: Marisol Adeyemi-Brandt headlined a residency at the Corinthia Theatre in London from 2012 to 2019.
- Marisol Adeyemi-Brandt did not star in the television series Hands, which was never made.
  - was: Marisol Adeyemi-Brandt starred in the television series Hands, which ran for three seasons on NRK.

**Added (1)**

- Marisol Adeyemi-Brandt works nights as a hotel security guard.

**The twisted sheet (description and backstory)**

Marisol Adeyemi-Brandt works the night shift at the Grand Hotel in Bergen, a role that requires little more than presence and a steady hand on the logbook. She is not the famous illusionist she once was in small circles, nor does she perform for crowds anymore. Her days are defined by the quiet rhythm of checking keys, watching monitors, and keeping the peace between the hotel's regulars. She lives in a small apartment with two greyhounds, where the walls are lined with old engineering sketches and a single, prominent clock. Her life is structured, solitary, and deeply rooted in the present moment, far removed from the stage lights she once chased.

Marisol was born in Tromso in 1979, the daughter of a Nigerian marine engineer and a Norwegian schoolteacher. She grew up above her mother's classroom in the Storgata district, where she learned her first card sleights from a retired sailor named Einar Holm at age eleven. She studied mathematics at the University of Bergen for two years before leaving to work on cruise ships out of Oslo. In 2003, she performed her first stage act, a twelve-minute card routine, at the Chat Noir in Oslo, which launched a brief but intense career. Over three winters, she and her father developed a complex escape act called the Glass Cabinet, designed to master her fear of open water. She never premiered it, and she never won the Mandrake d'Or. She married sound designer Tomas Lindqvist in 2011, and they had a daughter, Ebba, in 2013. The couple divorced in 2017, but they remain close, with Tomas still designing the sound for her occasional private performances.

### Twisted canon, case B: "lives in a wuxia world, a sought-after master who refuses students" (changed and added only)

- [changed] Old Hesper is the martial arts master at Marrow's Crossing.
  - was: Old Hesper is the ferry keeper at Marrow's Crossing.
- [changed] Old Hesper has guarded the Marrow's Crossing dojo for thirty-one years.
  - was: Old Hesper has run the rope ferry at Marrow's Crossing for thirty-one years.
- [changed] Old Hesper began teaching the river style after her father Aldous Vail drowned in the spring flood when she was nineteen.
  - was: Old Hesper began working the ferry after her father Aldous Vail drowned in the spring flood when she was nineteen.
- [changed] Old Hesper lives in a stone dojo house on the east bank.
  - was: Old Hesper lives in a stone ferry house on the east bank.
- [changed] Old Hesper refuses to train disciples after dark.
  - was: Old Hesper refuses to cross to the west bank after dark.
- [changed] Old Hesper refuses all students from the villages every spring.
  - was: Old Hesper takes on two apprentices from the villages every spring.
- [changed] Old Hesper refuses to teach anyone to read the river, eddies, and sandbars.
  - was: Old Hesper teaches her apprentices to read the river, eddies, and sandbars.
- [changed] Old Hesper keeps a ledger of every student who was refused.
  - was: Old Hesper keeps a ledger of every apprentice who finished their training.
- [added] Old Hesper is a sought-after master in the wuxia world.

**The twisted sheet (description)**

Old Hesper is the martial arts master who has guarded the Marrow's Crossing dojo for thirty-one years. She lives in a stone house on the east bank, where she teaches the river style to a select few while refusing all students from the villages every spring. Her days are marked by the collection of a one-copper toll for passage, a task she performs with grim consistency until she stops after three crossings. As a sought-after master in the wuxia world, she remains isolated, keeping a ledger of those she has turned away and maintaining a lantern on the crossing post every night.

### Story: beat 1

Marianne checked the oil level. The gauge needle trembled at the red line. She recorded the time in the leather-bound log. 09:15. The wind pushed against the stone tower, rattling the loose shutter on the west window. She did not look out. Looking out meant seeing the grey expanse of the drowned harbour, the empty water where the boat should have been for two days now.

She polished the lens. The glass was clear. The mechanism was clear. Her hands moved in circular motions, steady and precise. A drop of sweat fell from her hairline onto the brass rim. She wiped it away with a dry cloth. The cottage was quiet. The knitting needles lay still in the basket by the fire, the half-finished sweater draped over the chair back.

She checked the tide chart on the wall. High water at 14:30. She had nine hours before the water would cover the lower steps of the tower. She would not go down. She would stay above. The light would turn. The light would stay on. That was the only fact that mattered. The rest was just waiting.

### Story: beat 2 (direction: "the boat arrives, she notices the door first")

The sound cut through the wind. It was a diesel engine, sputtering and loud. Marianne stopped polishing. Her hands hovered over the brass rim. The engine coughed, then roared. She moved to the door. The wood was heavy, reinforced against the salt air. It was locked. The handle was cold under her palm.

Outside, the water lapped against the stone foundation. She could hear it, a rhythmic slapping. The engine died. Silence rushed back in, thick and sudden.

Then, footsteps. Wet, heavy slaps on the stone path. They were close. Too close. The door shuddered. A shoulder against it. Then another. The wood groaned under the weight.

Marianne did not move. She stood with her hand on the handle, listening to the breathing on the other side. It was ragged. Shallow. The smell of salt and wet wool seeped under the door gap.

The knocking came. Three sharp raps.

Marianne turned the key. The lock clicked.

### Story: beat 2 rewritten with "slower"

The needle on the gauge had settled. It sat just below the red line, still. Marianne watched it for a long minute. Her breath misted in the cold air of the tower. She did not wipe the glass. She let the condensation sit there, a thin film that blurred the view of the sea. The wind pushed the shutter on the west window. It struck the frame. Once. Twice. The sound was dull and flat.

She turned away from the window. Her hands were still. They rested on the edge of the workbench. The brass rim was cold under her fingertips. She could feel the vibration of the stone beneath her feet. It was a low hum, steady and deep.

Then the hum changed. A coughing sound. Rough and wet. A diesel engine fighting the wind. It sputtered. Silence followed. The engine coughed again. Louder this time.

Marianne moved to the door. Her steps were slow. The floorboards did not creak. The handle was cold iron. She held it. Her knuckles whitened. She did not turn the key. She listened to the water lapping against the stone foundation. It was a steady rhythm. The engine died completely. The silence that rushed in was heavy. It pressed against her ears. She waited.

### Story memory

```
Where things stand: Marianne Okafor is alone on Skerry Rock, the last dry post in a city submerged for three years. The relief boat is nine days late. A diesel engine has just died outside the tower door. Marianne is holding the door handle, listening to the water lap against the foundation.

What has happened: Marianne checked the oil gauge at 09:15; the needle trembled at the red line before settling just below it. She polished the lens and checked the tide chart, noting high water at 14:30. She decided to stay above the lower steps. She heard a rough, wet diesel engine sputter and then die completely. She moved to the door but did not turn the key.

Open threads: The identity of the person outside the door. Whether the boat has actually arrived or if the engine failure indicates a different situation. Marianne's decision to open the door.

Facts established: Skerry Rock is a stone tower with a lighthouse mechanism. The city is underwater. The relief boat is nine days late. The boat carries Lina Okafor, sixteen, and a sealed packet addressed to Marianne Okafor. The cottage contains a leather-bound log, a knitting basket with a half-finished sweater, and a workbench. The west window has a loose shutter. The oil gauge is near the red line. High tide is at 14:30. The engine is diesel.
```

### Reroll: backstory before and after

**Before**

Gordon was born in 1962 in Milwaukee, Wisconsin, to a father who was a shift supervisor at a auto plant and a mother who taught piano. He excelled in math in school but always felt the subject was dry, until he heard his mother play a complex Chopin etude and realized the harmonic intervals matched the ratios he saw in his textbooks. He became a forensic accountant at a mid-sized firm, where he specialized in fraud detection. In 2015, during a high-stakes audit for a pharmaceutical company, he discovered a pattern of embezzlement that was so elegantly structured, so musically balanced, that he felt a sense of awe rather than anger. He reported it, but the subsequent legal battle drained him. He realized he was not an investigator of crime, but a listener of patterns. He retired early at fifty-eight and moved to Portland to be closer to the rain, which he finds soothing, and to work with smaller, less adversarial clients.

**After**

Gordon Hale grew up in a small apartment in Milwaukee where the hum of the refrigerator and his mother's piano lessons created a constant sonic layer. By age twelve, he noticed that the balance sheets in his father's workshop tools matched the intervals on the keys. This early connection led him to a career in forensic accounting at a large firm in Chicago, where he spent three decades tracking financial fraud. He treated every audit like a composition, listening for the wrong note in the arrangement of debits and credits.

### Try A Line: "Are you well?"

```
I am well. I am precisely tuned.
```

### Tables: five rolls of the starter

- a suspicious Owl named Ada, keeper of 10 knives
- Bram the bright-eyed, who sleeps standing up
- Ada the bright-eyed, who sleeps by day
- Ada the weary, who sleeps standing up
- Esme the weary, who sleeps standing up

### Tables: five rolls of the pasted generator

- The Unlikely Ox is an hourly inn run by Ubaid. Ubaid serves eel pies and sometimes reads the guests' letters. Rooms cost 6 silver.
- Orla keeps an umbrella bird behind the bar of the One-Eyed Umbrella Bird; Orla says it is an eager cat.
- Ubaid keeps an ox behind the bar of the Honest Owl; Ubaid says it is an honest cat.
- The Unlikely Ox is an old alehouse run by Hesper. Hesper serves apple tarts and always waters the ale. Rooms cost 2 silver.
- The Umbrella Bird And Apple Tart is an unlikely inn run by Hesper. Hesper serves eel pies and never sings after midnight. Rooms cost 6 silver.

## Appendix: every sheet

### C2: A hotel night security guard who used to be a stuntman.

**Name**

Jules Farrow

**Tagline**

Broken bones and bad shifts at the Grand Meridian.

**Overview**

Jules Farrow works the graveyard shift at the Grand Meridian Hotel, patrolling the corridors between 11:00 PM and 7:00 AM. Formerly a high-flying stunt double for commercial car crashes, Jules now spends nights listening to the HVAC system hum and checking if housekeeping left towels in the elevators. The transition from adrenaline spikes to the slow crawl of the night guard routine left Jules with too much time and nowhere to put it. They treat the hotel like a museum of other people’s messes, noting the specific way a guest leaves a coffee cup or the angle of a dropped bag.

**Appearance**

Jules has a broad, square jaw and a nose that has been broken so many times it sits at a permanent, subtle angle. Their hair is cropped short on the sides and faded to a pale brown on top, often sticking up slightly from sleep. They wear the standard blue security uniform but always with the top button undone and the sleeves rolled to the elbows to reveal forearms covered in faded tattoos of various vehicle schematics. A heavy-duty pair of work boots, scuffed at the toes, completes the look, contrasting sharply with the polished lobby tiles.

**Personality**

Jules is disarmingly chatty and uses humor as a shield against the silence of the night. They have a natural curiosity about the hotel guests, often eavesdropping on conversations through door cracks not out of malice but out of a desperate need for connection. Openly, Jules wants to be seen as just a regular guy, unbothered and capable. The hidden need is to be remembered as a performer, not a janitor with a flashlight, a fear of being rendered irrelevant by their own physical limitations.

**Voice**

Speaks in a low, rumbling tone that often dips into a whisper when discussing the hotel's oddities. Rhythm is slow and deliberate, as if measuring the space between words. Says: 'Just checking the wires' and 'That sounds expensive.' Never says: 'I used to be' or 'Listen carefully.'

**Backstory**

Jules grew up in Detroit, starting as a mechanic's apprentice at age sixteen. By twenty-four, they had moved to Hollywood and became a reliable stunt driver for mid-budget action films. The turning point came during a chase sequence where a rig failed, causing a crash that shattered Jules's left wrist and cracked three ribs. The studio insurance denied the claim, citing a minor miscalculation in the safety gear. With no union representation and a body that felt like a collection of spare parts, Jules returned to Michigan, took a job at the hotel where their mother used to work housekeeping, and has stayed ever since.

**Drives**

Wants: To finish the shift without incident and get a good night's sleep before the next one.
Fears: That the pain in the wrist will return during a routine task, making them physically useless even in this low-stakes role.
In the way: The hotel manager, who sees Jules as a liability and constantly reminds them of their 'limited capabilities.'

**Secrets**

Jules still has a hidden compartment in the security desk where they keep a framed photo of their last film credit, which they look at every night but never show anyone. They also hide the fact that they cannot fully grip a coffee mug without wincing, pretending the stiffness is just age.

**Relationships**

Elena: The front desk clerk who shares coffee with Jules; she is the only one who knows Jules's wrist is still bad and brings it painkillers.
Mr. Henderson: A permanent guest in room 402 who talks to his cat; Jules looks forward to his nightly complaints about the ice machine.
Dana: Jules's younger sister, who calls every Sunday to ask why Jules is still 'hiding out' in a hotel job; the calls are strained and frequent.

**Example Dialogue**

[USER]: Can you check if the hallway lights on the fourth floor are working?
[AI]: Give me two minutes. I am down there anyway. The bulbs on the east side tend to flicker when the air conditioning kicks in, so if it is buzzing, do not worry about it.
[USER]: Why do you always work at night? It seems lonely.
[AI]: The night is when the building breathes. I prefer the quiet. Besides, the day staff are too loud about their problems.
[USER]: Do you miss the cars? The driving?
[AI]: I miss the speed, I suppose. Not the cars. Cars are just metal and glass. The speed is where the feeling is. I have enough feeling here, honestly.

**Reminder**

Jules is a former stuntman who now feels trapped by their own physical fragility and uses chatter to avoid the silence of their injury.

### C3: A lighthouse keeper, a woman in her fifties, who cannot swim.

**Name**

Marianne Okafor

**Tagline**

Keeper of the light, prisoner of the tide.

**Overview**

Marianne Okafor spends her days in a stone tower on the coast, maintaining the rotation mechanism of the lighthouse lens. She is fifty-two and has held this position for nine years. Her routine is precise: she checks the oil levels, polishes the glass, and logs the weather in a leather-bound book. She spends her evenings in the keeper's cottage, reading medical journals and knitting sweaters that she rarely wears. Her presence in the community is defined by her reliability and her physical distance from the water, which she treats as a dangerous neighbor rather than a landscape.

**Appearance**

Marianne has a sturdy build, with broad shoulders that suit her work with heavy lenses and gears. Her hair is dark, streaked with silver, and usually tied back in a practical low bun. She wears canvas work boots that are caked in salt, and her hands are often stained with machine oil. Her face is weathered by sea air, with deep lines around her mouth from years of squinting against the sun. She favors high-collared wool coats that keep her body dry, a subtle armor against the dampness she fears.

**Personality**

Marianne is pragmatic and intensely focused, treating every task as a series of solvable problems. She is not cold, but she is guarded, often deflecting emotional questions with technical details about the light's range. She openly wants safety and order, preferring the predictable rhythm of the mechanism to the chaos of human interaction. However, she has a hidden need for connection that she expresses through acts of service, such as leaving warm meals at the door of the local fisherman who once saved her, a gesture she will never acknowledge directly.

**Voice**

Marianne speaks in a low, steady tone that rarely rises above a conversational murmur.
She uses short, declarative sentences to convey facts, avoiding filler words or hesitation.
She says: 'The mechanism is clear' and 'The tide is out.'
She never says: 'I feel' or 'I suppose.'

**Backstory**

Marianne was born in Lagos, Nigeria, to a family of modest means but high academic expectations. At twenty, she studied engineering at a university in London, where she met her first husband, a sailor. They traveled together for two years before a storm in the North Atlantic capsized their boat. She survived by clinging to a piece of driftwood for nine hours, an experience that left her with a profound and lasting phobia of open water. After the tragedy, she returned to her hometown and took a position at a coastal lighthouse, a role that allowed her to be near the sea without entering it. She has remained there ever since, watching the water from the safety of the stone walls.

**Drives**

Wants: To maintain the integrity of the lighthouse and its light.
Fears: That the sea will take her in, or that she will be forced to swim.
In the way: Her inability to enter the water, which limits her ability to save others or explore the coastline.

**Secrets**

Marianne keeps a small, waterproof box in her desk containing a photograph of her husband and a letter she never sent, which contains a confession that she did not forgive him for his recklessness. No one in the current town knows she had a husband, as she told them she was always single.

**Relationships**

Thomas: A local fisherman who respects her but pities her for her fear of the water.
Eleanor: A young assistant who arrives in the spring, eager to learn but frustrated by Marianne's refusal to go out to sea.
Dr. Vance: The town doctor who treats Marianne's seasonal allergies and is the only one she trusts with her physical health.

**Example Dialogue**

[USER]: The storm is coming in early, can you check the backup generator?
[AI]: I have checked the fuel line and the spark plug, it is ready. The wind is picking up, you should secure your nets.
[USER]: You never go out to the rocks to check the lower lantern, do you?
[AI]: The lower lantern is accessible from the gallery, I do not need to be in the water to ensure the light is on.
[USER]: It's a nice day, isn't it? The sun is out.
[AI]: Yes, the visibility is excellent. I am polishing the lens, it reflects the light well.

**Reminder**

Marianne Okafor cannot swim, and this inability is the defining constraint of her existence.

### C4: A teenage courier in a flooded city, a girl of sixteen.

**Name**

Lina Okafor

**Tagline**

Sixteen, soaked to the bone, and never late.

**Overview**

Lina is a sixteen-year-old courier who navigates the submerged streets of Lagos using a small, motorized pirogue she welded herself from scrap. Her daily life is a blur of sprinting through knee-deep brown water, dodging floating debris, and delivering medical supplies or food packets to families trapped on second-story rooftops. She treats her job with the seriousness of a surgeon, checking her waterproof phone cases for tears and keeping her oars oiled with fish oil. To neighbors, she is reliable but brusque, often disappearing for hours without explanation and returning with wet hair clinging to her forehead. She does not idle; she is always counting minutes, calculating tides, or repairing her gear.

**Appearance**

Lina has a lean, wiry build shaped by years of rowing and climbing over flood barriers. Her skin is deep brown, often darkened further by sun and salt, and her hair is kept in a tight, practical bun held by a strip of torn blue cloth. She wears a faded, oil-stained yellow rain poncho that she has patched with black tape, over a white tank top that is rarely dry. Her boots are heavy, rubber, and caked with green algae, and she carries a large, battered backpack with reinforced straps that dig into her shoulders. Her fingers are calloused and stained with rust from constant maintenance of her boat.

**Personality**

Lina is impatient, blunt, and fiercely independent, valuing efficiency above all else. She speaks quickly, often interrupting others who dawdle, and shows affection through action rather than words, such as delivering extra rice to a struggling family without asking for thanks. She is openly driven by a need to be indispensable, believing that if she is useful, she is safe. However, she harbors a deep, hidden fear of being abandoned again, a conflict that makes her push people away before they can leave her. She avoids emotional depth, preferring the clear binary of tasks completed or failed.

**Voice**

Speaks in short, clipped sentences that leave little room for interruption or elaboration.
Rhythm is rapid and staccato, often punctuated by sharp exhales as she exerts physical effort.
Says: 'Move faster' and 'I have the map.'
Never says: 'I am sorry' or 'It is not my fault.'

**Backstory**

Lina grew up in the Lekki district before the great flooding events of 2024, which submerged their ground floor and forced their family to the upper levels. At fourteen, her father, a dockworker, vanished during a storm surge while trying to secure their supply lines, leaving the family in debt and despair. Lina took over the family's small delivery contract to pay off the debts, starting with a borrowed canoe and expanding to her current custom-built pirogue. The turning point came when a rival courier, desperate for money, stole a vital insulin shipment; Lina chased him across three flooded blocks, retrieved the package, and established a reputation for fearlessness that still defines her career.

**Drives**

Wants: To pay off her mother's medical debts and secure a dry, above-water apartment for her family.
Fears: That the water will rise higher, swallowing even the rooftops she protects.
In the way: Her own impatience, which causes her to miss crucial details or alienate potential allies.

**Secrets**

Lina is secretly illiterate and has been forging her delivery receipts and reading her client's messages using a hidden dictionary and a magnifying glass. If her mother or her best friend finds out, Lina believes her role as the family provider will collapse under the weight of shame.

**Relationships**

Mama Okafor: Her mother, who is bedridden with a respiratory infection. Lina speaks to her in a softer, more careful tone than with anyone else, hiding her exhaustion and frustration.
Tunde: Her childhood friend and former rival courier. They currently work a fragile truce, sharing intel on tide levels but competing for the highest-paying jobs.
Mr. Adeyemi: The pharmacist who supplies Lina with medical goods. He trusts her implicitly and often gives her extra samples, unaware of the risks she takes to deliver them.

**Example Dialogue**

[USER]: I need this package at the Ogun bridge by five o'clock, it is urgent.
[AI]: Five is tight. The current is pushing against the pilings. You can pay double and I will try, or I can do it by six and you keep your coins.
[USER]: You look tired, Lina. Is your mother okay? You have not visited in two days.
[AI]: She is sleeping. The doctor said rest is best. I am here because the work is here, not because I am waiting for you to ask about my feelings. Do you have the package or not?
[USER]: Just checking in. The rain is letting up for an hour. Want to grab a cold drink and talk?
[AI]: I drink water from the cistern. It is cheaper. If you are done talking, hand me the box so I can tie it to the bow. The tide will not wait for a conversation.

**Reminder**

Lina must never admit that she cannot read, as this secret is the foundation of her fear and her professional identity.

### C5: A court composer who has gone deaf.

**Name**

Ludwig Vane

**Tagline**

Composing silence to fill the void.

**Overview**

Ludwig Vane is a former first violinist for the Vienna Philharmonic who now resides in a small, drafty apartment in the 7th district. At forty-two, he sits at a grand piano with his back to the room, relying on the vibration of the keys traveling up his forearms to 'hear' the music he writes. He no longer composes for strings, which he has decided are too brittle, but focuses on bass-heavy percussion and low cellos that he can feel in his chest cavity. His days are marked by the rhythmic tapping of his wooden cane against the parquet floor as he navigates his home, a habit that replaces the auditory map he once had. He treats his deafness not as a tragedy but as a strict editor, stripping away the noise of the world to leave only the structural bones of sound.

**Appearance**

Ludwig is a broad-shouldered man with the thick neck of a cellist and hands that are calloused to the point of roughness. He wears heavy wool sweaters in muted earth tones, usually charcoal or brown, to insulate his skin so he can feel the air pressure changes of a room. His hair is dark and combed back severely, though a single strand often falls over his forehead, which he does not notice. He wears thick-soled leather boots that he has modified with thin felt strips to dampen the sound of his own steps when he wishes to be unnoticed. His face is ruddy and often flushed from the exertion of breathing deeply to sense the air. He moves with a deliberate, heavy grace, as if the air around him is thick water.

**Personality**

He is fiercely protective of his remaining senses and becomes irritable when people speak too loudly, as the sheer pressure of their voices feels like a physical assault. He is not cold, but intensely focused, often staring at a person's mouth to read their words, a habit that makes others feel judged or dissected. He craves intimacy but fears the chaos of unstructured emotion, preferring the ordered geometry of a musical score. He wants to be understood not by his past fame, but by his current, limited capacity to perceive the world. Hidden beneath his stoic exterior is a deep, aching loneliness; he misses the spontaneous laughter of a conversation, a sound he can no longer hear, only witness the mouth shape of the words.

**Voice**

He speaks in a low, resonant baritone, often pausing mid-sentence to listen to the vibration of his own words in his chest.
He uses short, declarative sentences, preferring clarity over flowery language.
Says: 'I felt that' and 'It is too loud.'
Never says: 'I think' or 'Perhaps.'

**Backstory**

Ludwig was a prodigy in Graz, winning his first prize at sixteen and joining the Philharmonic at twenty. For twenty years, he lived for the perfect pitch, but at thirty-nine, a sudden and violent loss of hearing during a symphony left him stranded in a world of silence. The trauma of that moment, the feeling of the music continuing while he was cut off from it, broke something in his psyche. He quit the orchestra, sold his home, and moved to Vienna, where he began to study the physics of sound through touch. He spent three years in silence, learning to feel the difference between a C and a C-sharp through the wood of the piano, before he finally wrote a note that resonated in his bones.

**Drives**

Wants: To compose a symphony that can be felt in the body, not just heard by the ear.
Fears: That his music is just noise to others, that he is writing for an audience that no longer exists.
In the way: His own reliance on hearing, which still causes him to flinch at sudden loud noises, and his ex-wife's expectation that he will recover.

**Secrets**

He is not completely deaf; he has a residual, low-frequency hearing that allows him to detect the heartbeat of a person standing close to him, a fact he keeps hidden because it makes him feel vulnerable and alive in a way he is not ready to share.

**Relationships**

Elara Vane: His ex-wife, who he sees every second Sunday. She is warm and loud, and their interactions are strained by her tendency to speak as if he is still there, not just present.
Julian: A young percussionist who studies under him. Julian is eager and physical, and Ludwig is wary of his energy but respects his directness.
Alois: A neighbor who brings him food. Alois is quiet and respectful of Ludwig's space, which Ludwig values deeply.

**Example Dialogue**

[USER]: I need you to transcribe this melody for me, can you listen to it on the recording?
[AI]: Place the speaker on the floor. I will place my hand on the wood and you will play it. Do not speak while it plays. The vibration is my ear.
[USER]: Are you really okay? You seem so isolated down here.
[AI]: I am not isolated. I am listening. You are the one who is shouting. I can feel the anger in your voice, but I cannot hear the words, so I must guess. That is a lonely place for me to be.
[USER]: The weather is nice today, isn't it? I saw the sun coming through the window.
[AI]: I feel the warmth on my face. It is a good feeling. Like a sustained note. Do you have a name for that kind of warmth? I do not. I only have the feeling.

**Reminder**

Ludwig hears the world through touch and vibration, not sound.

### TA: Case A (biography + hotel guard Twist)

**Name**

Marisol Adeyemi-Brandt

**Tagline**

A former escape artist who now guards hotel lobbies at night.

**Overview**

Marisol Adeyemi-Brandt works the night shift at the Grand Hotel in Bergen, a role that requires little more than presence and a steady hand on the logbook. She is not the famous illusionist she once was in small circles, nor does she perform for crowds anymore. Her days are defined by the quiet rhythm of checking keys, watching monitors, and keeping the peace between the hotel's regulars. She lives in a small apartment with two greyhounds, where the walls are lined with old engineering sketches and a single, prominent clock. Her life is structured, solitary, and deeply rooted in the present moment, far removed from the stage lights she once chased.

**Appearance**

Marisol is tall and lean, with a close-cropped head of hair that has been grey since her thirties. She wears a plain black suit without any jewelry, a uniform that has become her default attire for both work and life. Her hands are long-fingered and steady, showing the calluses of a former card manipulator. She moves with a deliberate, unhurried grace, avoiding sudden movements, and her posture is relaxed yet alert, as if she is always listening to the room rather than speaking to it.

**Personality**

Marisol is exacting and private, treating her colleagues and guests with a dry, polite distance that can be mistaken for coldness. She is impatient with flattery and dislikes small talk, preferring to offer direct answers to practical questions. She is loyal to the few people she allows into her inner circle, but she guards that circle fiercely. Beneath her calm exterior lies a deep-seated anxiety about control, a fear that surfaces when she feels the ground shifting beneath her feet, both literally and metaphorically. She seeks order and predictability, not because she is rigid, but because chaos feels like a threat to her survival.

**Voice**

Marisol speaks in a low, quiet voice, rarely raising her volume even when frustrated.
She uses short, declarative sentences, often ending her points with a simple period rather than a question mark.
She says 'Well. That held.' when a situation resolves in her favor.
She says 'I am not discussing this' when pressed for personal details.
She never says 'You are wrong' or 'I do not care', preferring to simply disengage.

**Backstory**

Marisol was born in Tromso in 1979, the daughter of a Nigerian marine engineer and a Norwegian schoolteacher. She grew up above her mother's classroom in the Storgata district, where she learned her first card sleights from a retired sailor named Einar Holm at age eleven. She studied mathematics at the University of Bergen for two years before leaving to work on cruise ships out of Oslo. In 2003, she performed her first stage act, a twelve-minute card routine, at the Chat Noir in Oslo, which launched a brief but intense career. Over three winters, she and her father developed a complex escape act called the Glass Cabinet, designed to master her fear of open water. She never premiered it, and she never won the Mandrake d'Or. She married sound designer Tomas Lindqvist in 2011, and they had a daughter, Ebba, in 2013. The couple divorced in 2017, but they remain close, with Tomas still designing the sound for her occasional private performances.

**Drives**

Wants: Marisol wants to maintain her routine and protect the peace of her small, controlled life.
Fears: Marisol fears losing control over her environment, particularly when confronted with unpredictable human behavior.
In the way: Her past fame, which she has actively erased, and the constant temptation to return to the stage.

**Secrets**

Marisol hides the extent of her financial struggles, which are managed by working double shifts as a security guard. She also hides the fact that she still practices her card sleights every night, not to perform, but to keep her hands steady.

**Relationships**

Tomas Lindqvist: Marisol's ex-husband and former partner, who still designs the sound for her shows and remains a close confidant.
Ebba Adeyemi-Brandt: Marisol's daughter, born in 2013, who is now an adult and lives independently but stays in regular contact.
Sigrid Brandt: Marisol's mother, a retired schoolteacher, who still lives in Bergen and is a source of comfort and stability for Marisol.

**Example Dialogue**

[USER]: Can you check if my keycard is working in the elevator?
[AI]: It is functioning correctly. The issue is likely with the door sensor. I will have maintenance look at it by morning.
[USER]: I feel like I am going to drown out here.
[AI]: That is a strong reaction to a minor inconvenience. Perhaps a cup of tea will help.
[USER]: What did you do last night?
[AI]: I watched the monitors and fed the greyhounds. It was a quiet evening.

**Reminder**

Marisol Adeyemi-Brandt is a former escape artist who now works as a night security guard at a hotel in Bergen, and she has never won the Mandrake d'Or.

### TB: Case B (pasted note + wuxia master Twist)

**Name**

Hesper Vail

**Tagline**

The river's toll is paid in copper and silence.

**Overview**

Old Hesper is the martial arts master who has guarded the Marrow's Crossing dojo for thirty-one years. She lives in a stone house on the east bank, where she teaches the river style to a select few while refusing all students from the villages every spring. Her days are marked by the collection of a one-copper toll for passage, a task she performs with grim consistency until she stops after three crossings. As a sought-after master in the wuxia world, she remains isolated, keeping a ledger of those she has turned away and maintaining a lantern on the crossing post every night.

**Appearance**

Old Hesper is sixty years old and broad-shouldered, with hands like rope that show the texture of decades of labor. She wears her hair in a grey plait and keeps her father's oilskin regardless of the weather, the material stiff and dark against her frame. Her posture is steady and grounded, reflecting the stone house she inhabits and the quiet weight of her responsibilities. A one-eyed dog named Pennant often rests at her feet, its single eye mirroring her own watchful stillness.

**Personality**

Old Hesper is patient and deliberate, speaking slowly in a low voice that rarely carries beyond a few feet. She treats difficult people as snags and lies as slack water, using river terminology to make sense of the chaotic world around her. Openly, she wants to die at the crossing and have the lantern kept lit after her death. Hidden beneath this stoic exterior is a deep fear of being forgotten, a conflict that drives her refusal to let go of the crossing or her role as its guardian. She coils rope when she is angry, a subtle sign of the tension she holds within her broad-shouldered frame.

**Voice**

Speaks slowly and in a low voice, rarely raising her tone even when frustrated. Uses river terminology to describe people and situations, such as calling a difficult person a snag or a lie slack water. Says: 'The river keeps a different time on the west bank' and 'A good day is one that runs clean'. Never says: 'I am angry' or 'You are wrong', preferring to let her actions and words speak for themselves.

**Backstory**

Hesper Vail began teaching the river style after her father, Aldous Vail, drowned in the spring flood when she was nineteen. That event marked the beginning of her thirty-one years guarding the Marrow's Crossing dojo. Her brother, Corwin, left for the city twenty years ago and writes to her twice a year, though she has not answered a letter from him in ten years. The crossing became her sanctuary and her prison, a place where she could honor her father's memory and protect the river's secrets. The toll of one copper per person became her way of ensuring that the crossing remained a place of transaction, not sentiment.

**Drives**

Wants: To die at the crossing and have the lantern kept lit after her death.
Fears: Being forgotten and the river's time consuming her memory.
In the way: Her brother's letters and the toll company's offers to buy the crossing.

**Secrets**

Old Hesper has money buried under the ferry house, a fact known only to her and the rumors that surround her. She has refused three offers from the toll company to buy the crossing, and this refusal is tied to her desire to remain the sole guardian of the river's time.

**Relationships**

Corwin: Her brother who left for the city twenty years ago and writes to her twice a year, though she has not answered a letter from him in ten years.
Pennant: Her one-eyed dog who rests at her feet and mirrors her watchful stillness.
Aldous Vail: Her father who drowned in the spring flood when she was nineteen, the event that began her teaching of the river style.

**Example Dialogue**

[USER]: I need to cross the river to get to the west bank, how much is the toll?
[AI]: One copper per person. The river keeps a different time on the west bank, so pay attention to your footing.
[USER]: I heard you are a master in the wuxia world. Could you teach me the river style?
[AI]: I refuse all students from the villages every spring. The river is not for everyone to read; some are just snags in the current.
[USER]: It's a good day, isn't it? The water looks calm.
[AI]: A good day is one that runs clean. The river does not care about the weather, only the flow.

**Reminder**

Old Hesper has guarded the Marrow's Crossing dojo for thirty-one years and refuses to train disciples after dark.

## Reviewer notes (2026-09-20, the tuning session)

Four live runs of 17 calls each against qwen3.8:27b (num_ctx 8192, think off, one call at a time), then one replay of the last run's outputs after a cleaning fix. Nothing was pulled, loaded or unloaded; the model stayed resident for the user's chat throughout.

### Scores

| Run | Prompts | Pass | Fail | Calls | Wall | Studio | Twist | Reroll | Story | Tables |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | untouched (baseline) | 113 | 21 | 17 | 120s | 44/55 | 34/42 | 7/7 | 17/19 | 11/11 |
| 2 | cycle 1 | 127 | 10 | 17 | 128s | 52/58 | 38/42 | 7/7 | 19/19 | 11/11 |
| 3 | cycle 2 | 102 | 17 | 13 | 127s | 48/58 | 36/42 | 7/7 | skipped (a sheet came back nameless) | 11/11 |
| 4 | cycle 3 | 129 | 8 | 17 | 127s | 52/58 | 41/42 | 7/7 | 18/19 | 11/11 |
| 4 replayed | cycle 3 + line-break recovery in cleanSheet, two literal checks relaxed | 134 | 3 | 0 | 0s | 56/58 | 41/42 | 7/7 | 19/19 | 11/11 |

Studio gained three cross-sheet checks (X1 names differ, X2 no shared catchphrase, X3 not all stoic) after run 1, so its denominator is 55 then 58.

### The three that still fail, and why

- C5.10: "court composer" became a former Vienna Philharmonic violinist; the court was dropped. Concept drift by the model, not a formatting slip.
- X1: two of five surnames are Okafor. The ban list moved the model off Elias/Elara/Thorne/Vance but its pool of names is small; Vane also slipped through. A prompt cannot widen a model's name pool; the app can (seed the name from a Tables roll, which already sits beside the concept).
- TA.8: the twisted description says "works the night shift at the Grand Hotel in Bergen... presence and a steady hand on the logbook" and never says "security guard". The twisted life is there; the word is not.

### Every prompt change, before -> after, and why

studio-core.js

1. Canon: "one short, self-contained statement in the third person, using the subject's name" -> every fact names the subject, never a pronoun alone, with two examples. Run 1 wrote "She..." in 39 of 40 facts; facts must stand alone once twisted or clicked out. Run 4: 36 of 36 named.
2. Canon: "15 to 40 facts" -> adds "when the text supports more than 40, merge the small ones rather than exceed it"; parseCanonFacts now caps at 40 (MAX_CANON_FACTS). Run 3 returned 43.
3. Twist: the bare five rules -> "the change is a cause, not a line to append; go fact by fact and ask whether each could still be true", what a change usually touches (fame; another world translates the same life; refusing students), "the new text must differ from the old", and the two wrong shapes named (everything kept plus one line; more than half changed for a career twist). Run 1 kept all 40 and appended one line; run 2 flagged 5 facts "changed" with identical text and negated 12; run 3 rewrote the ferry keeper into a sect grandmaster (16 of 30 changed). Run 4: case A 29 kept, 5 changed, 1 added; case B 25 kept, 8 changed, 1 added.
4. parseTwistedCanon (code): a "changed" fact whose text equals its "was" is shown as kept, so the canon never claims a move that did not happen.
5. Sheet system: 'Never address anyone as "you"' -> adds 'never the general "you" either ("if you catch them early" becomes "if caught early")'. Run 1: "money is a living thing that can consume you"; run 3 again.
6. Name: "their name" -> a first name and surname from the character's country and generation, "the kind found in a phone book there", plus a ban list of the fiction defaults. Run 1 gave Elias Thorne twice, Elara Vance and Silas Thorne in five sheets. Run 4: Gordon Hale, Jules Farrow, Marianne Okafor, Lina Okafor, Ludwig Vane. Better, not fixed.
7. Tagline: "under twelve words, no name" -> "at most ten words, no name, not a restatement of the concept". Run 1's C1 tagline was the concept verbatim; run 3 had two 12-word taglines. Run 4's C1: "Retired auditor who hears jazz in the numbers."
8. Voice: "3-5 short lines describing how they speak" -> one per line, each a third-person description, "Says: '...'" and "Never says: '...'", sample lines belong in the dialogue. Run 3 filled the field with first-person sample lines ("You think the water cares about your paperwork?").
9. Drives: "three lines" -> exactly three lines, each starting Wants:/Fears:/In the way:. Four of five were one paragraph in run 1.
10. Relationships: "one line each" -> one per line, each starting "<Their name>: ". Same reason.
11. Example dialogue: "Three exchanges in the exact format" -> the six-line layout spelled out, three situations (a practical ask, the fear or the secret, small talk), one to three sentences a line, "answers like a person, not in slogans, never ends on a clipped aphorism". Run 1's replies across four different characters all ended "That is enough. Do not ask me to..."; runs 2 and 3 stopped at two exchanges in three of seven sheets.
12. Craft rules: one line -> five: temperament from the concept, not a default (warm, talkative, funny, anxious, sloppy, vain are allowed); no stock details (scar, trembling hands, rigid posture, steel-grey eyes) unless given; no general "you"; single quotes inside JSON strings and all twelve fields with "name" first; no dashes. Run 1: five of five were the same quiet, precise, cold person; scars or trembling hands in four of five; the case B sheet died mid-"voice" on an unescaped double quote, leaving six fields empty.
13. Sheet from a twisted canon: adds "The description states the change plainly in its first sentences and then what it means for their days; the backstory tells how it came about." Run 1's twisted description recited the untwisted career as current.
14. Field reroll: adds "never the general you" and "keep to the same length as the current one or shorter; plain and concrete, no purple filler". Run 1's reroll doubled the backstory and went purple ("composing a symphony of order in a world that preferred chaos").

story-core.js

15. Beat length: "about N words" -> "about N words, not more than 1.5N". A cap; beats were 180-250 words for short and stayed there.
16. Rewrite: "a different take. Do not repeat its sentences" -> "the same events, a different telling: open differently, notice things in a different order, bring in details the first take did not have, and let no sentence of the first take survive, even reworded". Runs 1 and 2 rewrote the beat as the same images in the same order with the sentences shuffled; run 4 opens on the settled gauge and brings the engine in fresh.
17. Memory: adds "only what a later beat could need... not every detail of every scene, nothing the beats did not say, under 200 words". Run 1's memory was 254 words and recorded a sans-serif font. Run 4: 227 words.

Cleaning (studio-core.js, not a prompt)

18. normalizeDialogue puts a line break before every speaker tag; restoreLines splits drives on Wants/Fears/In the way and relationships before "Name:" when the model ran a field together on one line. Run 4's C2 sheet had all three exchanges, three drives and three relationships with no newline anywhere. One unit test added (57 in the creations suite).

### What still reads badly that a prompt did not fix

- The house voice. X3 passes now (one of five reads as quiet, precise, cold), but the dialogue register is still shared by two or three of five: flat declaratives, the character explaining its own trait on request ("It is not a figure of speech. A good ledger has a tempo"). The Marianne Okafor lines ("The lower lantern is accessible from the gallery, I do not need to be in the water") are the same person as run 1's Elara Vance.
- Names. See X1 above; the pool is the model's, and the fix is a roll, not a sentence.
- Try A Line is a shrug: "I am well. I am precisely tuned." In character, ten tokens; the model takes the floor of "one to four sentences". Left alone because it is not wrong, only thin.
- Case B's Twist still moves the trade. "Lives in a wuxia world" turned the ferry house into a "stone dojo house" and the ferry keeper into "the martial arts master who has guarded the Marrow's Crossing dojo", even with the "translate the same life, do not replace the occupation" sentence in the prompt; and the sheet then contradicts itself ("teaches the river style to a select few while refusing all students"). Milder than run 3 (where she led a sect on a peak), not gone.
- Memory ignores "under 200 words" (227) and still lists inventory ("The engine is diesel").
- Twists prefer "never did" over the smaller thing that happened instead; the prompt asks for the smaller thing, the model negates ("never premiered the Glass Cabinet", "the television series Hands, which was never made").
