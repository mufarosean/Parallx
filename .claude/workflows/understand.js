export const meta = {
  name: 'understand',
  description: 'Read several parts of Parallx at once and return one map: what each part is, what it stores, how it is entered, and where the parts meet or overlap',
  whenToUse: 'Before changing or joining systems that grew apart (for example Study, Flashcards and the Worksheets problem program). args: { question: what needs to be understood (required), areas: [paths or names of the parts to read] (required) }',
  phases: [
    { title: 'Read', detail: 'one reader per part' },
    { title: 'Map', detail: 'the parts set side by side' },
    { title: 'Gaps', detail: 'what the map leaves unread or unproven' },
  ],
}

const a = args && typeof args === 'object' && !Array.isArray(args) ? args : {}
const question = typeof a.question === 'string' ? a.question.trim() : ''
const areas = Array.isArray(a.areas) ? a.areas.filter((x) => typeof x === 'string' && x.trim()) : []
if (!question || !areas.length) return { error: 'Pass args.question and args.areas (paths or names of the parts to read).' }

const PART = {
  type: 'object',
  properties: {
    what: { type: 'string', description: 'what the part is and what a person does with it' },
    files: { type: 'array', items: { type: 'string' }, description: 'the files that matter, with a few words each' },
    nouns: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, meaning: { type: 'string' }, storedIn: { type: 'string' } }, required: ['name', 'meaning'] } },
    entries: { type: 'array', items: { type: 'string' }, description: 'commands, menus, editors, views: how a person or another tool gets in' },
    seams: { type: 'array', items: { type: 'object', properties: { seam: { type: 'string' }, direction: { type: 'string', enum: ['offers', 'uses'] }, where: { type: 'string' } }, required: ['seam', 'direction', 'where'] } },
    specific: { type: 'array', items: { type: 'string' }, description: 'what is tied to one exam, one user or one workflow rather than general' },
    notRead: { type: 'array', items: { type: 'string' } },
  },
  required: ['what', 'files', 'nouns', 'entries', 'seams', 'notRead'],
}
const GAPS = {
  type: 'object',
  properties: {
    gaps: { type: 'array', items: { type: 'object', properties: { claim: { type: 'string' }, problem: { type: 'string' }, check: { type: 'string', description: 'what to read or run to settle it' } }, required: ['claim', 'problem', 'check'] } },
  },
  required: ['gaps'],
}

phase('Read')
const parts = (await parallel(areas.map((area) => () =>
  agent(
    `Read one part of the Parallx repository and describe it from its code, not from its docs alone. The part: ${area}. The question the reading serves: ${question}\nRead the files themselves (the manifest, the entry point, the data layer and its migrations, the panes). Report what the part is, the files that matter, its nouns and where each is stored, how a person or another tool enters it, every seam it offers or uses (contribution points, registries, commands other tools call), and what in it is specific to one exam or one user. List what you did not read. Every statement must be one you can point to a file for.`,
    { label: `read:${area}`, phase: 'Read', schema: PART }).then((r) => (r ? { area, ...r } : null))))).filter(Boolean)

const missing = areas.filter((x) => !parts.some((p) => p.area === x))
if (missing.length) log(`Not read (the reader did not finish): ${missing.join(', ')}`)
if (!parts.length) return { question, error: 'No part was read.', notRead: missing }

phase('Map')
const map = await agent(
  `Question: ${question}\nBelow is what separate readers found in each part of Parallx. Set the parts side by side: 1. one paragraph per part; 2. a table of nouns that mean the same thing under different names, and nouns that share a name and differ; 3. where the parts already meet (which seam, which direction); 4. where they overlap (two parts doing the same job); 5. what is specific to one exam or user in each. Use only what is below; where the readers disagree or left something unread, say so.\n${JSON.stringify(parts, null, 1)}`,
  { label: 'map', phase: 'Map' })

phase('Gaps')
const critic = await agent(
  `A map of several parts of Parallx was written to answer: ${question}\nYour job is to find what it rests on that was not read or not shown. Check a sample of its statements against the code yourself. List each statement that is unsupported, wrong or decisive-but-unverified, and what to read or run to settle it.\n\nThe map:\n${map}\n\nWhat each reader said it did not read:\n${JSON.stringify(parts.map((p) => ({ area: p.area, notRead: p.notRead })), null, 1)}`,
  { label: 'gaps', phase: 'Gaps', schema: GAPS })

return { question, parts: parts.map((p) => p.area), notRead: missing, map, gaps: critic ? critic.gaps : [] }
