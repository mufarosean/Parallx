// ansiToHtml.ts — SGR escape sequences → themed HTML (M96)
//
// Kernel tracebacks arrive coloured. IPython emits real ANSI SGR codes, so a
// ZeroDivisionError comes over the wire as
//   ESC[31m---------ESC[39m \n ESC[31mZeroDivisionErrorESC[39m ...
// Rendering that verbatim shows the escape bytes as mojibake; stripping it
// throws away the structure that makes a traceback readable — the error type,
// the offending-line marker, the frame separators.
//
// No ANSI parser exists elsewhere in the app (the terminal view renders through
// a different path), so this is written rather than reused.
//
// Scope: SGR only, which is all a kernel emits. Cursor movement, erases, and
// OSC sequences are consumed and discarded rather than interpreted — a
// traceback containing them would be pathological, and honouring them inside a
// static block is meaningless.
//
// Colours resolve to theme tokens, not raw hex. A hardcoded 8-colour ANSI
// palette is exactly the thing that turns unreadable in light mode.

// ─── Escape matching ─────────────────────────────────────────────────────────

/**
 * The escape byte written as REGEX SOURCE, never as a literal control
 * character. A raw 0x1B in a source file survives no round trip through an
 * editor, a diff, or a copy-paste, and when one gets eaten the regex silently
 * stops matching — the failure is invisible until a traceback renders as
 * garbage.
 */
const ESC = '\\u001b';

/**
 * One alternation per escape family, each ESC-anchored so ordinary text is
 * never mistaken for a colour code. `arr[31m]` in a traceback is real Python,
 * not SGR, and an unanchored pattern would eat it.
 *
 *   1. SGR              ESC [ … m         — the only family interpreted
 *   2. OSC              ESC ] … BEL | ST  — titles, hyperlinks
 *   3. other CSI        ESC [ … <final>   — cursor moves, erases
 *   4. two-char escape  ESC <0x40–0x5F>
 */
const ESCAPE_RE = new RegExp(
  [
    `${ESC}\\[([0-9;]*)m`,
    `${ESC}\\][\\s\\S]*?(?:\\u0007|${ESC}\\\\)`,
    `${ESC}\\[[0-9;?]*[A-HJKSTfhlsu]`,
    `${ESC}[@-_]`,
  ].join('|'),
  'g',
);

// ─── Palette ─────────────────────────────────────────────────────────────────

/** Standard 8 + bright 8, mapped onto theme tokens rather than raw colours. */
const FG: Record<number, string> = {
  // "Black" is meaningless as a literal on a dark surface; it reads as
  // de-emphasis in every traceback that uses it.
  30: 'var(--px-text-faint)',
  31: 'var(--px-danger)',
  32: 'var(--px-success)',
  33: 'var(--px-warning)',
  34: 'var(--px-info)',
  35: 'var(--px-syntax-constant)',
  36: 'var(--px-syntax-type)',
  37: 'var(--px-text)',
  90: 'var(--px-text-faint)',
  91: 'var(--px-danger)',
  92: 'var(--px-success)',
  93: 'var(--px-warning)',
  94: 'var(--px-info)',
  95: 'var(--px-syntax-constant)',
  96: 'var(--px-syntax-type)',
  97: 'var(--px-text)',
};

const BG: Record<number, string> = {
  41: 'var(--px-danger-soft)',
  42: 'color-mix(in srgb, var(--px-success) 18%, transparent)',
  43: 'var(--px-warning-soft)',
  44: 'color-mix(in srgb, var(--px-info) 18%, transparent)',
  47: 'var(--px-surface-hover)',
  100: 'var(--px-surface-hover)',
  101: 'var(--px-danger-soft)',
  103: 'var(--px-warning-soft)',
};

/** The xterm 256-colour cube, collapsed onto the same token palette. */
function xterm256(index: number): string | undefined {
  if (index < 8) return FG[30 + index];
  if (index < 16) return FG[90 + (index - 8)];
  if (index >= 232) {
    // Greyscale ramp: the dark half reads as de-emphasis, the light half as
    // body text.
    return index < 244 ? 'var(--px-text-faint)' : 'var(--px-text)';
  }
  // 6×6×6 cube. Pick the dominant channel rather than inventing a literal
  // colour no theme controls.
  const c = index - 16;
  const r = Math.floor(c / 36);
  const g = Math.floor((c % 36) / 6);
  const b = c % 6;
  if (r > g && r > b) return 'var(--px-danger)';
  if (g > r && g > b) return 'var(--px-success)';
  if (b > r && b > g) return 'var(--px-info)';
  if (r === g && r > b) return 'var(--px-warning)';
  return 'var(--px-text)';
}

