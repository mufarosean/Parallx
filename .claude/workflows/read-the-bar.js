export const meta = {
  name: 'read-the-bar',
  description: 'Read the bar for a feature from primary sources: pick the sources, read each, check each reading against its page, then set it out',
  whenToUse: 'Before a surface or feature of Parallx is designed. args: { feature: what is being designed (required), questions: [the questions the design turns on], sources: [products or guidelines to include], max: how many sources to read (default 5) }',
  phases: [
    { title: 'Sources', detail: 'what the app already has, and which products and guidelines to read' },
    { title: 'Read', detail: 'one reader per source, from its own pages' },
    { title: 'Check', detail: 'a second agent opens the cited pages and tests the statements' },
    { title: 'Set out', detail: 'statements, disagreements, what could not be read' },
  ],
}

const a = typeof args === 'string' ? { feature: args } : (args && typeof args === 'object' ? args : {})
const feature = typeof a.feature === 'string' ? a.feature.trim() : ''
if (!feature) return { error: 'Pass args.feature: what is being designed.' }
const questions = Array.isArray(a.questions) ? a.questions.filter((q) => typeof q === 'string') : []
const given = Array.isArray(a.sources) ? a.sources.filter((s) => typeof s === 'string') : []
const max = Number.isInteger(a.max) && a.max > 0 ? Math.min(a.max, 12) : 5

const PLAN = {
  type: 'object',
  properties: {
    inApp: { type: 'array', items: { type: 'object', properties: { what: { type: 'string' }, where: { type: 'string' } }, required: ['what', 'where'] }, description: 'what Parallx already has that does this or overlaps it' },
    sources: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, kind: { type: 'string', enum: ['product', 'guideline', 'study'] }, why: { type: 'string' }, startAt: { type: 'array', items: { type: 'string' } } }, required: ['name', 'kind', 'why'] } },
  },
  required: ['inApp', 'sources'],
}
const READING = {
  type: 'object',
  properties: {
    statements: { type: 'array', items: { type: 'object', properties: { topic: { type: 'string' }, statement: { type: 'string', description: 'testable: what the product does or the source says' }, quote: { type: 'string' }, url: { type: 'string' } }, required: ['topic', 'statement', 'url'] } },
    unusual: { type: 'array', items: { type: 'string' } },
    couldNotRead: { type: 'array', items: { type: 'object', properties: { url: { type: 'string' }, why: { type: 'string' } }, required: ['url', 'why'] } },
  },
  required: ['statements', 'couldNotRead'],
}
const CHECKED = {
  type: 'object',
  properties: {
    results: { type: 'array', items: { type: 'object', properties: { index: { type: 'integer' }, holds: { type: 'string', enum: ['yes', 'no', 'page not readable'] }, note: { type: 'string' } }, required: ['index', 'holds'] } },
  },
  required: ['results'],
}

const ask = async (prompt, opts, agentType) => {
  try { return await agent(prompt, { ...opts, agentType }) } catch (err) { return await agent(prompt, opts) }
}
const qs = questions.length ? `The design turns on these questions:\n- ${questions.join('\n- ')}\n` : ''

phase('Sources')
const plan = await agent(
  `Parallx is about to design: ${feature}.\n${qs}First search the repository (ext/, src/built-in/, docs/) for what the app already has that does this or overlaps it, under other names too, and list it with paths. Then choose the sources to read: the products that are best at this, any platform guideline that applies (WCAG, Windows, Apple, Material), and published studies where a question is empirical.${given.length ? ` Include these: ${given.join(', ')}.` : ''} Give each a reason and one or two URLs of its own pages to start from. Order them best first. Do not report what they do yet.`,
  { label: 'sources', phase: 'Sources', schema: PLAN })
const sources = plan && Array.isArray(plan.sources) ? plan.sources : []
if (!sources.length) return { feature, error: 'No sources were chosen.', inApp: plan ? plan.inApp : [] }
const reading = sources.slice(0, max)
if (sources.length > max) log(`Reading ${max} of ${sources.length} sources; left out: ${sources.slice(max).map((s) => s.name).join(', ')}`)

phase('Read')
const read = await pipeline(
  reading,
  (s) => ask(
    `Your brief is \`.claude/agents/bar-researcher.md\`: read it first and work as it says. Feature: ${feature}.\n${qs}Your one source: ${s.name} (${s.kind}). Start at: ${(s.startAt || []).join(', ') || 'its own help or docs pages'}. Read its own pages today and bring back testable statements, each with the URL it was read on and the exact words where wording matters. List every page you could not read.`,
    { label: `read:${s.name}`, phase: 'Read', schema: READING }, 'bar-researcher'),
  async (result, s) => {
    const statements = result && Array.isArray(result.statements) ? result.statements : []
    if (!result) return { source: s.name, kind: s.kind, statements: [], unusual: [], couldNotRead: [{ url: s.name, why: 'the reader did not finish' }] }
    if (!statements.length) return { source: s.name, kind: s.kind, statements: [], unusual: result.unusual || [], couldNotRead: result.couldNotRead || [] }
    const judged = await agent(
      `Another agent read ${s.name} and reported the statements below, each with the URL it says it read it on. Open each URL yourself and say whether the page supports the statement: yes, no, or page not readable. Assume a statement is wrong until the page shows it. Do not use what you remember of the product.\n${JSON.stringify(statements.map((x, i) => ({ index: i, statement: x.statement, url: x.url })), null, 1)}`,
      { label: `check:${s.name}`, phase: 'Check', schema: CHECKED })
    const results = judged && Array.isArray(judged.results) ? judged.results : []
    return {
      source: s.name, kind: s.kind, unusual: result.unusual || [], couldNotRead: result.couldNotRead || [],
      statements: statements.map((x, i) => { const r = results.find((y) => y.index === i); return { ...x, source: s.name, checked: r ? r.holds : 'not checked', note: r ? r.note : undefined } }),
    }
  },
)

const done = read.filter(Boolean)
const statements = done.flatMap((d) => d.statements)
const held = statements.filter((s) => s.checked === 'yes')
const failed = statements.filter((s) => s.checked === 'no')
const unchecked = statements.filter((s) => s.checked !== 'yes' && s.checked !== 'no')
const couldNotRead = done.flatMap((d) => d.couldNotRead.map((c) => ({ ...c, source: d.source })))
log(`${statements.length} statements: ${held.length} held up, ${failed.length} did not, ${unchecked.length} could not be checked`)

phase('Set out')
const bar = await agent(
  `Set out the bar for: ${feature}.\n${qs}\nStatements a second agent found on the cited page:\n${JSON.stringify(held, null, 1)}\n\nStatements whose page could not be opened to check (mark each "unchecked"):\n${JSON.stringify(unchecked, null, 1)}\n\nWhat Parallx already has:\n${JSON.stringify(plan.inApp || [], null, 1)}\n\nWrite: 1. the statements grouped by topic, each ending with its source and URL; 2. where the sources disagree and what each is optimising for; 3. what is unusual and few do; 4. what the app already has that a design must build on or replace. Plain sentences, no recommendation, nothing that is not in the statements above.`,
  { label: 'set out', phase: 'Set out' })

return { feature, inApp: plan.inApp || [], bar, held: held.length, droppedAsUnsupported: failed, unchecked: unchecked.length, couldNotRead, sourcesNotRead: sources.slice(max).map((s) => s.name) }
