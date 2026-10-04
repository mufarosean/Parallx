// @vitest-environment jsdom
// After Enter adds a tag the cursor stays in the field, so the next tag can be
// typed straight away (it used to fall to the page body).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { createPropertyEditor, resolveOptionColor } from '../../src/built-in/canvas/properties/propertyEditors';

describe('tag editor', () => {
  it('keeps focus in the input after adding a tag', () => {
    const onChange = vi.fn();
    const editor = createPropertyEditor({ name: 'Tags', type: 'tags', config: { options: [] }, sortOrder: 0, createdAt: '', updatedAt: '' } as any, [], onChange);
    document.body.appendChild(editor);
    const input = editor.querySelector('.canvas-prop-tag-input') as HTMLInputElement;
    input.focus();
    for (const t of ['exam-prep', 'chapter-3']) {
      input.value = t;
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      expect(document.activeElement).toBe(editor.querySelector('.canvas-prop-tag-input'));
    }
    expect(onChange).toHaveBeenLastCalledWith(['exam-prep', 'chapter-3']);
    editor.remove();
  });

  it('an uncoloured tag gets the neutral tint, which shows on light and dark pages', () => {
    expect(resolveOptionColor(undefined)).toBe('var(--px-option-default)');
    const tokens = readFileSync(resolve(__dirname, '../../src/theme/px-tokens.css'), 'utf8');
    expect(tokens).toMatch(/--px-option-default:\s*rgba\(128, 128, 128, 0\.22\);/);
  });
});
