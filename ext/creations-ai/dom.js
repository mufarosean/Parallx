// dom.js — Creations' element helper, and its controls in the scene
// (docs/SELF_DESCRIBING_UI_DESIGN.md step 7). el builds an element from a
// tag, a class and attributes ({ text, html, ...attributes }); a `sceneId`
// attribute (with an optional `sceneLabel`) also declares it, once the
// caller's own setup has run, so the label is the finished one. tgDeclare
// names a control in place (DOM and listeners unchanged), tgSurface marks a
// repeated card. All read api.ui, set once at activate; before that they do
// nothing.

let ui = null;

export function setSceneUi(next) { ui = next || null; }

export function el(tag, className, attrs) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'text') e.textContent = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k !== 'sceneId' && k !== 'sceneLabel') e.setAttribute(k, v);
    }
    if (attrs.sceneId) queueMicrotask(() => tgDeclare(e, attrs.sceneId, attrs.sceneLabel ? { label: attrs.sceneLabel } : {}));
  }
  return e;
}

/** A dynamic id segment (a label, a key): the kit's slug. */
export function tgSlug(value) {
  return ui?.sceneSlug ? ui.sceneSlug(String(value ?? '')) : '';
}

/**
 * Declares a control the extension drew. The label is the accessible name,
 * else the visible text, else the placeholder or tooltip. A checkbox is a
 * toggle, a range a slider, a field an input with its value, anything else
 * a button.
 */
export function tgDeclare(node, id, extra = {}) {
  if (!ui?.declareControl) return node;
  const type = node.tagName === 'INPUT' ? node.type : '';
  const check = type === 'checkbox';
  const range = type === 'range';
  const typed = !check && !range && (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA');
  const label = extra.label || node.getAttribute('aria-label') || node.textContent.trim() || node.placeholder || node.title || '';
  const hint = node.title && node.title !== label ? node.title : undefined;
  const state = check ? () => ({ kind: 'pressed', value: node.checked })
    : range ? () => ({ kind: 'number', value: Number(node.value) })
      : typed ? () => ({ kind: 'value', value: node.value })
        : () => ({ kind: 'enabled', value: !node.disabled });
  ui.declareControl(node, { id, label, kind: check ? 'toggle' : range ? 'slider' : typed ? 'input' : 'button', ...(hint ? { hint } : {}), state });
  return node;
}

/** A form field: declared only when it is an input, a textarea or a select. */
export function tgDeclareField(node, id, label) {
  if (node && (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA')) tgDeclare(node, id, { label });
  return node;
}

/** A repeated card or row; `instance` tells the copies apart. */
export function tgSurface(node, id, label, instance) {
  if (ui?.createSurface) ui.createSurface(node, { id, owner: 'creations-ai', label: String(label ?? ''), ...(instance != null ? { instance: String(instance) } : {}) });
  return node;
}
