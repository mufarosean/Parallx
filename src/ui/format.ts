// format.ts — the small text formatters every surface shares.
//
// Each of these had been written many times over, each copy a little
// different (an escaper that skipped quotes, a byte count with other
// decimals, a Title Case that produced "Don'T"). One of each lives here; the
// `api.ui` namespace hands the same functions to extensions.
//
// Dependency rules: src/ui/ depends only on src/platform/.

/**
 * Make text safe to put in HTML: `& < > " '` become entities. Null and
 * undefined become the empty string, so a missing field renders as nothing
 * rather than "undefined".
 */
export function escapeHtml(text: unknown): string {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/**
 * A byte count for people: "512 B", "1.5 KB", "12.3 MB", "1.25 GB" (binary
 * units). Anything that is not a positive finite number is "0 B".
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Title Case: the first letter of each word goes up, the rest stays as it
 * is ("don't panic" → "Don't Panic", "NASA" stays "NASA"). Words are what
 * whitespace separates, so an apostrophe never starts a new word.
 */
export function titleCase(text: string): string {
  return String(text ?? '').replace(/(^|\s)(\p{Ll})/gu, (_m, space: string, letter: string) => `${space}${letter.toUpperCase()}`);
}
