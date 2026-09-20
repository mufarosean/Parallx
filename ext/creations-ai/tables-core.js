// tables-core.js — Creations AI: Tables. The Perchance list grammar, local.
//
// A table file is Perchance's generator language: named lists, indented
// items, `[references]`, weights (`^3`), inline choices (`{a|b^2}`), ranges
// (`{1-20}`), the dynamic article (`{a}`), modifiers (`.titleCase`), item
// methods (`.selectUnique(3)`), variables (`[x = name]`), nested lists that
// pick through their children, and `alias = {import:file}` for other
// tables. Pasted Perchance list source runs as is. JavaScript inside
// brackets is not supported (docs/CREATIONS_AI.md, out of scope).
//
// Pure: no DOM, no files. Imports are resolved through a loader the caller
// passes in. Randomness is injectable, so every test is deterministic.

const MAX_DEPTH = 100;

// ── Parsing ────────────────────────────────────────────────────────────────

/** @returns {{ lists: Map<string, ListNode>, imports: Map<string, string>, errors: string[] }} */
export function parseTables(source) {
  const lists = new Map();
  const imports = new Map();
  const errors = [];
  const lines = String(source || '').replace(/\r/g, '').split('\n');
  // stack of { node, indent, item } where node collects items at depth > indent
  let stack = [];
  lines.forEach((raw, idx) => {
    const line = raw.replace(/\t/g, '  ');
    if (!line.trim()) return;
    if (line.trim().startsWith('//')) return;
    const indent = line.length - line.trimStart().length;
    const text = line.trim();
    if (indent === 0) {
      const imp = text.match(/^([A-Za-z_$][\w$]*)\s*=\s*\{\s*import\s*:\s*([^}]+?)\s*\}\s*$/);
      if (imp) { imports.set(imp[1], imp[2]); stack = []; return; }
      const name = text.replace(/\s*=\s*$/, '');
      if (!/^[A-Za-z_$][\w$-]*$/.test(name)) { errors.push(`Line ${idx + 1}: a list name must be one word, got "${text}"`); stack = []; return; }
      const node = { name, items: [] };
      lists.set(name, node);
      stack = [{ node, indent: 0 }];
      return;
    }
    if (stack.length === 0) { errors.push(`Line ${idx + 1}: an item before any list: "${text}"`); return; }
    // Climb to the nearest open node shallower than this line.
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();
    let top = stack[stack.length - 1];
    if (indent <= top.indent) { errors.push(`Line ${idx + 1}: bad indentation: "${text}"`); return; }
    // Deeper than the last item of the top node: that item becomes a sub-list.
    const last = top.node.items[top.node.items.length - 1];
    if (last && top.lastIndent !== undefined && indent > top.lastIndent) {
      if (!last.children) last.children = { name: last.text, items: [] };
      stack.push({ node: last.children, indent: top.lastIndent });
      top = stack[stack.length - 1];
    }
    const item = parseItem(text);
    top.node.items.push(item);
    top.lastIndent = indent;
  });
  return { lists, imports, errors };
}

function parseItem(text) {
  // Trailing ^weight, unless the caret is escaped.
  const m = text.match(/(^|[^\\])\^(\d+(?:\.\d+)?)\s*$/);
  if (m) {
    const weight = Number(m[2]);
    return { text: text.slice(0, text.length - m[0].length + m[1].length).trimEnd(), weight: Number.isFinite(weight) ? weight : 1, children: null };
  }
  return { text, weight: 1, children: null };
}

export function listNames(gen) {
  return [...gen.lists.keys()];
}

// ── Evaluation ─────────────────────────────────────────────────────────────

/**
 * Evaluate one list (default `output`) to a string.
 * @param gen a parsed table
 * @param opts { rng?: () => number, imports?: (name) => parsedTable | null }
 */
export function evaluate(gen, listName = 'output', opts = {}) {
  const ctx = { rng: opts.rng || Math.random, imports: opts.imports || null, vars: new Map(), depth: 0, errors: [] };
  const node = gen.lists.get(listName) || (listName === 'output' ? firstList(gen) : null);
  if (!node) { ctx.errors.push(`No list named "${listName}"`); return { text: '', errors: ctx.errors }; }
  const text = fixArticles(evalList(gen, node, ctx));
  return { text, errors: ctx.errors };
}

