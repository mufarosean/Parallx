// pageLinks.ts — links to a page (and a block in it) inside the app
//
// A link mark whose href is `parallx-page:<pageId>` or
// `parallx-page:<pageId>#<blockId>` opens that page here (and shows the
// block) instead of going to the browser.  canvas_link_block writes these;
// the editor's link click opens them. The app-wide form the chat, its
// citations and Flashcards write, `parallx://canvas/page/<pageId>`, opens the
// same way (it used to be refused as "not an http link"), and backlinks
// count both (pageLinkForms).

export const PAGE_LINK_SCHEME = 'parallx-page';

const ID = '[A-Za-z0-9_-]{1,64}';
const PAGE_LINK_RE = new RegExp(`^(?:${PAGE_LINK_SCHEME}:|parallx://canvas/page/)(${ID})(?:#(${ID}))?$`);

/** Every way a page's link is written, for finding the pages that link to it. */
export function pageLinkForms(pageId: string): readonly string[] {
  return [`${PAGE_LINK_SCHEME}:${pageId}`, `parallx://canvas/page/${pageId}`];
}

export function pageLinkHref(pageId: string, blockId?: string): string {
  return `${PAGE_LINK_SCHEME}:${pageId}${blockId ? `#${blockId}` : ''}`;
}

export function parsePageLink(href: string): { pageId: string; blockId?: string } | null {
  const m = PAGE_LINK_RE.exec(href.trim());
  if (!m) return null;
  return m[2] ? { pageId: m[1]!, blockId: m[2] } : { pageId: m[1]! };
}
