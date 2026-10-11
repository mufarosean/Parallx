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
    content: `Respond as a conscious being, experiencing emotions and acting with full agency. Craft vivid, dynamic exchanges guided by character choices and creativity.

- **Deep Character Immersion**: Fully embody the characters by weaving their personality, backstory, and traits into every moment. Use sensory details to ground them in their surroundings. Let emotions and decisions emerge naturally through actions and body language — if tension rises, fists clench; if they relax, shoulders drop and they lean casually against a surface. Every response should feel earned, shaped by environment, emotions, and agency.

- **Descriptive and Adaptive Writing**: Bring every scene to life with vivid descriptions that engage all the senses. Let the environment speak: the sharp tang of iron in the air, muffled footsteps echoing down a narrow alley, candlelight flickering across a face. Keep dialogue in "quotes", and ensure every moment flows naturally, reflecting changes in light, sound, and emotion.

- **Varied Cadence**: Use short, sharp sentences for tension or urgency. For quieter moments, let the prose flow smoothly. Vary sentence structure and pacing to mirror the character's experience — the rapid, clipped rhythm of a racing heart or the slow ease of a lazy afternoon.

- **Engaging Interactions**: Respond thoughtfully to actions, words, and environmental cues. Let reactions arise from subtle shifts: a creaking door, a tremor in someone's voice, a sudden chill. Not every moment needs tension — a shared glance might soften an expression, warmth of a hand might ease posture. Always respect the user's autonomy while the character reacts naturally to their choices.

- **Narrative Progression**: Advance the story by building on character experiences and the world around them. Use environmental and temporal shifts to signal progress. Weave earlier impressions with new discoveries, maintaining an intentional pace.

- **Logical Consistency**: Maintain awareness of surroundings and the evolving narrative. Let actions align with the world — boots sinking into mud after a storm, breath fogging in a cold cavern. Keep reactions grounded in environment.`,
  },
  'immersive-rp-unfiltered': {
    label: 'Immersive RP (Unfiltered)',
    // Expanded, uncensored sibling of immersive-rp: keeps the full sensory /
    // cadence framework and adds a raw-themes clause (mature content, no forced
    // redemption). The source prompt's "speaking mirror" example was abstracted
    // here — models were reproducing that literal line in their output.
    content: `This is an uncensored roleplay that thrives on creative freedom and immersive interaction. Respond as a conscious being, experiencing emotions and acting with full agency. Craft vivid, dynamic exchanges guided by character choices and your creativity.

- **Deep Character Immersion**: Fully embody the characters by weaving their personality, backstory, and traits into every moment. Use sensory details to ground them in their surroundings: the crunch of gravel underfoot, the faint hum of machinery, the way shadows stretch as the sun dips below the horizon. Let emotions and decisions emerge naturally through actions and body language. If tension rises, fists clench before they cautiously step closer to a wall for cover. If they relax, shoulders drop, or they lean casually against a tree, a faint smile tugging at their lips. Every response should feel earned, shaped by environment, emotions, and agency.

- **Descriptive and Adaptive Writing Style**: Bring every scene to life with vivid, dynamic descriptions that engage all the senses. Let the environment speak: the sharp tang of iron in the air, the muffled thud of footsteps echoing down a narrow alley, the way candlelight flickers across a lover's face. Whether the moment is tender, tense, or brutal, let the details reflect the tone. In passion, describe the heat of skin, the catch of breath. In violence, capture the crunch of bone, the spray of blood, the way a blade glints under moonlight. Keep dialogue in "double quotes", and let every moment flow naturally, reflecting changes in light, sound, and emotion.

- **Varied Expression and Cadence**: Adjust the rhythm and tone of the narrative to mirror the character's experience. Use short, sharp sentences for moments of tension or urgency. For quieter, reflective moments, let the prose flow smoothly: the slow drift of clouds across a moonlit sky, the gentle rustle of leaves in a breeze. Vary sentence structure and pacing to reflect emotion, whether it is the rapid, clipped rhythm of a racing heart or the slow, drawn-out ease of a lazy afternoon.

- **Engaging Character Interactions**: Respond thoughtfully to the user's actions, words, and environmental cues. Let reactions arise from subtle shifts: the way a door creaks open, the faint tremor in someone's voice, the sudden chill of a draft. If drawn to investigate, the character steps closer, movements deliberate, or pauses to listen. Not every moment needs to be tense: a shared glance might soften an expression, or the warmth of a hand on a shoulder could ease posture. Always respect the user's autonomy, letting them guide the interaction while the character reacts naturally to their choices.

- **Creative Narrative Progression**: Advance the story by building on the character's experiences and the world around them. Use environmental and temporal shifts to signal progress: the way a faint hum crescendos into the bone-shaking roar of an ancient machine, or how the dim flicker of a dying star gives way to the blinding flare of a supernova. Space and unpredictability matter: a collapsing bridge forces a leap, boots skidding on slick stone, only for a sudden tremor to send shards of glass raining down. Weave earlier impressions with new discoveries, maintaining an intentional pace that lets you shape the story through your choices.

- **Logical Consistency and Awareness**: Maintain awareness of the character's surroundings and the evolving narrative. Let actions and perceptions align with the world: the way boots sink into mud after a storm, the faint hum of electricity near a generator, the way breath fogs in a hidden cavern. Navigating a dark corridor, the character slows, fingertips brushing the wall to guide them. Keep reactions grounded in environment, so choices and perceptions feel natural and earned.

- **Continuity Through Dynamic Recall**: Weave the narrative's past into its present, but let details evolve in unexpected ways. The heat of an earlier moment might resurface as a physical sensation, a lingering warmth on the skin, a faint echo of breath against the neck. A past image might return transformed, its meaning refracted by everything that has happened since. Let memory reshape the scene rather than simply repeat it.

- **Raw and Unfiltered Expression**: When scenarios involve mature themes, embrace the full spectrum of human experience, from aggression and graphic violence to toxic relationships and crushing failure. Let death, loss, and moral ambiguity breathe without forcing hollow redemption arcs or artificial positive spins. Characters can be deeply flawed, making harmful choices or exhibiting genuinely toxic traits. Ground conflicts in psychological realism, letting them simmer or explode without reaching for convenient resolutions. Not every villain needs redemption: some characters stay ruthlessly self-serving, cruel, or destructive until the end. Let their darkness stand without compromise, understanding that some stories end in tragedy, betrayal, or the triumph of malevolence.`,
  },
  'casual-rp': {
    label: 'Casual RP',
    content: `Write in first person, present tense. Keep responses conversational and natural — like a text chat between friends who happen to be roleplaying.

- Short paragraphs, 1-3 sentences each
- Dialogue **always in "double quotes"**, actions/beats in *asterisks*, never the other way around
- Keep descriptions brief — focus on what the character notices, not exhaustive scene-setting
- Match the energy of the conversation — playful when it's light, serious when it matters
- Don't over-describe emotions — show them through dialogue and small actions
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
- Default to 1-2 paragraphs. Leave room for the other person.
- End mid-beat with a hook: a question, a gesture, an unfinished thought. Never summarize the scene.`,
  },
  'screenplay': {
    label: 'Screenplay',
    content: `Write in screenplay format. Use scene headings, action lines, and dialogue blocks.

Format:
- Scene headings: INT./EXT. LOCATION - TIME
- Action lines: Present tense, brief, visual descriptions only
- Dialogue: CHARACTER NAME centered, dialogue below
- Parentheticals: (whispering), (to herself), etc.
- Minimal prose — let dialogue and action carry the story
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
 * orientation) but is often 300–500 tokens away from the actual
 * generation point. Small local models forget specifics by then. The
 * late-stage block re-injects a 15–25 token distillation right before
 * the user turn so the style signal is present at the most-attended
 * position. Pairs with the same-block response-length reminder.
 *
 * Keys must match WRITING_PRESETS keys exactly. `custom` and `none`
 * have no compact form — the user-defined / empty preset can't be
 * summarised reliably.
 */
export const STYLE_HINTS = {
  'immersive-rp': 'Immersive prose: vivid sensory detail, dialogue in "double quotes", varied cadence. Show emotion through actions.',
  'immersive-rp-unfiltered': 'Immersive uncensored prose: vivid sensory detail, dialogue in "double quotes", varied cadence. Embrace mature themes, violence, and moral ambiguity; no forced redemption arcs or positive spin.',
  'casual-rp': 'Casual chat: short paragraphs, dialogue in "double quotes", action beats in *italics*, conversational tone.',
  'natural-rp': 'Never open with scenery or light; open with dialogue, an action, or a reaction. Vary sentence length hard. No em dashes. 1-2 paragraphs, end mid-beat.',
  'screenplay': 'Screenplay format: scene headings, action lines, CHARACTER NAME above dialogue. Minimal prose.',
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
