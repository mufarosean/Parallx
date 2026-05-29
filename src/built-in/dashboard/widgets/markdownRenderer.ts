// markdownRenderer.ts — lightweight Markdown → DOM renderer shared by the
// dashboard's AI-backed widgets (news brief, custom AI widget, …).
//
// Intentionally small: it covers the subset the push-model widgets actually
// produce — headings, bullet/numbered lists, paragraphs, inline emphasis
// (**bold**, *italic*, _italic_, `code`) and [label](url) links. Anything
// fancier is a polish item; this keeps every AI widget rendering consistently
// without pulling in a full Markdown engine.

export function renderMarkdownToDom(markdown: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  // Block-level: split on double newline.
  const blocks = markdown.split(/\n\s*\n/);
  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    // Heading
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const level = Math.min(6, headingMatch[1].length);
      const h = document.createElement(`h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6');
      h.textContent = headingMatch[2];
      frag.appendChild(h);
      continue;
    }

    // Numbered or bullet list
    const lines = trimmed.split(/\n/);
    if (lines.every(l => /^\s*[-*•]\s+/.test(l))) {
      const ul = document.createElement('ul');
      for (const ln of lines) {
        const li = document.createElement('li');
        li.appendChild(parseInlineFragment(ln.replace(/^\s*[-*•]\s+/, '')));
        ul.appendChild(li);
      }
      frag.appendChild(ul);
      continue;
    }
    if (lines.every(l => /^\s*\d+\.\s+/.test(l))) {
      const ol = document.createElement('ol');
      for (const ln of lines) {
        const li = document.createElement('li');
        li.appendChild(parseInlineFragment(ln.replace(/^\s*\d+\.\s+/, '')));
        ol.appendChild(li);
      }
      frag.appendChild(ol);
      continue;
    }

    // Paragraph (preserving inline emphasis + links)
    const p = document.createElement('p');
    p.appendChild(parseInlineFragment(lines.join(' ')));
    frag.appendChild(p);
  }
  return frag;
}

export function parseInlineFragment(text: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  // Order: links, bold, italic, code. Simple regex pass.
  // [label](url)
  const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      frag.appendChild(parseEmphasis(text.slice(lastIdx, match.index)));
    }
    const a = document.createElement('a');
    a.href = match[2];
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = match[1];
    frag.appendChild(a);
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < text.length) {
    frag.appendChild(parseEmphasis(text.slice(lastIdx)));
  }
  return frag;
}

export function parseEmphasis(text: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|_[^_]+_|`[^`]+`)/);
  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith('**') && part.endsWith('**')) {
      const strong = document.createElement('strong');
      strong.textContent = part.slice(2, -2);
      frag.appendChild(strong);
    } else if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      const em = document.createElement('em');
      em.textContent = part.slice(1, -1);
      frag.appendChild(em);
    } else if (part.startsWith('_') && part.endsWith('_') && part.length > 2) {
      const em = document.createElement('em');
      em.textContent = part.slice(1, -1);
      frag.appendChild(em);
    } else if (part.startsWith('`') && part.endsWith('`')) {
      const code = document.createElement('code');
      code.textContent = part.slice(1, -1);
      frag.appendChild(code);
    } else {
      frag.appendChild(document.createTextNode(part));
    }
  }
  return frag;
}
