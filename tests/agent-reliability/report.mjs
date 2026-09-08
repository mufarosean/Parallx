// Aggregates durable per-run verdicts, retaining failed runs and incomplete
// runs. Concurrent invocations never depend on the convenience latest file.
import fs from 'node:fs/promises';
import path from 'node:path';
import { artifactRoot } from './isolation.mjs';
const runs = [];
for (const dir of await fs.readdir(artifactRoot, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  const root = path.join(artifactRoot, dir.name);
  const marker = await fs.readFile(path.join(root, 'run.json'), 'utf8').then(JSON.parse, () => null);
  if (!marker || !/^(live|deterministic)-/.test(marker.name)) continue;
  const result = await fs.readFile(path.join(root, 'evidence/result.json'), 'utf8').then(JSON.parse, () => null);
  runs.push({ ...marker, root, result });
}
runs.sort((a, b) => a.created.localeCompare(b.created));
const since = process.argv.find(s => s.startsWith('--since='))?.slice(8) ?? '';
const selected = runs.filter(r => r.created >= since);
const groups = {};
for (const run of selected) {
  const group = groups[run.name] ??= { passed: 0, failed: 0, incomplete: 0, durationsMs: [] };
  if (!run.result) group.incomplete++;
  else {
    group[run.result.pass ? 'passed' : 'failed']++;
    group.durationsMs.push(run.result.durationMs);
  }
}
for (const group of Object.values(groups)) {
  group.durationsMs.sort((a, b) => a - b);
  group.medianMs = group.durationsMs[Math.floor(group.durationsMs.length / 2)];
  delete group.durationsMs;
}
await fs.writeFile(path.join(artifactRoot, 'all-results.json'), JSON.stringify({ generated: new Date().toISOString(), runs }, null, 2));
console.log(JSON.stringify(groups, null, 2));
