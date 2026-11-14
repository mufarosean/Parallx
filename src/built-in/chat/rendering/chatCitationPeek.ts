// chatCitationPeek.ts — a citation shows the piece of the page it rests on.
//
// A citation in an answer is a link to a place: a PDF page, or a picture of
// a page, and the words the sentence rests on (the link's quote). Pointing
// at the link, moving to it with the keyboard, or pressing it with a finger
// shows a small card: the file, the page, and the piece of the page with the
// quote washed (services/pagePicture.ts). So a citation can be judged
// without leaving the chat. Nothing is made until a card is asked for.
//
// With a mouse or the keyboard the link itself still opens the place (a
// click, Enter), so the card only describes. A finger has no hover: its
// first press shows the card, which then carries the way in, and a second
// press on the link goes straight there.
//
// The picture is for the eye. A screen reader is told the words the sentence
// rests on as soon as the card is there, whatever the picture does.
//
// When the quote cannot be found on the page (or the file has not been read
// by the document reader and has no text of its own), the card says where in
// words instead of with a picture.

import { createBlock } from '../../../ui/kit.js';
import { createLink } from '../../../ui/link.js';
import { addDisposableListener } from '../../../ui/dom.js';
import type { IDisposable } from '../../../platform/lifecycle.js';
import { pieceOfPage } from '../../../services/pagePicture.js';
import { isPicturePath } from '../../../services/readerPolicy.js';
import './chatCitationPeek.css';

const LINKS = 'a[href^="parallx://explorer/file"]';
/** A link whose file is gone (chatCitationMarks.ts) has nothing to show. */
const BROKEN = 'parallx-chat-link--broken';
const HOVER_DELAY_MS = 300;
const LEAVE_GRACE_MS = 120;
/** The most room a piece is given; less in a small window. */
const PIECE_MAX_WIDTH = 540;
const PIECE_MAX_HEIGHT = 420;
/** The card is never narrower than this: its first line names the file. */
const CARD_MIN_WIDTH = 280;

let _workspaceRoot: (() => string | undefined) | undefined;

/** Install (or clear) where workspace paths in a link start: the open folder. */
export function setCitationPeekRoot(root: (() => string | undefined) | undefined): void {
  _workspaceRoot = root;
}

export interface ICitationPlace {
  /** The file, as the link names it. */
  readonly path: string;
  /** The file on disk; undefined when the link's path cannot be placed. */
  readonly fsPath: string | undefined;
  readonly page?: number;
  readonly quote: string;
}

/**
 * What a link cites, when it cites a place a piece can be shown of: a PDF or
 * a picture of a page, with a quote. Anything else has no card.
 */
export function citationPlace(href: string, root: string | undefined): ICitationPlace | null {
  const at = href.indexOf('?');
  if (at < 0 || !href.startsWith('parallx://explorer/file')) return null;
  const params = new URLSearchParams(href.slice(at + 1));
  const path = (params.get('path') ?? '').replace(/\\/g, '/');
  const quote = (params.get('quote') ?? '').replace(/\s+/g, ' ').trim();
  if (!path || !quote || !(/\.pdf$/i.test(path) || isPicturePath(path))) return null;
  const page = Number(params.get('page'));
  const absolute = /^[a-zA-Z]:\//.test(path);
  const climbs = path.split('/').some((s) => s === '..');
  const fsPath = absolute ? path : climbs || !root ? undefined : `${root.replace(/[\\/]+$/, '')}/${path.replace(/^(\.\/)+/, '').replace(/^\/+/, '')}`;
  return { path, fsPath, quote, ...(Number.isInteger(page) && page > 0 ? { page } : {}) };
}

let seq = 0;

/**
 * Show a card for the citation links under `container` (the chat's message
 * list). Returns what takes the listeners and any open card away.
 */
