// answerFormsCore.ts — the answer forms every chat has (ui/answerForms.ts).
//
// The look is typographic, inside the prose, never a tinted box: a chart
// is a headline sentence over hairline bars, a timeline a date gutter
// with a rail, a takeaway a larger sentence under a short accent rule,
// live numbers editable in the sentence that uses them, a worked
// solution numbered steps shown one at a time. Each form reads a
// forgiving syntax (local models are loose with it) and returns null
// when the source is not one, so the fence shows as code instead.
//
// `registerCoreAnswerForms` is called once by chat. The page blocks that
// Save To Page makes are chat's (built-in/chat/answerFormBlocks.ts); the
// block types are named here so a form knows what it saves as.

import { escapeHtml } from './format.js';
import { createButton } from './kit.js';
import { parseMindMapInfo, renderMindMapSvg } from './conceptMap.js';
import {
  evaluateFormula, formatFormula, formatNumber, formulaNames, operatorSign, parseFormula, parseLiteral,
  type FormulaNode, type NumberStyle, type Quantity,
} from './answerFormMath.js';
import { registerAnswerForm, type AnswerForm, type AnswerFormContext, type AnswerFormHydration } from './answerForms.js';
import type { IDisposable } from '../platform/lifecycle.js';
import { MINI_APP_BLOCK, MINI_APP_FORM } from './answerFormApp.js';
import { SUGGEST_FORM } from './answerFormSuggest.js';

/** The page block each savable core form becomes (chat registers them). */
export const CORE_FORM_BLOCKS = {
  chart: 'parallx.chat.chart',
  timeline: 'parallx.chat.timeline',
  live: 'parallx.chat.live',
  worked: 'parallx.chat.worked',
  app: MINI_APP_BLOCK,
} as const;

/** The command a worked solution's Next Step and Start Over run (chat registers it). */
export const WORKED_STEP_COMMAND = 'chat.answerFormStep';