/** Several results at once. */
export function roll(gen, count = 5, listName = 'output', opts = {}) {
  const out = [];
  const errors = [];
  for (let i = 0; i < count; i++) {
    const r = evaluate(gen, listName, opts);
    out.push(r.text);
    for (const e of r.errors) if (!errors.includes(e)) errors.push(e);
  }
  return { results: out, errors };
}

function firstList(gen) {
  for (const node of gen.lists.values()) return node;
  return null;
}

function pickWeighted(items, rng) {
  const live = items.filter((it) => it.weight > 0);
  if (live.length === 0) return null;
  if (live.length === 1) return live[0];
  const total = live.reduce((s, it) => s + it.weight, 0);
  let r = rng() * total;
  for (const it of live) { r -= it.weight; if (r < 0) return it; }
  return live[live.length - 1];
}

function evalList(gen, node, ctx) {
  if (++ctx.depth > MAX_DEPTH) { ctx.errors.push(`"${node.name}" refers to itself without end`); ctx.depth--; return ''; }
  try {
    const item = pickWeighted(node.items, ctx.rng);
    if (!item) return '';
    // A nested list: the parent line is only a heading; the pick goes on below it.
    if (item.children && item.children.items.length > 0) return evalList(gen, item.children, ctx);
    return evalTemplate(gen, item.text, ctx);
  } finally { ctx.depth--; }
}

/** Find the closing bracket for the opener at `start`, honouring escapes and nesting of both kinds. */
function matchBracket(text, start) {
  const open = text[start];
  const close = open === '[' ? ']' : '}';
  let depthSq = 0, depthCu = 0;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\') { i++; continue; }
    if (ch === '[') depthSq++;
    else if (ch === ']') depthSq--;
    else if (ch === '{') depthCu++;
    else if (ch === '}') depthCu--;
    if (depthSq === 0 && depthCu === 0 && ch === close) return i;
    if (depthSq < 0 || depthCu < 0) return -1;
  }
  return -1;
}

function evalTemplate(gen, text, ctx) {
  if (++ctx.depth > MAX_DEPTH) { ctx.errors.push('too deep'); ctx.depth--; return ''; }
  try {
    let out = '';
    let i = 0;
    while (i < text.length) {
      const ch = text[i];
      if (ch === '\\' && i + 1 < text.length) { out += text[i + 1]; i += 2; continue; }
      if (ch === '[' || ch === '{') {
        const end = matchBracket(text, i);
        if (end < 0) { out += ch; i++; continue; }
        const inner = text.slice(i + 1, end);
        out += ch === '[' ? evalReference(gen, inner, ctx) : evalBlock(gen, inner, ctx);
        i = end + 1;
        continue;
      }
      out += ch;
      i++;
    }
    return out;
  } finally { ctx.depth--; }
}

/** `{...}`: an article, a range, or a weighted inline choice. */
function evalBlock(gen, inner, ctx) {
  const t = inner.trim();
  if (t === 'a' || t === 'A') return `\u0001${t}`;
  if (/^import\s*:/i.test(t)) return '';
  const range = t.match(/^(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)$/);
  if (range) {
    const lo = Number(range[1]), hi = Number(range[2]);
    const decimals = Math.max(decimalsOf(range[1]), decimalsOf(range[2]));
    if (decimals === 0) {
      const a = Math.min(lo, hi), b = Math.max(lo, hi);
      return String(a + Math.floor(ctx.rng() * (b - a + 1)));
    }
    return (Math.min(lo, hi) + ctx.rng() * Math.abs(hi - lo)).toFixed(decimals);
  }
  const options = splitTop(inner, '|').map((o) => parseItem(o.trim()));
  const pick = pickWeighted(options, ctx.rng);
  return pick ? evalTemplate(gen, pick.text, ctx) : '';
}

function decimalsOf(s) { const i = s.indexOf('.'); return i < 0 ? 0 : s.length - i - 1; }

