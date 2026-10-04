// coreToolMentionsRatchet.test.ts — the core may not learn more about optional tools.
//
// CLAUDE.md, "The first principle": the core (workbench, canvas, chat,
// settings, dashboard, services, electron) knows no tool the user can turn
// off. Anything a tool needs from the core goes through a generic
// contribution point the tool registers into while it runs.
//
// This counts, per core file, the mentions of each optional tool (its id,
// command/tool-name prefixes, its name) in code (comments do not count) and
// fails if any count rises above the committed baseline
// (core-tool-mentions-baseline.json). Counts may only fall; a new file
// starts at zero. The tools' own folders (src/built-in/planner/,
// src/built-in/worksheet/, ext/) and the built-in manifests (each tool's own
// declaration) are not core and are not scanned.
//
// After a cleanup lowers a count, refresh the baseline so the gain is kept:
//   UPDATE_CORE_TOOL_BASELINE=1 npx vitest run tests/unit/coreToolMentionsRatchet.test.ts
import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { globSync } from 'glob';

const ROOT = resolve(__dirname, '..', '..');
const BASELINE = resolve(__dirname, 'core-tool-mentions-baseline.json');

/** One pattern per optional tool: ids, command/AI-tool prefixes, the name users see. */
const TOOLS: Record<string, RegExp> = {
  planner: /parallx\.planner|\bplanner[._:-]|\bPlanner\b/g,
  worksheets: /parallx\.worksheet|\bworksheets?[._:-]|\bWorksheets?\b/g,
  atelier: /media-organizer|mediaOrganizer|\bAtelier\b|x-mo-/g,
  budget: /parallx\.budget|\bbudget_[a-z]\w*|\bbudget\.(?:open|import|sync|show)\w*|Budget Summary/g,
  browser: /parallx\.browser\b/g,
  flashcards: /\bflashcards?[._-]|\bFlashcards?\b/g,
  webResearch: /web-research|webResearch|Web Research/g,
  workspaceGraph: /workspace-graph|workspaceGraph|Workspace Graph/g,
  conceptLab: /concept-lab|Concept Lab/g,
  creationsAi: /creations-ai|Creations AI/g,
};

const CORE_GLOBS = ['src/**/*.{ts,css}', 'electron/*.cjs'];
const NOT_CORE = [
  'src/built-in/planner/**',
  'src/built-in/worksheet/**',
  'src/tools/builtinManifests.ts',
  '**/*.d.ts.map',
];

type Counts = Record<string, Record<string, number>>;

function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/(?<=[;,{}()\]])\s*\/\/[^\n]*/g, '');
}

function measure(): Counts {
  const files = globSync(CORE_GLOBS, { cwd: ROOT, ignore: NOT_CORE }).sort();
  const out: Counts = {};
  for (const f of files) {
    const text = stripComments(readFileSync(resolve(ROOT, f), 'utf8'));
    for (const [tool, re] of Object.entries(TOOLS)) {
      const n = (text.match(re) ?? []).length;
      if (n > 0) (out[f] ??= {})[tool] = n;
    }
  }
  return out;
}

describe('core mentions of optional tools (ratchet)', () => {
  const now = measure();

  if (process.env.UPDATE_CORE_TOOL_BASELINE) {
    writeFileSync(BASELINE, JSON.stringify(now, null, 2) + '\n');
  }

  it('has a committed baseline', () => {
    expect(existsSync(BASELINE)).toBe(true);
  });

  it('no core file mentions an optional tool more than it did', () => {
    const base: Counts = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {};
    const rises: string[] = [];
    for (const [file, counts] of Object.entries(now)) {
      for (const [tool, n] of Object.entries(counts)) {
        const was = base[file]?.[tool] ?? 0;
        if (n > was) rises.push(`${file}: ${tool} ${was} -> ${n}`);
      }
    }
    expect(rises, 'Core code learned about an optional tool. Add a contribution point the tool registers into instead (CLAUDE.md, the first principle).').toEqual([]);
  });
});
