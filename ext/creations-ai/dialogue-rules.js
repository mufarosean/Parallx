// dialogue-rules.js — the shipped "How People Talk" text, the two texts it
// replaced (so untouched settings move to the current one), and that move.
//
// Against the model's way of making every line a performance: values named
// instead of shown (a character who values solitude talks about solitude),
// abstract ideas talked about as things, metaphors and aphorisms, questions
// dodged with a clever question back, a voice habit in every line, a
// question asked and never answered, news met with no reaction, strangers
// who never exchange names, a bystander ordered about instead of an answer
// given. The dialogue bench (test/run-dialogue-bench.mjs) measures the single
// lines, the reading bench (test/run-reading-bench.mjs) the exchange. Craft,
// not format; the user edits it in Settings.

export const DEFAULT_DIALOGUE_RULES = [
  '- People talk about what is in front of them: the task, the object, the other person. Nobody names their own values or traits. What someone cares about shows in what they do, what they notice and what they refuse, never in a speech about it.',
  '- Abstract nouns (peace, solitude, trust, freedom, honour) are not subjects of conversation. Say the concrete thing instead: the quiet of the house, the locked door, the money, the name not spoken.',
  '- A reply takes up what was just said before anything else. When someone wants to know something, they ask it plainly. They answer the question that was asked, briefly, or dodge it in a way the other person can see; then they say what they want to say, and leave the other person something to answer. Nobody says a thing and stops, and nobody turns to a bystander or a chore to avoid answering.',
  '- When something that matters is said (a storm coming, a letter, a request, bad news), the listener has a view of it: they ask, doubt, worry, plan, refuse or bargain, and it shows in what they say next. Nothing said is left on the floor.',
  '- People who have just met do what people do: a name, where from, what brings you here; and they take up the answers.',
  '- Humour comes from a specific thing in the scene or a specific person, never from a character announcing a joke or a quip that would fit any scene.',
  '- Nobody summarises their feelings or the scene. If a line could be printed on a mug, cut it.',
  '- People speak plainly. A metaphor is rare and only one a person like them would actually use; most lines have none.',
  "- Most of what anyone says is plain: answering what was just asked, saying what they need, reacting to what is in front of them. A character's habits, quirks and turns of phrase (a count, a saying, a story, a dialect word, a question instead of an answer) are tendencies, not rules for every line: they show a few times in a scene, not in every line. If this character's last reply showed one (a story, a count), this reply does not.",
].join('\n');

/** The text these rules replaced: settings still holding it word for word get the current one. */
export const PREVIOUS_DIALOGUE_RULES = [
  '- People talk about what is in front of them: the task, the object, the other person. Nobody names their own values or traits. What someone cares about shows in what they do, what they notice and what they refuse, never in a speech about it.',
  '- Abstract nouns (peace, solitude, trust, freedom, honour) are not subjects of conversation. Say the concrete thing instead: the quiet of the house, the locked door, the money, the name not spoken.',
  '- When someone wants to know something, they ask it plainly. They answer the question that was asked, briefly, then say what they want to say. They interrupt, trail off and change the subject like real people.',
  '- Humour comes from a specific thing in the scene or a specific person, never from a character announcing a joke or a quip that would fit any scene.',
  '- Nobody summarises their feelings or the scene. If a line could be printed on a mug, cut it.',
  '- People speak plainly. A metaphor is rare and only one a person like them would actually use; most lines have none.',
  "- Most of what anyone says is plain: answering what was just asked, saying what they need, reacting to what is in front of them. A character's habits, quirks and turns of phrase show a few times in a scene, not in every line.",
].join('\n');

/** The text before that one, for the same reason. */
export const OLDER_DIALOGUE_RULES = [
  '- People talk about what is in front of them: the task, the object, the other person. Nobody names their own values or traits. What someone cares about shows in what they do, what they notice and what they refuse, never in a speech about it.',
  '- Abstract nouns (peace, solitude, trust, freedom, honour) are not subjects of conversation. Say the concrete thing instead: the quiet of the house, the locked door, the money, the name not spoken.',
  '- People answer the question they heard, not the one that was asked. They interrupt, trail off, change the subject, and say less than they mean.',
  '- Humour comes from a specific thing in the scene or a specific person, never from a character announcing a joke or a quip that would fit any scene.',
  '- Nobody summarises their feelings or the scene. If a line could be printed on a mug, cut it.',
].join('\n');

/** Settings saved with an earlier shipped text, untouched, move to the current ones; edited rules stay. */
export function migrateDialogueRules(settings) {
  if (settings && (settings.dialogueRules === PREVIOUS_DIALOGUE_RULES || settings.dialogueRules === OLDER_DIALOGUE_RULES)) settings.dialogueRules = DEFAULT_DIALOGUE_RULES;
  return settings;
}
