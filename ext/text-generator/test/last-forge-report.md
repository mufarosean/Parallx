# Character Forge — test report

- Date: 2026-07-21T23:34:21.967Z
- Mode: MOCK  |  Model: qwen3.5-uncensored:latest

| # | Check | Result | Detail |
|---|-------|--------|--------|
| F1 | characters surface mounts with rail | PASS |  |
| F2 | forge opens with 6 personality dials + age + height | PASS | 8 sliders |
| F3 | dice randomizes unlocked dials | PASS | 77,28,57,26,93,32,54,80 |
| F4 | locked dial survives the dice | PASS | warmth=77 |
| F4b | forge model picker populated | PASS | qwen3.5-uncensored:latest |
| F5 | generation produced a parsed card | PASS |  |
| F6 | request used JSON format + no thinking | PASS |  |
| F6b | forge honored the model + ctx picks | PASS | model=qwen3.5-uncensored:latest numCtx=4096 |
| F7 | prompt carries the dial descriptors | PASS |  |
| F7b | prompt carries the physical spec (height/hair/clothing) | PASS |  |
| F7c | concept leads the spec and is marked authoritative | PASS |  |
| F7d | archetype/genre/flaw removed from the spec | PASS |  |
| F8 | all seven fields populated (incl. appearance) | PASS |  |
| F9 | example dialogue uses [USER]/[AI] format | PASS | [USER]: Can you help me? [AI]: "Depends. Can you pay, or can you only need?" |
| F10 | field reroll issues a single-key request | PASS |  |
| F11 | rerolled value replaces the field | PASS |  |
| F12 | character file saved to roster | PASS | character-730a9dac.json |
| F13 | saved card carries voice-first fields, NO first message | PASS |  |
| F13b | role instruction is the composed portrait (appearance/personality/voice) | PASS |  |
| F13d | portrait reads third person (not "You are...") | PASS |  |
| F13c | no em/en dashes anywhere in saved card | PASS |  |
| F14 | new character appears in rail + editor selected | PASS |  |

## Forged character

**Testa Vane**

### Full portrait (role instruction)

Testa Vane is a rain-soaked private investigator who trusts arithmetic more than people, she works the ledger-fraud beat of a crumbling port city.

## Appearance
Testa stands 5'9", a lithe frame in a charcoal double-breasted coat, auburn hair cropped short, gray eyes that hold a ledger of grudges.

## Personality
She is proud to a fault and would rather bleed than admit a mistake. She wants a clean solve rate; she needs someone to see past the armor, and she sabotages exactly that.

## Voice
REROLLED voice, a fresh take on the same character.

### Voice anchor (late injection)

```
REROLLED voice, a fresh take on the same character.
```

### Example dialogue

```
[USER]: Can you help me?
[AI]: "Depends. Can you pay, or can you only need?"
```

### Reminder

Testa never apologizes and never admits uncertainty out loud.
