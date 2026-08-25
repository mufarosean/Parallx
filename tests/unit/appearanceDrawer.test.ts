// appearanceDrawer.test.ts — the shared per-widget look editor.
//
// Extracted from the dashboard pane so workbench seats open the SAME
// drawer. Pins the extraction contract: live preview on the card, cancel
// restores the original, save hands the host a complete appearance
// (contentAlign included), and a failing save keeps the drawer open.
//
// @vitest-environment jsdom

import { describe, it, expect, afterEach, vi } from 'vitest';
import { openAppearanceDrawer } from '../../src/built-in/dashboard/appearanceDrawer';
import type { WidgetAppearance } from '../../src/built-in/dashboard/dashboardTypes';

const BASE: WidgetAppearance = {
  background: 'default', backgroundColor: null,
  border: 'default', borderColor: null,
  title: null, titleHidden: false,
  contentAlign: 'start',
};

function open(overrides?: Partial<Parameters<typeof openAppearanceDrawer>[0]>) {
  const card = document.createElement('div');
  document.body.appendChild(card);
  const onSave = vi.fn(async () => {});
  const showError = vi.fn();
  openAppearanceDrawer({
    card,
    appearance: BASE,
    defaultTitle: 'Clock & Links',
    onSave,
    showError,
    ...overrides,
  });
  return { card, onSave, showError };
}

const overlay = () => document.querySelector<HTMLElement>('.dashboard-settings-overlay');
const saveBtn = () =>
  [...document.querySelectorAll<HTMLButtonElement>('.dashboard-settings__foot button')]
    .find((b) => b.textContent === 'Save')!;
const cancelBtn = () =>
  [...document.querySelectorAll<HTMLButtonElement>('.dashboard-settings__foot button')]
    .find((b) => b.textContent === 'Cancel')!;
const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  document.body.textContent = '';
});

describe('openAppearanceDrawer', () => {
  it('renders every field, alignment included', () => {
    open();
    const labels = [...document.querySelectorAll<HTMLElement>('.dashboard-field__label')]
      .map((l) => l.textContent);
    expect(labels).toEqual(expect.arrayContaining(['Background', 'Border', 'Content', 'Title']));
    expect(document.querySelector('.dashboard-field__input')).not.toBeNull();
    expect(overlay()).not.toBeNull();
  });

  it('previews the title live on the card and saves a complete appearance', async () => {
    const { card, onSave } = open();
    const titleEl = document.createElement('span');
    titleEl.className = 'dashboard-widget__title';
    titleEl.dataset.defaultTitle = 'Clock & Links';
    card.appendChild(titleEl);

    const input = document.querySelector<HTMLInputElement>('.dashboard-field__input')!;
    input.value = 'Study Clock';
    input.dispatchEvent(new Event('input'));
    expect(titleEl.textContent).toBe('Study Clock'); // live preview

    saveBtn().click();
    await flush();
    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0]![0] as WidgetAppearance;
    expect(saved.title).toBe('Study Clock');
    expect(saved.contentAlign).toBe('start'); // always present in the saved shape
    expect(overlay()).toBeNull(); // closed on success
  });

  it('cancel restores the original look on the card', () => {
    const { card } = open({ appearance: { ...BASE, border: 'none' } });
    // The drawer opened against border:none — simulate the user flipping
    // the checkbox (a non-select control) and cancelling.
    const checkbox = document.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    expect(card.dataset.titleHidden).toBe('true'); // previewed

    cancelBtn().click();
    expect(card.dataset.titleHidden).toBeUndefined(); // restored
    expect(card.dataset.borderless).toBe('true'); // original border:none re-applied
    expect(overlay()).toBeNull();
  });

  it('a failing save shows the error and keeps the drawer open', async () => {
    const { showError } = open({
      onSave: async () => { throw new Error('db locked'); },
    });
    saveBtn().click();
    await flush();
    expect(showError).toHaveBeenCalledWith(expect.stringContaining('db locked'));
    expect(overlay()).not.toBeNull(); // still open — the edit is not lost
  });
});