const firstWords = (text: string, max = 60): string => {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

// ── chart ───────────────────────────────────────────────────────────────────

interface ChartRow { readonly label: string; readonly shown: string; readonly value: number; readonly stress: boolean }
export interface ChartModel { readonly title: string; readonly caption: string; readonly note: string; readonly baseline: number | null; readonly rows: readonly ChartRow[] }

/** The number at the start of a value ("1.65", "$4,200", "12 days"). */
function leadingNumber(text: string): number | null {
  const whole = parseLiteral(text);
  if (whole) return whole.value;
  const m = /^\s*([$€£¥]?-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?%?)/.exec(text);
  return m ? parseLiteral(m[1])?.value ?? null : null;
}

export function parseChart(src: string): ChartModel | null {
  let title = '', caption = '', note = '';
  let baseline: number | null = null;
  const rows: ChartRow[] = [];
  for (const raw of src.split('\n')) {
    const line = raw.trim().replace(/^[-•]\s+/, '');
    if (!line) continue;
    const meta = /^(title|caption|subtitle|note|source|baseline)\s*:\s*(.*)$/i.exec(line);
    if (meta) {
      const key = meta[1].toLowerCase();
      if (key === 'title') title = meta[2];
      else if (key === 'caption' || key === 'subtitle') caption = meta[2];
      else if (key === 'baseline') baseline = leadingNumber(meta[2]);
      else note = note ? `${note} ${meta[2]}` : meta[2];
      continue;
    }
    const cut = line.lastIndexOf(':');
    if (cut <= 0) continue;
    let shown = line.slice(cut + 1).trim().replace(/^\*\*(.+)\*\*$/, '$1');
    const stress = /\*\s*$/.test(shown);
    shown = shown.replace(/\s*\*+\s*$/, '').trim();
    const value = leadingNumber(shown);
    const label = line.slice(0, cut).trim().replace(/^\*\*(.*)\*\*$/, '$1');
    if (value === null || !label) continue;
    rows.push({ label, shown, value, stress });
  }
  return rows.length >= 2 ? { title, caption, note, baseline, rows } : null;
}

function renderChart(src: string, _info: string, ctx: AnswerFormContext): string | null {
  const chart = parseChart(src);
  if (!chart) return null;
  const values = chart.rows.map((r) => r.value);
  const base = chart.baseline ?? Math.min(0, ...values);
  const top = Math.max(...values);
  const anyStress = chart.rows.some((r) => r.stress);
  const span = top - base;
  const bars = chart.rows.map((r) => {
    const pct = span > 0 ? Math.max(1.5, Math.min(100, ((r.value - base) / span) * 100)) : 100;
    const strong = !anyStress || r.stress ? ' is-strong' : '';
    return `<span class="px-af-chart__label">${ctx.renderInline(r.label)}</span>`
      + `<span class="px-af-chart__cell"><span class="px-af-chart__bar${strong}" style="--px-af-w: ${pct.toFixed(1)}%"></span>`
      + `<span class="px-af-chart__value${strong}">${escapeHtml(r.shown)}</span></span>`;
  }).join('');
  const summary = `${chart.title ? `${chart.title}. ` : ''}${chart.rows.map((r) => `${r.label} ${r.shown}`).join(', ')}`;
  return '<figure class="px-af-chart"><figcaption class="px-af-chart__head"><span class="px-af-chart__titles">'
    + (chart.title ? `<span class="px-af-chart__title">${ctx.renderInline(chart.title)}</span>` : '')
    + (chart.caption ? `<span class="px-af-chart__caption">${ctx.renderInline(chart.caption)}</span>` : '')
    + '</span><span class="px-af-save"></span></figcaption>'
    + `<div class="px-af-chart__bars" role="img" aria-label="${escapeHtml(summary)}">${bars}</div>`
    + (chart.note ? `<p class="px-af-chart__note">${ctx.renderInline(chart.note)}</p>` : '')
    + '</figure>';
}

// ── timeline ────────────────────────────────────────────────────────────────

type TimelineMark = 'done' | 'today' | 'key' | '';
export interface TimelineItem { readonly date: string; readonly what: string; readonly mark: TimelineMark }

export function parseTimeline(src: string): TimelineItem[] | null {
  const items: TimelineItem[] = [];
  for (const raw of src.split('\n')) {
    const line = raw.trim().replace(/^[-*•]\s+/, '');
    const m = /^(.+?):\s+(.+)$/.exec(line);
    if (!m) continue;
    let what = m[2].trim();
    let mark: TimelineMark = '';
    const tag = /\s*[([]\s*(done|past|today|now|key)\s*[)\]]\s*$/i.exec(what);
    if (tag) {
      const t = tag[1].toLowerCase();
      mark = t === 'past' ? 'done' : t === 'now' ? 'today' : (t as TimelineMark);
      what = what.slice(0, tag.index).trim();
    } else if (/(?<!\*)\*\s*$/.test(what)) {
      mark = 'key';
      what = what.replace(/\s*\*\s*$/, '');
    }
    if (!mark && /^today\b/i.test(what)) mark = 'today';
    if (what) items.push({ date: m[1].replace(/^\*\*(.*)\*\*$/, '$1').trim(), what, mark });
  }
  return items.length >= 2 ? items : null;
}

function renderTimeline(src: string, _info: string, ctx: AnswerFormContext): string | null {
  const items = parseTimeline(src);
  if (!items) return null;
  const said = (i: TimelineItem): string => {
    if (i.mark === 'done') return '<span class="px-af-sr">, done</span>';
    if (i.mark === 'key') return '<span class="px-af-sr">, the key date</span>';
    if (i.mark === 'today' && !/\btoday\b/i.test(i.what)) return '<span class="px-af-sr">, today</span>';
    return '';
  };
  return '<ol class="px-af-timeline">' + items.map((i) =>
    `<li class="px-af-timeline__item${i.mark ? ` is-${i.mark}` : ''}">`
    + `<span class="px-af-timeline__date">${escapeHtml(i.date)}</span>`
    + '<span class="px-af-timeline__rail" aria-hidden="true"><span class="px-af-timeline__dot"></span></span>'
    + `<span class="px-af-timeline__what">${ctx.renderInline(i.what)}${said(i)}</span></li>`,
  ).join('') + '</ol>';
}

// ── takeaway ────────────────────────────────────────────────────────────────

function renderTakeaway(src: string, _info: string, ctx: AnswerFormContext): string | null {
  const text = src.split('\n').map((l) => l.trim().replace(/^>\s*/, '')).filter(Boolean).join(' ');
  return text ? `<div class="px-af-takeaway"><p>${ctx.renderInline(text)}</p></div>` : null;
}

// ── live ────────────────────────────────────────────────────────────────────

interface LiveDef {
  readonly name: string;
  readonly label: string;
  /** The line it was read from, and the text after its value (its label), to write a new value back. */
  readonly line: number;
  readonly tail: string;
  readonly input?: { readonly text: string; readonly style: NumberStyle };
  readonly formula?: FormulaNode;
  readonly percent: boolean;
}
export interface LiveModel { readonly defs: readonly LiveDef[]; readonly sentence: string }

export function parseLive(src: string): LiveModel | null {
  const lines = src.split('\n');
  const defs: LiveDef[] = [];
  let sentenceFrom = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*-{3,}\s*$/.test(line)) { sentenceFrom = i + 1; break; }
    const m = /^\s*(?:[-*•]\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s*$/.exec(line);
    if (!m) {
      if (line.trim() && defs.length > 0) { sentenceFrom = i; break; }
      continue;
    }
    let rest = m[2];
    let label = m[1];
    let tail = '';
    const quoted = /\s*"([^"]*)"\s*$/.exec(rest) ?? /\s+#\s*(.*)$/.exec(rest);
    if (quoted) { label = quoted[1].trim() || label; tail = rest.slice(quoted.index); rest = rest.slice(0, quoted.index).trim(); }
    const percent = /\(%\)\s*$/.test(label);
    if (percent) label = label.replace(/\s*\(%\)\s*$/, '');
    const literal = parseLiteral(rest);
    if (literal) { defs.push({ name: m[1], label, line: i, tail, input: { text: rest, style: literal.style }, percent }); continue; }
    const formula = parseFormula(rest);
    if (!formula) return null;
    defs.push({ name: m[1], label, line: i, tail, formula, percent });
  }
  if (!defs.some((d) => d.formula)) return null;
  const known = new Set(defs.map((d) => d.name));
  if (new Set(defs.map((d) => d.name)).size !== defs.length) return null;
  for (const d of defs) if (d.formula && formulaNames(d.formula).some((n) => !known.has(n))) return null;
  const sentence = sentenceFrom >= 0 ? lines.slice(sentenceFrom).join('\n').trim() : '';
  return { defs, sentence };
}

