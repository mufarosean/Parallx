// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { renderMarkdownToDom } from '../../src/built-in/dashboard/widgets/markdownRenderer';

/** Render markdown into a detached container so we can query the result. */
function render(md: string): HTMLDivElement {
  const div = document.createElement('div');
  div.appendChild(renderMarkdownToDom(md));
  return div;
}

describe('renderMarkdownToDom — ordered lists', () => {
  it('renders a tight ordered list as one <ol> with sequential items', () => {
    const out = render('1. First\n2. Second\n3. Third');
    const lists = out.querySelectorAll('ol');
    expect(lists.length).toBe(1);
    expect([...lists[0].querySelectorAll('li')].map(li => li.textContent)).toEqual([
      'First',
      'Second',
      'Third',
    ]);
  });

  // The reported bug: an AI brief with a blank line between each numbered item
  // used to render as three separate <ol>s, each restarting at "1.".
  it('coalesces a loose ordered list (blank lines between items) into one <ol>', () => {
    const out = render('1. First\n\n2. Second\n\n3. Third');
    const lists = out.querySelectorAll('ol');
    expect(lists.length).toBe(1);
    expect(lists[0].querySelectorAll('li').length).toBe(3);
  });

  it('coalesces a loose unordered list into one <ul>', () => {
    const out = render('- One\n\n- Two\n\n- Three');
    expect(out.querySelectorAll('ul').length).toBe(1);
    expect(out.querySelectorAll('li').length).toBe(3);
  });

  it('honors a starting number other than 1', () => {
    const out = render('3. Third\n\n4. Fourth');
    const ol = out.querySelector('ol')!;
    expect(ol.start).toBe(3);
    expect(ol.querySelectorAll('li').length).toBe(2);
  });

  it('keeps start at the default for lists that begin at 1', () => {
    const out = render('1. First\n2. Second');
    // Unset `start` reflects as 1 in the DOM; importantly we don't force the attribute.
    expect(out.querySelector('ol')!.hasAttribute('start')).toBe(false);
  });

  it('does not merge across a non-list block (heading closes the list)', () => {
    const out = render('1. First\n\n## Break\n\n1. Restart');
    expect(out.querySelectorAll('ol').length).toBe(2);
  });

  it('does not merge an ordered list into a preceding unordered list', () => {
    const out = render('- Bullet\n\n1. Number');
    expect(out.querySelectorAll('ul').length).toBe(1);
    expect(out.querySelectorAll('ol').length).toBe(1);
  });

  it('preserves inline links inside loose list items', () => {
    const out = render('1. Story one [src](https://example.com/a)\n\n2. Story two [src](https://example.com/b)');
    const links = out.querySelectorAll('ol li a');
    expect(links.length).toBe(2);
    expect((links[0] as HTMLAnchorElement).href).toBe('https://example.com/a');
  });
});
