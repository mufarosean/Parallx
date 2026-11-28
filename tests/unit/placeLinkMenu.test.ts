// @vitest-environment jsdom
// placeLinkMenu.test.ts — the kit's place link (src/ui/link.ts): Ctrl+click
// opens the place in a tab of its own in place of the element's own press;
// its context menu is the place link's, unless `menu: false`, when a row with
// actions of its own keeps its menu (Study's subject and unit rows).
import { describe, it, expect } from 'vitest';
import { bindPlaceLink, installPlaceOpener } from '../../src/ui/link.js';

const opened: [string, boolean][] = [];
installPlaceOpener(async (address, o) => { opened.push([address, !!o?.newTab]); return true; });

function row() {
  const parent = document.createElement('div');
  const el = document.createElement('button');
  parent.appendChild(el);
  document.body.appendChild(parent);
  let own = 0, menus = 0;
  el.addEventListener('click', () => { own++; });
  parent.addEventListener('contextmenu', () => { menus++; });
  return { el, own: () => own, menus: () => menus };
}

describe('place links', () => {
  it('Ctrl+click opens the place in a tab of its own instead of the element\'s press', () => {
    const r = row();
    bindPlaceLink(r.el, 'parallx://place/study/home');
    r.el.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    expect(opened.at(-1)).toEqual(['parallx://place/study/home', true]);
    expect(r.own()).toBe(0);
    r.el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(r.own()).toBe(1);
  });

  it('takes the context menu, unless told the row keeps its own', () => {
    const a = row();
    bindPlaceLink(a.el, 'parallx://place/study/home');
    a.el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(a.menus()).toBe(0);
    const b = row();
    const d = bindPlaceLink(b.el, 'parallx://place/study/weak', { menu: false });
    b.el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(b.menus()).toBe(1);
    b.el.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }));
    expect(opened.at(-1)).toEqual(['parallx://place/study/weak', true]);
    d.dispose();
    b.el.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    expect(b.own()).toBe(1);
  });
});
