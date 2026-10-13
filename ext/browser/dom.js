// dom.js — the Browser's element helper, and its controls in the scene
// (docs/SELF_DESCRIBING_UI_DESIGN.md step 7). el builds an element from a
// tag, a class and attributes ({ text, html, ...attributes }; a null value
// is skipped). A `sceneId` attribute (with an optional `sceneLabel`, and
// `sceneCommand` for a control that does what a command does) also declares
// it, once the caller's own setup has run, so the label is the finished
// one. brDeclare names a control in place (DOM and listeners unchanged). It
// reads api.ui, set once at activate; before that it does nothing.

let ui = null;

export function setSceneUi(next) { ui = next || null; }

const SCENE_KEYS = new Set(['sceneId', 'sceneLabel', 'sceneCommand']);

export function el(tag, className, attrs) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'text') e.textContent = v;
      else if (k === 'html') e.innerHTML = v;
      else if (v != null && !SCENE_KEYS.has(k)) e.setAttribute(k, v);
    }
    if (attrs.sceneId) queueMicrotask(() => brDeclare(e, attrs.sceneId, { label: attrs.sceneLabel, command: attrs.sceneCommand }));
  }
  return e;
}

/** A dynamic id segment (a label, a key): the kit's slug. */
export function brSlug(value) {
  return ui?.sceneSlug ? ui.sceneSlug(String(value ?? '')) : '';
}

/**
 * Declares a control the Browser drew. The label is the accessible name,
 * else the visible text, else the placeholder or tooltip. A switch or a
 * checkbox is a toggle, a field an input with its value, anything else a
 * button.
 */
export function brDeclare(node, id, extra = {}) {
  if (!ui?.declareControl) return node;
  const check = node.tagName === 'INPUT' && node.type === 'checkbox';
  const sw = node.getAttribute('role') === 'switch';
  const typed = !check && (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA');
  const label = extra.label || node.getAttribute('aria-label') || node.textContent.trim() || node.placeholder || node.title || '';
  const hint = node.title && node.title !== label ? node.title : undefined;
  const state = check ? () => ({ kind: 'pressed', value: node.checked })
    : sw ? () => ({ kind: 'pressed', value: node.getAttribute('aria-checked') === 'true' })
      : typed ? () => ({ kind: 'value', value: node.value })
        : () => ({ kind: 'enabled', value: !node.disabled });
  ui.declareControl(node, {
    id,
    label,
    kind: check || sw ? 'toggle' : typed ? 'input' : 'button',
    ...(hint ? { hint } : {}),
    ...(extra.command ? { command: extra.command } : {}),
    state,
  });
  return node;
}
