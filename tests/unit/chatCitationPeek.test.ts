// @vitest-environment jsdom
// chatCitationPeek.test.ts — a citation shows the piece of the page it rests
// on: pointed at, focused from the keyboard, or pressed with a finger.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pieceOfPage = vi.fn();
vi.mock('../../src/services/pagePicture', () => ({ pieceOfPage: (...args: unknown[]) => pieceOfPage(...args) }));

import { attachCitationPeek, citationPlace, setCitationPeekRoot } from '../../src/built-in/chat/rendering/chatCitationPeek';

const HREF = 'parallx://explorer/file?path=Papers%2FClark.pdf&page=13&quote=120+1.05+1.02';
const PIECE = { parts: [{ url: 'data:image/jpeg;base64,AAAA', width: 364, height: 144 }], what: 'table' as const, name: 'Table 3' };

function setup() {
  const list = document.createElement('div');
  list.innerHTML = `<p>The paid factor is 1.05 (<a id="cite" href="${HREF}">Clark.pdf, page 13</a>). See also <a id="page" href="parallx://explorer/file?path=Papers%2FClark.pdf&amp;page=2">page 2</a> and <a id="web" href="https://example.org">a site</a>.</p>`;
  document.body.appendChild(list);
  const peek = attachCitationPeek(list);
  const link = list.querySelector('#cite') as HTMLAnchorElement;
  const over = (el: Element, type = 'pointerover') => { const e = new Event(type, { bubbles: true }); Object.assign(e, { pointerType: 'mouse', relatedTarget: null }); el.dispatchEvent(e); };
  return { list, peek, link, over, card: () => document.querySelector('.parallx-cite-peek') as HTMLElement | null };
}

beforeEach(() => { vi.useFakeTimers(); pieceOfPage.mockReset(); pieceOfPage.mockResolvedValue(PIECE); setCitationPeekRoot(() => 'D:/Work'); document.documentElement.dataset.inputModality = 'pointer'; });
afterEach(() => { vi.useRealTimers(); setCitationPeekRoot(undefined); document.body.innerHTML = ''; });

describe('citationPlace', () => {
  it('reads the file, the page and the quote from a link to a PDF or a picture of a page', () => {
    expect(citationPlace(HREF, 'D:/Work')).toEqual({ path: 'Papers/Clark.pdf', fsPath: 'D:/Work/Papers/Clark.pdf', page: 13, quote: '120 1.05 1.02' });
    expect(citationPlace('parallx://explorer/file?path=Scans%2Fpage.jpg&quote=The+Bondy+method', 'D:\\Work\\')).toEqual({ path: 'Scans/page.jpg', fsPath: 'D:\\Work/Scans/page.jpg', quote: 'The Bondy method' });
    expect(citationPlace('parallx://explorer/file?path=C%3A%2Fpapers%2Fa.pdf&page=1&quote=some+words', undefined)?.fsPath).toBe('C:/papers/a.pdf');
  });

  it('has no place for a link with no quote, another kind of file, or another kind of link', () => {
    expect(citationPlace('parallx://explorer/file?path=Papers%2FClark.pdf&page=2', 'D:/Work')).toBeNull();
    expect(citationPlace('parallx://explorer/file?path=notes.md&line=4&quote=some+words', 'D:/Work')).toBeNull();
    expect(citationPlace('parallx://canvas/page?id=abc&quote=some+words', 'D:/Work')).toBeNull();
    expect(citationPlace('https://example.org/?path=a.pdf&quote=x', 'D:/Work')).toBeNull();
  });

  it('cannot place a path that climbs out of the workspace, or any workspace path with no folder open', () => {
    expect(citationPlace('parallx://explorer/file?path=..%2Fsecret.pdf&page=1&quote=some+words', 'D:/Work')?.fsPath).toBeUndefined();
    expect(citationPlace(HREF, undefined)?.fsPath).toBeUndefined();
  });
});