/** Every value, from the inputs' current text (default: as written). Null on a circular formula. */
export function computeLive(model: LiveModel, texts: ReadonlyMap<string, string> = new Map()): Map<string, { q: Quantity; text: string }> | null {
  const byName = new Map(model.defs.map((d) => [d.name, d]));
  const out = new Map<string, { q: Quantity; text: string }>();
  const visiting = new Set<string>();
  const visit = (name: string): Quantity | null => {
    const done = out.get(name);
    if (done) return done.q;
    const d = byName.get(name);
    if (!d || visiting.has(name)) return null;
    if (d.input) {
      const typed = texts.get(name) ?? d.input.text;
      const lit = parseLiteral(typed);
      const style: NumberStyle = lit ? { ...lit.style, prefix: lit.style.prefix || d.input.style.prefix } : d.input.style;
      const q = { v: lit ? lit.value : NaN, unit: style.prefix };
      out.set(name, { q, text: formatNumber(q.v, style) });
      return q;
    }
    visiting.add(name);
    const values = new Map<string, Quantity>();
    for (const n of formulaNames(d.formula!)) {
      const q = visit(n);
      if (!q) return null;
      values.set(n, q);
    }
    visiting.delete(name);
    const q = evaluateFormula(d.formula!, values);
    out.set(name, { q, text: formatNumber(q.v, { prefix: q.unit, percent: d.percent, decimals: null, group: null }) });
    return q;
  };
  for (const d of model.defs) if (!visit(d.name)) return null;
  return out;
}

