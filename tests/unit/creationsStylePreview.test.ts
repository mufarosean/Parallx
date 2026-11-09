// @vitest-environment jsdom
// style-preview.js: the writing styles readable where they are chosen. A
// preset's full text and its late reminder show under the dropdown; Custom
// shows the custom text or says it is empty; None says nothing is sent;
// Start Custom From This fills an empty custom style and never overwrites one.
import { describe, it, expect } from 'vitest';
// @ts-expect-error — JS module with no types
import { describePreset, mountStylePreview, mountCustomStylePreview, runStyleCommand } from '../../ext/creations-ai/style-preview.js';
// @ts-expect-error — JS module with no types
import { WRITING_PRESETS, STYLE_HINTS } from '../../ext/creations-ai/writing-style.js';

function el(tag: string, className?: string | null, attrs?: Record<string, string>) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (attrs) for (const [k, v] of Object.entries(attrs)) { if (k === 'text') e.textContent = v; else if (k === 'html') e.innerHTML = v; else e.setAttribute(k, v); }
  return e;
}
const ui = {
  createBlock(container: HTMLElement | null, tag: string, o: { className?: string; text?: string; attrs?: Record<string, string> } = {}) {
    const e = document.createElement(tag);
    if (o.className) e.className = o.className;
    if (o.text != null) e.textContent = o.text;
    for (const [k, v] of Object.entries(o.attrs || {})) e.setAttribute(k, v);
    container?.appendChild(e);
    return e;
  },
  // As the kit does: a button with a command runs it with its args.
  createButton(container: HTMLElement | null, o: { label: string; command?: string; args?: unknown[]; title?: string }) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = o.label;
    if (o.title) b.title = o.title;
    if (o.command) b.addEventListener('click', () => runStyleCommand(o.command!, o.args ?? []));
    container?.appendChild(b);
    return b;
  },
};
const buttonNamed = (root: HTMLElement, label: string) => [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === label) as HTMLButtonElement;
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('describePreset', () => {
  it('a shipped preset is its full text and its late reminder; Custom is the custom text; None sends nothing', () => {
    const d = describePreset('natural-rp');
    expect(d.text).toBe(WRITING_PRESETS['natural-rp'].content);
    expect(d.hint).toBe(STYLE_HINTS['natural-rp']);
    expect(d.label).toBe('Natural RP (Benchmark Winner)');
    expect(describePreset('custom', '  - Short.  ')).toMatchObject({ text: '- Short.', hint: '' });
    expect(describePreset('custom', '').note).toMatch(/^Empty\./);
    expect(describePreset('none')).toMatchObject({ text: '', hint: '' });
    expect(describePreset('none').note).toMatch(/No style text is sent/);
    expect(describePreset('').text).toBe(WRITING_PRESETS['immersive-rp'].content);
  });
});

describe('mountStylePreview', () => {
  it('opens on Style Text, shows the chosen preset, follows the dropdown on refresh, and reads a custom text getter', async () => {
    const host = el('div');
    const select = { value: 'screenplay' };
    let custom = '';
    const p = mountStylePreview(host, ui, select, { customText: async () => custom, idBase: 't' });
    await flush();
    const toggle = buttonNamed(host, 'Style Text');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    const body = host.querySelector('.tg-style-preview-body') as HTMLElement;
    expect(body.hidden).toBe(true);
    toggle.click();
    await flush();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(body.hidden).toBe(false);
    const text = host.querySelector('.tg-style-preview-text') as HTMLElement;
    expect(text.textContent).toBe(WRITING_PRESETS.screenplay.content);
    expect(text.getAttribute('role')).toBe('region');
    expect((host.querySelector('.tg-style-preview-hint:last-of-type') as HTMLElement).textContent).toContain(STYLE_HINTS.screenplay);
    select.value = 'custom';
    custom = '- Mine.';
    await p.refresh();
    expect(text.textContent).toBe('- Mine.');
    expect(text.hidden).toBe(false);
    select.value = 'none';
    await p.refresh();
    expect(text.hidden).toBe(true);
    expect(buttonNamed(host, 'Start Custom From This')).toBeUndefined();
    expect(host.textContent).not.toMatch(/[—–]/);
  });
});

describe('mountCustomStylePreview', () => {
  it('Start Custom From This fills an empty custom style with the preset text and switches to Custom; a filled one is left alone', async () => {
    const group = el('div', 'tg-form-group');
    const dd = el('span');
    group.appendChild(dd);
    const input = el('textarea') as HTMLTextAreaElement;
    const select = { element: dd, value: 'natural-rp' };
    const preview = mountCustomStylePreview(ui, select, input);
    await flush();
    expect(group.querySelector('.tg-style-preview')).toBeTruthy(); // under the preset dropdown, not under the textarea
    buttonNamed(group, 'Style Text').click();
    await flush();
    const start = buttonNamed(group, 'Start Custom From This');
    expect(start.hidden).toBe(false);
    start.click();
    await flush();
    expect(input.value).toBe(WRITING_PRESETS['natural-rp'].content);
    expect(select.value).toBe('custom');
    expect(start.hidden).toBe(true);
    // Back to a preset with text in the box: the button explains and changes nothing.
    select.value = 'casual-rp';
    await preview.refresh();
    input.value = '- Kept.';
    start.click();
    await flush();
    expect(input.value).toBe('- Kept.');
    expect(select.value).toBe('casual-rp');
    expect(group.textContent).toContain('The custom style already has text. Clear it first to start again from a preset.');
  });
});
