// @vitest-environment jsdom
// imageQuoteReveal.test.ts — a link's quote lights up on a picture of a page:
// the lines the document reader found it on are washed where they are.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImageQuoteReveal } from '../../src/editor/panes/imageQuoteReveal';
import { _clearFileRevealsForTest, requestFileReveal } from '../../src/editor/fileReveal';

const PATH = 'D:/scans/page.jpg';
const READING = { version: 1, ocr: true, blocks: [], tables: [], pages: [{ page: 1, width: 1200, height: 1600, lines: [
  { text: 'Chapter 7: Reserving', box: [120, 160, 720, 200] },
  { text: 'The ultimate loss is not the same', box: [120, 400, 960, 440] },
  { text: 'as the expected loss.', box: [120, 480, 600, 520] },
] }] };

function setup(reading: unknown = READING) {
  (globalThis as { parallxElectron?: unknown }).parallxElectron = { docling: { reading: vi.fn(async () => reading) } };
  const scroller = document.createElement('div');
  const wrapper = scroller.appendChild(document.createElement('div'));
  const image = wrapper.appendChild(document.createElement('img'));
  document.body.appendChild(scroller);
  // The picture as laid out: 600 x 800 at (40, 20) in its wrapper (jsdom lays nothing out).
  for (const [k, v] of Object.entries({ offsetLeft: 40, offsetTop: 20, offsetWidth: 600, offsetHeight: 800 })) Object.defineProperty(image, k, { value: v });
  image.style.transform = 'scale(1)';
  image.style.transformOrigin = 'center center';
  Element.prototype.scrollIntoView = vi.fn();
  const reveal = new ImageQuoteReveal({ image: () => image, wrapper: () => wrapper, scroller: () => scroller });
  return { reveal, scroller, wrapper, image, layer: () => wrapper.querySelector('.image-quote-layer') as HTMLElement | null };
}

afterEach(() => { _clearFileRevealsForTest(); delete (globalThis as { parallxElectron?: unknown }).parallxElectron; document.body.innerHTML = ''; });

describe('a quote on a picture of a page', () => {
  it('washes the lines that hold it, laid over the picture where they are', async () => {
    const s = setup();
    requestFileReveal(PATH, { quote: 'the ultimate loss is not the same as the expected loss' });
    await s.reveal.apply(PATH);
    const layer = s.layer()!;
    expect([layer.style.left, layer.style.top, layer.style.width, layer.style.height]).toEqual(['40px', '20px', '600px', '800px']);
    expect(layer.getAttribute('aria-hidden')).toBe('true');
    const washes = [...layer.children] as HTMLElement[];
    expect(washes).toHaveLength(2);
    expect([washes[0].style.left, washes[0].style.top, washes[0].style.width, washes[0].style.height]).toEqual(['10%', '25%', '70%', '2.5%']);
    expect(washes[1].style.top).toBe('30%');
  });

  it('follows the picture when it is zoomed', async () => {
    const s = setup();
    requestFileReveal(PATH, { quote: 'Chapter 7: Reserving' });
    await s.reveal.apply(PATH);
    s.image.style.transform = 'scale(2.5)';
    s.reveal.layout();
    expect(s.layer()!.style.transform).toBe('scale(2.5)');
    expect(s.wrapper.querySelectorAll('.image-quote-layer')).toHaveLength(1);
  });

  it('stays until the next press in the view', async () => {
    const s = setup();
    requestFileReveal(PATH, { quote: 'Chapter 7: Reserving' });
    await s.reveal.apply(PATH);
    expect(s.layer()).not.toBeNull();
    s.scroller.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(s.layer()).toBeNull();
    s.reveal.layout();
    expect(s.layer()).toBeNull();
  });

  it('does nothing with no link waiting, no quote on the picture, or no reading of it', async () => {
    const s = setup();
    await s.reveal.apply(PATH);                                   // opened from the explorer: no link
    expect(s.layer()).toBeNull();
    requestFileReveal(PATH, { quote: 'Bornhuetter and Ferguson' }); // words that are not on it
    await s.reveal.apply(PATH);
    expect(s.layer()).toBeNull();
    const unread = setup(null);
    requestFileReveal(PATH, { quote: 'Chapter 7: Reserving' });
    await unread.reveal.apply(PATH);
    expect(unread.layer()).toBeNull();
    await unread.reveal.apply(undefined);                         // a pasted image has no file
  });

  it('a link is taken once: opening the picture again later lights nothing', async () => {
    const s = setup();
    requestFileReveal(PATH, { quote: 'Chapter 7: Reserving' });
    await s.reveal.apply(PATH);
    s.reveal.clear();
    await s.reveal.apply(PATH);
    expect(s.layer()).toBeNull();
  });
});