/** The source with one input's value written back in place. */
export function rewriteLiveSource(src: string, model: LiveModel, name: string, text: string): string {
  const d = model.defs.find((x) => x.name === name && x.input);
  if (!d) return src;
  const lines = src.split('\n');
  lines[d.line] = `${d.name} = ${text.trim()}${d.tail}`;
  return lines.join('\n');
}

function renderLive(src: string, _info: string, ctx: AnswerFormContext): string | null {
  const model = parseLive(src);
  const values = model && computeLive(model);
  if (!model || !values) return null;
  const byName = new Map(model.defs.map((d) => [d.name, d]));
  const placed = new Set<string>();
  const input = (d: LiveDef): string => {
    placed.add(d.name);
    const text = d.input!.text;
    return `<input class="px-af-live__in" type="text" inputmode="decimal" spellcheck="false" autocomplete="off" `
      + `data-af-var="${escapeHtml(d.name)}" value="${escapeHtml(text)}" size="${Math.max(3, text.length + 1)}" aria-label="${escapeHtml(d.label)}">`;
  };
  const out = (name: string, cls = ''): string => `<span class="px-af-live__out${cls}" data-af-out="${escapeHtml(name)}">${escapeHtml(values.get(name)?.text ?? '–')}</span>`;
  const ref = (name: string): string => {
    const d = byName.get(name)!;
    return d.input && !placed.has(name) ? input(d) : out(name);
  };

  // The sentence: inputs become fields, results the numbers they make.
  let sentence = '';
  if (model.sentence) {
    const slots: string[] = [];
    const marked = model.sentence.replace(/\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}/g, (whole, name: string) => {
      const d = byName.get(name);
      if (!d) return whole;
      slots.push(d.input && !placed.has(name) ? input(d) : out(name, ' is-result'));
      return `⟦${slots.length - 1}⟧`;
    });
    sentence = `<p class="px-af-live__sentence">${ctx.renderInline(marked).replace(/⟦(\d+)⟧/g, (_m, i: string) => slots[Number(i)] ?? '')}</p>`;
  }

  // The worked sum: each result from what it is made of, a chain where one result feeds the next.
  const rows: string[] = [];
  const row = (op: string, label: string, value: string, cls = ''): void => {
    rows.push(`<span class="px-af-live__op${cls}">${op}</span><span class="px-af-live__label${cls}">${label}</span><span class="px-af-live__value${cls}">${value}</span>`);
  };
  const labelOf = (n: FormulaNode): string => (n.k === 'var' ? escapeHtml(byName.get(n.name)?.label ?? n.name) : '');
  const valueOf = (n: FormulaNode): string => (n.k === 'var' ? ref(n.name) : escapeHtml(n.k === 'num' ? formatNumber(n.v) : ''));
  const simple = (n: FormulaNode): boolean => n.k === 'var' || n.k === 'num';
  let prev: string | null = null;
  const results = model.defs.filter((d) => d.formula);
  for (const d of results) {
    const f = d.formula!;
    if (f.k === 'bin' && f.op !== '^' && f.a.k === 'var' && f.a.name === prev && simple(f.b)) {
      row(operatorSign(f.op), labelOf(f.b), valueOf(f.b));
    } else {
      if (rows.length) rows.push('<span class="px-af-live__gap" aria-hidden="true"></span>');
      if (f.k === 'bin' && f.op !== '^' && simple(f.a) && simple(f.b)) {
        row('', labelOf(f.a), valueOf(f.a));
        row(operatorSign(f.op), labelOf(f.b), valueOf(f.b));
      } else {
        row('', escapeHtml(formatFormula(f, (n) => byName.get(n)?.label ?? n)), '', ' is-formula');
      }
    }
    row('=', escapeHtml(d.label), out(d.name), d === results[results.length - 1] ? ' is-result is-final' : ' is-result');
    prev = d.name;
  }
  const hasInputs = model.defs.some((d) => d.input);
  return '<div class="px-af-live">' + sentence
    + `<div class="px-af-live__sum">${rows.join('')}</div>`
    + (hasInputs ? '<p class="px-af-live__hint">The underlined numbers are yours to change; everything after them follows.</p>' : '')
    + '<span class="px-af-sr" aria-live="polite" data-af-announce></span></div>';
}

