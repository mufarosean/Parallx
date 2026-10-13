// dom.js — Concept Lab's SVG element helper, and its controls in the scene
// (docs/SELF_DESCRIBING_UI_DESIGN.md step 7). The lab draws its own
// buttons and sliders; clDeclare names one in place (DOM and listeners
// unchanged). It reads api.ui, set once at activate; before that it does
// nothing.

const SVG_NS = 'http://www.w3.org/2000/svg';

export function svgEl(tag, attrs, cls) {
  const el = document.createElementNS(SVG_NS, tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (cls) el.setAttribute('class', cls);
  return el;
}

let ui = null;

export function setSceneUi(next) { ui = next || null; }

/** A dynamic id segment (a module, a preset): the kit's slug. */
export function clSlug(value) {
  return ui?.sceneSlug ? ui.sceneSlug(String(value ?? '')) : '';
}

/**
 * Declares a control the lab drew. The label is the accessible name, else
 * the visible text; a button's state is whether it is enabled.
 */
export function clDeclare(node, id, extra = {}) {
  if (!ui?.declareControl) return node;
  const label = extra.label || node.getAttribute('aria-label') || node.textContent.trim() || node.title || '';
  const hint = node.title && node.title !== label ? node.title : undefined;
  ui.declareControl(node, {
    id,
    label,
    kind: extra.kind || 'button',
    ...(hint ? { hint } : {}),
    state: extra.state || (() => ({ kind: 'enabled', value: !node.disabled })),
  });
  return node;
}

/**
 * A drag on bars, from the keyboard: the chart takes focus as a slider,
 * Left/Right pick a bar (outlined while focused), Up/Down change its value
 * (Shift: five steps), Home/End set its least and most. `read()` gives each
 * bar's { value, label, text }; `write(i, v)` sets one.
 */
export function clKeyBars(svg, barsG, { read, write, min, max, step, label }) {
  let at = 0;
  let keyed = false; // a click focuses the chart too; the outlines are the keyboard's
  for (const [k, v] of Object.entries({ tabindex: 0, role: 'slider', 'aria-label': label, 'aria-valuemin': min, 'aria-valuemax': max, 'aria-keyshortcuts': 'ArrowLeft ArrowRight ArrowUp ArrowDown Home End' })) svg.setAttribute(k, String(v));
  const show = () => {
    const on = document.activeElement === svg && (keyed || svg.matches(':focus-visible'));
    svg.style.boxShadow = on ? 'var(--px-ring-accent)' : '';
    Array.from(barsG.children).forEach((r, i) => {
      if (on && i === at) { r.setAttribute('stroke', 'var(--px-text)'); r.setAttribute('stroke-width', '2'); }
      else { r.removeAttribute('stroke'); r.removeAttribute('stroke-width'); }
    });
    const bar = read()[at];
    if (bar) { svg.setAttribute('aria-valuenow', String(bar.value)); svg.setAttribute('aria-valuetext', `${bar.label}: ${bar.text}`); }
  };
  svg.addEventListener('focus', show);
  svg.addEventListener('blur', show);
  svg.addEventListener('pointerdown', () => { keyed = false; show(); });
  svg.addEventListener('keydown', (e) => {
    const bars = read();
    if (!bars.length || e.ctrlKey || e.altKey || e.metaKey) return;
    at = Math.min(at, bars.length - 1);
    const was = bars[at].value;
    let v = was;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') at = Math.max(0, Math.min(bars.length - 1, at + (e.key === 'ArrowLeft' ? -1 : 1)));
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') v += (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 5 : 1);
    else if (e.key === 'Home') v = min;
    else if (e.key === 'End') v = max;
    else return;
    e.preventDefault();
    e.stopPropagation();
    keyed = true;
    if (v !== was) write(at, Number(Math.max(min, Math.min(max, Math.round(v / step) * step)).toFixed(6)));
    show();
  });
}
