// pdfPassagePrompt.ts — what the AI is told when you ask about a highlight.
//
// It used to see only the highlighted words: no file name, no page, nothing
// around them, so a question about "this term" or "the table above" could
// not be answered from the paper and the model guessed. It now sees the
// file's name, the page number, the whole page the passage is on (the
// passage marked within it), and, when the file is indexed, the passages of
// the same file that bear on the question. It is told to say when the paper
// does not answer, rather than fill the gap.

/** What the pane knows about where a highlight sits. */
export interface PassageContext {
  readonly fileName?: string;
  /** 1-based. */
  readonly pageNumber: number;
  readonly pageCount?: number;
  /** The page's text, as pdf.js reads it. */
  readonly pageText?: string;
  /** Passages from elsewhere in the same file that bear on the question. */
  readonly related?: string;
}

/** A page longer than this is cut around the passage. */
export const PAGE_TEXT_CHARS = 8000;

/** The page's text from pdf.js's text items, one line per line. */
export function pageTextFromItems(items: readonly unknown[]): string {
  let text = '';
  for (const item of items) {
    const it = item as { str?: unknown; hasEOL?: unknown };
    if (typeof it.str !== 'string') continue;
    text += it.str + (it.hasEOL ? '\n' : '');
  }
  return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** The page cut to `max` characters, keeping the passage in view when it is found. */
export function pageWindow(pageText: string, passage: string, max = PAGE_TEXT_CHARS): string {
  if (pageText.length <= max) return pageText;
  const probe = passage.trim().slice(0, 60);
  const at = probe ? pageText.indexOf(probe) : -1;
  const start = at < 0 ? 0 : Math.max(0, Math.min(at - Math.floor((max - passage.length) / 2), pageText.length - max));
  return (start > 0 ? '…' : '') + pageText.slice(start, start + max) + (start + max < pageText.length ? '…' : '');
}

/** The system message for a question about the highlighted passage. */
export function passagePrompt(passage: string, ctx: PassageContext): string {
  const where = [
    ctx.fileName ? `"${ctx.fileName}"` : 'a PDF',
    `page ${ctx.pageNumber}${ctx.pageCount ? ` of ${ctx.pageCount}` : ''}`,
  ].join(', ');
  const parts = [
    `You are helping a reader understand a passage they highlighted in ${where}.`,
    `The highlighted passage:\n\n---\n${passage || '(an image or figure, not text)'}\n---`,
  ];
  if (ctx.pageText?.trim()) {
    parts.push(`The whole of page ${ctx.pageNumber}, for context:\n\n---\n${pageWindow(ctx.pageText, passage)}\n---`);
  }
  if (ctx.related?.trim()) {
    parts.push(`Passages from elsewhere in the same file that may bear on the question:\n\n${ctx.related.trim()}`);
  }
  parts.push('Answer their questions about the passage clearly and concisely, using the page and the file. '
    + 'When the answer is not in what you were given, say so, and say what you are adding from general knowledge.');
  return parts.join('\n\n');
}

/** As much of a pdf.js document as reading one page's text needs. */
interface IPageTextDoc {
  readonly numPages: number;
  getPage(n: number): Promise<{ getTextContent(): Promise<{ items: readonly unknown[] }> }>;
}

/** The open file's name and path, its page count and one page's text. */
export async function pageSource(doc: IPageTextDoc | null, file: { name: string; uri: { fsPath: string } } | null, pageNumber: number):
  Promise<{ fileName?: string; filePath?: string; pageCount?: number; pageText?: string }> {
  const pageText = doc && pageNumber >= 1 && pageNumber <= doc.numPages
    ? await doc.getPage(pageNumber).then((p) => p.getTextContent()).then((c) => pageTextFromItems(c.items)).catch(() => undefined)
    : undefined;
  return { fileName: file?.name, filePath: file?.uri.fsPath, pageCount: doc?.numPages, pageText };
}
