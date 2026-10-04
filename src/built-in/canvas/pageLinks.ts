// pageLinks.ts — links to a page (and a block in it) inside the app
//
// A link mark whose href is `parallx-page:<pageId>` or
// `parallx-page:<pageId>#<blockId>` opens that page here (and shows the
// block) instead of going to the browser.  canvas_link_block writes these;
// the editor's link click opens them.

export const PAGE_LINK_SCHEME = 'parallx-page';

const ID = '[A-Za-z0-9_-]{1,64}';
const PAGE_LINK_RE = new RegExp(`^${PAGE_LINK_SCHEME}:(${ID})(?:#(${ID}))?$`);

export function pageLinkHref(pageId: string, blockId?: string): string {
  return `${PAGE_LINK_SCHEME}:${pageId}${blockId ? `#${blockId}` : ''}`;
}

export function parsePageLink(href: string): { pageId: string; blockId?: string } | null {
  const m = PAGE_LINK_RE.exec(href.trim());
  if (!m) return null;
  return m[2] ? { pageId: m[1]!, blockId: m[2] } : { pageId: m[1]! };
}