describe('pointing at a citation', () => {
  it('shows its card after a moment: the file and page, then the piece of the page', async () => {
    const s = setup();
    s.over(s.link);
    expect(s.card()).toBeNull();
    await vi.advanceTimersByTimeAsync(350);
    const card = s.card()!;
    expect(card.getAttribute('role')).toBe('tooltip');
    expect(s.link.getAttribute('aria-describedby')).toBe(card.id);
    expect(card.querySelector('.parallx-cite-peek__where')!.textContent).toBe('Clark.pdf, page 13');
    expect(pieceOfPage).toHaveBeenCalledWith('D:/Work/Papers/Clark.pdf', expect.objectContaining({ page: 13, quote: '120 1.05 1.02' }), expect.objectContaining({ maxWidth: expect.any(Number), maxHeight: expect.any(Number) }));
    const img = card.querySelector('img.parallx-cite-peek__piece') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe(PIECE.parts[0].url);
    expect([img.getAttribute('width'), img.getAttribute('height')]).toEqual(['364', '144']); // the size the piece asks to be shown at
    expect(card.style.width).toBe('364px'); // the card takes its piece's width
    expect(card.querySelector('.px-visually-hidden')!.textContent).toBe('Table 3. It rests on: 120 1.05 1.02');
    expect(card.querySelector('a')).toBeNull(); // the link itself is the way in
  });

  it('tells a screen reader the words at once, before any picture, and keeps the wait out of what is read', async () => {
    let arrive: (p: unknown) => void = () => {};
    pieceOfPage.mockReturnValue(new Promise((resolve) => { arrive = resolve; }));
    const s = setup();
    s.over(s.link);
    await vi.advanceTimersByTimeAsync(350);
    const card = s.card()!;
    expect(card.querySelector('.px-visually-hidden')!.textContent).toBe('It rests on: 120 1.05 1.02');
    expect(card.querySelector('.parallx-cite-peek__wait')!.getAttribute('aria-hidden')).toBe('true');
    arrive(PIECE);
    await vi.advanceTimersByTimeAsync(0);
    expect(card.querySelector('.parallx-cite-peek__wait')).toBeNull();
    expect(card.querySelector('.px-visually-hidden')!.textContent).toBe('Table 3. It rests on: 120 1.05 1.02');
  });

  it('shows a tall table as its heading and the rows the quote is in, with a mark where rows were left out', async () => {
    pieceOfPage.mockResolvedValue({ parts: [{ url: 'data:image/jpeg;base64,HEAD', width: 500, height: 60 }, { url: 'data:image/jpeg;base64,ROWS', width: 500, height: 300 }], what: 'table', name: 'Table 3' });
    const s = setup();
    s.over(s.link);
    await vi.advanceTimersByTimeAsync(350);
    const body = s.card()!.querySelector('.parallx-cite-peek__body')!;
    expect(Array.from(body.children).map((c) => c.className)).toEqual(['parallx-cite-peek__piece', 'parallx-cite-peek__skip', 'parallx-cite-peek__piece']);
    expect(body.querySelector('.parallx-cite-peek__skip')!.getAttribute('aria-hidden')).toBe('true');
    expect(s.card()!.style.width).toBe('500px');
  });

  it('goes when its link is followed', async () => {
    const s = setup();
    s.over(s.link);
    await vi.advanceTimersByTimeAsync(350);
    expect(s.card()).not.toBeNull();
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    s.link.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(false);
    expect(s.card()).toBeNull();
  });

  it('has no card for a citation whose file is gone', async () => {
    const s = setup();
    s.link.classList.add('parallx-chat-link--broken');
    s.over(s.link);
    await vi.advanceTimersByTimeAsync(500);
    expect(s.card()).toBeNull();
  });

  it('goes when the pointer leaves, and never shows for a pointer that only passed over', async () => {
    const s = setup();
    s.over(s.link);
    s.over(s.link, 'pointerout');
    await vi.advanceTimersByTimeAsync(500);
    expect(s.card()).toBeNull();
    s.over(s.link);
    await vi.advanceTimersByTimeAsync(350);
    s.over(s.link, 'pointerout');
    await vi.advanceTimersByTimeAsync(200);
    expect(s.card()).toBeNull();
    expect(s.link.hasAttribute('aria-describedby')).toBe(false);
  });

  it('says where in words when no piece can be made', async () => {
    pieceOfPage.mockResolvedValue(null);
    const s = setup();
    s.over(s.link);
    await vi.advanceTimersByTimeAsync(350);
    expect(s.card()!.querySelector('img')).toBeNull();
    expect(s.card()!.querySelector('.parallx-cite-peek__quote')!.textContent).toBe('\u201C120 1.05 1.02\u201D');
    expect(s.card()!.querySelector('.px-visually-hidden')).toBeNull(); // the words are there to read: not said twice
  });

  it('has no card for a link with no quote, or a link that is not a citation', async () => {
    const s = setup();
    s.over(s.list.querySelector('#page')!);
    s.over(s.list.querySelector('#web')!);
    await vi.advanceTimersByTimeAsync(500);
    expect(s.card()).toBeNull();
  });
});

