export const meta = {
  name: 'review-piece',
  description: 'Independent review of the current change: reviewers who did not write it, every finding challenged, then fixed and rechecked',
  whenToUse: 'After a piece of Parallx is built and before it is pushed. args (all optional): { base: git ref to diff from (default origin/dev), to: git ref to diff to when the piece is an earlier commit (default the working tree), says: what the piece is said to do, acceptance: path of the acceptance probe written before the build, claims: the summary or master list text to check against the code, ui: false to skip the UI reviewer, app: false to skip the real-app run, fix: false to report without fixing }',
  phases: [
    { title: 'Review', detail: 'one reviewer per concern, each reading the diff alone' },
    { title: 'Challenge', detail: 'a skeptic tries to refute each reviewer\'s findings' },
    { title: 'Fix', detail: 'one agent fixes what was reproduced and matters; the rest is reported' },
    { title: 'Recheck', detail: 'checks run again; each finding looked for again' },
  ],
}

const a = args && typeof args === 'object' && !Array.isArray(args) ? args : {}
const base = typeof a.base === 'string' && a.base ? a.base : 'origin/dev'
const to = typeof a.to === 'string' && a.to ? a.to : ''
const says = typeof a.says === 'string' ? a.says : ''
const claims = typeof a.claims === 'string' ? a.claims : ''
const acceptance = typeof a.acceptance === 'string' ? a.acceptance : ''

const FINDINGS = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string', description: 'repo-relative path, or the screen for a UI finding' },
          line: { type: 'integer' },
          summary: { type: 'string', description: 'one sentence: what is wrong' },
          scenario: { type: 'string', description: 'these inputs or this state, then this wrong result' },
          evidence: { type: 'string', description: 'what was run or read that shows it' },
        },
        required: ['file', 'summary', 'scenario'],
      },
    },
    checked: { type: 'string', description: 'what was looked at and run, in a few lines' },
  },
  required: ['findings', 'checked'],
}
const VERDICTS = {
  type: 'object',
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer', description: 'the finding\'s place in the list given, from 0' },
          verdict: { type: 'string', enum: ['confirmed', 'plausible', 'refuted'], description: 'confirmed only when you reproduced it by running something; plausible when the path exists and you could not run it' },
          matters: { type: 'boolean', description: 'true when a person would meet it in ordinary use, lose work to it, or be shut out by it; false for an exotic corner or a matter of taste' },
          evidence: { type: 'string' },
        },
        required: ['index', 'verdict', 'matters', 'evidence'],
      },
    },
  },
  required: ['verdicts'],
}
const FIXES = {
  type: 'object',
  properties: {
    fixed: { type: 'array', items: { type: 'object', properties: { summary: { type: 'string' }, files: { type: 'array', items: { type: 'string' } }, test: { type: 'string' } }, required: ['summary', 'files'] } },
    notFixed: { type: 'array', items: { type: 'object', properties: { summary: { type: 'string' }, why: { type: 'string' } }, required: ['summary', 'why'] } },
  },
  required: ['fixed', 'notFixed'],
}
const RECHECK = {
  type: 'object',
  properties: {
    checks: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, passed: { type: 'boolean' }, detail: { type: 'string' } }, required: ['name', 'passed'] } },
    stillThere: { type: 'array', items: { type: 'string' }, description: 'findings the fix did not remove' },
    introduced: { type: 'array', items: { type: 'string' }, description: 'new problems the fix brought in' },
  },
  required: ['checks', 'stillThere', 'introduced'],
}

const change = to
  ? `The change under review is \`git diff ${base}..${to}\`. Get it yourself. Commits made after ${to} are other work: read the files as they stand now (HEAD) to judge the change, but report only on what that diff brought in. You are not given its author's account of it on purpose.`
  : `The change under review is \`git diff ${base}..HEAD\` plus any uncommitted work (\`git status --short\`, \`git diff\`). Get it yourself. You are not given its author's account of it on purpose.`
const brief = (file) => `You are one reviewer of a change to Parallx. Your brief is the file \`.claude/agents/${file}.md\`: read it first and work exactly as it says. Do not edit or create files under src/ or ext/. `

