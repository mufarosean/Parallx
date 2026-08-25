// settingsDrawer.test.ts — the shared per-widget settings editor.
//
// Extracted from the dashboard pane so workbench seats open the SAME
// config drawer. Pins the extraction contract: fields render from the
// schema, save collects every field's value into one config object, and
// a failing save keeps the drawer open.
//
// @vitest-environment jsdom

import { describe, it, expect, afterEach, vi } from 'vitest';
import { openWidgetSettingsDrawer } from '../../src/built-in/dashboard/settingsDrawer';
import type { WidgetTypeRegistration } from '../../src/api/bridges/dashboardBridge';

const TYPE = {
  typeId: 'test.widget',
  displayName: 'Test Widget',
  description: 'A widget for testing.',
  configSchema: {
    fields: {
      label: { type: 'string', label: 'Label', placeholder: 'A label' },
      count: { type: 'number', label: 'Count', default: 3 },
      loud: { type: 'boolean', label: 'Loud Mode', default: false },
      notes: { type: 'textarea', label: 'Notes' },
    },
  },
} as unknown as WidgetTypeRegistration<unknown>;

function open(overrides?: Partial<Parameters<typeof openWidgetSettingsDrawer>[0]>) {
  const onSave = vi.fn(async () => {});
  const showError = vi.fn();
  openWidgetSettingsDrawer({
    typeReg: TYPE,
    config: { label: 'Hello', count: 7 },
    onSave,
    showError,
    ...overrides,
  });
  return { onSave, showError };
}

const overlay = () => document.querySelector<HTMLElement>('.dashboard-settings-overlay');
const saveBtn = () =>
  [...document.querySelectorAll<HTMLButtonElement>('.dashboard-settings__foot button')]
    .find((b) => b.textContent === 'Save')!;
const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  document.body.textContent = '';
});

describe('openWidgetSettingsDrawer', () => {
  it('renders a field per schema entry, seeded from current config', () => {
    open();
    const labels = [...document.querySelectorAll<HTMLElement>('.dashboard-field__label')]
      .map((l) => l.textContent);
    expect(labels).toEqual(expect.arrayContaining(['Label', 'Count', 'Notes']));
    const text = document.querySelector<HTMLInputElement>('input[type="text"]')!;
    expect(text.value).toBe('Hello');
    const num = document.querySelector<HTMLInputElement>('input[type="number"]')!;
    expect(num.value).toBe('7');
    const bool = document.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(bool.checked).toBe(false); // schema default
  });

  it('save collects every field into one config object and closes', async () => {
    const { onSave } = open();
    const text = document.querySelector<HTMLInputElement>('input[type="text"]')!;
    text.value = 'Renamed';
    const bool = document.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    bool.checked = true;

    saveBtn().click();
    await flush();
    expect(onSave).toHaveBeenCalledWith({
      label: 'Renamed', count: 7, loud: true, notes: '',
    });
    expect(overlay()).toBeNull();
  });

  it('a failing save shows the error and keeps the drawer open', async () => {
    const { showError } = open({ onSave: async () => { throw new Error('db locked'); } });
    saveBtn().click();
    await flush();
    expect(showError).toHaveBeenCalledWith(expect.stringContaining('db locked'));
    expect(overlay()).not.toBeNull();
  });
});
