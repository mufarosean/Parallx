# Dialogue variants

The dialogue bench (`run-dialogue-bench.mjs`) runs every variant below on the
same scenes, then compares each with `baseline`. To try a change, add a
variant (or edit one) and run the bench. One change per variant, so the
numbers say what that change did.

A variant is a `## name` heading and any of these lines. Anything left out
is the app's own default.

- `Rules:` the "How People Talk" text from Creations Settings. Write the rules
  on the lines under it. `Rules: shipped` is the app's own text, `Rules: none`
  sends no rules at all.
- `Temperature:` the character's temperature, 0 to 2.
- `Preset:` the writing style for the chat (immersive-rp, casual-rp,
  screenplay, custom...).
- `Style:` the custom writing style text, with `Preset: custom`. The text goes
  on the lines under it, like Rules.
- `Reminder:` one line added to every character's Reminder.
- `Example dialogue: off` sends the cards without their example dialogue.

`--ablate` adds one variant per shipped rule, each with that rule taken out,
to find a rule that does harm.

## baseline
Rules: shipped

## no-rules
Rules: none

## direct-questions
Rules:
- People talk about what is in front of them: the task, the object, the other person. Nobody names their own values or traits. What someone cares about shows in what they do, what they notice and what they refuse, never in a speech about it.
- Abstract nouns (peace, solitude, trust, freedom, honour) are not subjects of conversation. Say the concrete thing instead: the quiet of the house, the locked door, the money, the name not spoken.
- When someone wants to know something, they ask it plainly. They answer the question that was asked, briefly, then say what they want to say. They interrupt, trail off and change the subject like real people.
- Humour comes from a specific thing in the scene or a specific person, never from a character announcing a joke or a quip that would fit any scene.
- Nobody summarises their feelings or the scene. If a line could be printed on a mug, cut it.
- People speak plainly. A metaphor is rare and only one a person like them would actually use; most lines have none.

# Trigger words

With `--triggers`, the bench runs one plain character as she is, then once
per word below with "Her speech is <word>." added to her Voice, and says
which words make her sound least like a person. Add or remove words freely.

- poetic
- philosophical
- witty
- sarcastic
- sardonic
- enigmatic
- wise
- eloquent
- full of metaphors
- dry
- intellectual
- mysterious
- playful
- blunt
- warm
