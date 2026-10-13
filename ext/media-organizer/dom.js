// dom.js — Media Organizer's element helper, and its controls in the scene
// (docs/SELF_DESCRIBING_UI_DESIGN.md step 7). moEl builds an element from a
// tag, a class and attributes; a `sceneId` attribute (with an optional
// `sceneLabel`) also declares it, once the caller's own setup has run, so
// the label is the finished one. moDeclare names a control in place (DOM and
// listeners unchanged), moSurface marks a repeated card, moList declares a
// list the extension renders as one entry. All read api.ui, set once at
// activate; before that they do nothing.

let ui = null;

export function setSceneUi(next) { ui = next || null; }

export function moEl(tag, className, attrs) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'textContent') e.textContent = v;
      else if (k === 'innerHTML') e.innerHTML = v;
      else if (k === 'onclick') e.addEventListener('click', v);
      else if (k === 'onchange') e.addEventListener('change', v);
      else if (k === 'oninput') e.addEventListener('input', v);
      else if (k !== 'sceneId' && k !== 'sceneLabel') e.setAttribute(k, v);
    }
    if (attrs.sceneId) queueMicrotask(() => moDeclare(e, attrs.sceneId, attrs.sceneLabel ? { label: attrs.sceneLabel } : {}));
  }
  return e;
}

/** A dynamic id segment (a label, a key): the kit's slug. */
export function moSlug(value) {
  return ui?.sceneSlug ? ui.sceneSlug(String(value ?? '')) : '';
}

/**
 * Declares a control the extension drew. The label is the accessible name,
 * else the visible text, else the placeholder or tooltip. A checkbox or a
 * button with aria-pressed is a toggle, a range a slider, a field an input
 * with its value, anything else a button.
 */
export function moDeclare(node, id, extra = {}) {
  if (!ui?.declareControl) return node;
  const type = node.tagName === 'INPUT' ? node.type : '';
  const check = type === 'checkbox' || type === 'radio';
  const range = type === 'range';
  const typed = !check && !range && (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA');
  const pressed = !check && !typed && !range && node.hasAttribute('aria-pressed');
  const label = extra.label || node.getAttribute('aria-label') || node.textContent.trim() || node.placeholder || node.title || '';
  const hint = node.title && node.title !== label ? node.title : undefined;
  const state = check ? () => ({ kind: 'pressed', value: node.checked })
    : range ? () => ({ kind: 'number', value: Number(node.value) })
      : typed ? () => ({ kind: 'value', value: node.value })
        : pressed ? () => ({ kind: 'pressed', value: node.getAttribute('aria-pressed') === 'true' })
          : () => ({ kind: 'enabled', value: !node.disabled });
  ui.declareControl(node, {
    id,
    label,
    kind: extra.kind || (check || pressed ? 'toggle' : range ? 'slider' : typed ? 'input' : 'button'),
    ...(hint ? { hint } : {}),
    state,
  });
  return node;
}

/** A repeated card or row; `instance` tells the copies apart. */
export function moSurface(node, id, label, instance) {
  if (ui?.createSurface) ui.createSurface(node, { id, owner: 'media-organizer', label: String(label ?? ''), ...(instance != null ? { instance: String(instance) } : {}) });
  return node;
}

/** A list the extension renders, one entry; `selected` returns the chosen keys. */
export function moList(node, id, label, selected) {
  if (ui?.createList) ui.createList(node, { id, label, rows: () => [...node.children], selected });
  return node;
}
