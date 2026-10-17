// chatCitationMarks.ts — how citations look in a rendered reply.
//
// Two layers, both about trust in a link:
//
//   - The citation check (openclaw/openclawCitationCheck.ts) turns each
//     source label ("[S3]") into its link before the answer is final, and
//     marks a citation that failed with an "Unverified: …" title. The
//     markdown plugin below styles those links apart, and shows a label the
//     check has not reached yet (the answer is still being written) as a
//     quiet chip, so a raw "[S3]" never looks like a finished citation.
//   - Every rendered parallx:// link is checked against its target (the
//     link's own kind decides whether it exists); a dead one is marked and
//     titled with the reason. Results are cached briefly, since a streaming
//     reply re-renders the same links many times.

import type MarkdownIt from 'markdown-it';
import './chatCitationMarks.css';

const SOURCE_LABEL_RE = /\[(S\d{1,4}(?:\s*[,;]\s*S\d{1,4})*)\]/gi;

/** Markdown plugin: pending source labels as chips, Unverified links styled apart. */
export function citationMarks(markdown: MarkdownIt): void {
  const defaultText = markdown.renderer.rules.text!;
  markdown.renderer.rules.text = (tokens, idx, options, env, self) =>
    defaultText(tokens, idx, options, env, self).replace(
      SOURCE_LABEL_RE,
      (_m, ids: string) => `<span class="parallx-cite-pending" title="Checking this source">${ids}</span>`,
    );

  const defaultLinkOpen = markdown.renderer.rules.link_open
    ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
  markdown.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    if ((token.attrGet('href') ?? '').startsWith('parallx://') && (token.attrGet('title') ?? '').startsWith('Unverified')) {
      token.attrJoin('class', 'parallx-chat-link--unverified');
    }
    return defaultLinkOpen(tokens, idx, options, env, self);
  };
}

// ── parallx:// link checks ─────────────────────────────────────────────

export type ChatLinkCheck = { readonly ok: true } | { readonly ok: false; readonly error: string };
type ChatLinkChecker = (uri: string) => Promise<ChatLinkCheck>;

let _linkChecker: ChatLinkChecker | undefined;
const _linkCheckCache = new Map<string, { readonly at: number; readonly result: Promise<ChatLinkCheck> }>();
const LINK_CHECK_TTL_MS = 15_000;
const LINK_CHECK_CACHE_MAX = 200;

/** Install (or clear) the checker that marks parallx:// links whose target is gone. */
export function setChatLinkChecker(checker: ChatLinkChecker | undefined): void {
  _linkChecker = checker;
  _linkCheckCache.clear();
}

function _checkLink(href: string, checker: ChatLinkChecker): Promise<ChatLinkCheck> {
  const now = Date.now();
  const cached = _linkCheckCache.get(href);
  if (cached && now - cached.at <= LINK_CHECK_TTL_MS) return cached.result;
  // A checker that fails says nothing about the link: leave it unmarked.
  const result = checker(href).catch((): ChatLinkCheck => ({ ok: true }));
  _linkCheckCache.delete(href);
  _linkCheckCache.set(href, { at: now, result });
  while (_linkCheckCache.size > LINK_CHECK_CACHE_MAX) {
    const oldest = _linkCheckCache.keys().next().value;
    if (oldest === undefined) break;
    _linkCheckCache.delete(oldest);
  }
  return result;
}

/** Check every parallx:// link in a rendered reply; mark the dead ones. */
export function markParallxLinks(root: HTMLElement): Promise<void> {
  const checker = _linkChecker;
  if (!checker) return Promise.resolve();
  const anchors = Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href^="parallx://"]'));
  return Promise.all(anchors.map(async (a) => {
    const href = a.getAttribute('href');
    if (!href) return;
    const check = await _checkLink(href, checker);
    if (check.ok) return;
    a.classList.add('parallx-chat-link--broken');
    a.setAttribute('aria-invalid', 'true');
    a.title = `This link does not work: ${check.error}`;
  })).then(() => undefined);
}
