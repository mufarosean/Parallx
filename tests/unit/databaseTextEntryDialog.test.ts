// @vitest-environment jsdom

import { describe, expect, it, beforeEach } from 'vitest';
import { showDatabaseTextEntryDialog } from '../../src/built-in/canvas/database/textEntryDialog';

describe('databaseTextEntryDialog', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('resolves submitted text when Enter is pressed', async () => {
    const resultPromise = showDatabaseTextEntryDialog({
      title: 'Rename view',
      value: 'Table',
    });

    const input = document.querySelector('.ui-input-box-input') as HTMLInputElement;
    input.value = 'Timeline';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    await expect(resultPromise).resolves.toBe('Timeline');
  });

  it('resolves undefined when Cancel is clicked', async () => {
    const resultPromise = showDatabaseTextEntryDialog({
      title: 'Option name',
    });

    const buttons = Array.from(document.querySelectorAll('.ui-button')) as HTMLButtonElement[];
    const cancel = buttons.find((button) => button.textContent?.includes('Cancel'));
    cancel?.click();

    await expect(resultPromise).resolves.toBeUndefined();
  });
});