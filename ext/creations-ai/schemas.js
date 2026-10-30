// schemas.js — the shape of every Creations answer that is JSON.
//
// A structured call used to ask for `format: 'json'`: any JSON at all, so a
// model could answer {"text": ...} for {"brief": ...} and the parser found
// nothing. Each call with a fixed shape now sends its JSON schema as the
// format; Ollama and OpenAI-compatible servers hold the model's answer to it
// (constrained decoding), and the parsers stay as they are for the providers
// that do not. The prompts still describe the shape, so a model that ignores
// the schema reads the same request as before. Studio's calls ask for many
// different shapes through one function and keep plain JSON.

const str = { type: 'string' };
const num = { type: 'number' };

/** An object schema with every listed property required. */
function object(properties) {
  return { type: 'object', properties, required: Object.keys(properties) };
}

/** Memory fact categories, in the order the memory file lists them. */
export const MEMORY_CATEGORY_ORDER = ['relationship', 'trait', 'event', 'place', 'preference', 'other'];

/** Act: the next act's brief (acts.js buildNextActMessages). */
export const NEXT_ACT_SCHEMA = object({ brief: str });

/** Test drive: one line per situation (drive.js buildSituationsMessages). */
export const SITUATIONS_SCHEMA = object({
  situations: { type: 'array', items: object({ kind: { type: 'string', enum: ['work', 'pressure', 'idle'] }, line: str }) },
});

/** Story: the running memory (story-core.js buildMemoryMessages). */
export const STORY_MEMORY_SCHEMA = object({ memory: str });

/** Chat memory: new facts and beats from the last exchanges (main.js). */
export const MEMORY_EXTRACT_SCHEMA = object({
  facts: { type: 'array', items: object({ text: str, category: { type: 'string', enum: MEMORY_CATEGORY_ORDER }, confidence: num }) },
  beats: { type: 'array', items: object({ summary: str, importance: num }) },
});

/** Since then: one line for each character named (since-then.js). */
export function sinceThenSchema(names) {
  const name = names && names.length ? { type: 'string', enum: [...names] } : str;
  return object({ since: { type: 'array', items: object({ name, line: str }) } });
}
