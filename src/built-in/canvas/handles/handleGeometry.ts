// handleGeometry.ts — THE single vertical-band geometry for handle targeting
//
// "Which row/block is the cursor vertically over?" used to be answered by
// four separate inline loops (list-gutter reanchor, container reanchor,
// DOM-element gutter branch, sticky-refresh descendant scan) — each with its
// own containment rules, and one with the full-rect bug that anchored the
// handle to a PARENT row whenever the cursor hovered its nested children
// (a parent <li>'s rect spans every descendant row).
//
// This module owns that answer:
//   • a block's OWN LINE is its first content element's band — never the
//     full node box, which for rows/containers covers all nested content;
//   • descending picks the child whose band contains the cursor Y
//     (or is nearest by edge), recursively through nested lists.
//
// Pure geometry — callers map the returned ELEMENT back to a document
// position through the canonical blockUnit resolver.  Gate: handles/ —
// imports only from handleRegistry.

import { listItemContentElement } from './handleRegistry.js';

export interface Band {
  readonly top: number;
  readonly bottom: number;
}

/**
 * Pick the band containing `y` (containment wins outright), else the band
 * nearest by vertical edge distance.  Returns the index, or null when empty.
 */
export function pickBandIndex(bands: readonly Band[], y: number): number | null {
  let bestIdx: number | null = null;
  let bestDist = Infinity;
  for (let i = 0; i < bands.length; i++) {
    const b = bands[i];
    if (b.bottom <= b.top) continue; // zero/negative-height — unmeasurable
    if (y >= b.top && y <= b.bottom) return i;
    const dist = y < b.top ? b.top - y : y - b.bottom;
    if (dist < bestDist) { bestDist = dist; bestIdx = i; }
  }
  return bestIdx;
}

/**
 * The vertical band of a block element's OWN line.
 *
 * For list rows that is the row's content element (skipping a task item's
 * checkbox label) — NOT the <li> box, which spans every nested descendant.
 * For other elements, the first element child when present, else the first
 * line-height strip of the element itself.
 */
export function ownLineBand(el: HTMLElement): Band {
  const lineEl = el.tagName === 'LI'
    ? listItemContentElement(el)
    : (el.firstElementChild as HTMLElement | null) ?? el;

  const measured = lineEl === el ? el : lineEl;
  const r = measured.getBoundingClientRect();
  if (r.height > 0 && measured !== el) {
    return { top: r.top, bottom: r.bottom };
  }

  const full = el.getBoundingClientRect();
  const lineH = parseFloat(window.getComputedStyle(el).lineHeight) || full.height;
  return { top: full.top, bottom: Math.min(full.top + lineH, full.bottom) };
}

/** Direct <li> children of a list element, in document order. */
export function directListItems(listEl: HTMLElement): HTMLElement[] {
  return Array.from(listEl.children).filter(
    (c): c is HTMLElement => c instanceof HTMLElement && c.tagName === 'LI',
  );
}

/**
 * The direct <li> child of `listEl` whose vertical range holds `y` (or is
 * nearest).  Null when the list has no rows.
 */
export function pickListItemAtY(listEl: HTMLElement, y: number): HTMLElement | null {
  const items = directListItems(listEl);
  const idx = pickBandIndex(items.map((li) => {
    const r = li.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom };
  }), y);
  return idx === null ? null : items[idx];
}

/**
 * Starting from a list row, descend to the row whose OWN LINE the cursor Y
 * is actually over: if `y` is below `start`'s own line, walk into its nested
 * sub-lists, picking the row band containing `y` at each level.  This is the
 * fix for the "handle anchors to the parent row while hovering a nested row"
 * class — full-rect containment can never be the stop condition because a
 * parent row's rect covers its whole subtree.
 */
export function descendToRowAtY(start: HTMLElement, y: number): HTMLElement {
  let current = start;
  for (let guard = 0; guard < 32; guard++) {
    const line = ownLineBand(current);
    if (y >= line.top && y <= line.bottom) return current;

    // Below (or above) this row's own line — look for a nested row.
    const nestedLists = Array.from(current.children).filter(
      (c): c is HTMLElement =>
        c instanceof HTMLElement && (c.tagName === 'UL' || c.tagName === 'OL'),
    );
    const rows = nestedLists.flatMap((l) => directListItems(l));
    if (rows.length === 0) return current;

    const idx = pickBandIndex(rows.map((li) => {
      const r = li.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom };
    }), y);
    if (idx === null) return current;

    const next = rows[idx];
    if (next === current) return current;
    current = next;
  }
  return current;
}
