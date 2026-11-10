// findTargets.ts — what Find searches inside one editor.
//
// The find surface (workbench/findSurface.ts) talks to the active editor
// through an IFindTarget. An editor that knows its own text gives its own
// (the PDF viewer); every other editor gets one of the two here: the text of
// a <textarea>, or the text the editor has on screen (a page, a database, a
// tool's own editor), marked with the CSS Custom Highlight API so nothing in
// the editor's DOM is touched.

/** The three query toggles. */
export interface FindOptions {
  readonly caseSensitive: boolean;
  readonly wholeWord: boolean;
  readonly useRegex: boolean;
}

/** `current` counts from 1; 0 when there is no current match. */
export interface FindCount {
  readonly current: number;
  readonly total: number;
}

export interface IFindTarget {
  /** Find every match and make the nearest one current. An empty query clears. Nothing returned: the count comes later (onDidChangeCount). */
  find(query: string, options: FindOptions): FindCount | undefined;
  /** Move to the next (1) or the previous (-1) match, wrapping round. */
  step(delta: 1 | -1): FindCount | undefined;
  /** Take every mark away. */
  clear(): void;
  /** For a target that counts later than it is asked (the PDF viewer). */
  onDidChangeCount?(listener: (count: FindCount) => void): { dispose(): void };
}

/** The query as a global RegExp, or null when it is empty or not a valid expression. */
export function buildFindRegex(query: string, options: FindOptions): RegExp | null {
  if (!query) return null;
  try {
    let pattern = options.useRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (options.wholeWord) pattern = `\\b${pattern}\\b`;
    return new RegExp(pattern, options.caseSensitive ? 'gu' : 'giu');
  } catch {
    return null;
  }
}

const MAX_MATCHES = 5000;
const HIGHLIGHT_ALL = 'px-find';
const HIGHLIGHT_CURRENT = 'px-find-current';
const SKIP = 'script, style, textarea, input, select, .find-surface, [hidden], [aria-hidden="true"]';

interface HighlightRegistryLike { set(name: string, highlight: unknown): void; delete(name: string): void }
function highlights(): HighlightRegistryLike | undefined {
  return (globalThis as { CSS?: { highlights?: HighlightRegistryLike } }).CSS?.highlights;
}
function makeHighlight(ranges: Range[]): unknown {
  const Ctor = (globalThis as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
  return Ctor ? new Ctor(...ranges) : undefined;
}

/** The text an editor has on screen, as ranges. Matches may cross inline formatting, never a block. */
function collectRanges(root: HTMLElement, regex: RegExp): Range[] {
  const nodes: Text[] = [];
  const starts: number[] = [];
  let flat = '';
  const blockOf = new Map<Element, Element>();
  const visible = new Map<Element, boolean>();
  const block = (el: Element): Element => {
    let b = blockOf.get(el);
    if (!b) {
      b = el;
      while (b !== root && b.parentElement && getComputedStyle(b).display.startsWith('inline')) b = b.parentElement;
      blockOf.set(el, b);
    }
    return b;
  };
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let lastBlock: Element | undefined;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const parent = (n as Text).parentElement;
    if (!parent || !n.nodeValue) continue;
    let ok = visible.get(parent);
    if (ok === undefined) {
      ok = !parent.closest(SKIP) && (typeof parent.checkVisibility !== 'function' || parent.checkVisibility());
      visible.set(parent, ok);
    }
    if (!ok) continue;
    const b = block(parent);
    if (lastBlock && b !== lastBlock) flat += '\n';
    lastBlock = b;
    nodes.push(n as Text);
    starts.push(flat.length);
    flat += n.nodeValue;
  }
  const at = (offset: number, end: boolean): [Text, number] => {
    let lo = 0, hi = nodes.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= (end ? offset - 1 : offset)) lo = mid; else hi = mid - 1;
    }
    return [nodes[lo], Math.max(0, Math.min(nodes[lo].length, offset - starts[lo]))];
  };
  const out: Range[] = [];
  regex.lastIndex = 0;
  for (let m = regex.exec(flat); m && out.length < MAX_MATCHES; m = regex.exec(flat)) {
    if (!m[0].length) { regex.lastIndex++; continue; }
    const range = document.createRange();
    range.setStart(...at(m.index, false));
    range.setEnd(...at(m.index + m[0].length, true));
    out.push(range);
  }
  return out;
}

/** Find in whatever `root` shows: a page, a database, any tool's editor. */
export function domFindTarget(root: HTMLElement): IFindTarget {
  let ranges: Range[] = [];
  let current = -1;
  const count = (): FindCount => ({ current: current + 1, total: ranges.length });
  const paint = (): void => {
    const reg = highlights();
    if (!reg) return;
    if (ranges.length) reg.set(HIGHLIGHT_ALL, makeHighlight(ranges)); else reg.delete(HIGHLIGHT_ALL);
    if (current >= 0) reg.set(HIGHLIGHT_CURRENT, makeHighlight([ranges[current]])); else reg.delete(HIGHLIGHT_CURRENT);
  };
  const reveal = (): void => {
    ranges[current]?.startContainer.parentElement?.scrollIntoView({ block: 'center', inline: 'nearest' });
  };
  return {
    find(query, options) {
      const regex = buildFindRegex(query, options);
      ranges = regex ? collectRanges(root, regex) : [];
      current = -1;
      if (ranges.length) {
        // Start from what the reader is looking at, not from the top of the document.
        const top = root.getBoundingClientRect().top;
        current = 0;
        for (let i = 0; i < Math.min(ranges.length, 400); i++) {
          if (ranges[i].getBoundingClientRect().bottom >= top) { current = i; break; }
        }
        reveal();
      }
      paint();
      return count();
    },
    step(delta) {
      if (!ranges.length) return count();
      current = (current + delta + ranges.length) % ranges.length;
      reveal();
      paint();
      return count();
    },
    clear() {
      ranges = [];
      current = -1;
      paint();
    },
  };
}

/** Find in a <textarea>: the current match is its selection. */
export function textareaFindTarget(textarea: HTMLTextAreaElement): IFindTarget {
  let matches: [number, number][] = [];
  let current = -1;
  const count = (): FindCount => ({ current: current + 1, total: matches.length });
  const select = (): void => {
    const m = matches[current];
    if (!m) return;
    textarea.setSelectionRange(m[0], m[1]);
    const line = textarea.value.slice(0, m[0]).split('\n').length;
    const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight) || 18;
    const wanted = (line - 3) * lineHeight;
    if (wanted < textarea.scrollTop || wanted > textarea.scrollTop + textarea.clientHeight - lineHeight * 4) textarea.scrollTop = Math.max(0, wanted);
  };
  return {
    find(query, options) {
      const regex = buildFindRegex(query, options);
      matches = [];
      current = -1;
      if (regex) {
        for (let m = regex.exec(textarea.value); m && matches.length < MAX_MATCHES; m = regex.exec(textarea.value)) {
          if (!m[0].length) { regex.lastIndex++; continue; }
          matches.push([m.index, m.index + m[0].length]);
        }
        const from = textarea.selectionStart ?? 0;
        current = matches.length ? Math.max(0, matches.findIndex((m) => m[1] > from)) : -1;
        select();
      }
      return count();
    },
    step(delta) {
      if (!matches.length) return count();
      current = (current + delta + matches.length) % matches.length;
      select();
      return count();
    },
    clear() {
      matches = [];
      current = -1;
    },
  };
}
