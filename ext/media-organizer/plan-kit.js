// plan-kit.js — the parts the painting plan's step panels share: a section,
// a slider that shows its value, a hint, a labelled choice and a switch. Each
// is drawn from the kit or declared to the scene, so every control has a name
// and a focus ring.

import { moEl } from './dom.js';

/** A block of the panel, with an optional sentence-case title; `split` draws a line above it. */
export function moPlanSection(parent, title, split) {
  const s = moEl('div', `mo-plan-section${split ? ' mo-pc-split' : ''}`);
  if (title) s.appendChild(moEl('div', 'mo-practice-section-title', { textContent: title }));
  parent.appendChild(s);
  return s;
}

export function moPlanHint(parent, text) {
  return parent.appendChild(moEl('div', 'mo-practice-dim mo-plan-hint', { textContent: text }));
}

/**
 * A slider with its value at the right of its label. `onInput` runs while it
 * moves, `onChange` once it is let go (or a key steps it); a double-click puts
 * it back at `rest` when one is given.
 */
export function moPlanSlider(parent, o) {
  const row = moEl('div', 'mo-plan-slider');
  const head = moEl('div', 'mo-plan-slider-head');
  const text = o.text || ((v) => String(v));
  const val = moEl('span', 'mo-practice-dim', { textContent: text(o.value) });
  head.append(moEl('span', null, { textContent: o.label }), val);
  const input = moEl('input', null, { sceneId: o.id, type: 'range', min: String(o.min), max: String(o.max), step: String(o.step), 'aria-label': o.label, 'aria-valuetext': text(o.value), ...(o.title ? { title: o.title } : {}) });
  input.value = String(o.value);
  const show = (v) => { val.textContent = text(v); input.setAttribute('aria-valuetext', text(v)); };
  input.addEventListener('input', () => { const v = Number(input.value); show(v); if (o.onInput) o.onInput(v); });
  input.addEventListener('change', () => { const v = Number(input.value); show(v); if (o.onChange) o.onChange(v); });
  if (o.rest !== undefined) input.addEventListener('dblclick', () => { input.value = String(o.rest); show(o.rest); if (o.onChange) o.onChange(o.rest); });
  row.append(head, input);
  parent.appendChild(row);
  return input;
}

/** One choice of a few, filling its row, with an optional label above it. */
export function moPlanChoice(ui, parent, o, disposers) {
  const f = moEl('div', 'mo-pc-field');
  if (o.label) f.appendChild(moEl('span', null, { textContent: o.label }));
  const seg = ui.createSegmented(f, { id: o.id, ariaLabel: o.label || o.ariaLabel, value: o.value, items: o.items.map(([value, label]) => ({ value, label })), onChange: o.onChange });
  disposers.push(() => seg.dispose());
  parent.appendChild(f);
  return seg;
}

/** An on/off switch with its words. */
export function moPlanSwitch(ui, parent, o, disposers) {
  const t = ui.createToggle(parent, { id: o.id, label: o.label, checked: !!o.checked, onChange: o.onChange, ...(o.hint ? { hint: o.hint } : {}) });
  t.element.classList.add('mo-plan-switch');
  disposers.push(() => t.dispose());
  return t;
}
