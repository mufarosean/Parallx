// harness-common.mjs — shared plumbing for the Creations quality harnesses
// (docs/CREATIONS_QUALITY_TESTING.md): model calls with a cache, two passes,
// a judge that never is the player, mechanical measures, and the report.
//
// Every harness built on this takes:
//   --mock              no model at all: canned replies; checks the wiring
//   --replay            no model: rescore the cached outputs of the last run
//   --pass play|judge|all   play = player calls only (cached); judge = judge
//                       calls over the cached play (the GPU swaps models once,
//                       not per call); all = both, in that order (default)
//   --model <tag>       the player: the model you play Creations with (gemma4:31b)
//   --judge <tag>       the judge, never the player and of another family (qwen3.8:27b)
//   --num-ctx <n>       num_ctx for every call (65536, as you play; at most 131072)
//   --samples <n>       samples per case (3)
//   --cache <path>      raw outputs, by label (os tmpdir by default)
//   --report <path>     the Markdown report
//
// Nothing here pulls, loads or unloads a model by itself; Ollama loads what
// a request names. The judge lives only in the harness; the app never calls it.

import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

export function parseArgs(argv, defaults = {}) {
  const args = argv.slice(2);
  const after = (flag, dflt) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : dflt);
  const mock = args.includes('--mock');
  const replay = args.includes('--replay');
  const opts = {
    mock, replay,
    mode: mock ? 'MOCK' : replay ? 'REPLAY' : 'LIVE',
    pass: after('--pass', 'all'),
    model: after('--model', 'gemma4:31b'),
    judge: after('--judge', 'qwen3.8:27b'),
    numCtx: Math.min(131072, Math.max(2048, Number(after('--num-ctx', 65536)) || 65536)),
    samples: Math.max(1, Number(after('--samples', defaults.samples ?? 3)) || 3),
    cache: path.resolve(after('--cache', path.join(os.tmpdir(), `${defaults.name || 'creations-harness'}-cache.json`))),
    report: path.resolve(after('--report', defaults.report || `${defaults.name || 'creations-harness'}.md`)),
    only: new Set(String(after('--only', '')).split(',').map((s) => s.trim()).filter(Boolean)),
    ollama: after('--ollama', 'http://localhost:11434'),
  };
  if (!['play', 'judge', 'all'].includes(opts.pass)) throw new Error(`--pass must be play, judge or all, not "${opts.pass}"`);
  if (opts.model === opts.judge) throw new Error('The judge must not be the player model: models rate their own writing higher.');
  return opts;
}

/**
 * The model gateway. `call(label, messages, { role, json, temperature, maxTokens })`
 * returns the reply text. Labels are the cache keys: the same label is the
 * same case, so a replay or a judge pass finds the play it scores.
 */
