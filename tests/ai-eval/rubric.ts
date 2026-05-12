/**
 * Rubric / scoring + per-scenario report writer.
 *
 * The harness is intentionally diagnostic, not pass/fail.  Each scenario
 * defines a set of dimensions, each scored 0/1/2 by the scenario's own
 * grade() function.  We persist:
 *
 *   - JSON: full transcript (every Ollama turn, tool calls, args, latencies)
 *   - MD : human-readable report with thinking text, tool sequence,
 *           rubric verdict per dimension, and a "confusion notes" section
 *           the scenario can populate with observations.
 *
 * Output dir: test-results/ai-eval/<scenarioId>__<model>__<UTC-ISO>.{json,md}
 */
import fs from 'fs';
import path from 'path';
import type { OllamaTurn } from './ollamaRecorder.js';

export interface RubricDimension {
  readonly id: string;
  readonly max: 1 | 2;
  readonly score: number;
  readonly note: string;
}

export interface ScenarioReport {
  readonly scenarioId: string;
  readonly scenarioTitle: string;
  readonly model: string;
  readonly startedAt: string;
  readonly durationMs: number;
  readonly prompt: string;
  readonly dimensions: ReadonlyArray<RubricDimension>;
  readonly totalScore: number;
  readonly maxScore: number;
  readonly confusion: ReadonlyArray<string>;
  readonly toolSequence: ReadonlyArray<{ turn: number; name: string; arguments: Record<string, unknown> }>;
  readonly turns: ReadonlyArray<OllamaTurn>;
  readonly finalState?: Record<string, unknown>;
}

const OUT_DIR = path.resolve(process.cwd(), 'test-results', 'ai-eval');

export function ensureOutputDir(): string {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  return OUT_DIR;
}

function safeSlug(s: string): string {
  return s.replace(/[^a-z0-9._-]+/gi, '-').slice(0, 80);
}

export function writeReport(r: ScenarioReport): { jsonPath: string; mdPath: string } {
  ensureOutputDir();
  const stamp = new Date(r.startedAt).toISOString().replace(/[:.]/g, '-');
  const base = `${safeSlug(r.scenarioId)}__${safeSlug(r.model)}__${stamp}`;
  const jsonPath = path.join(OUT_DIR, `${base}.json`);
  const mdPath = path.join(OUT_DIR, `${base}.md`);

  fs.writeFileSync(jsonPath, JSON.stringify(r, null, 2), 'utf8');
  fs.writeFileSync(mdPath, renderMarkdown(r), 'utf8');
  return { jsonPath, mdPath };
}

function renderMarkdown(r: ScenarioReport): string {
  const lines: string[] = [];
  lines.push(`# ${r.scenarioTitle}`);
  lines.push('');
  lines.push(`- **Scenario id:** \`${r.scenarioId}\``);
  lines.push(`- **Model:** \`${r.model}\``);
  lines.push(`- **Started:** ${r.startedAt}`);
  lines.push(`- **Duration:** ${r.durationMs} ms`);
  lines.push(`- **Score:** **${r.totalScore} / ${r.maxScore}**`);
  lines.push('');
  lines.push('## Prompt');
  lines.push('');
  lines.push('```');
  lines.push(r.prompt);
  lines.push('```');
  lines.push('');

  lines.push('## Rubric');
  lines.push('');
  lines.push('| Dimension | Score | Note |');
  lines.push('|-----------|-------|------|');
  for (const d of r.dimensions) {
    lines.push(`| \`${d.id}\` | ${d.score} / ${d.max} | ${d.note.replace(/\|/g, '\\|')} |`);
  }
  lines.push('');

  lines.push('## Tool call sequence');
  lines.push('');
  if (r.toolSequence.length === 0) {
    lines.push('_No tool calls were emitted._');
  } else {
    lines.push('| # | Turn | Tool | Args |');
    lines.push('|---|------|------|------|');
    r.toolSequence.forEach((c, i) => {
      const argStr = JSON.stringify(c.arguments).replace(/\|/g, '\\|').slice(0, 220);
      lines.push(`| ${i + 1} | ${c.turn} | \`${c.name}\` | \`${argStr}\` |`);
    });
  }
  lines.push('');

  if (r.confusion.length) {
    lines.push('## Confusion notes');
    lines.push('');
    for (const c of r.confusion) lines.push(`- ${c}`);
    lines.push('');
  }

  if (r.finalState) {
    lines.push('## Final canvas state');
    lines.push('');
    lines.push('```json');
    lines.push(JSON.stringify(r.finalState, null, 2));
    lines.push('```');
    lines.push('');
  }

  lines.push('## Turn-by-turn');
  lines.push('');
  for (const t of r.turns) {
    lines.push(`### Turn ${t.index} (${t.latencyMs} ms)`);
    lines.push('');
    if (t.response.thinking.trim()) {
      lines.push('**Thinking:**');
      lines.push('');
      lines.push('```');
      lines.push(t.response.thinking.trim().slice(0, 4000));
      lines.push('```');
      lines.push('');
    }
    if (t.response.toolCalls.length) {
      lines.push('**Tool calls:**');
      lines.push('');
      for (const c of t.response.toolCalls) {
        lines.push(`- \`${c.name}\` ${JSON.stringify(c.arguments).slice(0, 400)}`);
      }
      lines.push('');
    }
    if (t.response.content.trim()) {
      lines.push('**Content:**');
      lines.push('');
      lines.push('```');
      lines.push(t.response.content.trim().slice(0, 2000));
      lines.push('```');
      lines.push('');
    }
  }

  return lines.join('\n');
}
