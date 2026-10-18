// @vitest-environment jsdom
// Answer forms (ui/answerForms.ts, answerFormsCore.ts): the forms an AI
// answer can take besides markdown, drawn in chat and kept on pages.

import { describe, expect, it } from 'vitest';
import { formatNumber, parseFormula, parseLiteral, evaluateFormula } from '../../src/ui/answerFormMath';
import { getAnswerForm, getAnswerForms, hydrateAnswerForms, registerAnswerForm } from '../../src/ui/answerForms';
import { computeLive, parseChart, parseLive, parseTimeline, parseWorked, rewriteLiveSource, stepWorkedForm } from '../../src/ui/answerFormsCore';
import { _markdownToHtml, renderContentPart } from '../../src/built-in/chat/rendering/chatContentParts';
import { buildAnswerFormsSection, buildOpenclawSystemPrompt } from '../../src/openclaw/openclawSystemPrompt';
import { ChatContentPartKind } from '../../src/services/chatTypes';

const fence = (lang: string, body: string): string => `Intro.\n\n\`\`\`${lang}\n${body}\n\`\`\`\n\nAfter.`;
const draw = (md: string): HTMLElement => renderContentPart({ kind: ChatContentPartKind.Markdown, content: md } as never);

describe('numbers as people write them', () => {
  it('reads currency, grouping, percent and decimals', () => {
    expect(parseLiteral('$4,200')).toEqual({ value: 4200, style: { prefix: '$', percent: false, decimals: 0, group: true } });
    expect(parseLiteral('80%')?.value).toBeCloseTo(0.8);
    expect(parseLiteral('-1.25')?.value).toBe(-1.25);
    expect(parseLiteral('4,20')).toBeNull();
    expect(parseLiteral('abc')).toBeNull();
  });

  it('writes a result in a style, and fewer decimals as it grows', () => {
    expect(formatNumber(5250, { prefix: '$', percent: false, decimals: null, group: null })).toBe('$5,250');
    expect(formatNumber(1.25)).toBe('1.25');
    expect(formatNumber(0.2, { prefix: '', percent: true, decimals: null, group: null })).toBe('20%');
    expect(formatNumber(-1050, { prefix: '$', percent: false, decimals: null, group: null })).toBe('-$1,050');
    expect(formatNumber(NaN)).toBe('–');
  });

  it('parses formulas without evaluating code, and carries currency', () => {
    const f = parseFormula('ultimate - paid')!;
    const values = new Map([['ultimate', { v: 5250, unit: '$' }], ['paid', { v: 4200, unit: '$' }]]);
    expect(evaluateFormula(f, values)).toEqual({ v: 1050, unit: '$' });
    expect(evaluateFormula(parseFormula('paid / ultimate')!, values).unit).toBe('');
    expect(evaluateFormula(parseFormula('round(2 ^ 3 × 1.5 ÷ 4, 1)')!, new Map()).v).toBe(3);
    expect(parseFormula('alert(1)')).toBeNull();
    expect(parseFormula('a +')).toBeNull();
    expect(parseFormula('window.x')).toBeNull();
  });
});

