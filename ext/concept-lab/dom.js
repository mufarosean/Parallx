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
