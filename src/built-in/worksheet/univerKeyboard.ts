// univerKeyboard.ts — the spreadsheet engine's own editors, for a keyboard
// and a screen reader.
//
// Univer's cell editor and formula bar are unnamed divs, and it mounts the
// formula bar's straight on <body>, outside the sheet's region. In them Tab
// and Enter belong to the sheet (as in Excel), so each says what it is and
// that F6 leaves (WCAG 2.1.2), the way the sheet's region does. Installed
// the first time a sheet mounts; nothing runs while worksheets are off.

const EDITOR_PREFIX = 'univer-doc-selection-container-';
const NAMES: Record<string, string> = {
  __INTERNAL_EDITOR__DOCS_NORMAL: 'Cell editor',
  __INTERNAL_EDITOR__DOCS_FORMULA_BAR: 'Formula bar',
};

let installed = false;

/**
 * Keys the sheet's own access code must see before the engine does: the
 * engine listens on the window and stops Tab in its formula bar. This one
 * listener is added before any engine starts (the first sheet's mount), so
 * it runs first; univerA11y.ts adds its handler here.
 */
export const sheetKeyHooks = new Set<(e: KeyboardEvent) => void>();

export function ensureUniverEditorExits(): void {
  if (installed) return;
  installed = true;
  window.addEventListener('keydown', (e) => { for (const h of sheetKeyHooks) { if (e.cancelBubble) break; h(e); } }, true);
  document.addEventListener('focusin', (e) => {
    const box = (e.target as Element | null)?.closest?.(`[id^="${EDITOR_PREFIX}"]`);
    if (!box || box.hasAttribute('aria-keyshortcuts')) return;
    const name = NAMES[box.id.slice(EDITOR_PREFIX.length)] ?? 'Sheet editor';
    box.setAttribute('aria-keyshortcuts', 'F6');
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', `${name}. F6 moves to the next area.`);
  }, true);
}

// The sheet for a screen reader (a voice for the canvas grid, names for the engine's controls).
export { installSheetAccess } from './univerA11y.js';
