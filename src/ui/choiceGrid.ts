// choiceGrid.ts — one choice from a grid of pictures or colour swatches (a
// portrait per character, a swatch per hair colour). The kit's choice grid:
// a radio group, arrow keys move between tiles (rows and columns), one tile is
// in the tab order, each tile is named for a screen reader and shows focus.
// Re-exported by kit.ts as createChoiceGrid.

import { declareControl } from './kit.js';
import './choiceGrid.css';

export interface IKitChoiceGridItem {
  readonly value: string;
  readonly label: string;
  /** A picture for the tile (a data URL or an object URL). */
  readonly image?: string;
  /** A colour for the tile, as red, green and blue from 0 to 1 (data, not styling). */
  readonly rgb?: readonly [number, number, number];
}

export interface IKitChoiceGridOptions {
  readonly id: string;
  readonly label: string;
  readonly items: readonly IKitChoiceGridItem[];
  readonly value?: string;
  /** 'picture' tiles (default) show the picture and the label under it; 'swatch' tiles are small colour squares. */
  readonly variant?: 'picture' | 'swatch';
  readonly onChange?: (value: string) => void;
}

export interface IKitChoiceGrid {
  readonly element: HTMLElement;
  value: string;
  /** Put a picture on a tile later (one rendered after the grid was made). */
  setImage(value: string, image: string): void;
  dispose(): void;
}

export function createChoiceGrid(container: HTMLElement | null | undefined, options: IKitChoiceGridOptions): IKitChoiceGrid {
  const variant = options.variant ?? 'picture';
  const root = document.createElement('div');
  root.className = `ui-choice-grid ui-choice-grid--${variant}`;
  let value = options.value ?? options.items[0]?.value ?? '';
  const tiles: HTMLButtonElement[] = [];

  for (const item of options.items) {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'ui-choice-grid__tile';
    tile.setAttribute('role', 'radio');
    tile.dataset.value = item.value;
    tile.title = item.label;
    tile.setAttribute('aria-label', item.label);
    const face = document.createElement('span');
    face.className = 'ui-choice-grid__face';
    if (item.rgb) face.style.backgroundColor = `rgb(${item.rgb.map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255)).join(', ')})`;
    if (item.image) { const img = document.createElement('img'); img.alt = ''; img.src = item.image; face.appendChild(img); }
    // A swatch with no colour of its own ("as it was", "none") shows a diagonal line
    if (!item.rgb && !item.image && variant === 'swatch') face.classList.add('ui-choice-grid__face--none');
    tile.appendChild(face);
    if (variant === 'picture') {
      const name = document.createElement('span');
      name.className = 'ui-choice-grid__label';
      name.textContent = item.label;
      tile.appendChild(name);
    }
    tile.addEventListener('click', () => choose(item.value, true));
    tiles.push(tile);
    root.appendChild(tile);
  }

  function sync(): void {
    const current = tiles.find((t) => t.dataset.value === value) ?? tiles[0];
    for (const t of tiles) {
      const on = t === current && t.dataset.value === value;
      t.setAttribute('aria-checked', String(on));
      t.classList.toggle('ui-choice-grid__tile--selected', on);
      t.tabIndex = t === current ? 0 : -1;
    }
  }

  function choose(v: string, fire: boolean): void {
    if (v === value) return;
    value = v;
    sync();
    if (fire) options.onChange?.(v);
  }

  /** How many tiles sit in one row now (for Up and Down). */
  function columns(): number {
    if (tiles.length < 2) return 1;
    const top = tiles[0].offsetTop;
    const n = tiles.findIndex((t) => t.offsetTop !== top);
    return n > 0 ? n : tiles.length;
  }

  root.addEventListener('keydown', (e) => {
    const i = tiles.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns(), ArrowUp: -columns() }[e.key];
    let next = -1;
    if (step !== undefined) next = Math.min(tiles.length - 1, Math.max(0, i + step));
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tiles.length - 1;
    if (next < 0) return;
    e.preventDefault();
    tiles[next].focus();
    choose(tiles[next].dataset.value ?? '', true);
  });

  sync();
  if (container) container.appendChild(root);
  const reg = declareControl(root, { id: options.id, label: options.label, kind: 'segmented', state: () => ({ kind: 'value', value }) });
  root.setAttribute('aria-label', options.label);

  return {
    element: root,
    get value() { return value; },
    set value(v: string) { choose(v, false); },
    setImage(v: string, image: string) {
      const tile = tiles.find((t) => t.dataset.value === v);
      const face = tile?.querySelector('.ui-choice-grid__face');
      if (!face) return;
      let img = face.querySelector('img');
      if (!img) { img = document.createElement('img'); img.alt = ''; face.appendChild(img); }
      img.src = image;
    },
    dispose() { reg.dispose(); root.remove(); },
  };
}
