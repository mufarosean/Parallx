// Scene sweep: `node scripts/scene-sweep.mjs <probeOutDir>`.
//
// Reads the scene the probe wrote (scene-full.json in <probeOutDir>, from
// tests/probes/scene-probe.mjs) and the source, and lists what the
// self-describing UI still owes (docs/SELF_DESCRIBING_UI_DESIGN.md, step 11):
//
//   unlabeled  a scene entry with no label
//   twoParents a control id registered under two different parents
//   onClick    a kit call with an id and an onClick but no command, where a
//              command with the same id exists (it should carry the command)
//   rawDom     a file whose raw DOM count in tests/unit/raw-dom-baseline.json
//              is above zero: chrome the kit does not draw yet
//
// A hit is a candidate, not a verdict: a control id that is also a command
// id may run something the command does not. Read the file before changing.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git']);
const SKIP_FILES = [/\.d\.ts$/, /\.generated\.ts$/, /ext\/study\/main\.js$/, /\/test\//];

function walk(dir, exts, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, exts, out);
    else if (exts.some((x) => e.name.endsWith(x)) && !SKIP_FILES.some((re) => re.test(rel(p)))) out.push(p);
  }
  return out;
}

const outDir = process.argv[2];
if (!outDir) { console.error('usage: node scripts/scene-sweep.mjs <probeOutDir>'); process.exit(2); }
const scenePath = path.resolve(outDir, 'scene-full.json');
if (!fs.existsSync(scenePath)) { console.error(`no scene-full.json in ${outDir}; run tests/probes/scene-probe.mjs first`); process.exit(2); }
const scene = JSON.parse(fs.readFileSync(scenePath, 'utf8'));

// ── unlabeled, twoParents ──
const unlabeled = [];
const parentsOf = new Map();
const walkScene = (node, parent) => {
  if (!node.label) unlabeled.push(`${node.kind} "${node.id}" under ${parent}`);
  if (node.kind !== 'surface') {
    const set = parentsOf.get(node.id) ?? new Set();
    set.add(parent);
    parentsOf.set(node.id, set);
  }
  for (const c of node.children ?? []) walkScene(c, node.id);
};
for (const s of scene.surfaces) walkScene(s, 'the window');
const twoParents = [...parentsOf].filter(([, set]) => set.size > 1).map(([id, set]) => `"${id}" under ${[...set].join(' and ')}`);

// ── onClick where a command of the same id exists ──
const commandsDoc = path.join(ROOT, 'docs/reference/commands.md');
const commandIds = new Set(fs.existsSync(commandsDoc) ? [...fs.readFileSync(commandsDoc, 'utf8').matchAll(/^\| `([^`]+)` \|/gm)].map((m) => m[1]) : []);
const onClick = [];
const files = [...walk(path.join(ROOT, 'src'), ['.ts']), ...walk(path.join(ROOT, 'ext'), ['.js', '.ts'])];
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  for (const m of text.matchAll(/create(?:Button|IconButton|FilterChip|Segmented|AiButton)\((?:[^,]|,(?!\s*\{))*,\s*\{/g)) {
    // The options object: up to its closing brace at the same depth.
    let depth = 1; let i = m.index + m[0].length;
    while (i < text.length && depth > 0) { if (text[i] === '{') depth++; else if (text[i] === '}') depth--; i++; }
    const obj = text.slice(m.index, i);
    const id = /\bid:\s*'([^']+)'/.exec(obj)?.[1];
    if (!id || !/\bonClick\b/.test(obj) || /\bcommand:/.test(obj)) continue;
    if (commandIds.has(id)) onClick.push(`${rel(file)}: ${id}`);
  }
}

// ── rawDom ──
const baselinePath = path.join(ROOT, 'tests/unit/raw-dom-baseline.json');
const baseline = fs.existsSync(baselinePath) ? JSON.parse(fs.readFileSync(baselinePath, 'utf8')) : {};
const rawDom = Object.entries(baseline).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([f, n]) => `${f}: ${n}`);

const section = (name, items) => {
  console.log(`\n## ${name} (${items.length})`);
  for (const i of items) console.log(`- ${i}`);
};
console.log(`# Scene sweep of ${rel(scenePath)}`);
section('unlabeled', unlabeled);
section('twoParents', twoParents);
section('onClick', onClick);
section('rawDom', rawDom);
