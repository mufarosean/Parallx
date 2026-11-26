// @vitest-environment jsdom
// chatSourceMarks.test.ts — a numbered source mark in an answer: the number
// alone (its outlined box is the stylesheet's), named for a screen reader,
// and pressed by the keys as well as the mouse (it was mouse-only).
import { describe, expect, it } from 'vitest';
import { renderContentPart } from '../../src/built-in/chat/rendering/chatContentParts';
import { ChatContentPartKind } from '../../src/services/chatTypes';

describe('a numbered source mark', () => {
  const part = { kind: ChatContentPartKind.Markdown, content: 'Mack estimates the variance [1] and the weights [2]. A stray [9] stays text.',
    citations: [{ index: 1, uri: 'parallx-page://page-1', label: 'Mack notes' }, { index: 2, uri: 'file:///w/mack.pdf', label: 'Mack 1994, p. 214' }] };

  it('is the number alone, named with its source, and a Tab stop', () => {
    const el = renderContentPart(part as never);
    document.body.appendChild(el);
    const marks = [...el.querySelectorAll<HTMLElement>('.parallx-citation-badge')];
    expect(marks.map((m) => m.textContent)).toEqual(['1', '2']);
    expect(marks.map((m) => m.getAttribute('aria-label'))).toEqual(['Source 1: Mack notes', 'Source 2: Mack 1994, p. 214']);
    expect(marks.every((m) => m.tabIndex === 0 && m.getAttribute('role') === 'link')).toBe(true);
    // A number with no source behind it is left as the text it was.
    expect(el.textContent).toContain('[9]');
    el.remove();
  });

  it('goes to its source on Enter and on Space, as on a click', () => {
    const el = renderContentPart(part as never);
    document.body.appendChild(el);
    const seen: string[] = [];
    el.addEventListener('parallx:navigate-page', (e) => seen.push((e as CustomEvent).detail.pageId));
    const mark = el.querySelector<HTMLElement>('.parallx-citation-badge')!;
    mark.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    mark.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    mark.click();
    mark.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(seen).toEqual(['page-1', 'page-1', 'page-1']);
    el.remove();
  });
});