function hydrateLive(root: HTMLElement, h: AnswerFormHydration): void {
  const model = parseLive(h.src);
  if (!model) return;
  const fields = Array.from(root.querySelectorAll<HTMLInputElement>('input[data-af-var]'));
  const announce = root.querySelector<HTMLElement>('[data-af-announce]');
  let src = h.src;
  let announceTimer: ReturnType<typeof setTimeout> | undefined;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const recompute = (): void => {
    const texts = new Map(fields.map((f) => [f.getAttribute('data-af-var') ?? '', f.value]));
    const values = computeLive(model, texts);
    if (!values) return;
    for (const el of Array.from(root.querySelectorAll<HTMLElement>('[data-af-out]'))) {
      el.textContent = values.get(el.getAttribute('data-af-out') ?? '')?.text ?? '–';
    }
    clearTimeout(announceTimer);
    announceTimer = setTimeout(() => {
      if (announce) announce.textContent = model.defs.filter((d) => d.formula).map((d) => `${d.label} ${values.get(d.name)?.text ?? ''}`).join('. ');
    }, 500);
  };
  for (const f of fields) {
    f.addEventListener('input', () => {
      f.size = Math.max(3, f.value.length + 1);
      recompute();
      if (!h.onSourceChange || !parseLiteral(f.value)) return;
      src = rewriteLiveSource(src, model, f.getAttribute('data-af-var') ?? '', f.value);
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => h.onSourceChange?.(src), 700);
    });
  }
}

// ── worked ──────────────────────────────────────────────────────────────────

export interface WorkedStep { readonly title: string; readonly body: string }