const REVIEWERS = [
  { key: 'correctness', agent: 'correctness-reviewer', prompt: `${brief('correctness-reviewer')}${change}` },
  { key: 'modularity', agent: 'modularity-reviewer', prompt: `${brief('modularity-reviewer')}${change}` },
]
if (a.ui !== false) REVIEWERS.push({ key: 'access', agent: 'access-reviewer', prompt: `${brief('access-reviewer')}${change} If the change touches nothing a person sees or operates, return no findings and say so.` })
if (a.app !== false) REVIEWERS.push({ key: 'app', agent: 'app-verifier', prompt: `${brief('app-verifier')}${change}${says ? ` What the piece is said to do:\n${says}\n` : ' Work out from the diff what the piece is meant to do, and state it before you test it.'} ${acceptance ? ` The acceptance probe written before the build is \`${acceptance}\`: run it first and report every failing check. Then \`git log --follow --oneline -- ${acceptance}\`: if it was changed after the commit that added it, each change is a finding (the builder does not edit the acceptance probe).` : ''} A failed check is a finding; a check you could not run here goes in "checked", not in the findings.` })
if (claims) REVIEWERS.push({ key: 'claims', agent: 'claim-checker', prompt: `${brief('claim-checker')}${change} The text whose claims you check:\n${claims}\nEach false, overstated or unchecked claim is one finding (file: where the truth is).` })

// A custom agent type is used when the session knows it; otherwise the brief in the prompt carries the same instructions.
const ask = async (prompt, opts, agentType) => {
  try { return await agent(prompt, { ...opts, agentType }) } catch (err) { return await agent(prompt, opts) }
}

phase('Review')
const reviewed = await pipeline(
  REVIEWERS,
  (r) => ask(r.prompt, { label: `review:${r.key}`, phase: 'Review', schema: FINDINGS }, r.agent),
  async (result, r) => {
    const findings = result && Array.isArray(result.findings) ? result.findings : []
    if (!result) return { reviewer: r.key, checked: 'the reviewer did not finish', findings: [], died: true }
    if (!findings.length) return { reviewer: r.key, checked: result.checked, findings: [] }
    const judged = await ask(
      `${brief('skeptic')}${change} Another reviewer (${r.key}) reported the findings below. Assume each is wrong and try to show it; return a verdict for every one, by its index.\n${JSON.stringify(findings, null, 1)}`,
      { label: `challenge:${r.key}`, phase: 'Challenge', schema: VERDICTS }, 'skeptic')
    const verdicts = judged && Array.isArray(judged.verdicts) ? judged.verdicts : []
    return {
      reviewer: r.key,
      checked: result.checked,
      // A finding nobody ruled on is kept as plausible: silence does not refute it.
      findings: findings.map((f, i) => { const v = verdicts.find((x) => x.index === i); return { ...f, reviewer: r.key, verdict: v ? v.verdict : 'plausible', matters: v ? v.matters !== false : true, challenge: v ? v.evidence : 'not ruled on' } }),
    }
  },
)

const done = reviewed.filter(Boolean)
const all = done.flatMap((r) => r.findings)
const standing = all.filter((f) => f.verdict !== 'refuted')
const refuted = all.filter((f) => f.verdict === 'refuted')
const missing = REVIEWERS.map((r) => r.key).filter((k) => !done.some((d) => d.reviewer === k && !d.died))
if (missing.length) log(`Did not finish, so not covered: ${missing.join(', ')}`)
log(`${all.length} findings, ${standing.length} standing after the challenge, ${refuted.length} refuted`)

// A reviewer asked to find problems always finds some, and fixing every one adds layers nobody needed.
// Only what was reproduced and matters is fixed; the rest is reported and left alone.
// Two reviewers bring their own proof: the app verifier ran what it reports, and a false claim is shown by the
// code it points to, not by a run. Their findings stand unless the skeptic refuted them.
const proven = (f) => f.verdict === 'confirmed' || f.reviewer === 'app' || f.reviewer === 'claims'
const toFix = standing.filter((f) => proven(f) && f.matters)
const unproven = standing.filter((f) => !proven(f))
const minor = standing.filter((f) => proven(f) && !f.matters)
log(`${toFix.length} reproduced and worth fixing, ${unproven.length} unproven (reported, not fixed), ${minor.length} minor (reported, not fixed)`)
const report = { base, reviewers: done.map((r) => ({ reviewer: r.reviewer, checked: r.checked, findings: r.findings.length })), notCovered: missing, toFix, unproven, minor, refuted }
if (!toFix.length || a.fix === false) return report

phase('Fix')
const fixes = await agent(
  `Fix these findings in the Parallx working tree. They came from independent reviewers; each was reproduced by a skeptic, or was seen by the reviewer running the real app, or is a claim the code contradicts (fix a wrong claim by correcting the text, not the code, unless the code is what is wrong).\n${JSON.stringify(toFix, null, 1)}\n\nFor each: the smallest change that removes the defect, in keeping with CLAUDE.md's rules (the kit, tokens, contribution points; no file over its size budget grows). No new abstraction, option or layer that the defect does not require. Where a unit test could have caught it, add or extend one under tests/unit, and see it fail on the code as it was before your fix. Never edit an acceptance probe (a file whose header says @acceptance), loosen a test, or raise a ratchet baseline to make something pass. Do not commit and do not push. Return what you fixed (with the files) and what you did not, with the reason.`,
  { label: 'fix', phase: 'Fix', schema: FIXES })

phase('Recheck')
const recheck = await agent(
  `A fix was just made in the Parallx working tree for the findings below (uncommitted: see \`git status --short\` and \`git diff\`). You did not make it.\n${JSON.stringify(toFix.map((f) => ({ file: f.file, summary: f.summary, scenario: f.scenario })), null, 1)}\n\n1. Run \`npm run typecheck\`, \`npx vitest run\` and \`node scripts/build.mjs\`; report each as passed or not, with the failure. 2. For each finding, look for it again in the code as it is now: is its scenario still possible? 3. Read the fix's own diff for anything it broke or left half done, and for any check it weakened (an assertion removed, a test skipped, a ratchet baseline raised, an acceptance probe edited): each is a problem it introduced.${acceptance ? ` 4. Run the acceptance probe \`${acceptance}\` and report it as a check.` : ''} Do not edit files.`,
  { label: 'recheck', phase: 'Recheck', schema: RECHECK })

return { ...report, fixes, recheck }