export function createGateway(opts, { mockRespond }) {
  let cache = { player: {}, judge: {} };
  const calls = [];
  const gw = {
    calls,
    async load() {
      try { cache = { player: {}, judge: {}, ...JSON.parse(await fsp.readFile(opts.cache, 'utf8')) }; } catch { /* first run */ }
    },
    async save() {
      if (opts.mock) return;
      await fsp.mkdir(path.dirname(opts.cache), { recursive: true });
      await fsp.writeFile(opts.cache, JSON.stringify(cache), 'utf8');
    },
    has(role, label) { return typeof cache[role]?.[label] === 'string'; },
    /** `onText(textSoFar, msSinceStart)` streams the reply (live only), for latency measures. */
    async call(label, messages, { role = 'player', json = false, temperature = 0.8, maxTokens = 0, onText = null, stop = null, think = false, model: modelOverride = '' } = {}) {
      const model = modelOverride || (role === 'judge' ? opts.judge : opts.model);
      if (opts.mock) {
        const content = mockRespond(label, messages, { role, json });
        calls.push({ label, role, ms: 0, promptTokens: 0, evalTokens: 0 });
        return content;
      }
      // A pass that does not own this role reads the cache; so does --replay.
      const owns = opts.pass === 'all' || (opts.pass === 'play' && role === 'player') || (opts.pass === 'judge' && role === 'judge');
      if (opts.replay || !owns) {
        const content = cache[role]?.[label];
        if (typeof content !== 'string') throw new SkipCase(`no cached ${role} output for "${label}"`);
        calls.push({ label, role, ms: 0, promptTokens: 0, evalTokens: 0, cached: true });
        return content;
      }
      const started = Date.now();
      const body = { model, messages, stream: !!onText, think: !!think, keep_alive: '10m', options: { num_ctx: opts.numCtx, temperature } };
      if (maxTokens > 0) body.options.num_predict = maxTokens;
      if (Array.isArray(stop) && stop.length) body.options.stop = stop;
      if (json) body.format = 'json';
      const res = await fetch(`${opts.ollama}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 300)}`);
      let j;
      let content = '';
      if (onText) {
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, idx).trim();
            buf = buf.slice(idx + 1);
            if (!line) continue;
            const part = JSON.parse(line);
            content += part.message?.content || '';
            onText(content, Date.now() - started);
            if (part.done) j = part;
          }
        }
        j ??= {};
      } else {
        j = await res.json();
        content = j.message?.content || '';
      }
      const rec = { label, role, ms: Date.now() - started, promptTokens: j.prompt_eval_count || 0, evalTokens: j.eval_count || 0, firstTokenMs: Math.round((j.load_duration || 0) / 1e6 + (j.prompt_eval_duration || 0) / 1e6) };
      calls.push(rec);
      cache[role] ??= {};
      cache[role][label] = content;
      await gw.save();
      console.log(`  [${role}] ${label}: ${(rec.ms / 1000).toFixed(1)}s, prompt ${rec.promptTokens} tok, output ${rec.evalTokens} tok`);
      return content;
    },
    /** Embeddings through the local nomic-embed-text; null in mock/replay or when it is not there. */
    async embed(texts) {
      if (opts.mock || opts.replay) return null;
      try {
        const res = await fetch(`${opts.ollama}/api/embed`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'nomic-embed-text', input: texts }) });
        if (!res.ok) return null;
        const j = await res.json();
        return Array.isArray(j.embeddings) ? j.embeddings : null;
      } catch { return null; }
    },
  };
  return gw;
}

/** A case that cannot run in this pass (its play is not cached yet); reported, not failed. */
export class SkipCase extends Error {}

/** The judge's JSON verdict; null when it gave none. */
export async function judgeJson(gw, label, system, user, opts = {}) {
  const raw = await gw.call(label, [{ role: 'system', content: system }, { role: 'user', content: user }], { role: 'judge', json: true, temperature: 0, ...opts });
  try { return JSON.parse(raw); } catch {
    const m = /\{[\s\S]*\}/.exec(raw);
    try { return m ? JSON.parse(m[0]) : null; } catch { return null; }
  }
}

// ── Report ──────────────────────────────────────────────────────────────────

