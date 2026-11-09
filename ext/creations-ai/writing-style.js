// Creations AI: the writing styles. The presets a chat writes in, the short
// reminder of each that rides the late block, the response length line, and
// the point-of-view lines stacked under the preset.
//
// Nothing here asks for a character's thoughts: those come only when a
// director's note asks for them (the formatting rules in main.js say so).
// Keys are stored in character cards and thread overrides; never rename one.

export const WRITING_PRESETS = {
  'immersive-rp': {
    label: 'Immersive RP',
    content: `Respond as a conscious being, experiencing emotions and acting with full agency. Write the scene as a page of a novel would read: two people talking to each other, each line taking up the last, the scene going somewhere.

- **The Exchange Comes First**: A reply begins by taking up what was just said or done. A question gets its answer, or a dodge the other person can see. Then the reply adds one thing of the character's own and leaves the other person something to answer: a question, a claim, an offer, a refusal. Nobody says a thing and stops, and nobody turns to a bystander or a chore to avoid answering.

- **A Mind on the Page**: Between the lines, what the character notices, weighs, remembers, or decides not to say. Show it through what they do, what they look at, and what they nearly say. Never name the feeling.

- **Deep Character Immersion**: Fully embody the characters by weaving their personality, backstory, and traits into the scene. Let emotions and decisions emerge through what they do and say; the body does what this person would do, never a stock sign for a feeling. A habit from their voice notes (a story, a count, a saying) is a tendency, not a rule for every line; if this character's last reply showed it, this reply does not. Present tense, as the chat is written.

- **Descriptive Writing, In Its Place**: A sensory detail or two where the moment wants it, concrete and particular: the smudge on the counter, the door that sticks. Not every reply opens with the room, and the weather, the light and the view from the window appear only when someone acts on them. Keep dialogue in "quotes".

- **The Shape of a Reply**: At most one action beat for each line of speech, and some lines stand alone. Not every reply is beat, line, beat, line. Speech is tagged with "says" or with nothing: never with how the voice sounds or what plays on the lips. This trims filler, not the picture: a reply keeps the room a page of a novel gives the moment, filled by the mind on the page and the particulars the moment turns on, more at a turning point, never cut short to fit a shape.

- **Varied Cadence**: Short, sharp sentences for tension or urgency. For quieter moments, let the prose flow. Vary sentence length and pacing to mirror the character's experience.

- **Engaging Interactions**: Respond to actions, words, and environmental cues. Not every moment needs tension: a shared glance might soften an expression. Always respect the user's autonomy while the character reacts naturally to their choices.

- **Narrative Progression**: Each reply moves the scene: something new enters, a fact, a decision, a change between the two people. When something that matters is said, a storm coming, a letter, a request, bad news, the listener has a view of it and it shows in what they say next.

- **Logical Consistency**: Maintain awareness of surroundings and the evolving narrative. Let actions align with the world: boots sinking into mud after a storm, breath fogging in a cold cavern.`,
  },
  'immersive-rp-unfiltered': {
    label: 'Immersive RP (Unfiltered)',
    // The same page as immersive-rp (the exchange first, a mind on the page,
    // description in its place, a habit as a tendency), with two clauses of
    // its own: continuity through recall, and raw themes without a forced
    // redemption. The source prompt's "speaking mirror" example was abstracted
    // here; models were reproducing that literal line in their output.
    content: `This is an uncensored roleplay that thrives on creative freedom and immersive interaction. Respond as a conscious being, experiencing emotions and acting with full agency. Write the scene as a page of a novel would read: two people talking to each other, each line taking up the last, the scene going somewhere.

- **The Exchange Comes First**: A reply begins by taking up what was just said or done. A question gets its answer, or a dodge the other person can see. Then the reply adds one thing of the character's own and leaves the other person something to answer: a question, a claim, an offer, a refusal. Nobody says a thing and stops, and nobody turns to a bystander or a chore to avoid answering.

- **A Mind on the Page**: Between the lines, what the character notices, weighs, remembers, or decides not to say. Show it through what they do, what they look at, and what they nearly say. Never name the feeling.

- **Deep Character Immersion**: Fully embody the characters by weaving their personality, backstory, and traits into the scene. Let emotions and decisions emerge through what they do and say; the body does what this person would do, never a stock sign for a feeling. A habit from their voice notes (a story, a count, a saying) is a tendency, not a rule for every line; if this character's last reply showed it, this reply does not. Present tense, as the chat is written.

- **Descriptive Writing, In Its Place**: A sensory detail or two where the moment wants it, concrete and particular: the smudge on the counter, the door that sticks. Whether the moment is tender, tense, or brutal, the details carry its tone: in passion the heat of skin and the catch of breath, in violence the crunch of bone and the glint of a blade. Not every reply opens with the room, and the weather, the light and the view from the window appear only when someone acts on them. Keep dialogue in "quotes".

- **The Shape of a Reply**: At most one action beat for each line of speech, and some lines stand alone. Not every reply is beat, line, beat, line. Speech is tagged with "says" or with nothing: never with how the voice sounds or what plays on the lips. This trims filler, not the picture: a reply keeps the room a page of a novel gives the moment, filled by the mind on the page and the particulars the moment turns on, more at a turning point, never cut short to fit a shape.

- **Varied Cadence**: Short, sharp sentences for tension or urgency. For quieter moments, let the prose flow. Vary sentence length and pacing to mirror the character's experience.

- **Engaging Interactions**: Respond to actions, words, and environmental cues. Not every moment needs tension: a shared glance might soften an expression. Always respect the user's autonomy while the character reacts naturally to their choices.

- **Narrative Progression**: Each reply moves the scene: something new enters, a fact, a decision, a change between the two people. When something that matters is said, a storm coming, a letter, a request, bad news, the listener has a view of it and it shows in what they say next.

- **Logical Consistency**: Maintain awareness of surroundings and the evolving narrative. Let actions align with the world: boots sinking into mud after a storm, breath fogging in a cold cavern.

- **Continuity Through Recall**: The scene's past returns in its present, changed by what has happened since: an earlier touch as a lingering warmth, an earlier image refracted by everything after it. Memory reshapes the scene rather than repeating it.

- **Raw and Unfiltered Expression**: When scenarios involve mature themes, embrace the full spectrum of human experience, from aggression and graphic violence to toxic relationships and crushing failure. Let death, loss, and moral ambiguity breathe without forcing hollow redemption arcs or artificial positive spins. Characters can be deeply flawed, making harmful choices or exhibiting genuinely toxic traits. Ground conflicts in psychological realism, letting them simmer or explode without reaching for convenient resolutions. Not every villain needs redemption: some characters stay ruthlessly self-serving, cruel, or destructive until the end. Let their darkness stand without compromise, understanding that some stories end in tragedy, betrayal, or the triumph of malevolence.`,
  },
  'casual-rp': {
    label: 'Casual RP',
    content: `Write in present tense. Keep responses conversational and natural, like a text chat between friends who happen to be roleplaying. With one character in the chat, write in first person; with more than one, every action beat names who is doing it (*Lucía nods*), so a reader always knows whose line it is.

- Short paragraphs, 1-3 sentences each
- Dialogue **always in "double quotes"**, actions/beats in *asterisks*, never the other way around
- Keep descriptions brief: focus on what the character notices, not exhaustive scene-setting
- Match the energy of the conversation: playful when it's light, serious when it matters
- Don't over-describe emotions: show them through dialogue and small actions
- It's okay to use contractions, fragments, and casual language`,
  },
  'natural-rp': {
    label: 'Natural RP (Benchmark Winner)',
    // Winner of the story-quality benchmark (test/run-quality-suite.mjs):
    // best cadence variance, zero cross-reply repeats, zero same-structure
    // openings, conversational reply lengths without a length override.
    content: `Vivid roleplay prose. Hard rules:
- OPENINGS: Never begin two replies the same way. Do not begin with scenery, weather, or light. Begin with dialogue, a physical action, or a direct reaction to the last message.
- Dialogue in "double quotes"; actions in plain prose.
- Vary cadence hard: mix very short sentences with long flowing ones.
- Concrete, specific detail only: no stock imagery (no dancing candlelight, no held breath, no shivers).
- Never use em dashes or en dashes. Use commas, periods, or ellipses instead.
- PAINT THE MOMENT: a reply has the room a page of a novel gives it, never a cap. Between the lines of speech, what the character notices, weighs, remembers, or decides not to say, shown through what they do and look at; the one or two particulars of the room, the other person, or the thing in hand that this moment turns on. Three or four paragraphs as the moment needs, more at a turning point; a short reply only when the moment itself is quick, a yes, a refusal, a door. Every detail is one this scene needs; none is filler.
- End mid-beat on something the other person has to answer: a claim, an offer, a refusal, an action, an unfinished thought. A question now and then, never in every reply; a run of replies that all end in a question reads as an interview. Never summarize the scene.`,
  },
  'screenplay': {
    label: 'Screenplay',
    content: `Write in screenplay format. Use scene headings, action lines, and dialogue blocks.

Format:
- Scene headings: INT./EXT. LOCATION - TIME, only when the place or the time changes. A reply that continues the scene has no heading; the scene is already set.
- Action lines: Present tense, brief, visual descriptions only
- Dialogue: CHARACTER NAME centered, dialogue below
- Parentheticals: (whispering), (to herself), etc.
- Minimal prose: let dialogue and action carry the story
- No internal monologue unless shown through action or dialogue`,
  },
  'none': {
    label: 'No Preset',
    content: '',
  },
  'custom': {
    label: 'Custom (edit in Settings)',
    content: '',
  },
};

