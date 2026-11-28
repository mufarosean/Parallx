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

/**
 * A drawer is a popover over a place: when it closes the keys go back to what
 * opened it, else the same control drawn again (its kit id, or the same
 * transaction's row), else the page's title. Call when the drawer opens (the
 * opener has the keys then); run what it returns when the drawer closes.
 */
export function keysBack(opener = document.activeElement) {
  const by = ['data-px-id', 'data-tx-id'].find((a) => opener?.hasAttribute?.(a));
  const key = by ? opener.getAttribute(by) : null;
  // Its own page: with two Budget tabs side by side, the other's controls are not this one's.
  const page = opener?.closest?.('.budget-editor') || document.querySelector('.budget-editor');
  return () => requestAnimationFrame(() => {
    const now = document.activeElement;
    if (now && now !== document.body && now.isConnected) return; // something else took them meanwhile
    if (opener?.isConnected) { opener.focus(); return; }
    if (!page?.isConnected) return;
    const again = by ? page.querySelector(`[${by}="${CSS.escape(key)}"]`) : null;
    if (again) { again.focus(); return; }
    const title = page.querySelector('.px-page-header__title');
    if (title) { if (!title.hasAttribute('tabindex')) title.tabIndex = -1; title.focus({ preventScroll: true }); }
  });
}