export function attachCitationPeek(container: HTMLElement): IDisposable {
  let card: HTMLElement | null = null;
  let shownFor: HTMLAnchorElement | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** What listens only while a card is open: Escape, a press elsewhere, a scroll, a press on the card's own way in. */
  let whileOpen: IDisposable[] = [];
  const doc = container.ownerDocument;
  const modality = (): string => doc.documentElement.dataset.inputModality ?? 'pointer';
  const linkOf = (target: EventTarget | null): HTMLAnchorElement | null =>
    target instanceof Element ? target.closest<HTMLAnchorElement>(LINKS) : null;
  const citedBy = (link: HTMLAnchorElement): ICitationPlace | null =>
    link.classList.contains(BROKEN) ? null : citationPlace(link.getAttribute('href') ?? '', _workspaceRoot?.());
  const wait = (ms: number, then: () => void): void => { if (timer) clearTimeout(timer); timer = setTimeout(() => { timer = null; then(); }, ms); };

  const hide = (): void => {
    if (timer) { clearTimeout(timer); timer = null; }
    for (const l of whileOpen) l.dispose();
    whileOpen = [];
    shownFor?.removeAttribute('aria-describedby');
    shownFor = null;
    card?.remove();
    card = null;
  };

  const place = (link: HTMLAnchorElement): void => {
    if (!card) return;
    const r = link.getBoundingClientRect();
    const view = { w: doc.documentElement.clientWidth, h: doc.documentElement.clientHeight };
    const size = { w: card.offsetWidth, h: card.offsetHeight };
    const left = Math.max(8, Math.min(r.left, view.w - size.w - 8));
    // Under the link when there is room, over it otherwise.
    const below = r.bottom + 6 + size.h <= view.h - 8 || r.top - 6 - size.h < 8;
    card.style.left = `${Math.round(left)}px`;
    card.style.top = `${Math.round(below ? r.bottom + 6 : r.top - 6 - size.h)}px`;
  };

  const show = (link: HTMLAnchorElement, withWayIn: boolean): void => {
    const cited = citedBy(link);
    if (!cited) return;
    hide();
    shownFor = link;
    const name = cited.path.split('/').pop() || cited.path;
    const mine = card = createBlock(doc.body, 'div', { className: 'parallx-cite-peek', attrs: { role: 'tooltip', id: `parallx-cite-peek-${++seq}` } });
    link.setAttribute('aria-describedby', mine.id);
    createBlock(mine, 'div', { className: 'parallx-cite-peek__where', text: cited.page ? `${name}, page ${cited.page}` : name });
    const body = createBlock(mine, 'div', { className: 'parallx-cite-peek__body' });
    createBlock(body, 'p', { className: 'parallx-cite-peek__wait', text: 'Finding the place…', attrs: { 'aria-hidden': 'true' } });
    const spoken = createBlock(mine, 'span', { className: 'px-visually-hidden', text: `It rests on: ${cited.quote}` });
    if (withWayIn) createLink(mine, { id: null, href: link.getAttribute('href') ?? '', label: 'Open At This Place', external: false, className: 'parallx-cite-peek__open' });
    place(link);

    whileOpen = [
      addDisposableListener(doc, 'keydown', (e) => { if ((e as KeyboardEvent).key === 'Escape') hide(); }),
      addDisposableListener(doc, 'pointerdown', (e) => {
        if (!(e.target instanceof Node) || mine.contains(e.target) || link.contains(e.target)) return;
        hide();
      }, true),
      addDisposableListener(container, 'scroll', hide, true),
      // The card's own way in was taken: the app opens the place, the card goes.
      addDisposableListener(mine, 'click', () => wait(0, hide)),
    ];

    const view = { w: doc.documentElement.clientWidth, h: doc.documentElement.clientHeight };
    const limits = { maxWidth: Math.max(CARD_MIN_WIDTH, Math.min(PIECE_MAX_WIDTH, view.w - 40)), maxHeight: Math.max(160, Math.min(PIECE_MAX_HEIGHT, Math.round(view.h * 0.55))) };
    const piece = cited.fsPath ? pieceOfPage(cited.fsPath, cited, limits) : Promise.resolve(null);
    void piece.then((p) => {
      if (card !== mine) return;
      body.replaceChildren();
      if (!p) {
        // No picture: the words themselves, to read.
        spoken.remove();
        createBlock(body, 'p', { className: 'parallx-cite-peek__quote', text: `“${cited.quote}”` });
      } else {
        // The card takes the width of its piece: what the card adds round it is measured, not assumed.
        const round = mine.offsetWidth - body.clientWidth;
        p.parts.forEach((part, i) => {
          // Between a table's heading and the rows the quote is in: the rows left out.
          if (i > 0) createBlock(body, 'div', { className: 'parallx-cite-peek__skip', attrs: { 'aria-hidden': 'true' } });
          createBlock(body, 'img', { className: 'parallx-cite-peek__piece', attrs: { src: part.url, alt: '', width: String(part.width), height: String(part.height) } });
        });
        mine.style.width = `${Math.max(CARD_MIN_WIDTH, Math.max(...p.parts.map((part) => part.width)) + round)}px`;
        if (p.name) spoken.textContent = `${p.name}. It rests on: ${cited.quote}`;
      }
      place(link);
    });
  };

  const listeners: IDisposable[] = [
    // A mouse: over the link for a moment.
    addDisposableListener(container, 'pointerover', (e) => {
      const link = linkOf(e.target);
      if (!link || (e as PointerEvent).pointerType !== 'mouse' || link === shownFor) return;
      wait(HOVER_DELAY_MS, () => show(link, false));
    }),
    addDisposableListener(container, 'pointerout', (e) => {
      const link = linkOf(e.target);
      if (!link || (e as PointerEvent).pointerType !== 'mouse') return;
      const to = (e as PointerEvent).relatedTarget;
      if (to instanceof Node && link.contains(to)) return;
      wait(LEAVE_GRACE_MS, hide);
    }),
    // The keyboard: the link has the focus.
    addDisposableListener(container, 'focusin', (e) => {
      const link = linkOf(e.target);
      if (link && modality() === 'keyboard') show(link, false);
    }),
    addDisposableListener(container, 'focusout', (e) => { if (linkOf(e.target) === shownFor && modality() !== 'touch') hide(); }),
    addDisposableListener(container, 'click', (e) => {
      const link = linkOf(e.target);
      if (!link) return;
      // A finger: the first press shows the card, the second goes there.
      if (modality() === 'touch' && link !== shownFor && citedBy(link)) { e.preventDefault(); show(link, true); return; }
      // The link is being followed: the card has done its work.
      hide();
    }),
  ];

  return { dispose: () => { hide(); for (const l of listeners) l.dispose(); } };
}
