export const meta = {
  name: 'acceptance-first',
  description: 'Before a piece is built: a verifier writes its acceptance probe from the request alone, proves it fails on the app as it is, and a skeptic checks the probe cannot pass by accident',
  whenToUse: 'At the start of a piece of Parallx, before any of it is built. args: { request: what was asked for, in the owner\'s words where possible (required), name: short kebab-case name for the probe file (required) }',
  phases: [
    { title: 'Write', detail: 'the probe, from the request, run against the app as it is' },
    { title: 'Challenge', detail: 'could a check pass without the piece working?' },
  ],
}

const a = args && typeof args === 'object' && !Array.isArray(args) ? args : {}
const request = typeof a.request === 'string' ? a.request.trim() : ''
const name = typeof a.name === 'string' ? a.name.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') : ''
if (!request || !name) return { error: 'Pass args.request (what was asked for) and args.name (a short name for the probe).' }
const file = `tests/probes/${name}-acceptance.mjs`

const PROBE = {
  type: 'object',
  properties: {
    path: { type: 'string' },
    checks: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, readsBack: { type: 'string', description: 'what the check reads from the app to decide' }, failsNow: { type: 'boolean', description: 'true when it fails on the app as it is today' } }, required: ['name', 'readsBack', 'failsNow'] } },
    cannotCheckHere: { type: 'array', items: { type: 'string' }, description: 'parts of the request that need the owner\'s model, card or Windows' },
    unclear: { type: 'array', items: { type: 'string' }, description: 'what the request leaves open, and the reading the probe took' },
  },
  required: ['path', 'checks', 'cannotCheckHere', 'unclear'],
}
const VERDICTS = {
  type: 'object',
  properties: {
    checks: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, sound: { type: 'boolean' }, problem: { type: 'string', description: 'how it could pass without the piece working, or what part of the request it misses' } }, required: ['name', 'sound'] } },
    missing: { type: 'array', items: { type: 'string' }, description: 'things the request asks for that no check covers' },
  },
  required: ['checks', 'missing'],
}
const ask = async (prompt, opts, agentType) => {
  try { return await agent(prompt, { ...opts, agentType }) } catch (err) { return await agent(prompt, opts) }
}

phase('Write')
const probe = await ask(
  `Your brief is \`.claude/agents/app-verifier.md\`; read it and \`.claude/skills/run-hidden/SKILL.md\` first. A piece of Parallx is about to be built. Before it exists, you write the probe that will decide whether it works.\n\nThe request:\n${request}\n\nWrite \`${file}\` from \`.claude/skills/run-hidden/probe-template.mjs\`. Its header must carry this line exactly: \`// @acceptance: written from the request before the build. The builder does not edit this file.\` Work from the request, not from any plan for how it will be built: each check does what a person would do (mouse, keys, a file opened) and reads the result back from the app (a value, a file on disk, what is on screen). Include the hard cases: empty, twice, another tab shown, the app closed and opened, the tool turned off. You may read the app's code to learn how to reach a surface; where the surface does not exist yet, name the command or control you expect and say so under "unclear". Then run the probe against the app as it is today. Every check for the new behaviour must fail now: a check that already passes proves nothing, so rewrite it or drop it. Do not build any part of the piece. Last, commit the probe alone (\`git add ${file} && git commit -m "Acceptance probe for ${name}, written before the build"\`), so that any later edit to it shows in its history; do not push.`,
  { label: 'write the probe', phase: 'Write', schema: PROBE }, 'app-verifier')
if (!probe) return { error: 'The probe was not written.', file }

phase('Challenge')
const verdict = await ask(
  `Your brief is \`.claude/agents/skeptic.md\`. Read the acceptance probe \`${probe.path || file}\`. It was written before the piece exists, from this request:\n${request}\n\nFor every check in it: could it pass while the piece does not work? Look for a check that reads back what the probe itself wrote, one that only looks for an element or a string that could be there for another reason, one with no real comparison, one that swallows its own errors. Then list what the request asks for that no check covers. Do not edit the probe.`,
  { label: 'challenge the probe', phase: 'Challenge', schema: VERDICTS }, 'skeptic')

const ruled = verdict && Array.isArray(verdict.checks) ? verdict.checks : []
const weak = ruled.filter((c) => !c.sound)
// A check nobody ruled on is not known to be sound: silence is not a pass.
const notChallenged = probe.checks.filter((c) => !ruled.some((v) => v.name === c.name)).map((c) => c.name)
const alreadyPass = probe.checks.filter((c) => !c.failsNow)
if (!verdict) log('The challenge did not finish: no check has been shown to be sound')
else if (notChallenged.length) log(`${notChallenged.length} checks were not ruled on by the skeptic`)
if (weak.length) log(`${weak.length} checks could pass without the piece working`)
if (alreadyPass.length) log(`${alreadyPass.length} checks already pass on the app as it is, so they prove nothing`)
return { path: probe.path || file, checks: probe.checks.length, challenged: !!verdict, alreadyPass, weak, notChallenged, missing: verdict ? verdict.missing : [], cannotCheckHere: probe.cannotCheckHere, unclear: probe.unclear }
