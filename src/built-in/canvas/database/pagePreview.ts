// pagePreview.ts — a page's first picture, for a card's preview (pure).

import { decodeCanvasContent } from '../contentSchema.js';

interface Node { readonly type?: string; readonly attrs?: Record<string, unknown>; readonly content?: readonly Node[] }

/** The src of the first image block in stored page content, or null. */
export function firstImageSrc(stored: string | null | undefined): string | null {
  if (!stored) return null;
  let doc: Node;
  try { doc = decodeCanvasContent(stored).doc as Node; } catch { return null; }
  const stack: Node[] = [doc];
  while (stack.length) {
    const n = stack.shift()!;
    if (n.type === 'image' && typeof n.attrs?.['src'] === 'string' && n.attrs['src']) return n.attrs['src'] as string;
    if (Array.isArray(n.content)) stack.unshift(...n.content);
  }
  return null;
}
