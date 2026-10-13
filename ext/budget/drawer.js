// drawer.js — what the Budget's three drawers (transaction, asset or debt,
// goal) share: the labelled field. Each field's control is also put in the
// scene (docs/SELF_DESCRIBING_UI_DESIGN.md step 7) as `<scope>.<label slug>`,
// under the drawer's own surface: an input or textarea as an input, a
// makeDropdown wrapper as a select, both with their value as state.

export function drawerField(api, scope, labelText, control, hint) {
  const f = document.createElement('label'); f.className = 'budget-field';
  const l = document.createElement('span'); l.className = 'budget-field-label'; l.textContent = labelText;
  f.appendChild(l); f.appendChild(control);
  if (hint) { const h = document.createElement('span'); h.className = 'budget-field-hint'; h.textContent = hint; f.appendChild(h); }
  const typed = control.tagName === 'INPUT' || control.tagName === 'TEXTAREA';
  api.ui.declareControl(control, {
    id: `${scope}.${api.ui.sceneSlug(labelText)}`,
    label: labelText,
    kind: typed ? 'input' : 'select',
    ...(hint ? { hint } : {}),
    state: () => ({ kind: 'value', value: String(control.value ?? '') }),
  });
  return f;
}
