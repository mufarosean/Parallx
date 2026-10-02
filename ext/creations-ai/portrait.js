// Creations AI: a character's portrait without a picture (docs/CREATIONS_AI.md,
// "No images"). Their initials on a quiet tone of a hue taken from the name.
// The hue is the only colour a character carries; it shows on the portrait
// and nowhere else. The tone itself comes from the --px-portrait-* tokens,
// so light and dark modes each get a readable pair.

/** Hues a user can pick in the Studio, by name. */
export const PORTRAIT_HUES = [
  { label: 'Rose', hue: 338 },
  { label: 'Rust', hue: 12 },
  { label: 'Amber', hue: 36 },
  { label: 'Moss', hue: 96 },
  { label: 'Sea', hue: 168 },
  { label: 'Sky', hue: 204 },
  { label: 'Iris', hue: 250 },
  { label: 'Plum', hue: 290 },
];

/** A stable hue from a name: the same name always gets the same tone. */
export function hueFromName(name) {
  const s = String(name || '').trim().toLowerCase();
  if (!s) return 220;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return PORTRAIT_HUES[(h >>> 0) % PORTRAIT_HUES.length].hue;
}

/** One or two letters: first and last word, skipping a leading "The". */
export function initialsOf(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  const kept = words.length > 1 && /^the$/i.test(words[0]) ? words.slice(1) : words;
  if (kept.length === 0) return '?';
  const first = [...kept[0]][0] || '';
  const last = kept.length > 1 ? ([...kept[kept.length - 1]][0] || '') : '';
  return (first + last).toUpperCase();
}

/** The hue a character shows: the one picked in the Studio, else the name's. */
export function hueOf(data) {
  const picked = Number(data?.hue);
  if (Number.isFinite(picked) && data?.hue !== null && data?.hue !== '') return picked;
  return hueFromName(data?.name);
}

/**
 * A portrait element. Sizes follow the board: 72 Studio, 56 gallery,
 * 44 Home, 32 chat, 24 inline.
 */
export function createPortrait(name, { size = 40, hue = null } = {}) {
  const span = document.createElement('span');
  span.className = 'cr-portrait';
  span.setAttribute('aria-hidden', 'true');
  span.textContent = initialsOf(name);
  span.style.setProperty('--cr-size', `${size}px`);
  span.style.setProperty('--cr-hue', String(hue ?? hueFromName(name)));
  return span;
}

/** Repaint an existing portrait after a rename or a new hue. */
export function updatePortrait(span, name, hue = null) {
  span.textContent = initialsOf(name);
  span.style.setProperty('--cr-hue', String(hue ?? hueFromName(name)));
}

/**
 * Shared look for the redesign's parts: the portrait, the writing states
 * (shimmer, caret, dots, the brief glow on fresh text) and the hover bar.
 * Motion stops under reduced motion and when the user turns streaming
 * display off (`.cr-still` on an ancestor).
 */
export const CREATIONS_PARTS_CSS = `
.cr-portrait { flex: none; width: var(--cr-size, 40px); height: var(--cr-size, 40px); border-radius: calc(var(--cr-size, 40px) * .3); display: inline-flex; align-items: center; justify-content: center; background: hsl(var(--cr-hue, 220) var(--px-portrait-s) var(--px-portrait-l)); color: hsl(var(--cr-hue, 220) 22% var(--px-portrait-ink-l)); font-size: calc(var(--cr-size, 40px) * .4); font-weight: 600; letter-spacing: .02em; line-height: 1; user-select: none; }
@keyframes cr-shimmer { 0% { background-position: -400px 0; } 100% { background-position: 400px 0; } }
@keyframes cr-blink { 50% { opacity: 0; } }
@keyframes cr-bob { 0%, 80%, 100% { transform: translateY(0); opacity: .4; } 40% { transform: translateY(-3px); opacity: 1; } }
@keyframes cr-fresh { from { box-shadow: 0 0 0 3px rgba(var(--px-green-rgb), .22); } to { box-shadow: 0 0 0 3px rgba(var(--px-green-rgb), 0); } }
@keyframes cr-tilt { 0%, 100% { transform: rotate(0); } 50% { transform: rotate(-14deg); } }
.cr-skel { display: block; border-radius: var(--px-radius-xs); height: 10px; background: linear-gradient(90deg, var(--px-bg-inset) 0, var(--px-surface-hover) 120px, var(--px-bg-inset) 240px); background-size: 800px 100%; animation: cr-shimmer 1.6s linear infinite; }
.cr-caret { display: inline-block; width: 2px; height: 1em; vertical-align: -2px; margin-left: 2px; background: var(--px-accent); animation: cr-blink 1s steps(1) infinite; }
.cr-dots { display: inline-flex; gap: 3px; align-items: center; }
.cr-dots i { display: inline-block; width: 4px; height: 4px; border-radius: var(--px-radius-full); background: currentColor; animation: cr-bob 1.2s infinite; }
.cr-dots i:nth-child(2) { animation-delay: .15s; }
.cr-dots i:nth-child(3) { animation-delay: .3s; }
.cr-fresh { animation: cr-fresh 2s var(--px-ease-out) both; }
.cr-dice:hover .tg-icon, .cr-dice:hover svg { animation: cr-tilt .5s var(--px-ease); }
.cr-still .cr-skel, .cr-still .cr-caret, .cr-still .cr-dots i, .cr-still .cr-fresh, .cr-still .cr-dice:hover svg { animation: none; }
@media (prefers-reduced-motion: reduce) { .cr-skel, .cr-caret, .cr-dots i, .cr-fresh, .cr-dice:hover svg { animation: none; } }
`;

/** Three bobbing dots: something is being written. */
export function createDots() {
  const s = document.createElement('span');
  s.className = 'cr-dots';
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = '<i></i><i></i><i></i>';
  return s;
}
