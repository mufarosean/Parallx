// boardCardKeys.ts — a database board card from the keyboard: a button that
// Enter opens, Shift+F10 (or the menu key) gives its row menu, and
// Ctrl+Shift+Left/Right move a column over, as dropping it there does.
// docs/ACCESSIBILITY.md, section 6.

export interface IBoardCardKeys {
  open(): void;
  /** The row menu, anchored at a point in the window. */
  menu(x: number, y: number): void;
  /** Move the card `step` columns (-1 left, +1 right). */
  move(step: -1 | 1): void;
}

export function wireBoardCardKeys(card: HTMLElement, keys: IBoardCardKeys): void {
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') keys.open();
    else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { const r = card.getBoundingClientRect(); keys.menu(r.left, r.bottom); }
    else if (e.ctrlKey && e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) keys.move(e.key === 'ArrowLeft' ? -1 : 1);
    else return;
    e.preventDefault();
  });
}
