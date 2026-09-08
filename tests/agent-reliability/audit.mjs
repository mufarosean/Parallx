// Re-score retained evidence independently, including runs from older harness
// versions. Do not overwrite original verdicts or conceal failed attempts.
import fs from 'node:fs/promises';
import path from 'node:path';
import { artifactRoot } from './isolation.mjs';
import { assess } from './task.mjs';
const since = process.argv.find(s => s.startsWith('--since='))?.slice(8) ?? '';
const rows = [];
for (const dir of await fs.readdir(artifactRoot, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  const root = path.join(artifactRoot, dir.name);
  const read = name => fs.readFile(path.join(root, name), 'utf8').then(JSON.parse, () => null);
  const marker = await read('run.json');
  if (!marker || marker.created < since || !/^(live|deterministic)-/.test(marker.name)) continue;
  const result = await read('evidence/result.json');
  if (!result?.pass) continue;
  const final = await read('evidence/final.json');
  const oracle = await read('evidence/oracle.json');
  const artifacts = await read('evidence/artifacts.json');
  const reportName = ['instruction', 'combined'].includes(result.scenario) ? 'revised.md' : 'report.md';
  const failures = assess(oracle, artifacts.files, reportName).failures;
  if (final.result?.errorDetails || !final.session.messages.at(-1)?.response.isComplete) failures.push('Final turn incomplete or errored');
  const requests = new Map();
  for (const name of await fs.readdir(path.join(root, 'evidence'))) {
    if (!/^(phase-one|after-compact|after-pressure|before-restart|denied|final)\.json$/.test(name)) continue;
    const state = await read(`evidence/${name}`);
    for (const request of state?.requests ?? []) requests.set(request.at, request);
  }
  let promptTokens = 0, completionTokens = 0;
  const compactions = [];
  for (const request of requests.values()) {
    const pending = [];
    for (const message of request.messages) {
      if (message.role === 'assistant') pending.push(...(message.toolCalls ?? []).map(c => c.function.name));
      else if (message.role === 'tool') {
        const index = pending.indexOf(message.toolName);
        if (index < 0) failures.push(`Orphan tool result ${message.toolName} in request ${request.at}`);
        else pending.splice(index, 1);
      } else if (pending.length) failures.push(`Unresolved tool calls before ${message.role} in request ${request.at}`);
    }
    if (pending.length) failures.push(`Missing tool results in request ${request.at}`);
    // Only final usage chunks carry provider token totals. Counters here sum
    // each unique request, including compaction, across process restarts.
    const usage = request.chunks?.findLast(c => c.promptEvalCount !== undefined || c.evalCount !== undefined);
    promptTokens += usage?.promptEvalCount ?? 0;
    completionTokens += usage?.evalCount ?? 0;
    if (request.messages[0]?.content.startsWith('You are compacting an agent conversation')) {
      compactions.push({ inputCharacters: request.messages.reduce((n, m) => n + m.content.length, 0), outputCharacters: request.chunks?.reduce((n, c) => n + (c.content?.length ?? 0), 0) ?? null });
    }
  }
  rows.push({ root, scenario: result.scenario, mode: result.mode, pass: !failures.length, failures: [...new Set(failures)], requests: requests.size, promptTokens, completionTokens, compactions, cleanupError: await read('evidence/close-error.json') });
}
await fs.writeFile(path.join(artifactRoot, 'audit-results.json'), JSON.stringify({ since, generated: new Date().toISOString(), rows }, null, 2));
console.log(JSON.stringify({ audited: rows.length, passed: rows.filter(r => r.pass).length, failures: rows.filter(r => !r.pass), cleanupErrors: rows.filter(r => r.cleanupError).map(r => r.root) }, null, 2));
process.exitCode = rows.some(r => !r.pass) ? 1 : 0;
