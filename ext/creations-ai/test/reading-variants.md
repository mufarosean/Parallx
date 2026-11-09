# Reading variants

The reading bench (`run-reading-bench.mjs`) plays every variant below on the
same five scenes and compares each with `baseline`. One change per variant,
so the numbers say what that change did. A variant is a `## name` heading and
any of these lines; anything left out is the app's own default.

- `Preset:` the writing style the chat runs in (immersive-rp, natural-rp,
  casual-rp, screenplay, custom...). The style judge is shown the preset's
  label.
- `Style:` the custom writing style text (sets `Preset: custom`). The text
  goes on the lines under it.
- `Label:` what the style judge is shown for this variant, when the preset's
  own label would give the game away or two variants share a preset.
- `Rules:` the "How People Talk" text. `shipped` is the app's own text,
  `none` sends no rules, `shipped +` is the app's text with the lines under
  it added; anything else replaces it.
- `Temperature:` the characters' temperature, 0 to 2.

## baseline
Label: Immersive RP
Rules: shipped

## natural-rp
Preset: natural-rp
Rules: shipped

## screenplay
Preset: screenplay
Rules: shipped

## casual-rp
Preset: casual-rp
Rules: shipped

## conversation-rules
What the conversation rules do on their own, with the baseline style.
Label: Immersive RP with conversation rules
Rules: shipped +
- Every line answers what was just said, then adds one thing of the speaker's own. A question gets an answer, or a dodge the other person notices and names.
- A line leaves the other person something to answer: a question, a claim they can take or refuse, an offer, a request, an action that needs a reaction. Nobody says a thing and stops.
- People who have just met do what people do: names, where from, what they do, what brings them here; and they take up the answers.
- When something is said, the listener has a view of it: they agree, doubt, worry, plan, or remember. It shows in what they say next.

## novel
Close third person, past tense, with the character's thinking on the page.
Label: Novel (close third)
Rules: shipped
Style:
Write as a chapter of a literary novel. Close third person, past tense, one viewpoint: the character who is speaking. Never another character's thoughts.
Scene: every reply is a beat in a scene. The viewpoint character wants something in this exchange, and the reply moves it: they get closer, are refused, change tack, or learn something.
Talk: people answer what was just said, then add one thing of their own. A question gets an answer, or a dodge the other person notices. Strangers do what strangers do: names, where from, what brings you here, and they take up the answers. A line leaves the other person something to answer. Nobody says a thing and stops.
Thinking: between the lines, the viewpoint character's mind is on the page: what they notice, what they weigh, what they decide not to say, what the moment reminds them of. Never name the feeling ("she felt sad"); give the thought and the body.
Mechanics: "said" and "asked", or an action beat; at most one beat per line of dialogue. Paragraphs of one to four sentences. Dialogue in double quotes. Past tense throughout, no slips into the present. No em dashes.
Prose: concrete and particular; no stock images; sentences of different lengths. Two to five paragraphs. End the reply mid-scene, on something the other person has to answer.

## novel-no-thinking
The novel style without the thinking rule, to see what that rule does.
Label: Novel, outward only
Rules: shipped
Style:
Write as a chapter of a literary novel. Close third person, past tense, one viewpoint: the character who is speaking. Never another character's thoughts.
Scene: every reply is a beat in a scene. The viewpoint character wants something in this exchange, and the reply moves it: they get closer, are refused, change tack, or learn something.
Talk: people answer what was just said, then add one thing of their own. A question gets an answer, or a dodge the other person notices. Strangers do what strangers do: names, where from, what brings you here, and they take up the answers. A line leaves the other person something to answer. Nobody says a thing and stops.
Mechanics: "said" and "asked", or an action beat; at most one beat per line of dialogue. Paragraphs of one to four sentences. Dialogue in double quotes. Past tense throughout, no slips into the present. No em dashes.
Prose: concrete and particular; no stock images; sentences of different lengths. Two to five paragraphs. End the reply mid-scene, on something the other person has to answer.

## unfiltered
The Unfiltered sibling of the baseline preset, after it was given the same page.
Preset: immersive-rp-unfiltered
Label: Immersive RP (Unfiltered)
Rules: shipped
