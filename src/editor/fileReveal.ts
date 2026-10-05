// fileReveal.ts — "open this file at this spot" requests for editor panes.
//
// A citation link opens a file at the spot it cites: a PDF page and quote, a
// text line, a spreadsheet cell. The open path (EditorsBridge.openFileEditor)
// files the request here before opening the editor. The group tells the pane
// once it is shown, laid out and its view state restored (IEditorPane.didShow),
// and the pane takes the request then (a PDF only once its pages are laid
// out), so a request is never lost to a slow load or undone by a restore.
//
// Requests are keyed by file path, compared without regard to slash
// direction or case. One that no pane takes within a minute is dropped, so a
// later, unrelated open of that file does not jump.

/** Where to take the reader. Every field is optional; a pane uses what applies to it. */
export interface IFileRevealTarget {
  /** PDF page (1 = first page of the file). */
  readonly page?: number;
  /** Passage to find and highlight. */
  readonly quote?: string;
  /** Text line (1-based) and, for a passage over several lines, its last line. */
  readonly line?: number;
  readonly endLine?: number;
  /** Spreadsheet sheet name and A1-style cell. */
  readonly sheet?: string;
  readonly cell?: string;
}

const PENDING_TTL_MS = 60_000;

interface Pending { readonly target: IFileRevealTarget; readonly at: number }

const _pending = new Map<string, Pending>();

/** Comparable key for a file path or file URI path. */
export function fileRevealKey(fsPath: string): string {
  return fsPath.replace(/\\/g, '/').replace(/^\/(?=[a-zA-Z]:)/, '').toLowerCase();
}

/** True when the target asks for anything at all. */
export function hasRevealTarget(target: IFileRevealTarget | undefined): target is IFileRevealTarget {
  return !!target && (
    (typeof target.page === 'number' && target.page > 0)
    || (typeof target.line === 'number' && target.line > 0)
    || (typeof target.quote === 'string' && target.quote.trim().length > 0)
    || (typeof target.cell === 'string' && target.cell.trim().length > 0)
    || (typeof target.sheet === 'string' && target.sheet.length > 0)
  );
}

/** File a reveal for `fsPath`. Replaces any earlier one for the same file. */
export function requestFileReveal(fsPath: string, target: IFileRevealTarget, now: number = Date.now()): void {
  if (!fsPath || !hasRevealTarget(target)) return;
  const key = fileRevealKey(fsPath);
  _pending.set(key, { target, at: now });
}

/** Take (and clear) the pending reveal for `fsPath`, if one is still fresh. */
export function takeFileReveal(fsPath: string, now: number = Date.now()): IFileRevealTarget | undefined {
  if (!fsPath) return undefined;
  const key = fileRevealKey(fsPath);
  const entry = _pending.get(key);
  if (!entry) return undefined;
  _pending.delete(key);
  if (now - entry.at > PENDING_TTL_MS) return undefined;
  return entry.target;
}

/** Test seam: drop every pending request. */
export function _clearFileRevealsForTest(): void {
  _pending.clear();
}
