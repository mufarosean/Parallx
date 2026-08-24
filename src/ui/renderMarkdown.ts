// renderMarkdown.ts — the shared compact Markdown + KaTeX renderer.
//
// One renderer for every surface that displays AI- or user-authored rich
// text OUTSIDE the chat transcript: flashcard fronts/backs, widget bodies,
// discussion panels. (Chat keeps its own heavyweight renderer with link
// routing and streaming supports; the dashboard's hand-rolled subset should
// migrate here over time.)
//
// Properties:
//   - markdown-it with html DISABLED — author HTML never reaches the DOM,
//     so the output is safe for model-generated content.
//   - Math is extracted BEFORE the markdown pass and rendered after it.
//     Running markdown first destroyed real formulas (user report: advanced
//     LaTeX, especially aligned multi-formula blocks): markdown's escape
//     rules ate the `\\` row separators in \begin{aligned}, `_`/`*` inside
//     $...$ opened emphasis that split the math across DOM nodes, and bare
//     \begin{env} blocks were never recognized at all. Placeholders (Unicode
//     private-use delimiters markdown passes through untouched) hold each
//     segment's place; a post-render walk swaps them for KaTeX output —
//     or restores the raw source when a placeholder lands inside code/pre,
//     preserving "$ in code stays literal".
//   - Output is a `.px-markdown` element; typography in ui.css sizes it
//     for embedding inside cards and panels (no page-level headings).

import MarkdownIt from 'markdown-it';
import katex from 'katex';

const md = new MarkdownIt({
  html: false,
  linkify: false,
  breaks: false,
  typographer: false,
});

interface MathSegment {
  readonly src: string;
  readonly display: boolean;
  /** The original text, restored verbatim when the placeholder ends up in code. */
  readonly raw: string;
}

const PH_OPEN = '';
const PH_CLOSE = '';
const PH_RE = /(\d+)/;

/** KaTeX has no top-level numbered environments — map them to their
 *  KaTeX-supported inner forms. */
function normalizeEnvironments(src: string): string {
  return src
    .replace(/\\begin\{align\*?\}/g, '\\begin{aligned}')
    .replace(/\\end\{align\*?\}/g, '\\end{aligned}')
    .replace(/\\begin\{gather\*?\}/g, '\\begin{gathered}')
    .replace(/\\end\{gather\*?\}/g, '\\end{gathered}')
    .replace(/\\begin\{equation\*?\}/g, '')
    .replace(/\\end\{equation\*?\}/g, '');
}

/** Pull math out of the raw markdown, longest constructs first. */
function extractMath(markdown: string): { text: string; segments: MathSegment[] } {
  const segments: MathSegment[] = [];
  // An earlier pass may have stashed a construct INSIDE this one — the
  // environment pass fires on `\begin{cases}…\end{cases}` sitting within a
  // `$…$` span, hollowing it out to `$Expos(t) = ⟪1⟫$`; KaTeX then drew the
  // private-use placeholder as red tofu (user report: cases formulas
  // rendering as boxes). Expanding nested placeholders back to their raw
  // source makes the passes compose in any nesting order.
  const unstash = (s: string): string =>
    s.replace(new RegExp(PH_RE.source, 'g'), (whole, n: string) => segments[Number(n)]?.raw ?? whole);
  const stash = (raw: string, src: string, display: boolean): string => {
    segments.push({ raw: unstash(raw), src: unstash(src).trim(), display });
    return `${PH_OPEN}${segments.length - 1}${PH_CLOSE}`;
  };
  let t = String(markdown ?? '');
  // $$display$$ — may span lines and contain anything but $$.
  t = t.replace(/\$\$([\s\S]+?)\$\$/g, (raw, expr: string) => stash(raw, expr, true));
  // Bare LaTeX environments (aligned/align, cases, matrices, …) — display.
  t = t.replace(
    /\\begin\{(aligned|align\*?|alignedat|gathered|gather\*?|equation\*?|cases|split|(?:b|p|v|V|small)?matrix|array)\}[\s\S]+?\\end\{\1\}/g,
    (raw) => stash(raw, raw, true),
  );
  // $inline$ — single line, no interior $, and no space hugging the
  // delimiters (rejects "costs $5 and $10 more" money false-positives).
  t = t.replace(/\$(?!\s)([^$\n]+?)\$/g, (raw, expr: string, offset: number, whole: string) => {
    if (/\s$/.test(expr)) return raw;
    // A digit immediately after the closing $ reads as money, not math.
    const after = whole[offset + raw.length];
    if (expr.length <= 2 && /^\d+$/.test(expr.trim()) && after !== undefined && /\d/.test(after)) return raw;
    return stash(raw, expr, false);
  });
  return { text: t, segments };
}

function renderSegment(seg: MathSegment): HTMLElement {
  const span = document.createElement('span');
  span.className = seg.display ? 'px-markdown__math px-markdown__math--display' : 'px-markdown__math';
  try {
    span.innerHTML = katex.renderToString(normalizeEnvironments(seg.src), {
      throwOnError: false,
      displayMode: seg.display,
    });
  } catch {
    span.textContent = seg.raw; // leave the raw source visible on failure
  }
  return span;
}

function restoreMathIn(root: HTMLElement, segments: MathSegment[]): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const targets: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (PH_RE.test(node.textContent ?? '')) targets.push(node as Text);
  }
  for (const textNode of targets) {
    const inCode = !!textNode.parentElement?.closest('code, pre');
    const text = textNode.textContent ?? '';
    const frag = document.createDocumentFragment();
    let cursor = 0;
    const re = new RegExp(PH_RE.source, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const seg = segments[Number(m[1])];
      if (!seg) continue;
      if (m.index > cursor) frag.appendChild(document.createTextNode(text.slice(cursor, m.index)));
      if (inCode) frag.appendChild(document.createTextNode(seg.raw));
      else frag.appendChild(renderSegment(seg));
      cursor = m.index + m[0].length;
    }
    if (cursor < text.length) frag.appendChild(document.createTextNode(text.slice(cursor)));
    textNode.replaceWith(frag);
  }
}

/**
 * Render markdown (+ KaTeX math) into a `.px-markdown` element.
 * Safe for model-generated input: raw HTML is never interpreted.
 */
export function renderMarkdown(markdown: string): HTMLElement {
  const { text, segments } = extractMath(markdown ?? '');
  const root = document.createElement('div');
  root.className = 'px-markdown';
  root.innerHTML = md.render(text);
  if (segments.length > 0) restoreMathIn(root, segments);
  // Links open nowhere by default from embedded surfaces; consumers that
  // want navigation attach their own handlers. Neutralise targets so a
  // stray click can't navigate the workbench window.
  root.querySelectorAll('a').forEach((a) => {
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
  });
  return root;
}
