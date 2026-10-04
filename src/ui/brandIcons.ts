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
//   - Brand icons are for PRODUCT nouns (canvas, dashboard, chat, the tool
//     gallery). Universal verbs and objects (search, folder, settings,
//     trash…) stay Lucide — genericness is correct there.
//   - Upright plate: `<rect x="4.5" y="4" width="15" height="16" rx="1.5"/>`.
//     One strong inner mark, no fills, nothing outside 2–22.
//   - Only the core's own nouns live here. A tool that can be turned off
//     brings its mark itself (its manifest's `contributes.icons`, drawn with
//     `brandIcon` + `BRAND_PLATE` for a built-in, the same markup inline in
//     an extension's manifest); it is registered while the tool runs.

const SVG_OPEN =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';

/** A brand icon: the inner marks wrapped in the shared 24×24 stroke svg. */
export function brandIcon(inner: string): string {
  return `${SVG_OPEN}${inner}</svg>`;
}
const brand = brandIcon;

/** The upright plate most brand icons are built on. */
export const BRAND_PLATE = '<rect x="4.5" y="4" width="15" height="16" rx="1.5"/>';
const PLATE = BRAND_PLATE;

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
};