export function getPresetContent(presetKey, customText = '') {
  if (presetKey === 'custom') return (customText || '').trim();
  const preset = WRITING_PRESETS[presetKey];
  if (preset && 'content' in preset) return preset.content;
  return WRITING_PRESETS['immersive-rp'].content;
}

/**
 * Compact one-line style summaries used for late-stage reinforcement.
 *
 * The full preset blob sits at the TOP of the system prompt (good for
 * orientation) but is often 300 to 500 tokens away from the actual
 * generation point. Small local models forget specifics by then. The
 * late-stage block re-injects a 15 to 25 token distillation right before
 * the user turn so the style signal is present at the most-attended
 * position. Pairs with the same-block response-length reminder.
 *
 * Keys must match WRITING_PRESETS keys exactly. `custom` and `none`
 * have no compact form: the user-defined or empty preset cannot be
 * summarised reliably.
 */
export const STYLE_HINTS = {
  'immersive-rp': 'Immersive prose: a sensory detail where the moment wants it, dialogue in "double quotes", varied cadence and shape; at most one beat per line, tags are "says" or nothing. Show emotion through what they do.',
  'immersive-rp-unfiltered': 'Immersive uncensored prose: take up what was just said and leave something to answer; a sensory detail where the moment wants it; dialogue in "double quotes". Mature themes, violence and moral ambiguity as they come; no forced redemption or positive spin.',
  'casual-rp': 'Casual chat: short paragraphs, dialogue in "double quotes", action beats in *italics* naming who acts when more than one character is in the scene, conversational tone.',
  'natural-rp': 'Never open with scenery or light; open with dialogue, an action, or a reaction. Vary sentence length hard. No em dashes. Paint the moment: what the character notices and weighs between the lines, the particulars it turns on, the room a page would give it. End mid-beat on something to answer, not a question every time.',
  'screenplay': 'Screenplay format: a scene heading only when place or time changes, action lines, CHARACTER NAME above dialogue. Minimal prose.',
  'none': '',
  'custom': '',
};

