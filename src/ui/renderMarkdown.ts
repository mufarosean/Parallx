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
//   - Math: $inline$ and $$display$$ segments render through KaTeX after
//     the markdown pass, via a text-node walk that skips code/pre.
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

function renderMathIn(root: HTMLElement): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const targets: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = node.textContent ?? '';
    if (!text.includes('$')) continue;
    const parent = (node as Text).parentElement;
    if (!parent || parent.closest('code, pre, .katex')) continue;
    targets.push(node as Text);
  }

  for (const textNode of targets) {
    const text = textNode.textContent ?? '';
    const frag = document.createDocumentFragment();
    let cursor = 0;
    let matched = false;

    // One combined scan: display math wins over inline at the same position.
    const combined = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;
    let m: RegExpExecArray | null;
    while ((m = combined.exec(text))) {
      const [whole, display, inline] = m;
      const expr = (display ?? inline ?? '').trim();
      if (!expr) continue;
      matched = true;
      if (m.index > cursor) frag.appendChild(document.createTextNode(text.slice(cursor, m.index)));
      const span = document.createElement('span');
      span.className = display ? 'px-markdown__math px-markdown__math--display' : 'px-markdown__math';
      try {
        span.innerHTML = katex.renderToString(expr, {
          throwOnError: false,
          displayMode: !!display,
        });
      } catch {
        span.textContent = whole; // leave the raw source visible on failure
      }
      frag.appendChild(span);
      cursor = m.index + whole.length;
    }

    if (!matched) continue;
    if (cursor < text.length) frag.appendChild(document.createTextNode(text.slice(cursor)));
    textNode.replaceWith(frag);
  }
}

/**
 * Render markdown (+ KaTeX math) into a `.px-markdown` element.
 * Safe for model-generated input: raw HTML is never interpreted.
 */
export function renderMarkdown(markdown: string): HTMLElement {
  const root = document.createElement('div');
  root.className = 'px-markdown';
  root.innerHTML = md.render(markdown ?? '');
  renderMathIn(root);
  // Links open nowhere by default from embedded surfaces; consumers that
  // want navigation attach their own handlers. Neutralise targets so a
  // stray click can't navigate the workbench window.
  root.querySelectorAll('a').forEach((a) => {
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
  });
  return root;
}
