// colour-study-panels.js — the two panels that take the rows' place on a Colour
// Study sheet: the bench, where a mix is changed (parts, a swapped tube, one
// more squeeze of each, what to do when it is wrong), and My Paints, where
// the painter's list and its named sets are kept. Both only draw: every
// control runs one of the sheet's commands (colour-study-home.js).

import { moEl, moSlug } from './dom.js';
import { MO_COMMON_PAINTS } from './colour.js';
import { moFixMix, moHex, moMixOrder, moTubeNudges } from './paint-engine.js';
import { PROBLEMS, say } from './colour-study-state.js';

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * c: { ui, view, go(parent, action, label, icon, opts), goIcon(parent, action, icon, title, opts), owned: [],
 *   mix: [{ name, parts }], edited, rec, drift, paints (in use), all, fixing, onAdd(name) }
 */
export function moDrawBench(c) {
  const { ui, view, go, goIcon, mix, rec } = c;
  view.replaceChildren();
  const head = moEl('div', 'mo-cs-line');
  head.append(moEl('span', 'mo-practice-section-title', { textContent: 'The mix' }), moEl('span', 'mo-cs-grow'));
  const reset = go(head, 'resetMix', rec && rec.paints.length ? `Back To ${rec.paints.map((p) => p.parts).join(' : ')}` : 'Back To The Recipe', 'rotate-ccw', { kind: 'ghost', title: 'Undo the changes to the mix' });
  reset.disabled = !c.edited;
  go(head, 'closeBench', 'Back To Rows', 'chevron-left', { kind: 'ghost' });
  view.appendChild(head);
  const d = c.drift;
  view.appendChild(moEl('div', 'mo-cs-drift', { textContent: !d ? 'Put a paint down to start a mix.' : !c.edited ? '' : d.text === 'the same' ? 'Your mix matches the target: the eye would not tell them apart.' : `Your mix is ${d.text} than the target.` }));
  if (mix.length > 1) view.appendChild(moEl('div', 'mo-practice-dim mo-cs-cap', { textContent: moMixOrder(mix, c.all).text }));

  const list = moEl('div', 'mo-cs-tube-list');
  for (const m of mix) {
    const p = c.all.find((x) => x.name === m.name), slug = moSlug(m.name);
    const row = moEl('div', 'mo-cs-tube', { 'data-paint': m.name });
    const sw = moEl('span', 'mo-cs-sw', { 'aria-hidden': 'true' }); if (p) sw.style.background = p.hex;
    const step = moEl('span', 'mo-cs-step', { role: 'group', 'aria-label': `Parts of ${m.name}` });
    goIcon(step, 'less', 'minus', `Less ${m.name}`, { tail: slug, args: [m.name] }).disabled = m.parts <= 1 && mix.length === 1;
    step.appendChild(moEl('span', 'mo-cs-parts', { textContent: String(m.parts), 'aria-label': `${m.parts} part${m.parts === 1 ? '' : 's'}` }));
    goIcon(step, 'more', 'plus', `More ${m.name}`, { tail: slug, args: [m.name] }).disabled = m.parts >= 24;
    const role = !c.edited && rec ? (rec.paints.find((x) => x.name === m.name) || {}).role : '';
    const acts = moEl('span', 'mo-cs-line');
    go(acts, 'swap', 'Swap…', 'arrow-left-right', { kind: 'ghost', tail: slug, args: [m.name], title: `Mix this without ${m.name}` });
    goIcon(acts, 'dropPaint', 'x', `Take ${m.name} out`, { tail: slug, args: [m.name] });
    row.append(sw, moEl('span', 'mo-cs-tube-name', { textContent: m.name }), step, moEl('span', 'mo-practice-dim mo-cs-role', { textContent: role || '' }), acts);
    list.appendChild(row);
  }
  view.appendChild(list);
  const addable = c.paints.filter((p) => !mix.some((m) => m.name === p.name));
  if (addable.length) {
    const line = moEl('div', 'mo-cs-line');
    const dd = ui.createDropdown(line, { items: [{ value: '', label: 'Add A Paint' }, ...addable.map((p) => ({ value: p.name, label: p.name, color: p.hex }))], selected: '', ariaLabel: 'Add a paint to the mix' });
    dd.element.setAttribute('data-px-id', 'media-organizer.colour.addPaintToMix');
    const sub = dd.onDidChange((v) => { if (v) c.onAdd(v); });
    c.owned.push(() => { sub.dispose(); dd.dispose(); });
    view.appendChild(line);
  }

  // one more part of each tube
  const nudges = moEl('div', 'mo-cs-nudges', { role: 'group', 'aria-label': 'One more part of each tube' });
  for (const n of moTubeNudges(c.paints, mix, 1)) {
    const words = n.drift.text === 'the same' ? 'Hardly changes' : cap(n.drift.text);
    const b = go(nudges, 'nudge', `${n.name}: ${words}`, 'plus', { kind: 'ghost', tail: moSlug(n.name), args: [n.name], title: `Add one part of ${n.name}` });
    b.classList.add('mo-cs-nudge'); b.setAttribute('data-paint', n.name);
    const sw = moEl('span', 'mo-cs-nudge-sw', { 'aria-hidden': 'true' }); sw.style.background = moHex(n.rgb);
    b.replaceChildren(sw, moEl('b', null, { textContent: n.name }), moEl('span', 'mo-practice-dim', { textContent: words }));
  }
  view.append(moEl('div', 'mo-practice-section-title', { textContent: 'One more part of each tube' }), nudges, moEl('div', 'mo-practice-dim mo-cs-cap', { textContent: 'Each swatch is the mix with one more part of that tube. Press one to add it.' }));

  // fix my mix
  const fixRow = moEl('div', 'mo-cs-line mo-cs-wrap', { role: 'group', 'aria-label': 'What is wrong with the mix' });
  for (const [k, label, icon] of PROBLEMS) { const b = go(fixRow, 'fix', label, icon, { kind: 'ghost', tail: k, args: [k] }); b.classList.add('mo-cs-fix'); b.setAttribute('aria-pressed', String(c.fixing === k)); }
  const advice = moEl('div', `mo-cs-fix-advice${c.fixing ? '' : ' mo-hidden'}`, { 'aria-live': 'polite' });
  if (c.fixing) { const f = mix.length ? moFixMix(c.paints, mix, c.fixing) : null; advice.textContent = f ? f.text : 'None of your paints moves this mix that way.'; }
  view.append(moEl('div', 'mo-practice-section-title', { textContent: 'Fix my mix' }), fixRow, advice);
}

