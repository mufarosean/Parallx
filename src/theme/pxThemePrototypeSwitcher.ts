// pxThemePrototypeSwitcher.ts — M83 prototype-phase theme picker.
//
// A small, self-contained control so the look can be chosen WITHOUT
// devtools. Applies the saved palette on boot and renders a compact
// switcher in the corner. Entirely removable once a direction is locked:
// delete this file + its one import in main.ts.
//
// Themes map to the [data-px-theme] blocks in px-tokens.css. The default
// (no attribute) is "warm".

const STORAGE_KEY = 'px-theme';

type PxTheme = 'warm' | 'slate' | 'ember';

const THEMES: { id: PxTheme; label: string; swatch: string }[] = [
  { id: 'warm',  label: 'Warm',  swatch: 'hsl(226 58% 65%)' },
  { id: 'slate', label: 'Slate', swatch: 'hsl(205 64% 60%)' },
  { id: 'ember', label: 'Ember', swatch: 'hsl(32 78% 58%)' },
];

function applyTheme(id: PxTheme): void {
  // Set on the documentElement (:root), NOT body. Semantic tokens
  // (--px-bg: var(--px-base-00)) are declared on :root and inherit their
  // already-resolved value; overriding the primitives on a child (body)
  // would not re-derive them. Co-locating the override with the derivation
  // on :root is what makes the swap actually take effect.
  const root = document.documentElement;
  if (id === 'warm') {
    root.removeAttribute('data-px-theme');
  } else {
    root.setAttribute('data-px-theme', id);
  }
}

function getSaved(): PxTheme {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === 'slate' || v === 'ember' || v === 'warm') return v;
  } catch { /* ignore */ }
  return 'warm';
}

/** Apply the saved theme immediately (call as early as possible at boot). */
export function applySavedPxTheme(): void {
  applyTheme(getSaved());
}

/** Mount the corner switcher. Idempotent. */
export function mountPxThemeSwitcher(): void {
  if (document.getElementById('px-theme-switcher')) return;

  const current = getSaved();

  const host = document.createElement('div');
  host.id = 'px-theme-switcher';

  const label = document.createElement('span');
  label.className = 'px-theme-switcher__label';
  label.textContent = 'Theme';
  host.appendChild(label);

  const group = document.createElement('div');
  group.className = 'px-theme-switcher__group';

  for (const t of THEMES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'px-theme-switcher__btn';
    btn.dataset.theme = t.id;
    if (t.id === current) btn.classList.add('px-theme-switcher__btn--active');

    const dot = document.createElement('span');
    dot.className = 'px-theme-switcher__dot';
    dot.style.background = t.swatch;
    btn.appendChild(dot);

    const text = document.createElement('span');
    text.textContent = t.label;
    btn.appendChild(text);

    btn.addEventListener('click', () => {
      applyTheme(t.id);
      try { window.localStorage.setItem(STORAGE_KEY, t.id); } catch { /* ignore */ }
      for (const sib of Array.from(group.children)) {
        if (sib instanceof HTMLElement) {
          sib.classList.toggle('px-theme-switcher__btn--active', sib.dataset.theme === t.id);
        }
      }
    });
    group.appendChild(btn);
  }

  host.appendChild(group);
  document.body.appendChild(host);
}
