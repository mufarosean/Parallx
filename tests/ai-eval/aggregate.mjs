#!/usr/bin/env node
/**
 * Aggregates per-scenario JSON reports under test-results/ai-eval into a
 * single comparison matrix across models and scenarios. Run after one or
 * more eval passes:
 *
 *   PARALLX_AI_EVAL_MODEL=gemma4:26b   npx playwright test --config playwright.ai-eval.config.ts
 *   PARALLX_AI_EVAL_MODEL=gpt-oss:20b  npx playwright test --config playwright.ai-eval.config.ts
 *   node tests/ai-eval/aggregate.mjs
 *
 * Output: test-results/ai-eval/SUMMARY.md
 */
import fs from 'fs';
import path from 'path';
import url from 'url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '..', '..', 'test-results', 'ai-eval');

if (!fs.existsSync(OUT_DIR)) {
  console.error(`No results directory at ${OUT_DIR}. Run the eval first.`);
  process.exit(1);
}

const files = fs.readdirSync(OUT_DIR)
  .filter(f => f.endsWith('.json') && f !== 'playwright-results.json');

if (files.length === 0) {
  console.error('No scenario JSON reports found.');
  process.exit(1);
}

const reports = files.map(f => {
  const raw = fs.readFileSync(path.join(OUT_DIR, f), 'utf8');
  return { file: f, ...JSON.parse(raw) };
});

// Group: model -> scenarioId -> latest report
const byModel = new Map();
for (const r of reports) {
  if (!byModel.has(r.model)) byModel.set(r.model, new Map());
  const m = byModel.get(r.model);
  const existing = m.get(r.scenarioId);
  if (!existing || new Date(r.startedAt) > new Date(existing.startedAt)) {
    m.set(r.scenarioId, r);
  }
}

const models = [...byModel.keys()].sort();
const allScenarios = new Set();
for (const m of byModel.values()) for (const sid of m.keys()) allScenarios.add(sid);
const scenarios = [...allScenarios].sort();

const lines = [];
lines.push('# AI canvas-interaction eval — comparison summary');
lines.push('');
lines.push(`Generated: ${new Date().toISOString()}`);
lines.push(`Reports: ${reports.length} across ${models.length} model(s) and ${scenarios.length} scenario(s).`);
lines.push('');

// Per-model totals
lines.push('## Overall scores');
lines.push('');
lines.push('| Model | Total | Max | % |');
lines.push('|-------|-------|-----|---|');
for (const model of models) {
  let total = 0, max = 0;
  for (const r of byModel.get(model).values()) {
    total += r.totalScore;
    max += r.maxScore;
  }
  const pct = max ? Math.round(100 * total / max) : 0;
  lines.push(`| \`${model}\` | ${total} | ${max} | ${pct}% |`);
}
lines.push('');

// Matrix
lines.push('## Per-scenario score matrix');
lines.push('');
const head = ['Scenario', ...models.map(m => `\`${m}\``)];
lines.push(`| ${head.join(' | ')} |`);
lines.push(`|${head.map(() => '---').join('|')}|`);
for (const sid of scenarios) {
  const row = [`\`${sid}\``];
  for (const model of models) {
    const r = byModel.get(model)?.get(sid);
    row.push(r ? `${r.totalScore}/${r.maxScore}` : '—');
  }
  lines.push(`| ${row.join(' | ')} |`);
}
lines.push('');

// Per-dimension breakdown
lines.push('## Per-dimension breakdown');
lines.push('');
for (const sid of scenarios) {
  lines.push(`### ${sid}`);
  lines.push('');
  // Collect dimensions from first available report
  const sample = models.map(m => byModel.get(m)?.get(sid)).find(Boolean);
  if (!sample) continue;
  const dimIds = sample.dimensions.map((d) => d.id);
  lines.push(`| Dimension | ${models.map(m => `\`${m}\``).join(' | ')} |`);
  lines.push(`|---|${models.map(() => '---').join('|')}|`);
  for (const did of dimIds) {
    const cells = models.map(m => {
      const r = byModel.get(m)?.get(sid);
      const d = r?.dimensions.find((x) => x.id === did);
      return d ? `${d.score}/${d.max}` : '—';
    });
    lines.push(`| \`${did}\` | ${cells.join(' | ')} |`);
  }
  lines.push('');
}

// Confusion pattern roll-up
lines.push('## Confusion patterns observed');
lines.push('');
for (const model of models) {
  lines.push(`### \`${model}\``);
  lines.push('');
  let any = false;
  for (const sid of scenarios) {
    const r = byModel.get(model)?.get(sid);
    if (!r || !r.confusion?.length) continue;
    any = true;
    lines.push(`**${sid}**`);
    lines.push('');
    for (const c of r.confusion) lines.push(`- ${c}`);
    lines.push('');
  }
  if (!any) lines.push('_No confusion notes recorded._\n');
}

// Latency
lines.push('## Latency (median first-turn ms)');
lines.push('');
lines.push(`| Scenario | ${models.map(m => `\`${m}\``).join(' | ')} |`);
lines.push(`|---|${models.map(() => '---').join('|')}|`);
for (const sid of scenarios) {
  const cells = models.map(m => {
    const r = byModel.get(m)?.get(sid);
    if (!r || !r.turns?.length) return '—';
    const sorted = r.turns.map((t) => t.latencyMs).sort((a, b) => a - b);
    return `${sorted[Math.floor(sorted.length / 2)]}`;
  });
  lines.push(`| \`${sid}\` | ${cells.join(' | ')} |`);
}
lines.push('');

const summaryPath = path.join(OUT_DIR, 'SUMMARY.md');
fs.writeFileSync(summaryPath, lines.join('\n'), 'utf8');
console.log(`Wrote ${summaryPath}`);
