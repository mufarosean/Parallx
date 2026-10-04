// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPropertyEditor } from '../../src/built-in/canvas/properties/propertyEditors';
import type { IPropertyDefinition } from '../../src/built-in/canvas/properties/propertyTypes';

const DATETIME_DEFINITION: IPropertyDefinition = {
  name: 'modified',
  type: 'datetime',
  config: {},
  sortOrder: 0,
  createdAt: '',
  updatedAt: '',
};

function formatDatetime(value: string): string {
  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

describe('property datetime editor', () => {
  const originalTz = process.env.TZ;

  beforeEach(() => {
    process.env.TZ = 'America/Chicago';
  });

  afterEach(() => {
    if (originalTz === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTz;
    }
  });

  it('renders timezone-aware timestamps in the local timezone', () => {
    const editor = createPropertyEditor(DATETIME_DEFINITION, '2026-05-21T02:05:00Z', vi.fn());

    expect(editor.textContent).toBe(formatDatetime('2026-05-21T02:05:00Z'));
    expect(editor.textContent).toContain('May 20, 2026');
    expect(editor.textContent).not.toBe(formatDatetime('2026-05-21T02:05'));
  });
});

describe('text and number editors save every edit', () => {
  const def = (type: 'text' | 'number'): IPropertyDefinition => ({ name: 'p', type, config: {}, sortOrder: 0, createdAt: '', updatedAt: '' });
  const edit = (input: HTMLInputElement, v: string) => {
    input.focus();
    input.value = v;
    input.dispatchEvent(new Event('blur'));
  };

  it('a second edit in the same field is saved (it used to be dropped)', () => {
    const onChange = vi.fn();
    const input = createPropertyEditor(def('text'), 'a', onChange) as HTMLInputElement;
    edit(input, 'b');
    edit(input, 'c');
    expect(onChange.mock.calls.map((c) => c[0])).toEqual(['b', 'c']);
  });

  it('changing back to the first value is saved too, and Enter then blur saves once', () => {
    const onChange = vi.fn();
    const input = createPropertyEditor(def('text'), 'a', onChange) as HTMLInputElement;
    edit(input, 'b');
    edit(input, 'a');
    input.value = 'z';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    input.dispatchEvent(new Event('blur'));
    expect(onChange.mock.calls.map((c) => c[0])).toEqual(['b', 'a', 'z']);
  });

  it('numbers: each change is saved, an unchanged blur is not', () => {
    const onChange = vi.fn();
    const input = createPropertyEditor(def('number'), 1, onChange) as HTMLInputElement;
    edit(input, '1');
    edit(input, '2');
    edit(input, '3');
    expect(onChange.mock.calls.map((c) => c[0])).toEqual([2, 3]);
  });
});