describe('the forms read a forgiving syntax', () => {
  it('chart: meta lines, values as written, stressed bars', () => {
    const c = parseChart('title: Most is rent\n- Rent: $1,450 *\nFood: $620\nnot a row\nbaseline: 0')!;
    expect(c.title).toBe('Most is rent');
    expect(c.rows.map((r) => [r.label, r.shown, r.value, r.stress])).toEqual([['Rent', '$1,450', 1450, true], ['Food', '$620', 620, false]]);
    expect(parseChart('Only: 1')).toBeNull();
  });

  it('timeline: marks in brackets or a trailing star; "Today" marks itself', () => {
    const t = parseTimeline('Mar 3: Sent (done)\nApr 2: Today\nApr 15: Deadline *')!;
    expect(t.map((i) => i.mark)).toEqual(['done', 'today', 'key']);
    expect(t[2].what).toBe('Deadline');
  });

  it('worked: titles from "Title:" or **bold**, numbered or not, continuation lines join', () => {
    const w = parseWorked('1. **Find the age.** It is 36 months.\n2. Read the curve: G = 0.80\n   so 80% has emerged\n3. 1 ÷ 0.80 = 1.25')!;
    expect(w).toEqual([
      { title: 'Find the age', body: 'It is 36 months.' },
      { title: 'Read the curve', body: 'G = 0.80 so 80% has emerged' },
      { title: '', body: '1 ÷ 0.80 = 1.25' },
    ]);
  });

  it('live: inputs, formulas in any order, the sentence after ---', () => {
    const src = 'paid = 4,200 "Paid to date"\nultimate = paid * cdf "Ultimate"\ncdf = 1.25 "Factor"\n---\nUltimate {ultimate}.';
    const m = parseLive(src)!;
    expect(m.defs.map((d) => d.name)).toEqual(['paid', 'ultimate', 'cdf']);
    expect(computeLive(m)!.get('ultimate')!.text).toBe('5,250');
    expect(computeLive(m, new Map([['paid', '5000']]))!.get('ultimate')!.text).toBe('6,250');
    expect(rewriteLiveSource(src, m, 'paid', '5,000').split('\n')[0]).toBe('paid = 5,000 "Paid to date"');
  });

  it('live: unknown names and circular formulas are not a form', () => {
    expect(parseLive('a = 1\nb = a + c')).toBeNull();
    const loop = parseLive('a = b + 1\nb = a + 1')!;
    expect(computeLive(loop)).toBeNull();
  });
});

describe('in chat', () => {
  it('a form fence draws inside the prose; an unknown or broken one stays code', () => {
    const html = _markdownToHtml(fence('chart', 'title: T\nA: 2\nB: 1'));
    expect(html).toContain('class="px-af-host" data-af-form="chart"');
    expect(html).toContain('<p>Intro.</p>');
    expect(_markdownToHtml(fence('chart', 'just text'))).toContain('<pre><code class="language-chart">');
    expect(_markdownToHtml(fence('python', 'x = 1'))).toContain('language-python');
  });

  it('the model text inside a form is escaped', () => {
    const html = _markdownToHtml(fence('timeline', 'Mon: <img src=x onerror=alert(1)>\nTue: **ok**'));
    expect(html).not.toContain('<img');
    expect(html).toContain('<strong>ok</strong>');
  });

  it('concept maps still draw through the same slot, with their own save', () => {
    const el = draw(fence('mindmap', 'Root\n  A\n  B\n  C'));
    expect(el.querySelector('.parallx-mindmap')).not.toBeNull();
    expect(el.querySelector('.parallx-mindmap__save')).not.toBeNull();
    expect(el.querySelector('.px-af-save')).toBeNull();
  });

  it('a savable form gets Save To Page, running the canvas command with its block', () => {
    const el = draw(fence('chart', 'title: T\nA: 2\nB: 1'));
    const btn = el.querySelector<HTMLButtonElement>('.px-af-save button');
    expect(btn?.textContent).toContain('Save To Page');
    expect(el.querySelector('.px-af-chart__bars')?.getAttribute('aria-label')).toBe('T. A 2, B 1');
  });

  it('live numbers recompute as the reader types', () => {
    const el = draw(fence('live', 'paid = 4,200 "Paid to date"\ncdf = 1.25 "Factor"\nultimate = paid * cdf "Ultimate"\nreserve = ultimate - paid "Reserve"\n---\nWith {paid} and {cdf}, the reserve is {reserve}.'));
    const paid = el.querySelector<HTMLInputElement>('input[data-af-var="paid"]')!;
    expect(paid.getAttribute('aria-label')).toBe('Paid to date');
    const reserve = (): string[] => Array.from(el.querySelectorAll('[data-af-out="reserve"]')).map((n) => n.textContent ?? '');
    expect(reserve()).toEqual(['1,050', '1,050']);
    paid.value = '8,000';
    paid.dispatchEvent(new Event('input'));
    expect(reserve()).toEqual(['2,000', '2,000']);
    paid.value = 'oops';
    paid.dispatchEvent(new Event('input'));
    expect(reserve()).toEqual(['–', '–']);
  });

  it('a worked solution shows one step at a time, then Start Over', () => {
    const el = draw(fence('worked', 'One: a\nTwo: b\nThree: c'));
    document.body.appendChild(el);
    const box = el.querySelector<HTMLElement>('.px-af-worked')!;
    const key = box.getAttribute('data-af-key')!;
    const shown = (): number => Array.from(box.querySelectorAll<HTMLElement>('.px-af-worked__step')).filter((s) => !s.hidden).length;
    expect(shown()).toBe(1);
    expect(box.querySelector('.px-af-worked__next')?.textContent).toContain('Next Step');
    stepWorkedForm(key, 'next');
    expect(shown()).toBe(2);
    expect(box.querySelector('.px-af-worked__left')?.textContent).toBe('1 more');
    stepWorkedForm(key, 'next');
    expect(shown()).toBe(3);
    expect(box.querySelector<HTMLElement>('.px-af-worked__next')!.hidden).toBe(true);
    expect(box.querySelector<HTMLElement>('.px-af-worked__again')!.hidden).toBe(false);
    stepWorkedForm(key, 'reset');
    expect(shown()).toBe(1);
    el.remove();
  });

  it('callouts are a coloured lead-in word, not a box', () => {
    const html = _markdownToHtml('> [!WARNING]\n> A change in settlement breaks it.');
    expect(html).toContain('<div class="markdown-alert markdown-alert-warning"><p><span class="markdown-alert-lead">Watch out.</span> A change');
    expect(_markdownToHtml('> [!NOTE] Benktander\n> sits between.')).toContain('<span class="markdown-alert-lead">Benktander.</span> sits');
    expect(_markdownToHtml('> [!TIP]\n> - a list first')).toContain('<p><span class="markdown-alert-lead">Tip.</span> </p>');
  });
});

