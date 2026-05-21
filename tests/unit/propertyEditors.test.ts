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