export function createReport(title, opts) {
  const results = [];
  const metrics = [];
  const samples = [];
  const skipped = [];
  let current = '';
  const r = {
    results, metrics, samples, skipped,
    section(name) { current = name; },
    check(id, name, ok, detail = '') {
      results.push({ id, name, section: current, status: ok ? 'PASS' : 'FAIL', detail: String(detail ?? '') });
      console.log(`[${ok ? 'PASS' : 'FAIL'}] ${id} ${name}${detail ? ' :: ' + String(detail).split('\n')[0].slice(0, 140) : ''}`);
      return ok;
    },
    /** A number to watch, with its bar when there is one. */
    metric(id, name, value, bar = '') {
      metrics.push({ id, name, section: current, value, bar });
      console.log(`[METRIC] ${id} ${name}: ${typeof value === 'number' ? round(value) : value}${bar ? ` (bar ${bar})` : ''}`);
    },
    sample(name, text) { samples.push({ name, section: current, text: String(text ?? '') }); },
    skip(id, why) { skipped.push({ id, section: current, why }); console.log(`[SKIP] ${id} ${why}`); },
    async write(gw, extra = '') {
      const pass = results.filter((x) => x.status === 'PASS').length;
      const fail = results.length - pass;
      const lines = [
        `# ${title}`, '',
        `- Mode: ${opts.mode}, pass: ${opts.pass}`,
        `- Player: ${opts.model}, judge: ${opts.judge}, num_ctx ${opts.numCtx}, samples ${opts.samples}`,
        `- Commit: ${gitCommit()}`,
        `- Calls: ${gw.calls.filter((c) => !c.cached).length} live, ${gw.calls.filter((c) => c.cached).length} from the cache`,
        `- Checks: ${pass} pass, ${fail} fail${skipped.length ? `, ${skipped.length} skipped` : ''}`,
        '',
      ];
      if (extra) lines.push(extra, '');
      const bySection = (list) => [...new Set(list.map((x) => x.section))];
      if (metrics.length) {
        lines.push('## Measures', '', '| Section | Id | Measure | Value | Bar |', '|---|---|---|---|---|');
        for (const m of metrics) lines.push(`| ${m.section} | ${m.id} | ${m.name} | ${typeof m.value === 'number' ? round(m.value) : esc(m.value)} | ${esc(m.bar)} |`);
        lines.push('');
      }
      lines.push('## Checks', '');
      for (const s of bySection(results)) {
        lines.push(`### ${s}`, '', '| Id | Check | Result | Detail |', '|---|---|---|---|');
        for (const x of results.filter((y) => y.section === s)) lines.push(`| ${x.id} | ${esc(x.name)} | ${x.status} | ${esc(x.detail.slice(0, 300))} |`);
        lines.push('');
      }
      if (skipped.length) {
        lines.push('## Skipped', '');
        for (const x of skipped) lines.push(`- ${x.section} ${x.id}: ${x.why}`);
        lines.push('');
      }
      if (samples.length) {
        lines.push('## Samples', '');
        for (const s of samples) lines.push(`### ${s.section}: ${s.name}`, '', '```text', s.text.trim(), '```', '');
      }
      const timed = gw.calls.filter((c) => !c.cached && c.ms > 0);
      if (timed.length) {
        lines.push('## Calls', '', '| Label | Role | Seconds | Prompt tok | Output tok |', '|---|---|---|---|---|');
        for (const c of timed) lines.push(`| ${esc(c.label)} | ${c.role} | ${(c.ms / 1000).toFixed(1)} | ${c.promptTokens} | ${c.evalTokens} |`);
        lines.push('');
      }
      await fsp.mkdir(path.dirname(opts.report), { recursive: true });
      await fsp.writeFile(opts.report, lines.join('\n'), 'utf8');
      console.log(`\nDONE: ${pass} pass, ${fail} fail${skipped.length ? `, ${skipped.length} skipped` : ''}. Report: ${opts.report}`);
      return fail;
    },
  };
  return r;
}

const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const round = (n) => (Number.isInteger(n) ? n : Math.round(n * 1000) / 1000);

export function gitCommit() {
  try { return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim(); } catch { return 'unknown'; }
}

export function ollamaPs(opts) {
  if (opts.mock) return '(mock: ollama ps not run)';
  if (opts.replay) return '(replay: no model touched)';
  try { return execSync('ollama ps', { encoding: 'utf8', timeout: 15000 }).trim(); } catch (err) { return `ollama ps failed: ${err?.message || err}`; }
}

// ── Mechanical measures ─────────────────────────────────────────────────────

const STOP = new Set(('a an the and or but if then so of to in on at by for with from into onto over under about as is are was were be been being it its this that these those he she they them his her their him i me my you your we our us not no nor do does did have has had will would can could should may might must just only very more most less than too also there here what which who whom whose when where why how all any each every some such own same other another one two up down out off again once while because until before after above below between through during without within against toward towards upon among around like').split(/\s+/));