export function parseWorked(src: string): WorkedStep[] | null {
  const steps: { title: string; body: string }[] = [];
  for (const raw of src.split('\n')) {
    if (!raw.trim()) continue;
    const marker = /^\s*(?:\d+[.)]|[-*•])\s+/.exec(raw);
    if (!marker && /^\s/.test(raw) && steps.length) {
      const last = steps[steps.length - 1];
      last.body = `${last.body} ${raw.trim()}`.trim();
      continue;
    }
    const line = raw.slice(marker ? marker[0].length : 0).trim();
    const bold = /^\*\*(.+?)\*\*[:.]?\s*(.*)$/.exec(line);
    if (bold) { steps.push({ title: bold[1].replace(/[.:]\s*$/, ''), body: bold[2] }); continue; }
    const colon = /^([^:=$`]{2,48}):\s+(.+)$/.exec(line);
    if (colon && colon[1].trim().split(/\s+/).length <= 7 && !/^\d/.test(colon[1])) {
      steps.push({ title: colon[1].trim(), body: colon[2] });
      continue;
    }
    steps.push({ title: '', body: line });
  }
  return steps.length >= 2 ? steps : null;
}

let _workedKeys = 0;

function renderWorked(src: string, _info: string, ctx: AnswerFormContext): string | null {
  const steps = parseWorked(src);
  if (!steps) return null;
  const key = `af${++_workedKeys}`;
  const items = steps.map((s, i) => {
    const title = s.title ? `<span class="px-af-worked__title">${ctx.renderInline(/[.!?]$/.test(s.title) ? s.title : `${s.title}.`)}</span> ` : '';
    return `<li class="px-af-worked__step${i === 0 ? ' is-current' : ''}"${i === 0 ? '' : ' hidden'}>${title}${ctx.renderInline(s.body)}</li>`;
  }).join('');
  return `<div class="px-af-worked" data-af-key="${key}" data-af-steps="${steps.length}">`
    + `<ol class="px-af-worked__steps" aria-live="polite">${items}</ol>`
    + `<div class="px-af-worked__nav"><span class="px-af-worked__left">${steps.length - 1} more</span>`
    + `<span class="px-af-worked__done" hidden>All ${steps.length} steps shown.</span></div></div>`;
}

function hydrateWorked(root: HTMLElement): void {
  const box = root.querySelector<HTMLElement>('.px-af-worked');
  const nav = box?.querySelector<HTMLElement>('.px-af-worked__nav');
  const key = box?.getAttribute('data-af-key');
  if (!box || !nav || !key) return;
  const next = createButton(nav, { id: null, label: 'Next Step', icon: 'chevron-right', kind: 'ghost', size: 'sm', command: WORKED_STEP_COMMAND, args: [key, 'next'] });
  next.classList.add('px-af-worked__next');
  nav.insertBefore(next, nav.firstChild);
  const again = createButton(nav, { id: null, label: 'Start Over', icon: 'rotate-ccw', kind: 'ghost', size: 'sm', command: WORKED_STEP_COMMAND, args: [key, 'reset'] });
  again.classList.add('px-af-worked__again');
  again.hidden = true;
}

/** Next Step and Start Over on the worked solution `key`; Dismiss puts any keyed form away (the command's body). */
export function stepWorkedForm(key: string, action: 'next' | 'reset' | 'dismiss'): void {
  const found = document.querySelector<HTMLElement>(`[data-af-key="${String(key).replace(/[^a-z0-9]/gi, '')}"]`);
  if (found && action === 'dismiss') { (found.closest<HTMLElement>('.px-af-host') ?? found).hidden = true; return; }
  const box = found?.classList.contains('px-af-worked') ? found : null;
  if (!box) return;
  const steps = Array.from(box.querySelectorAll<HTMLElement>('.px-af-worked__step'));
  const shown = steps.filter((s) => !s.hidden).length;
  const count = action === 'reset' ? 1 : Math.min(steps.length, shown + 1);
  steps.forEach((s, i) => { s.hidden = i >= count; s.classList.toggle('is-current', i === count - 1); });
  const finished = count >= steps.length;
  const next = box.querySelector<HTMLElement>('.px-af-worked__next');
  const again = box.querySelector<HTMLElement>('.px-af-worked__again');
  const left = box.querySelector<HTMLElement>('.px-af-worked__left');
  const done = box.querySelector<HTMLElement>('.px-af-worked__done');
  const hadFocus = (el: HTMLElement | null): boolean => !!el && el === document.activeElement;
  const moveFocus = hadFocus(next) || hadFocus(again);
  if (next) next.hidden = finished;
  if (left) { left.hidden = finished; left.textContent = `${steps.length - count} more`; }
  if (done) done.hidden = !finished;
  if (again) again.hidden = !finished;
  if (moveFocus) (finished ? again : next)?.focus();
}

// ── concept map ─────────────────────────────────────────────────────────────

function renderConceptMap(src: string, info: string, ctx: AnswerFormContext): string | null {
  const { dir } = parseMindMapInfo(`mindmap ${info}`);
  const html = renderMindMapSvg(src, { dir, renderMath: ctx.renderMath });
  // A rendered map (not the fallback) grows its own save: the outline is
  // the payload, and the canvas has a living concept map block for it.
  if (!html.startsWith('<div class="parallx-mindmap"')) return html;
  return html.replace(/<\/div>$/, '<button type="button" class="parallx-mindmap__save" '
    + `data-mindmap-src="${encodeURIComponent(src)}" data-mindmap-dir="${dir}">Save To Canvas</button></div>`);
}

// ── Registration ────────────────────────────────────────────────────────────

const FENCE = '```';

export const CORE_ANSWER_FORMS: readonly Omit<AnswerForm, 'ownerToolId'>[] = [
  {
    name: 'chart',
    hint: [
      `### ${FENCE}chart: a headline chart`,
      'Bars for a handful of numbers that make one point. One `label: value` per line, the value as you would write it (1.65, $4,200, 80%).',
      '`title:` is the point as a sentence, never a topic; `caption:` says what is measured; `note:` adds one line under the bars;',
      '`baseline: 1` starts the bars at 1 (factors, ratios). End a line with * to stress that bar.',
      `${FENCE}chart`, 'title: Rent and food are two thirds of spending', 'caption: Monthly spending, last quarter',
      'Rent: $1,450 *', 'Food: $620 *', 'Transport: $310', 'Utilities: $180', FENCE,
    ].join('\n'),
    render: renderChart,
    saveAs: { blockType: CORE_FORM_BLOCKS.chart, title: (src) => firstWords(parseChart(src)?.title || 'Chart') },
  },
  {
    name: 'timeline',
    hint: [
      `### ${FENCE}timeline: dates in order`,
      'One `date: what` per line, earliest first. Mark a line (done), (today) or (key): done is past, today is now, key is the date that matters most.',
      `${FENCE}timeline`, 'Mar 3: Application sent (done)', 'Mar 20: Interview (done)', 'Apr 2: Today (today)', 'Apr 15: Offer deadline (key)', FENCE,
    ].join('\n'),
    render: renderTimeline,
    saveAs: { blockType: CORE_FORM_BLOCKS.timeline, title: () => 'Timeline' },
  },
  {
    name: 'takeaway',
    aliases: ['pullquote', 'key-point'],
    hint: [
      `### ${FENCE}takeaway: the sentence to remember`,
      'One or two sentences, set larger under a short rule. At most one per reply, after the explanation it sums up.',
    ].join('\n'),
    render: renderTakeaway,
  },
  {
    name: 'live',
    aliases: ['calc', 'calculation'],
    hint: [
      `### ${FENCE}live: numbers the reader can change`,
      'A calculation the reader can try with their own numbers. `name = value "Label"` lines are the inputs; `name = formula "Label"` lines',
      'follow from them (+ - * / ^, parentheses, min, max, round, sqrt, exp, ln). After a line `---`, one sentence that uses them as {name}.',
      'The inputs show as editable numbers in the sentence, and a worked sum shows how each result is reached. A label ending in (%) shows a result as a percent.',
      `${FENCE}live`, 'monthly = $500 "Saved each month"', 'months = 18 "Months"', 'goal = $12,000 "Goal"',
      'saved = monthly * months "Saved"', 'left = goal - saved "Still to save"', '---',
      'Saving {monthly} a month for {months} months puts away {saved}, which leaves {left} to reach {goal}.', FENCE,
    ].join('\n'),
    render: renderLive,
    hydrate: hydrateLive,
    saveAs: { blockType: CORE_FORM_BLOCKS.live, title: () => 'Calculation' },
  },
  {
    name: 'worked',
    aliases: ['steps', 'solution'],
    hint: [
      `### ${FENCE}worked: a solution shown one step at a time`,
      'For a problem the reader should follow step by step. One step per line, `Title: what happens, with the numbers`; the reader reveals them one at a time.',
      'It replaces writing the steps out: never give the same steps in prose as well.',
      `${FENCE}worked`, 'Find the change: 72 − 60 = 12.', 'Divide by where it started: 12 ÷ 60 = 0.2.', 'Write it as a percent: 0.2 is a 20% increase.', FENCE,
    ].join('\n'),
    render: renderWorked,
    hydrate: hydrateWorked,
    saveAs: { blockType: CORE_FORM_BLOCKS.worked, title: (src) => firstWords(parseWorked(src)?.[0]?.title || 'Worked Solution') },
  },
  MINI_APP_FORM,
  SUGGEST_FORM,
  {
    name: 'mindmap',
    aliases: ['concept-map'],
    hint: conceptMapHint(),
    render: renderConceptMap,
  },
];

/**
 * The concept map's teaching (it was the system prompt's "Concept maps"
 * section). Two halves carry the weight: the "when NOT to" half (left to
 * itself a model decorates every answer with a diagram) and the "one
 * question per level" half (left to itself a model associates, which
 * draws a web, not a hierarchy).
 */
function conceptMapHint(): string {
  return [
    `### ${FENCE}mindmap: a concept map`,
    'Its syntax is an indented list — indentation is the only thing that',
    'matters, and a child is any line indented further than the line above:',
    '',
    `${FENCE}mindmap`, 'Reserve risk', '  Parameter risk', '    every year shares the same estimated factors',
    '    does not diversify across years', '  Process risk', '    randomness left in future development', '    averages out across years', FENCE,
    '',
    `A bare ${FENCE}mindmap draws radially: the first line is the centre card`,
    'and its branches grow out on both sides, so give a map ONE root with',
    `three to seven branches and the details under those. Write`,
    `${FENCE}mindmap tree for a left-to-right tree (several roots, or a chain)`,
    `and ${FENCE}mindmap vertical for a top-down tree (wide, shallow maps).`,
    'A box is markdown: full sentences, **bold**, *italic*, `code`, ~~strike~~,',
    'inline $LaTeX$ (renders as real math). Long text wraps and is never cut.',
    'For several lines in ONE box write \\n inside its line: bullets',
    '(`**Checks**\\n- means add\\n- SE between floor and sum`), numbered',
    'items, # headings, > quotes and $$display math$$ all render. Keep each',
    'box to one idea; the hierarchy still comes from the indentation.',
    '',
    'Use one when the answer is about how several ideas RELATE — what depends',
    'on what, what splits into what, how two things differ and where they',
    'meet. Draw the map first, then explain it in prose; the map is the',
    'skeleton of the explanation, never a replacement for one.',
    '',
    'Do NOT use one for a sequence of steps, a plain list, a comparison of',
    'two things, or anything with fewer than four nodes. Prose is better for',
    'all of those, and a diagram of something that was already a list makes',
    'the reply longer without making it clearer. Most answers need no map.',
    '',
    'Build it top-down, ONE QUESTION PER LEVEL. The first line is the topic.',
    'Decide what single question its branches answer (what are its parts,',
    'its kinds, its steps, its assumptions, its consequences) and every',
    'branch answers that question and nothing else. Under each branch,',
    'again one question. Siblings are parallel: the same kind of thing, the',
    'same grammar, no overlap, and together they cover the parent. A child',
    'sits under its parent because the parent CONTAINS it, never because it',
    'reminds you of it; a node that would fit under another parent is in the',
    'wrong place. Order siblings by the logic (sequence, importance, the',
    'source\'s order), never by the order they occurred to you. A branch with',
    'one child is not a branch: merge it up. Before writing the nodes, name',
    'the question for each level to yourself; if you cannot name it, what',
    'you have is a list of associations, and prose will serve better.',
    '',
    'Shape: three to seven branches, two to five leaves under each, three',
    'levels at most, under about 20 nodes. Branches are named dimensions;',
    'leaves are short claims, not sentences. The reader can click any node',
    'to ask a follow-up about it.',
  ].join('\n');
}

let _registered: IDisposable[] | null = null;

/** Register the core forms once (chat calls this when it starts). */
export function registerCoreAnswerForms(): void {
  if (_registered) return;
  _registered = CORE_ANSWER_FORMS.map((f) => registerAnswerForm({ ...f, ownerToolId: 'core' }));
}
