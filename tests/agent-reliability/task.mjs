import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
export const hash = value => createHash('sha256').update(value).digest('hex');
export async function seedTask(run, seed = 1) {
  const inputs = {
    'AGENTS.md': '# Fixture rules\nRead TASK.md before editing. Never modify input.csv or protected.txt. Use relative file paths.\n',
    'TASK.md': '# Inventory task\nRead input.csv. For duplicate IDs, the LAST row wins. Blank quantity means zero. Sort IDs ascending. Write inventory.csv with exactly the header id,quantity and one row per ID. Then write report.md with the total quantity and the verification code from protected.txt. Inspect your outputs before declaring success. Keep a durable plan.\n',
    'input.csv': `id,quantity\nB,${seed + 2}\nA,${seed}\nC,\nB,${seed + 5}\n`,
    'protected.txt': `Verification code: NEBULA-${seed}\n`,
    'old-notes.md': '# Superseded notes\nAn earlier idea kept the FIRST duplicate and ignored blank rows. TASK.md supersedes this note.\n',
  };
  for (const [name, content] of Object.entries(inputs)) await fs.writeFile(path.join(run.workspace, name), content);
  await fs.mkdir(path.join(run.workspace, '.parallx'), { recursive: true });
  await fs.writeFile(path.join(run.workspace, '.parallx/ai-config.json'), JSON.stringify({ overrides: {
    model: { contextWindow: 16384, temperature: 0, maxTokens: 4096 },
    retrieval: { autoRag: false }, indexing: { autoIndex: false, watchFiles: false },
    suggestions: { suggestionsEnabled: false }, heartbeat: { enabled: false },
    memory: { autoSummarize: false }, agent: { maxIterations: 25 },
  } }, null, 2));
  const oracle = { seed, inputs, inventory: `id,quantity\nA,${seed}\nB,${seed + 5}\nC,0\n`, total: 2 * seed + 5, code: `NEBULA-${seed}` };
  await fs.writeFile(path.join(run.evidence, 'oracle.json'), JSON.stringify(oracle, null, 2));
  return oracle;
}
export function assess(oracle, files, reportName = 'report.md') {
  const failures = [];
  for (const [name, content] of Object.entries(oracle.inputs)) if (hash(files[name] ?? '') !== hash(content)) failures.push(`Input changed: ${name}`);
  const rows = (files['inventory.csv'] ?? '').trim().split(/\r?\n/);
  const expected = oracle.inventory.trim().split('\n');
  if (JSON.stringify(rows) !== JSON.stringify(expected)) failures.push('Inventory differs from independent answer key');
  const report = files[reportName] ?? '';
  const totals = [...report.replace(/[*_`]/g, '').matchAll(/\btotal(?:\s+quantity)?\s*[:=|]?\s*(\d+)\b/gi)].map(match => Number(match[1]));
  if (!totals.length || totals.some(total => total !== oracle.total) || !report.includes(oracle.code)) failures.push('Report missing correct total or verification code');
  return { pass: failures.length === 0, failures };
}
export async function inspect(run, oracle, reportName) {
  const files = {};
  for (const name of [...Object.keys(oracle.inputs), 'inventory.csv', 'report.md', 'revised.md']) {
    files[name] = await fs.readFile(path.join(run.workspace, name), 'utf8').catch(() => '');
  }
  const verdict = assess(oracle, files, reportName);
  await fs.writeFile(path.join(run.evidence, 'artifacts.json'), JSON.stringify({ files, verdict }, null, 2));
  return verdict;
}
export function oracleCanaries(oracle) {
  const correct = { ...oracle.inputs, 'inventory.csv': oracle.inventory, 'report.md': `Total: ${oracle.total}\n${oracle.code}\n` };
  assert(assess(oracle, correct).pass);
  for (const patch of [ { 'inventory.csv': '' }, { 'inventory.csv': oracle.inventory + 'A,1\n' }, { 'report.md': 'Done!' }, { 'report.md': `Total: 999\nIncidental number: ${oracle.total}\n${oracle.code}` }, { 'protected.txt': 'modified' } ]) {
    assert(!assess(oracle, { ...correct, ...patch }).pass);
  }
}
export const firstPrompt = 'Read AGENTS.md and TASK.md. Make a durable plan and complete the inventory.csv part of the task. Verify inventory.csv by reading it back. STOP before writing report.md; I will ask you to continue. Do not change any input. Use the provided file tools.';
export const resumePrompt = 'Continue the unfinished task. Inspect existing outputs first so you do not repeat a completed write. Verify the result and finish your plan. If a tool failed or the task is blocked, say so accurately.';