export function words(text) { return String(text || '').toLowerCase().match(/[\p{L}\p{N}']+/gu) || []; }
export function contentWords(text) { return words(text).filter((w) => w.length > 2 && !STOP.has(w)); }

export function jaccard(a, b) {
  const A = new Set(contentWords(a));
  const B = new Set(contentWords(b));
  if (!A.size && !B.size) return 0;
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return n / (A.size + B.size - n);
}

/** Mean and max pairwise overlap of a list of texts (Jaccard over content words). */
export function pairwiseOverlap(texts) {
  const vals = [];
  for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) vals.push(jaccard(texts[i], texts[j]));
  return { mean: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0, max: vals.length ? Math.max(...vals) : 0 };
}

export function cosine(a, b) {
  let d = 0; let na = 0; let nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? d / Math.sqrt(na * nb) : 0;
}

export function pairwiseCosine(vectors) {
  const vals = [];
  for (let i = 0; i < vectors.length; i++) for (let j = i + 1; j < vectors.length; j++) vals.push(cosine(vectors[i], vectors[j]));
  return { mean: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0, max: vals.length ? Math.max(...vals) : 0 };
}

/**
 * Concrete phrases of a reply: content-word bigrams plus lone nouns that
 * look concrete (not on the abstract list), minus the given names. A rough
 * stand-in for noun phrases that needs no tagger and is stable across runs.
 */
export function phrases(text, ignore = []) {
  const skip = new Set(ignore.flatMap((n) => words(n)));
  const toks = words(text).filter((w) => !skip.has(w));
  const out = new Set();
  for (let i = 0; i + 1 < toks.length; i++) {
    if (STOP.has(toks[i]) || STOP.has(toks[i + 1]) || toks[i].length < 3 || toks[i + 1].length < 3) continue;
    out.add(`${toks[i]} ${toks[i + 1]}`);
  }
  for (const t of toks) if (t.length > 3 && !STOP.has(t) && !ABSTRACT.has(t)) out.add(t);
  return out;
}

/**
 * Motif echo: a phrase in at least `min` of any `window` replies in a row.
 * Returns [{ phrase, turns: [i...] }], the first window each was seen in.
 * Lone words count only when they are nouns the reply would not need to
 * repeat; to keep the list readable, a word also inside a reported bigram
 * is dropped.
 */
export function motifEchoes(replies, { names = [], window = 5, min = 3, bigramsOnly = false } = {}) {
  const sets = replies.map((r) => phrases(r, names));
  const found = new Map();
  for (let start = 0; start + window <= replies.length || (start === 0 && replies.length > 0); start++) {
    const end = Math.min(replies.length, start + window);
    const counts = new Map();
    for (let i = start; i < end; i++) for (const p of sets[i]) {
      if (bigramsOnly && !p.includes(' ')) continue;
      if (!counts.has(p)) counts.set(p, []);
      counts.get(p).push(i + 1);
    }
    for (const [p, turns] of counts) if (turns.length >= min && !found.has(p)) found.set(p, turns);
    if (end === replies.length) break;
  }
  const bigramWords = new Set([...found.keys()].filter((p) => p.includes(' ')).flatMap((p) => p.split(' ')));
  return [...found.entries()].filter(([p]) => p.includes(' ') || !bigramWords.has(p)).map(([phrase, turns]) => ({ phrase, turns }));
}

/**
 * Collapse: per reply, whether it names something new (a capitalised name
 * or a concrete content word never seen before in the session, the seed
 * text counting as seen). Returns the share by thirds.
 */
export function noveltyByThirds(replies, seed = '') {
  const seen = new Set(contentWords(seed));
  const flags = replies.map((r) => {
    const fresh = contentWords(r).filter((w) => w.length > 4 && !ABSTRACT.has(w) && !seen.has(w));
    for (const w of contentWords(r)) seen.add(w);
    return fresh.length >= 2;
  });
  const third = Math.max(1, Math.ceil(flags.length / 3));
  const share = (xs) => (xs.length ? xs.filter(Boolean).length / xs.length : 0);
  return { flags, thirds: [share(flags.slice(0, third)), share(flags.slice(third, 2 * third)), share(flags.slice(2 * third))] };
}

/** Abstract nouns a character should show, never name (editable). */
export const ABSTRACT = new Set(['peace', 'solitude', 'freedom', 'honor', 'honour', 'loyalty', 'truth', 'justice', 'love', 'duty', 'courage', 'dignity', 'purpose', 'meaning', 'control', 'order', 'chaos', 'trust', 'faith', 'hope', 'grief', 'pride', 'shame', 'beauty', 'silence', 'independence', 'integrity', 'balance', 'harmony', 'redemption', 'legacy']);

/** Sentences in which an abstract noun from ABSTRACT is the subject ("Loyalty is everything."). */
export function abstractSubjects(text) {
  const hits = [];
  for (const s of String(text || '').split(/(?<=[.!?])\s+|\n+/)) {
    const m = /^\W*(?:my |the |true |real )?(\p{L}+)\s+(is|was|means|matters|has|keeps|makes|isn't|was not|is not)\b/iu.exec(s.trim());
    if (m && ABSTRACT.has(m[1].toLowerCase())) hits.push(s.trim());
  }
  return hits;
}

/** The phrase given as "Might say" in a Voice field ('' when none). */
export function mightSay(voice) {
  // "Might say: '...'" on its own line; the phrase may hold apostrophes, so
  // the whole rest of the line is taken and its outer quotes removed.
  const m = /might say\s*:?\s*(.+)$/im.exec(String(voice || ''));
  return m ? m[1].trim().replace(/^['"“‘]+|['"”’.]+$/g, '').trim() : '';
}

export function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return 0;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
