// pressable.ts — a gallery row that opens on click also opens from the keyboard.

/** Tab reaches it, Enter or Space presses it. `expanded` is given for a group header. */
export function pressable(el: HTMLElement, expanded?: boolean): void {
  el.tabIndex = 0;
  el.setAttribute('role', 'button');
  if (expanded !== undefined) el.setAttribute('aria-expanded', String(expanded));
  el.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target === el) { e.preventDefault(); el.click(); }
  });
}
