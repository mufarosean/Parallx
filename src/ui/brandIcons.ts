// brandIcons.ts — Parallx-original icons for the product's core nouns.
//
// Stock Lucide reads as "every AI-built app" on the surfaces that carry
// identity: the activity-bar rail and the primary product nouns. These marks
// are hand-drawn on the LOGO's motif — the skewed parallelogram plate (the
// same skewX(-8) lean as the brand mark) — with Lucide-compatible geometry
// (24×24 viewBox, stroke 2, round caps/joins, currentColor) so they sit next
// to Lucide glyphs without visual seams.
//
// Rules:
//   - Brand icons are for PRODUCT nouns (canvas, planner, dashboard, chat,
//     automations, extensions' primary surfaces). Universal verbs and objects
//     (search, folder, settings, trash…) stay Lucide — genericness is correct
//     there.
//   - The plate outline is `M7 4 L20 4 L17 20 L4 20 Z` (3px lean over 16px —
//     the logo's angle). Inner marks stay inside the plate's leaned bounds.
//   - Register via iconRegistry; ids are namespaced `px-*`.

const SVG_OPEN =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';

function brand(inner: string): string {
  return `${SVG_OPEN}${inner}</svg>`;
}

/** The leaning plate every brand icon is built on. */
const PLATE = '<path d="M7 4 L20 4 L17 20 L4 20 Z"/>';

export const BRAND_ICONS: Record<string, string> = {
  /** The logo mark — two overlapping plates. */
  'px-mark': brand(
    '<path d="M9.5 4.3 L21 4.3 L18.9 15.5 L7.4 15.5 Z"/>'
    + '<path d="M5.1 8.5 L16.6 8.5 L14.5 19.7 L3 19.7 Z"/>',
  ),

  /** Canvas — the plate as a page with text lines. */
  'px-canvas': brand(
    PLATE
    + '<path d="M8.4 8.5 L17 8.5"/>'
    + '<path d="M7.6 12.5 L16.2 12.5"/>'
    + '<path d="M6.9 16.5 L12 16.5"/>',
  ),

  /** Planner — binding ticks piercing the plate, a row, a done-check. */
  'px-planner': brand(
    PLATE
    + '<path d="M11 2 L10.2 6.3"/>'
    + '<path d="M16.6 2 L15.8 6.3"/>'
    + '<path d="M7.9 11 L16.5 11"/>'
    + '<path d="M8.3 15.8 L10 17.5 L13.6 13.9"/>',
  ),

  /** Dashboard — the plate split into leaning tiles. */
  'px-dashboard': brand(
    PLATE
    + '<path d="M5.5 12 L18.5 12"/>'
    + '<path d="M13.5 4 L10.5 20"/>',
  ),

  /** Chat — the plate as a speech card with a tail. */
  'px-chat': brand(
    '<path d="M7 4 L20 4 L17.8 15.7 L10.5 15.7 L5.6 20 L6.6 15.7 L4.8 15.7 Z"/>',
  ),

  /** Tool gallery — the plate with a puzzle notch in its top edge. */
  'px-tools': brand(
    '<path d="M7 4 L11.4 4 A2.1 2.1 0 0 0 15.6 4 L20 4 L17 20 L4 20 Z"/>',
  ),

  /** AI hub — the plate carrying a four-point spark. */
  'px-ai': brand(
    PLATE
    + '<path d="M12.6 7.4 L13.7 10.8 L17.1 11.9 L13.7 13 L12.6 16.4 L11.5 13 L8.1 11.9 L11.5 10.8 Z"/>',
  ),

  /** Automations — the plate carrying a bolt. */
  'px-automations': brand(
    PLATE
    + '<path d="M14 6.6 L9.6 13 L12.4 13 L11 17.4 L15.4 11 L12.6 11 Z"/>',
  ),

  /** Flashcards — two plates (a card behind a card) + a prompt line. */
  'px-flashcards': brand(
    '<path d="M9.4 3.8 L21.4 3.8 L19.3 15 L7.3 15 Z"/>'
    + '<path d="M10.6 8 L18.6 8"/>'
    + '<path d="M5.6 10.2 L17.6 10.2 L15.5 21.4 L3.5 21.4 Z"/>',
  ),

  /** Media library — sun + ridge line inside the plate. */
  'px-media': brand(
    PLATE
    + '<circle cx="15" cy="8.7" r="1.6"/>'
    + '<path d="M6.1 17 L9.8 12.2 L12.4 15 L14.5 12.6 L17.2 17"/>',
  ),

  /** Workspace graph — linked nodes inside the plate. */
  'px-graph': brand(
    PLATE
    + '<circle cx="9.7" cy="9.2" r="1.5"/>'
    + '<circle cx="15.6" cy="11" r="1.5"/>'
    + '<circle cx="10.6" cy="15.6" r="1.5"/>'
    + '<path d="M11.1 9.7 L14.2 10.6"/>'
    + '<path d="M14.6 12.2 L11.7 14.6"/>',
  ),

  /** Text generator — an italic capital on the plate. */
  'px-writer': brand(
    PLATE
    + '<path d="M13.9 7.5 L10.6 16.5"/>'
    + '<path d="M12.3 7.5 L15.5 7.5"/>'
    + '<path d="M9 16.5 L12.2 16.5"/>',
  ),

  /** Budget — a coin over the ledger line. */
  'px-budget': brand(
    PLATE
    + '<circle cx="12.3" cy="11.2" r="3.3"/>'
    + '<path d="M6.8 17 L13.4 17"/>',
  ),

  /** Web research — a globe crossed by its orbit. */
  'px-web': brand(
    PLATE
    + '<circle cx="12.5" cy="11.5" r="3.5"/>'
    + '<path d="M7.2 15.1 L17.8 7.9"/>',
  ),
};
