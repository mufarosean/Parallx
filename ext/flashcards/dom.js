// dom.js — Flashcards' element helper, and its controls in the scene
// (docs/SELF_DESCRIBING_UI_DESIGN.md step 7). The extension draws its own
// buttons and fields; fcDeclare names one in place (DOM and listeners
// unchanged), fcSurface marks a repeated card or row so the controls in it
// keep fixed ids, and fcList declares a list it renders as one entry. All
// three read api.ui, set once at activate; before that they do nothing.

let ui = null;

export function setSceneUi(next) { ui = next || null; }

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A dynamic id segment (a tag, a label): the kit's slug. */
export function fcSlug(value) {
  return ui?.sceneSlug ? ui.sceneSlug(String(value ?? '')) : '';
}

/**
 * Declares a control the extension drew. The label is the accessible name,
 * else the visible text, else the placeholder or tooltip; a checkbox is a
 * toggle, a field an input with its value, anything else a button.
 */
export function fcDeclare(node, id, extra = {}) {
  if (!ui?.declareControl) return node;
  const check = node.tagName === 'INPUT' && node.type === 'checkbox';
  const typed = !check && (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA');
  const label = extra.label || node.getAttribute('aria-label') || node.textContent.trim() || node.placeholder || node.title || '';
  const hint = node.title && node.title !== label ? node.title : undefined;
  ui.declareControl(node, {
    id,
    label,
    kind: extra.kind || (check ? 'toggle' : typed ? 'input' : 'button'),
    ...(hint ? { hint } : {}),
    ...(extra.command ? { command: extra.command } : {}),
    state: extra.state || (check
      ? () => ({ kind: 'pressed', value: node.checked })
      : typed ? () => ({ kind: 'value', value: node.value }) : () => ({ kind: 'enabled', value: !node.disabled })),
  });
  return node;
}

/** A toggle whose on state is an ARIA attribute (aria-pressed, aria-checked, aria-selected). */
export function fcDeclareToggle(node, id, attr, label) {
  return fcDeclare(node, id, { kind: 'toggle', ...(label ? { label } : {}), state: () => ({ kind: 'pressed', value: node.getAttribute(attr) === 'true' }) });
}

/** A repeated card or row; `instance` tells the copies apart. */
export function fcSurface(node, id, label, instance) {
  if (ui?.createSurface) ui.createSurface(node, { id, owner: 'flashcards', label: String(label ?? ''), ...(instance != null ? { instance: String(instance) } : {}) });
  return node;
}

/** A list the extension renders, one entry; `selected` returns the chosen values. */
export function fcList(node, id, label, selected) {
  if (ui?.createList) ui.createList(node, { id, label, rows: () => [...node.children], selected });
  return node;
}
