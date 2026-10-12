// Dead-code sweep: `node scripts/dead-code-sweep.mjs`.
//
// Lists, by name, what the code base declares but nothing references:
//
//   exports   an export in src/ that no file (src, ext, electron, scripts,
//             tests) references, and that its own file does not use either
//   testOnly  an export in src/ that only tests reference
//   ext       a top-level function, class or const in ext/ or electron/
//             referenced nowhere, its own file included
//   settings  a setting a manifest declares that no code reads by its key
//             or last segment, or a bound schema whose config field nothing
//             outside the settings code reads
//   css       a stylesheet in src/ that nothing imports
//
// A hit is a candidate, not a verdict: a name reached only through a
// string, a computed key or the extension API shows up here too. Read the
// file before deleting. Exported types are left out on purpose: an unused
// exported interface costs nothing and most of them are the shape of a
// public object.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Repo-relative, '/'-separated on every platform, so the patterns below read the same on Windows. */
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git']);
const SKIP_FILES = [/\.d\.ts$/, /\.generated\.ts$/, /ext\/study\/main\.js$/, /readability\.js$/, /\/test\//];

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

// Block comments only where they start a token, so a glob like `**/*.md`
// inside a string does not swallow code up to the next `*/`.
const stripComments = (s) =>
  s.replace(/(^|\s)\/\*[\s\S]*?\*\//g, '$1').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

const srcFiles = walk(path.join(ROOT, 'src'), ['.ts']);
const testFiles = walk(path.join(ROOT, 'tests'), ['.ts', '.mjs', '.js']);
const extFiles = walk(path.join(ROOT, 'ext'), ['.js']);
const electronFiles = walk(path.join(ROOT, 'electron'), ['.cjs', '.mjs', '.js']);
const scriptFiles = walk(path.join(ROOT, 'scripts'), ['.mjs', '.cjs', '.js']);
const htmlFiles = walk(path.join(ROOT, 'electron'), ['.html']);
const allFiles = [...srcFiles, ...testFiles, ...extFiles, ...electronFiles, ...scriptFiles, ...htmlFiles];

const raw = new Map(allFiles.map((p) => [p, fs.readFileSync(p, 'utf8')]));
const code = new Map([...raw].map(([p, s]) => [p, stripComments(s)]));
const isTest = (p) => rel(p).startsWith('tests/');

/** Occurrences of `name` as a whole identifier (property access counts). */
function occurrences(name, text) {
  const re = new RegExp(`(?<![\\w$])${name}(?![\\w$])`, 'g');
  const m = text.match(re);
  return m ? m.length : 0;
}

const EXPORT_DECL = /^export\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(function\*?|class|const|let|var|enum)\s+([A-Za-z_$][\w$]*)/gm;
const TOP_DECL = /^(?:export\s+)?(?:async\s+)?(?:function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm;
const MANIFEST_KEY = /^\s*'([a-z][\w-]*(?:\.[\w-]+)+)':\s*\{/gm;

const report = { exports: [], testOnly: [], ext: [], settings: [], css: [] };

for (const f of srcFiles) {
  const own = code.get(f);
  for (const m of own.matchAll(EXPORT_DECL)) {
    const [, kind, name] = m;
    if (name.length < 3) continue;
    let src = 0;
    let tests = 0;
    for (const [p, t] of code) {
      if (p === f) continue;
      const n = occurrences(name, t);
      if (!n) continue;
      if (isTest(p)) tests += n; else src += n;
    }
    if (src > 0) continue;
    if (occurrences(name, own) > 1) continue;
    (tests > 0 ? report.testOnly : report.exports).push(`${rel(f)}: ${kind} ${name}`);
  }
}

for (const f of [...extFiles, ...electronFiles]) {
  for (const m of code.get(f).matchAll(TOP_DECL)) {
    const name = m[1];
    if (name.length < 3) continue;
    let total = 0;
    for (const [, t] of code) total += occurrences(name, t);
    if (total <= 1) report.ext.push(`${rel(f)}: ${name}`);
  }
}

// A manifest key is read by its full string or its last segment. A bound
// schema (aiSettings) reads a field of the unified config instead, so the
// field its `read` names is what must be used outside the settings code.
const SCHEMA_ENTRY = /\bkey:\s*'([a-z][\w-]*(?:\.[\w-]+)+)'[\s\S]*?read:\s*\(\w+\)\s*=>\s*\w+(?:\.\w+)*\.(\w+)/g;
const declared = [];
for (const [f, t] of raw) {
  if (/SettingsSchemas\.ts$/.test(rel(f))) for (const m of t.matchAll(SCHEMA_ENTRY)) declared.push({ key: m[1], field: m[2], where: f });
  if (/manifest\.ts$/.test(rel(f)) || /^ext\/[^/]+\/main\.js$/.test(rel(f))) for (const m of t.matchAll(MANIFEST_KEY)) declared.push({ key: m[1], where: f });
}
for (const { key, field, where } of declared) {
  const short = key.slice(key.lastIndexOf('.') + 1);
  let reads = 0;
  for (const [p, t] of code) {
    if (p === where || isTest(p)) continue;
    if (field) {
      if (rel(p).includes('/aiSettings/')) continue;
      reads += occurrences(field, t);
    } else {
      reads += t.split(`'${key}'`).length - 1 + t.split(`"${key}"`).length - 1;
      reads += occurrences(short, t);
    }
  }
  if (reads === 0) report.settings.push(`${key}${field ? ` (field ${field})` : ''} (declared in ${rel(where)})`);
}

for (const f of walk(path.join(ROOT, 'src'), ['.css'])) {
  const base = path.basename(f);
  const imported = [...raw].some(([p, t]) => p !== f && t.includes(base));
  if (!imported) report.css.push(rel(f));
}

for (const [section, lines] of Object.entries(report)) {
  console.log(`\n## ${section} (${lines.length})`);
  for (const line of lines.sort()) console.log(line);
}
