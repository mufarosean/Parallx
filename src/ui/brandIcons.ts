// brandIcons.ts — Parallx-original icons for the product's core nouns.
//
// Stock Lucide reads as "every AI-built app" on the surfaces that carry
// identity: the activity-bar rail and the primary product nouns. These marks
// are hand-drawn with Lucide-compatible geometry (24×24, stroke 2, round
// caps/joins, currentColor) so they sit next to Lucide glyphs without seams.
//
// LESSON (2026-07-22, Mufaro's rail screenshot): the first draft drew every
// icon on the logo's skewed-parallelogram plate. A full rail of glyphs all
// leaning the same way — beside upright Lucide icons — reads as a rendering
// bug, not a motif. A signature gesture must be SCARCE. So:
//
//   - Noun icons are UPRIGHT. Their identity comes from the compositions
//     (binding ticks piercing the planner, the card-behind-a-card, the
//     puzzle-notched plate), not from tilting the silhouette.
//   - The parallelogram lean lives ONLY in `px-mark` — the logo itself.
//
// Rules:
//   - Brand icons are for PRODUCT nouns (canvas, planner, dashboard, chat,
//     automations, extensions' primary surfaces). Universal verbs and objects
//     (search, folder, settings, trash…) stay Lucide — genericness is correct
//     there.
//   - Upright plate: `<rect x="4.5" y="4" width="15" height="16" rx="1.5"/>`.
//     One strong inner mark, no fills, nothing outside 2–22.

const SVG_OPEN =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';

function brand(inner: string): string {
  return `${SVG_OPEN}${inner}</svg>`;
}

/** The upright plate most brand icons are built on. */
const PLATE = '<rect x="4.5" y="4" width="15" height="16" rx="1.5"/>';

/**
 * THE logo: two leaning plates, filled, the back one ghosted. This is the
 * same geometry as the app icon and the title-bar mark (the 32-unit original
 * scaled into the 24-unit icon box), in `currentColor` so it takes whatever
 * ink its surface uses: the muted title bar, the accent on the welcome page,
 * the faint watermark, the AI button's pill. One drawing, one id, every
 * surface. It used to be pasted inline in five places in two colours.
 */
const LOGO_SVG =
  '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">'
  + '<rect x="4.5" y="6" width="12" height="12" rx="1.1" transform="skewX(-8)" opacity="0.4"/>'
  + '<rect x="7.5" y="4.5" width="12" height="12" rx="1.1" transform="skewX(-8)"/>'
  + '</svg>';

export const BRAND_ICONS: Record<string, string> = {
  /** The logo mark. */
  'px-mark': LOGO_SVG,

  /**
   * The AI mark IS the logo. Parallx does not wear the sparkle, the robot or
   * the speech bubble: the assistant is the app, so "AI acts here" is
   * signalled by the brand mark itself, everywhere, so a user learns once
   * that this shape means the AI is one click away. Kept as its own id so
   * call sites say what they mean; it resolves to the same drawing.
   */
  'px-ai-mark': LOGO_SVG,

  /** Canvas — the plate as a page; line rhythm, short last line. */
  'px-canvas': brand(
    PLATE
    + '<path d="M8 8.5 L16.5 8.5"/>'
    + '<path d="M8 12.5 L16.5 12.5"/>'
    + '<path d="M8 16.5 L12.5 16.5"/>',
  ),

  /** Planner — binding ticks piercing the plate + a done-check (no divider,
   *  which is what separates it from Lucide's calendar-check). */
  'px-planner': brand(
    PLATE
    + '<path d="M9.5 2.2 L9.5 6"/>'
    + '<path d="M14.5 2.2 L14.5 6"/>'
    + '<path d="M8.3 13.6 L10.4 15.7 L15.7 10.4"/>',
  ),

  /** Dashboard — staggered shelves, not the symmetric stock split. */
  'px-dashboard': brand(
    PLATE
    + '<path d="M13.5 4 L13.5 20"/>'
    + '<path d="M4.5 12.5 L13.5 12.5"/>'
    + '<path d="M13.5 10 L19.5 10"/>',
  ),

  /** Tool gallery — the plate with a puzzle notch in its top edge. */
  'px-tools': brand(
    '<path d="M4.5 4 L10 4 A2 2 0 0 0 14 4 L19.5 4 L19.5 20 L4.5 20 Z"/>',
  ),

  /** Automations — the plate carrying a bolt. */
  'px-automations': brand(
    PLATE
    + '<path d="M13.4 6.5 L9 13 L11.8 13 L10.4 17.5 L14.8 11 L12 11 Z"/>',
  ),

  /** Flashcards — a landscape card with a prompt line, another card behind. */
  'px-flashcards': brand(
    '<rect x="7.5" y="5" width="13" height="10" rx="1.5"/>'
    + '<path d="M10.5 9 L17.5 9"/>'
    + '<path d="M4.5 9 L4.5 17 A2 2 0 0 0 6.5 19 L15 19"/>',
  ),

  /** Media library — sun + ridge line inside the plate. */
  'px-media': brand(
    PLATE
    + '<circle cx="15" cy="8.8" r="1.6"/>'
    + '<path d="M6.5 17 L10 12.4 L12.7 15.1 L14.8 12.8 L17.5 17"/>',
  ),

  /** Workspace graph — linked nodes inside the plate. */
  'px-graph': brand(
    PLATE
    + '<circle cx="9.4" cy="9" r="1.5"/>'
    + '<circle cx="15.4" cy="10.4" r="1.5"/>'
    + '<circle cx="10.4" cy="15.4" r="1.5"/>'
    + '<path d="M10.9 9.4 L13.9 10"/>'
    + '<path d="M14.4 11.6 L11.5 14.3"/>',
  ),

  /** Text generator — an italic capital on the plate. */
  'px-writer': brand(
    PLATE
    + '<path d="M13.6 7.5 L10.4 16.5"/>'
    + '<path d="M12 7.5 L15.2 7.5"/>'
    + '<path d="M8.8 16.5 L12 16.5"/>',
  ),

  /** Budget — a coin over the ledger line. */
  'px-budget': brand(
    PLATE
    + '<circle cx="12" cy="11" r="3.3"/>'
    + '<path d="M7.5 17 L14 17"/>',
  ),

  /** Web research — a globe crossed by its orbit. */
  'px-web': brand(
    PLATE
    + '<circle cx="12" cy="11.5" r="3.5"/>'
    + '<path d="M6.8 14.8 L17.2 8.2"/>',
  ),
};