describe('the keyboard and a finger', () => {
  it('shows the card when the keyboard brings the focus to a citation, and takes it away when the focus leaves or on Escape', async () => {
    const s = setup();
    document.documentElement.dataset.inputModality = 'keyboard';
    s.link.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(0);
    expect(s.card()).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(s.card()).toBeNull();
    s.link.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    s.link.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    expect(s.card()).toBeNull();
  });

  it('a finger\'s first press shows the card with the way in; the second press on the link goes there', async () => {
    const s = setup();
    document.documentElement.dataset.inputModality = 'touch';
    const first = new MouseEvent('click', { bubbles: true, cancelable: true });
    s.link.dispatchEvent(first);
    expect(first.defaultPrevented).toBe(true); // the app's link handler leaves a prevented click alone
    await vi.advanceTimersByTimeAsync(0);
    const way = s.card()!.querySelector('a.parallx-cite-peek__open') as HTMLAnchorElement;
    expect(way.textContent).toBe('Open At This Place');
    expect(way.getAttribute('href')).toBe(HREF);
    const second = new MouseEvent('click', { bubbles: true, cancelable: true });
    s.link.dispatchEvent(second);
    expect(second.defaultPrevented).toBe(false);
    expect(s.card()).toBeNull(); // it is being followed
  });

  it('a press on the card\'s own way in is left to the app, and the card goes', async () => {
    const s = setup();
    document.documentElement.dataset.inputModality = 'touch';
    s.link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await vi.advanceTimersByTimeAsync(0);
    const way = s.card()!.querySelector('a.parallx-cite-peek__open') as HTMLAnchorElement;
    // The app's own handler for its links: on the document, and it leaves a prevented click alone.
    const opened: string[] = [];
    const app = (e: Event): void => { const a = (e.target as Element).closest('a[href^="parallx://"]'); if (a && !e.defaultPrevented) { opened.push(a.getAttribute('href')!); e.preventDefault(); } };
    document.addEventListener('click', app);
    way.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    document.removeEventListener('click', app);
    expect(opened).toEqual([HREF]);
    await vi.advanceTimersByTimeAsync(0);
    expect(s.card()).toBeNull();
  });

  it('listens on the document only while a card is open', async () => {
    const added = vi.spyOn(document, 'addEventListener');
    const removed = vi.spyOn(document, 'removeEventListener');
    const s = setup();
    expect(added).not.toHaveBeenCalled();
    document.documentElement.dataset.inputModality = 'keyboard';
    s.link.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    const while_open = added.mock.calls.map((c) => c[0]).sort();
    expect(while_open).toEqual(['keydown', 'pointerdown']);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(removed.mock.calls.map((c) => c[0]).sort()).toEqual(['keydown', 'pointerdown']);
    added.mockRestore(); removed.mockRestore();
  });

  it('a mouse click on a citation is never held back', () => {
    const s = setup();
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    s.link.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(false);
  });

  it('a press elsewhere takes a finger\'s card away; dispose takes everything', async () => {
    const s = setup();
    document.documentElement.dataset.inputModality = 'touch';
    s.link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(s.card()).not.toBeNull();
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(s.card()).toBeNull();
    s.link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    s.peek.dispose();
    expect(s.card()).toBeNull();
    const after = new MouseEvent('click', { bubbles: true, cancelable: true });
    s.link.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });
});
