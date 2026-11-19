// @vitest-environment jsdom
// quickPickMany.test.ts — the core quick pick of several (canPickMany): each
// row a checkbox a screen reader hears as selected or not, a search that finds
// every word typed in the label and, when asked, the description, ticks kept
// while the search changes, the dialog's own Cancel and confirming button,
// Tab kept inside, Escape cancels and gives focus back.

import { describe, it, expect, afterEach } from 'vitest';
import { scene } from '../../src/ui/scene.js';
import { showQuickPickModal } from '../../src/api/notificationService.js';
import { acceptQuickPickMany, cancelQuickPickMany } from '../../src/api/quickPickMany.js';

const settle = () => new Promise<void>((r) => setTimeout(r, 20));
const key = (k: string, shift = false) => {
  const e = new KeyboardEvent('keydown', { key: k, shiftKey: shift, bubbles: true, cancelable: true });
  (document.activeElement ?? document.body).dispatchEvent(e);
  return e;
};
const opener = () => { const b = document.createElement('button'); b.textContent = 'Add Notes or Files…'; document.body.appendChild(b); b.focus(); return b; };
const rows = () => Array.from(document.querySelectorAll<HTMLElement>('[role=option]'));
const labels = () => rows().map((r) => r.querySelector('.parallx-quickpick-label')?.textContent);
const search = (text: string) => { const input = document.querySelector('[role=dialog] input') as HTMLInputElement; input.value = text; input.dispatchEvent(new Event('input')); };
const button = (text: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('[role=dialog] button')).find((b) => b.textContent === text)!;

const ITEMS = [
  { label: 'Mack 1993.pdf', description: 'Readings · Week 1' },
  { label: 'Clark.md' },
  { label: 'Mack and Clark Compared', description: 'Page' },
  { label: 'Siewert.png' },
];

afterEach(() => { document.body.innerHTML = ''; scene.reset(); });

describe('a quick pick of several', () => {
  it('shows a checkbox per row, ticks by a click, keeps the ticks while the search changes, and answers with the ticked ones', async () => {
    opener();
    const answer = showQuickPickModal(document.body, ITEMS, { placeholder: 'Find pages and files', canPickMany: true, matchOnDescription: true, confirmLabel: 'Attach' });
    await settle();
    expect(document.querySelector('[role=listbox]')?.getAttribute('aria-multiselectable')).toBe('true');
    expect(rows().every((r) => r.getAttribute('aria-selected') === 'false')).toBe(true);
    expect(button('Attach').disabled).toBe(true);
    search('clark');
    expect(labels()).toEqual(['Clark.md', 'Mack and Clark Compared']);
    rows()[0]!.click();
    expect(rows()[0]!.getAttribute('aria-selected')).toBe('true');
    search('week 1');
    expect(labels()).toEqual(['Mack 1993.pdf']);
    rows()[0]!.click();
    search('');
    expect(rows().filter((r) => r.getAttribute('aria-selected') === 'true').map((r) => r.querySelector('.parallx-quickpick-label')?.textContent)).toEqual(['Mack 1993.pdf', 'Clark.md']);
    expect(document.querySelector('.parallx-quickpick-count')?.textContent).toBe('2 chosen');
    acceptQuickPickMany();
    expect((await answer as { label: string }[]).map((i) => i.label)).toEqual(['Mack 1993.pdf', 'Clark.md']);
  });

  it('finds every word typed, in the label only unless the description is asked for', async () => {
    const answer = showQuickPickModal(document.body, ITEMS, { canPickMany: true });
    await settle();
    search('week');
    expect(labels()).toEqual([]);
    expect(document.querySelector('.parallx-quickpick-more')?.textContent).toBe('Nothing matches.');
    search('mack clark');
    expect(labels()).toEqual(['Mack and Clark Compared']);
    key('Escape');
    expect(await answer).toBeUndefined();
  });

  it('is a dialog for the keyboard: Tab stays inside, Space ticks in the list, Enter confirms, Escape gives the focus back', async () => {
    const back = opener();
    const answer = showQuickPickModal(document.body, ITEMS, { placeholder: 'Pick', canPickMany: true, confirmLabel: 'Attach' });
    await settle();
    const dialog = document.querySelector('[role=dialog]') as HTMLElement;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement?.tagName).toBe('INPUT');
    expect(key('Tab').defaultPrevented || dialog.contains(document.activeElement)).toBe(true);
    (document.querySelector('[role=dialog] input') as HTMLElement).focus();
    key('ArrowDown');
    expect(document.activeElement?.getAttribute('role')).toBe('listbox');
    key('ArrowDown');
    key(' ');
    expect(rows()[1]!.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement?.getAttribute('aria-activedescendant')).toBe(rows()[1]!.id);
    key('Enter');
    expect((await answer as { label: string }[]).map((i) => i.label)).toEqual(['Clark.md']);
    expect(document.activeElement).toBe(back);

    const again = showQuickPickModal(document.body, ITEMS, { canPickMany: true });
    await settle();
    expect(dialog.isConnected).toBe(false);
    key('Escape');
    expect(await again).toBeUndefined();
    expect(document.activeElement).toBe(back);
  });

  it('closes on Escape even when the focus fell behind it, and gives it back', async () => {
    const back = opener();
    const answer = showQuickPickModal(document.body, ITEMS, { canPickMany: true });
    await settle();
    (document.activeElement as HTMLElement).blur();
    expect(document.activeElement).toBe(document.body);
    key('Escape');
    expect(await answer).toBeUndefined();
    expect(document.activeElement).toBe(back);
  });

  it('draws at most 200 rows and says how many more the search would show', async () => {
    const many = Array.from({ length: 230 }, (_, i) => ({ label: `Bulk ${i}` }));
    const answer = showQuickPickModal(document.body, many, { canPickMany: true });
    await settle();
    expect(rows()).toHaveLength(200);
    expect(document.querySelector('.parallx-quickpick-more')?.textContent).toBe('30 more. Type to narrow the list.');
    cancelQuickPickMany();
    expect(await answer).toBeUndefined();
  });

  it('keeps a single pick as it was: no checkboxes, no buttons', async () => {
    const answer = showQuickPickModal(document.body, ITEMS, { placeholder: 'One' });
    await settle();
    expect(document.querySelector('.parallx-quickpick-check')).toBeNull();
    expect(document.querySelector('[role=dialog] button')).toBeNull();
    key('Escape');
    expect(await answer).toBeUndefined();
  });
});