describe('a tool adds forms while it runs', () => {
  it('registers, draws, and is gone when disposed; names are its own', () => {
    const d = registerAnswerForm({ name: 'tally', hint: '### tally', ownerToolId: 'ext.t', render: (src) => `<b>${src.trim().length}</b>` });
    expect(getAnswerForm('TALLY')?.ownerToolId).toBe('ext.t');
    expect(_markdownToHtml(fence('tally', 'abc'))).toContain('<b>3</b>');
    expect(() => registerAnswerForm({ name: 'tally', hint: 'x', ownerToolId: 'ext.other', render: () => '' })).toThrow(/already registered/);
    expect(() => registerAnswerForm({ name: 'chart', hint: 'x', ownerToolId: 'ext.other', render: () => '' })).toThrow(/already registered/);
    d.dispose();
    expect(getAnswerForm('tally')).toBeUndefined();
    expect(_markdownToHtml(fence('tally', 'abc'))).toContain('language-tally');
  });

  it('the prompt teaches only the forms registered now', () => {
    const names = getAnswerForms().map((f) => f.name);
    expect(names).toEqual(expect.arrayContaining(['chart', 'timeline', 'takeaway', 'live', 'worked', 'mindmap']));
    const section = buildAnswerFormsSection([{ name: 'x', hint: '### ```x: a thing' }]);
    expect(section).toMatch(/^## Answer forms/);
    expect(section).toContain('### ```x: a thing');
    const params = { bootstrapFiles: [], workspaceDigest: '', skills: [], tools: [], runtimeInfo: { model: 'm', provider: 'ollama', host: 'h', parallxVersion: '0' } };
    expect(buildOpenclawSystemPrompt(params as never)).toContain('### ```chart: a headline chart');
    expect(buildOpenclawSystemPrompt({ ...params, answerForms: [] } as never)).not.toContain('## Answer forms');
  });

  it('hydrating twice wires once', () => {
    const el = draw(fence('worked', 'One: a\nTwo: b'));
    hydrateAnswerForms(el, { save: true });
    expect(el.querySelectorAll('.px-af-worked__next')).toHaveLength(1);
  });
});