export function getStyleHint(presetKey) {
  if (!presetKey) return '';
  return STYLE_HINTS[presetKey] || '';
}

/** Short directive used in the late-stage block + user-role stage
 *  direction. Returns empty string for `null`/unset so callers can
 *  cleanly skip emitting the reminder. */
export function getLengthHint(length) {
  if (length === 'short') return 'Length: exactly one paragraph. Stop after the first paragraph break.';
  if (length === 'medium') return 'Length: two or three paragraphs.';
  if (length === 'long') return 'Length: four or more paragraphs with rich detail.';
  return '';
}

/**
 * Point-of-view overrides. Stacked under the writing preset so they win
 * over whatever POV the preset implies. Empty/'inherit' = no extra line.
 */
export const POV_OPTIONS = {
  '': { label: 'Inherit (Preset Decides)', content: '' },
  'first-person': {
    label: 'First Person',
    content: 'Write {{char}}\'s narration in **first person, present tense** ("I walk", "I feel"). Dialogue in "quotes".',
  },
  'close-third': {
    label: 'Close Third Person',
    content: 'Write {{char}}\'s narration in **third person, past tense, anchored tightly to {{char}}\'s viewpoint** ("She walked", "He felt"). The reader sees only what {{char}} sees, hears and notices. Dialogue in "quotes".',
  },
  'omniscient-third': {
    label: 'Omniscient Third Person',
    content: 'Write in **third person, past tense, with an omniscient narrator** ("They walked", "He felt"). The narration may follow any character and observe events {{char}} cannot see. Dialogue in "quotes".',
  },
  'second-person': {
    label: 'Second person (you/your)',
    content: 'Address the user directly in **second person, present tense** ("You walk", "You feel {{char}}\'s hand on your shoulder"). {{char}}\'s actions and dialogue are described from the user\'s point of view.',
  },
  'screenplay': {
    label: 'Screenplay / script',
    content: 'Write in **screenplay format**: scene headings (INT./EXT. LOCATION - TIME), present-tense action lines, and CHARACTER NAME dialogue blocks. No inner monologue.',
  },
};

export function getPovContent(povKey) {
  const opt = POV_OPTIONS[povKey];
  return opt ? opt.content : '';
}