/** Split on a separator at nesting depth zero, honouring escapes. */
function splitTop(text, sep) {
  const parts = [];
  let cur = '';
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\' && i + 1 < text.length) { cur += ch + text[i + 1]; i++; continue; }
    if (ch === '[' || ch === '{' || ch === '(') depth++;
    else if (ch === ']' || ch === '}' || ch === ')') depth--;
    if (ch === sep && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  parts.push(cur);
  return parts;
}

/** `[...]`: a variable, a list, a path into a nested list, methods and modifiers, or an assignment. */
function evalReference(gen, inner, ctx) {
  const t = inner.trim();
  const assign = t.match(/^([A-Za-z_$][\w$]*)\s*=\s*([\s\S]+)$/);
  if (assign && !/^==/.test(assign[2])) {
    const rhs = assign[2].trim();
    const quoted = rhs.match(/^(["'])([\s\S]*)\1$/);
    const value = quoted ? quoted[2] : (/^[A-Za-z_$]/.test(rhs) ? evalReference(gen, rhs, ctx) : evalTemplate(gen, rhs, ctx));
    // As on Perchance: the assignment prints the value it stored.
    ctx.vars.set(assign[1], value);
    return value;
  }
  const segments = splitTop(t, '.').map((s) => s.trim()).filter(Boolean);
  if (segments.length === 0) return '';
  let cursor;
  let owner = gen;
  const head = segments[0];
  if (ctx.vars.has(head)) cursor = { value: ctx.vars.get(head) };
  else if (gen.lists.has(head)) cursor = { node: gen.lists.get(head) };
  else if (gen.imports.has(head) && ctx.imports) {
    const imported = ctx.imports(gen.imports.get(head));
    if (!imported) { ctx.errors.push(`The table "${gen.imports.get(head)}" could not be found`); return `[${inner}]`; }
    owner = imported;
    const next = segments[1];
    if (next && imported.lists.has(next)) { cursor = { node: imported.lists.get(next) }; segments.splice(1, 1); }
    else cursor = { node: imported.lists.get('output') || firstList(imported) };
    if (!cursor.node) { ctx.errors.push(`The table "${gen.imports.get(head)}" has no output list`); return `[${inner}]`; }
  } else { ctx.errors.push(`No list named "${head}"`); return `[${inner}]`; }

  for (const seg of segments.slice(1)) {
    const call = seg.match(/^([A-Za-z_$][\w$]*)\s*(?:\((.*)\))?$/);
    if (!call) { ctx.errors.push(`Cannot read "${seg}"`); return `[${inner}]`; }
    const name = call[1];
    const arg = call[2] === undefined ? null : call[2].trim();
    // A child list under the current node.
    if (cursor.node && arg === null) {
      const child = cursor.node.items.find((it) => it.children && it.text === name);
      if (child) { cursor = { node: child.children }; continue; }
    }
    if (cursor.node && METHODS[name]) { cursor = METHODS[name](owner, cursor.node, ctx, arg); continue; }
    if (MODIFIERS[name]) {
      const value = materialise(owner, cursor, ctx);
      cursor = { value: MODIFIERS[name](value) };
      continue;
    }
    ctx.errors.push(`Unknown "${name}"`);
    return `[${inner}]`;
  }
  return materialise(owner, cursor, ctx);
}

function materialise(gen, cursor, ctx) {
  if (cursor.node) return evalList(gen, cursor.node, ctx);
  if (Array.isArray(cursor.value)) return cursor.value.join(', ');
  return cursor.value == null ? '' : String(cursor.value);
}

const METHODS = {
  selectOne: (gen, node, ctx) => ({ value: evalList(gen, node, ctx) }),
  selectMany: (gen, node, ctx, arg) => {
    const n = Math.max(0, Math.min(200, parseInt(arg || '1', 10) || 1));
    return { value: Array.from({ length: n }, () => evalList(gen, node, ctx)) };
  },
  selectUnique: (gen, node, ctx, arg) => {
    const n = Math.max(0, parseInt(arg || '1', 10) || 1);
    const seen = new Set();
    const out = [];
    let guard = 0;
    while (out.length < n && guard++ < n * 20) {
      const v = evalList(gen, node, ctx);
      if (!seen.has(v)) { seen.add(v); out.push(v); }
    }
    return { value: out };
  },
  selectAll: (gen, node, ctx) => ({ value: node.items.map((it) => it.children ? evalList(gen, it.children, ctx) : evalTemplate(gen, it.text, ctx)) }),
  joinItems: (gen, node, ctx, arg) => {
    const sep = arg ? arg.replace(/^(["'])([\s\S]*)\1$/, '$2') : ', ';
    return { value: node.items.map((it) => it.children ? evalList(gen, it.children, ctx) : evalTemplate(gen, it.text, ctx)).join(sep) };
  },
};

// ── Modifiers ──────────────────────────────────────────────────────────────

export function titleCase(s) { return String(s).replace(/\b[a-z]/g, (c) => c.toUpperCase()); }
export function sentenceCase(s) { const t = String(s); return t.charAt(0).toUpperCase() + t.slice(1); }

const IRREGULAR_PLURALS = { man: 'men', woman: 'women', child: 'children', person: 'people', mouse: 'mice', goose: 'geese', tooth: 'teeth', foot: 'feet', ox: 'oxen', sheep: 'sheep', fish: 'fish', deer: 'deer', knife: 'knives', wife: 'wives', life: 'lives', leaf: 'leaves', wolf: 'wolves', elf: 'elves' };
export function pluralForm(word) {
  const w = String(word);
  const m = w.match(/^([\s\S]*?)([A-Za-z]+)$/);
  if (!m) return w;
  const [, head, last] = m;
  const lower = last.toLowerCase();
  const cap = (p) => (last[0] === last[0].toUpperCase() && last[0] !== last[0].toLowerCase() ? p.charAt(0).toUpperCase() + p.slice(1) : p);
  if (IRREGULAR_PLURALS[lower]) return head + cap(IRREGULAR_PLURALS[lower]);
  if (/(s|x|z|ch|sh)$/.test(lower)) return head + last + 'es';
  if (/[^aeiou]y$/.test(lower)) return head + last.slice(0, -1) + 'ies';
  if (/(?:[^f]fe|[lr]f)$/.test(lower)) return head + last.replace(/fe?$/, 'ves');
  if (/[^aeiou]o$/.test(lower) && !/(photo|piano|halo)$/.test(lower)) return head + last + 'es';
  return head + last + 's';
}
export function singularForm(word) {
  const w = String(word);
  const lower = w.toLowerCase();
  for (const [s, p] of Object.entries(IRREGULAR_PLURALS)) if (lower.endsWith(p)) return w.slice(0, w.length - p.length) + (w[w.length - p.length] === w[w.length - p.length].toUpperCase() ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  if (/ies$/.test(lower)) return w.slice(0, -3) + 'y';
  if (/(s|x|z|ch|sh)es$/.test(lower)) return w.slice(0, -2);
  if (/ves$/.test(lower)) return w.slice(0, -3) + 'f';
  if (/s$/.test(lower) && !/ss$/.test(lower)) return w.slice(0, -1);
  return w;
}

const MODIFIERS = {
  titleCase, upperCase: (s) => String(s).toUpperCase(), lowerCase: (s) => String(s).toLowerCase(), sentenceCase,
  pluralForm, singularForm, trim: (s) => String(s).trim(),
  evaluateItem: (s) => s,
};

// ── The article ────────────────────────────────────────────────────────────

const AN_EXCEPTIONS = /^(hour|honest|honou?r|heir)/i;
const A_EXCEPTIONS = /^(uni|use|user|usual|utensil|one|once|euro|ewe|ur[aeiou])/i;
/** `{a}` resolves after the next word is known: "an owl", "a cat", "an hour", "a unicorn". */
export function fixArticles(text) {
  return String(text).replace(/\u0001([aA])(\s*)(\S*)/g, (m, art, gap, word) => {
    const w = word.replace(/^[^A-Za-z0-9]+/, '');
    let an;
    if (!w) an = false;
    else if (AN_EXCEPTIONS.test(w)) an = true;
    else if (A_EXCEPTIONS.test(w)) an = false;
    else an = /^[aeiou]/i.test(w);
    const article = (an ? 'an' : 'a');
    return (art === 'A' ? article.charAt(0).toUpperCase() + article.slice(1) : article) + (gap || ' ') + word;
  });
}

// ── A starter table, shipped so the surface is never empty ─────────────────

export const STARTER_TABLE = `// A table is a list of lists. The first list, or one named output, is what rolls.
// [name] picks from a list. {a|b^2} picks inline, with weights. {1-20} is a range.
// {a} becomes "a" or "an" for the next word. .titleCase, .pluralForm and friends shape the pick.
// Indent under an item to make it a list of its own: [creature] picks through it.

output
  {a} [mood] [creature.titleCase] named [name], keeper of {1-12} [treasure.pluralForm]
  [name] the [mood], who {sleeps by day|never sleeps|sleeps standing up}

name
  Ada^3
  Bram
  Cyra
  Dorian
  Esme

mood
  weary
  bright-eyed
  suspicious^2
  quietly furious

creature
  cat
  owl
  bird
    sparrow
    crow
    heron
  ox

treasure
  key
  match
  map
  knife
`;