// ─── SGR state ───────────────────────────────────────────────────────────────

interface SgrState {
  fg?: string;
  bg?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  dim?: boolean;
}

function applyCodes(state: SgrState, codes: readonly number[]): void {
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i];

    if (code === 0) {
      delete state.fg; delete state.bg;
      delete state.bold; delete state.italic;
      delete state.underline; delete state.dim;
      continue;
    }
    if (code === 1) { state.bold = true; continue; }
    if (code === 2) { state.dim = true; continue; }
    if (code === 3) { state.italic = true; continue; }
    if (code === 4) { state.underline = true; continue; }
    if (code === 22) { delete state.bold; delete state.dim; continue; }
    if (code === 23) { delete state.italic; continue; }
    if (code === 24) { delete state.underline; continue; }
    if (code === 39) { delete state.fg; continue; }
    if (code === 49) { delete state.bg; continue; }

    // Extended colour: 38;5;n / 48;5;n (256) and 38;2;r;g;b / 48;2;r;g;b
    // (truecolour). Their arguments MUST be consumed here — leaving them in
    // the stream is the classic bug where a colour index like 1 or 4 gets
    // re-read as "bold" or "underline".
    if (code === 38 || code === 48) {
      const mode = codes[i + 1];
      if (mode === 5) {
        const resolved = xterm256(codes[i + 2] ?? 0);
        if (resolved) { if (code === 38) state.fg = resolved; else state.bg = resolved; }
        i += 2;
      } else if (mode === 2) {
        const r = codes[i + 2] ?? 0;
        const g = codes[i + 3] ?? 0;
        const b = codes[i + 4] ?? 0;
        const css = `rgb(${r}, ${g}, ${b})`;
        if (code === 38) state.fg = css; else state.bg = css;
        i += 4;
      }
      continue;
    }

    if (FG[code]) { state.fg = FG[code]; continue; }
    if (BG[code]) { state.bg = BG[code]; continue; }
  }
}

function styleOf(state: SgrState): string {
  const parts: string[] = [];
  if (state.fg) parts.push(`color:${state.fg}`);
  if (state.bg) parts.push(`background:${state.bg}`);
  if (state.bold) parts.push('font-weight:600');
  if (state.italic) parts.push('font-style:italic');
  if (state.underline) parts.push('text-decoration:underline');
  if (state.dim) parts.push('opacity:0.7');
  return parts.join(';');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function wrap(escaped: string, state: SgrState): string {
  if (!escaped) return '';
  const style = styleOf(state);
  return style ? `<span style="${style}">${escaped}</span>` : escaped;
}

// ─── Public ──────────────────────────────────────────────────────────────────

/**
 * Convert ANSI-coloured text to an HTML fragment.
 *
 * Output is assembled from HTML-escaped text plus a fixed set of inline
 * styles — no part of the input ever reaches the DOM as markup. That matters
 * because this renders `evalue`, which carries arbitrary user data: a KeyError
 * on a dict key of `<img onerror=alert(1)>` is an entirely ordinary thing to
 * hit while working.
 */
export function ansiToHtml(text: string): string {
  const state: SgrState = {};
  let html = '';
  let lastIndex = 0;

  ESCAPE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ESCAPE_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      html += wrap(escapeHtml(text.slice(lastIndex, match.index)), state);
    }
    // Capture group 1 exists only for the SGR alternation; the other families
    // are consumed and dropped.
    if (match[1] !== undefined) {
      const codes = match[1] === ''
        ? [0]   // bare ESC[m is a reset
        : match[1].split(';').map((n) => parseInt(n, 10) || 0);
      applyCodes(state, codes);
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    html += wrap(escapeHtml(text.slice(lastIndex)), state);
  }
  return html;
}

/** Drop every escape sequence — for copying a traceback as plain text. */
export function stripAnsi(text: string): string {
  ESCAPE_RE.lastIndex = 0;
  return text.replace(ESCAPE_RE, '');
}
