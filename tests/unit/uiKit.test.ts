// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { createButton, createEmptyState, createFilterChip, createIconButton, createPageHeader, createSectionLabel, createSegmented } from '../../src/ui/kit';

describe('ui kit — the one set of chrome components', () => {
  it('a button carries its kind and size as classes, secondary/md by default', () => {
    const host = document.createElement('div');
    const b = createButton(host, { label: 'Save' });
    expect(b.parentElement).toBe(host);
    expect(b.className).toBe('px-btn px-btn--secondary');
    expect(b.type).toBe('button');
    const p = createButton(null, { label: 'Go', kind: 'primary', size: 'sm' });
    expect(p.className).toBe('px-btn px-btn--primary px-btn--sm');
    expect(p.parentElement).toBeNull();
  });

  it('an icon button always has words: its title is the tooltip and aria-label', () => {
    const b = createIconButton(null, { icon: 'settings', title: 'Settings' });
    expect(b.title).toBe('Settings');
    expect(b.getAttribute('aria-label')).toBe('Settings');
    expect(b.classList.contains('px-btn--icon')).toBe(true);
    expect(b.textContent).toBe('');
  });

  it('a page header shows one primary and at most two secondary; the rest overflow into ⋯', () => {
    const run = vi.fn();
    const header = createPageHeader(null, {
      title: 'Budget',
      primary: { label: 'Sync Now', onClick: run },
      secondary: [
        { label: 'Refresh', onClick: () => {} },
        { label: 'Export', onClick: () => {} },
        { label: 'Import', onClick: () => {} },
        { label: 'Reset', onClick: () => {} },
      ],
    });
    const buttons = [...header.querySelectorAll('.px-page-header__actions > button')];
    const worded = buttons.filter((b) => !b.classList.contains('px-btn--icon'));
    expect(worded.map((b) => b.textContent)).toEqual(['Refresh', 'Export', 'Sync Now']);
    expect(header.querySelectorAll('.px-btn--primary')).toHaveLength(1);
    // The overflow became a ⋯ button.
    expect(buttons.filter((b) => b.classList.contains('px-btn--icon'))).toHaveLength(1);
    (header.querySelector('.px-btn--primary') as HTMLButtonElement).click();
    expect(run).toHaveBeenCalledOnce();
  });

  it('a header with nothing to do draws no action bar at all', () => {
    const header = createPageHeader(null, { title: 'Overview', subtitle: 'September' });
    expect(header.querySelector('.px-page-header__actions')).toBeNull();
    expect(header.querySelector('.px-page-header__subtitle')?.textContent).toBe('September');
  });

  it('an empty state has one headline, an optional hint, and its action is the primary', () => {
    const go = vi.fn();
    const empty = createEmptyState(null, { headline: 'No decks yet.', hint: 'Create one to start.', action: { label: 'New Deck', onClick: go } });
    expect(empty.querySelector('.px-empty__headline')?.textContent).toBe('No decks yet.');
    expect(empty.querySelector('.px-empty__hint')?.textContent).toBe('Create one to start.');
    const btn = empty.querySelector('.px-empty__action') as HTMLButtonElement;
    expect(btn.classList.contains('px-btn--primary')).toBe(true);
    btn.click();
    expect(go).toHaveBeenCalledOnce();
  });

  it('a section label is plain text in the shared class', () => {
    const l = createSectionLabel(null, 'Recent');
    expect(l.className).toBe('px-section-label');
    expect(l.textContent).toBe('Recent');
  });

  it('a filter chip toggles aria-pressed and reports the new state', () => {
    const onToggle = vi.fn();
    const chip = createFilterChip(null, { label: 'Noted', count: 5, onToggle });
    expect(chip.element.getAttribute('aria-pressed')).toBe('false');
    expect(chip.element.textContent).toBe('Noted5');
    chip.element.click();
    expect(chip.pressed).toBe(true);
    expect(onToggle).toHaveBeenCalledWith(true);
    chip.setCount(undefined);
    expect((chip.element.querySelector('.px-chip__count') as HTMLElement).hidden).toBe(true);
  });

  it('a segmented switch is a named radiogroup that reports changes', () => {
    const host = document.createElement('div');
    const onChange = vi.fn();
    const seg = createSegmented(host, { ariaLabel: 'Rating', items: [{ value: 'easy', label: 'Easy' }, { value: 'hard', label: 'Hard' }], value: 'easy', onChange });
    expect(seg.element.parentElement).toBe(host);
    expect(seg.element.getAttribute('role')).toBe('radiogroup');
    expect(seg.element.getAttribute('aria-label')).toBe('Rating');
    (host.querySelector('[data-value="hard"]') as HTMLButtonElement).click();
    expect(onChange).toHaveBeenCalledWith('hard');
    expect(seg.value).toBe('hard');
  });

  it('a page header can link back to the page it belongs to', () => {
    const back = vi.fn();
    const header = createPageHeader(null, { title: 'Problem Bank', back: { label: 'Worksheets', onClick: back } });
    const link = header.querySelector('.px-page-header__back') as HTMLButtonElement;
    expect(link.textContent).toBe('Worksheets');
    link.click();
    expect(back).toHaveBeenCalledOnce();
  });
});