/** c: { ui, view, go, goIcon, owned: [], all, setInfo, onAddCommon(paint), onStrength(name, value) } */
export function moDrawPaints(c) {
  const { ui, view, go, goIcon, all, setInfo } = c;
  view.replaceChildren();
  const head = moEl('div', 'mo-cs-line');
  head.append(moEl('span', 'mo-practice-section-title', { textContent: 'Paints you have' }), moEl('span', 'mo-practice-dim', { textContent: String(all.length) }), moEl('span', 'mo-cs-grow'));
  go(head, 'closePaints', 'Back To Rows', 'chevron-left', { kind: 'ghost' });
  view.appendChild(head);
  view.appendChild(moEl('div', 'mo-practice-dim mo-cs-cap', { textContent: setInfo.current ? `These are the set ${setInfo.current}. Change them and save the set again to keep the change in it. Painting plans use these paints too.` : `${setInfo.starter ? 'Starter paints until you set your own. ' : ''}Painting plans use these paints too. Save them as a set to keep more than one kit.` }));
  const setRow = moEl('div', 'mo-cs-line mo-cs-wrap');
  go(setRow, 'saveSet', 'Save As Set…', 'save');
  go(setRow, 'deleteSet', 'Delete Set…', 'trash-2', { kind: 'ghost' }).disabled = !setInfo.current;
  go(setRow, 'starterPaints', 'Use Starter Paints', 'rotate-ccw', { kind: 'ghost' });
  view.appendChild(setRow);

  const list = moEl('div', 'mo-cs-paint-list');
  for (const p of all) {
    const slug = moSlug(p.name), row = moEl('div', 'mo-cs-paint', { 'data-paint': p.name });
    const colour = goIcon(row, 'paintColour', 'palette', `Change the colour of ${p.name}, now ${p.hex}…`, { tail: slug, args: [p.name] });
    colour.classList.add('mo-cs-paint-colour');
    const sw = moEl('span', 'mo-cs-sw', { 'aria-hidden': 'true' }); sw.style.background = p.hex;
    colour.replaceChildren(sw);
    row.appendChild(moEl('span', 'mo-cs-tube-name', { textContent: p.name }));
    const strength = moEl('span', 'mo-cs-strength');
    const sl = ui.createSlider(strength, { id: `media-organizer.colour.strength.${slug}`, label: `Strength of ${p.name}`, min: 0.5, max: 2, step: 0.1, value: p.strength || 1, onCommit: (v) => c.onStrength(p.name, v) });
    c.owned.push(() => sl.dispose());
    strength.appendChild(moEl('span', 'mo-practice-dim', { textContent: `Strength ${say(p.strength || 1)}` }));
    row.appendChild(strength);
    goIcon(row, 'removePaint', 'x', `Remove ${p.name}`, { tail: slug, args: [p.name] });
    list.appendChild(row);
  }
  view.appendChild(list);
  const addRow = moEl('div', 'mo-cs-line mo-cs-wrap');
  const addable = MO_COMMON_PAINTS.filter((x) => !all.some((p) => p.name === x.name));
  if (addable.length) {
    const dd = ui.createDropdown(addRow, { items: [{ value: '', label: 'Add A Common Paint' }, ...addable.map((p) => ({ value: p.name, label: p.name, color: p.hex }))], selected: '', ariaLabel: 'Add a common paint' });
    dd.element.setAttribute('data-px-id', 'media-organizer.colour.addCommonPaint');
    const sub = dd.onDidChange((v) => { const x = MO_COMMON_PAINTS.find((y) => y.name === v); if (x) c.onAddCommon(x); });
    c.owned.push(() => { sub.dispose(); dd.dispose(); });
  }
  go(addRow, 'customPaint', 'Custom Paint…', 'plus');
  view.appendChild(addRow);
  view.appendChild(moEl('div', 'mo-practice-dim mo-cs-cap', { textContent: 'A paint’s colour is how its mid tone reads on screen. Strength is how far one part of it goes: raise it for a tube that takes over a mix, lower it for a weak one. Both are estimates until you set them from your own tubes.' }));
}
