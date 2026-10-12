// Worksheets: the small controls panes build. Icon buttons, the star and
// mark buttons, the sheet theme button, and `el`.

import { createIconButton } from '../../ui/kit.js';
import { setItemStarred } from './worksheetData.js';
import { markListeners, persistPractice, resolveSheetDark, setSheetAppearance, state, type RunningPractice } from './state.js';

/** The scratch-bar / item-header toggle: flips the sheet light↔dark (a
 *  pinned choice — 'app' is reachable in Settings). */
/** An icon button for the sheet bars: the icon is the label and the word is
 *  the tooltip's first line (no more rows of word
 *  buttons; same pattern as the flashcards study toolbar). Falls back to the
 *  word when the registry lacks the icon. */
export function iconBtn(iconId: string, label: string, opts: { id?: string; hint?: string; primary?: boolean; danger?: boolean; onClick?: () => void } = {}): HTMLButtonElement {
  // The kit's icon button; an accent glyph for the primary one, red on hover for a danger one.
  // `id` declares it in the scene: given for the one button of its kind on a pane, never for one in a row.
  const b = createIconButton(null, { id: opts.id, icon: iconId, title: label, hint: opts.hint });
  if (opts.primary) b.classList.add('ws-icon--accent');
  if (opts.danger) b.classList.add('ws-icon--danger');
  paintIconBtn(b, iconId, label, opts.hint);
  if (opts.onClick) b.addEventListener('click', opts.onClick);
  return b;
}
export function paintIconBtn(b: HTMLButtonElement, iconId: string, label: string, hint?: string): void {
  let svg = '';
  try { svg = state.api?.icons?.createIconHtml?.(iconId, 16) ?? ''; } catch { svg = ''; }
  if (svg) b.innerHTML = svg; else b.textContent = label;
  // The app's tooltip collapses line breaks, so the word and the hint read as two sentences.
  b.title = hint ? `${label}. ${hint}` : label;
  b.setAttribute('aria-label', label);
}
/** The star: the student's bookmark on a problem, one look everywhere it
 *  appears (sheet header, bank row, quiz overview). Stored on the problem,
 *  so it outlives the quiz it was set in. */
export const STAR_HINT = 'Kept on the problem across quizzes. Quiz Starred on Home, the Dashboard or the quiz builder runs every starred problem.';
function paintStarBtn(b: HTMLButtonElement, on: boolean): void {
  paintIconBtn(b, 'star', on ? 'Unstar Problem' : 'Star Problem', on ? 'Takes the star off this problem.' : STAR_HINT);
  b.classList.toggle('ws-star--on', on);
  b.setAttribute('aria-pressed', on ? 'true' : 'false');
}
export function starBtn(itemId: number, starred: boolean, onChange?: (on: boolean) => void, opts: { id?: string } = {}): HTMLButtonElement {
  const b = iconBtn('star', 'Star Problem', { id: opts.id });
  b.classList.add('ws-star');
  let on = starred;
  paintStarBtn(b, on);
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    on = !on;
    paintStarBtn(b, on);
    onChange?.(on);
    void setItemStarred(itemId, on).catch(() => { on = !on; paintStarBtn(b, on); onChange?.(on); });
  });
  return b;
}
/** Mark For Later: the flag on a problem inside ONE quiz, an exam's mark for
 *  review (no easy way to come back to a problem later in
 *  the quiz). Same pressed look as the star, a flag instead of a star, so the
 *  two never read as one thing; stored on the quiz, so it goes with it. */
const MARK_HINT = 'Flags this problem to come back to in this quiz. Marked problems show in Quiz Overview, and Next Marked jumps between them.';
function paintMarkBtn(b: HTMLButtonElement, on: boolean): void {
  paintIconBtn(b, 'flag', on ? 'Unmark Problem' : 'Mark for Later', on ? 'Takes the mark off this problem.' : MARK_HINT);
  b.classList.toggle('ws-mark--on', on);
  b.setAttribute('aria-pressed', on ? 'true' : 'false');
}
export function markBtn(session: RunningPractice, itemId: number, onChange?: (on: boolean) => void, opts: { id?: string } = {}): HTMLButtonElement {
  const b = iconBtn('flag', 'Mark for Later', { id: opts.id });
  b.classList.add('ws-mark');
  paintMarkBtn(b, session.marked.has(itemId));
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    const on = !session.marked.has(itemId);
    if (on) session.marked.add(itemId); else session.marked.delete(itemId);
    paintMarkBtn(b, on);
    void persistPractice();
    onChange?.(on);
    for (const fn of markListeners) { try { fn(); } catch { /* pane torn down */ } }
  });
  return b;
}
/** Sun when the sheet is dark (click for light), moon when light. */
export function paintSheetThemeButton(btn: HTMLButtonElement): void {
  const dark = resolveSheetDark();
  paintIconBtn(btn, dark ? 'sun' : 'moon', dark ? 'Light Sheet' : 'Dark Sheet', 'Flips this practice sheet only. Light matches the real exam surface; Settings has a follow-the-app option.');
}
export function makeSheetThemeButton(): HTMLButtonElement {
  const btn = iconBtn('moon', 'Dark Sheet', { id: 'worksheet.sheetTheme', onClick: () => { void setSheetAppearance(resolveSheetDark() ? 'light' : 'dark'); } });
  paintSheetThemeButton(btn);
  return btn;
}

export const WS_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/></svg>';

export function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
