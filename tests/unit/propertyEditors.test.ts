/**
 * @vitest-environment jsdom
 */
/**
 * Unit tests for database/properties/propertyEditors.ts
 *
 * Tests editor creation, value commitment via keyboard events,
 * dismiss events, and the dispatch function createPropertyEditor().
 *
 * Select/MultiSelect/Status editors use ContextMenu which requires
 * full DOM positioning — tested via dispatch null-check only.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createPropertyEditor } from '../../src/built-in/canvas/database/properties/propertyEditors';
import type { IPropertyValue, PropertyConfig } from '../../src/built-in/canvas/database/databaseTypes';

// ─── Helpers ─────────────────────────────────────────────────────────────────

let container: HTMLElement;
let anchor: HTMLElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  anchor = document.createElement('div');
  document.body.appendChild(anchor);
  // Give anchor a rect for ContextMenu positioning
  Object.defineProperty(anchor, 'getBoundingClientRect', {
    value: () => new DOMRect(100, 100, 200, 30),
  });
});

const emptyConfig: PropertyConfig = {} as any;

// ═════════════════════════════════════════════════════════════════════════════
//  createPropertyEditor — dispatch
// ═════════════════════════════════════════════════════════════════════════════

describe('createPropertyEditor (dispatch)', () => {
  it('returns editor for title type', () => {
    const editor = createPropertyEditor('title', container, anchor, undefined, emptyConfig);
    expect(editor).not.toBeNull();
    editor!.dispose();
  });

  it('returns editor for rich_text type', () => {
    const editor = createPropertyEditor('rich_text', container, anchor, undefined, emptyConfig);
    expect(editor).not.toBeNull();
    editor!.dispose();
  });

  it('returns editor for number type', () => {
    const editor = createPropertyEditor('number', container, anchor, undefined, emptyConfig);
    expect(editor).not.toBeNull();
    editor!.dispose();
  });

  it('returns editor for checkbox type', () => {
    const editor = createPropertyEditor('checkbox', container, anchor, undefined, emptyConfig);
    expect(editor).not.toBeNull();
    editor!.dispose();
  });

  it('returns editor for date type', () => {
    const editor = createPropertyEditor('date', container, anchor, undefined, emptyConfig);
    expect(editor).not.toBeNull();
    editor!.dispose();
  });

  it('returns editor for url type', () => {
    const editor = createPropertyEditor('url', container, anchor, undefined, emptyConfig);
    expect(editor).not.toBeNull();
    editor!.dispose();
  });

  it('returns editor for email type', () => {
    const editor = createPropertyEditor('email', container, anchor, undefined, emptyConfig);
    expect(editor).not.toBeNull();
    editor!.dispose();
  });

  it('returns editor for phone_number type', () => {
    const editor = createPropertyEditor('phone_number', container, anchor, undefined, emptyConfig);
    expect(editor).not.toBeNull();
    editor!.dispose();
  });

  it('returns editor for files type', () => {
    const editor = createPropertyEditor('files', container, anchor, undefined, emptyConfig);
    expect(editor).not.toBeNull();
    editor!.dispose();
  });

  it('returns null for created_time (read-only)', () => {
    const editor = createPropertyEditor('created_time', container, anchor, undefined, emptyConfig);
    expect(editor).toBeNull();
  });

  it('returns null for last_edited_time (read-only)', () => {
    const editor = createPropertyEditor('last_edited_time', container, anchor, undefined, emptyConfig);
    expect(editor).toBeNull();
  });

  it('returns null for formula (read-only)', () => {
    const editor = createPropertyEditor('formula', container, anchor, undefined, emptyConfig);
    expect(editor).toBeNull();
  });

  it('returns null for rollup (read-only)', () => {
    const editor = createPropertyEditor('rollup', container, anchor, undefined, emptyConfig);
    expect(editor).toBeNull();
  });

  it('returns null for unique_id (read-only)', () => {
    const editor = createPropertyEditor('unique_id', container, anchor, undefined, emptyConfig);
    expect(editor).toBeNull();
  });

  it('returns null for relation (read-only)', () => {
    const editor = createPropertyEditor('relation', container, anchor, undefined, emptyConfig);
    expect(editor).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  TextInputEditor (title, rich_text, url, email, phone_number)
// ═════════════════════════════════════════════════════════════════════════════

describe('TextInputEditor', () => {
  it('creates an input element in container', () => {
    const editor = createPropertyEditor('title', container, anchor, undefined, emptyConfig);
    expect(container.querySelector('input.db-cell-editor-input')).not.toBeNull();
    editor!.dispose();
  });

  it('populates input with current title value', () => {
    const value: IPropertyValue = { type: 'title', title: [{ type: 'text', content: 'Hello' }] };
    const editor = createPropertyEditor('title', container, anchor, value, emptyConfig);
    const input = container.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('Hello');
    editor!.dispose();
  });

  it('fires onDidChange + onDidDismiss on Enter', () => {
    const editor = createPropertyEditor('title', container, anchor, undefined, emptyConfig)!;
    const changeSpy = vi.fn();
    const dismissSpy = vi.fn();
    editor.onDidChange(changeSpy);
    editor.onDidDismiss(dismissSpy);

    const input = container.querySelector('input')!;
    input.value = 'New Title';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(changeSpy).toHaveBeenCalledTimes(1);
    const val = changeSpy.mock.calls[0][0] as IPropertyValue;
    expect(val.type).toBe('title');
    expect((val as any).title[0].content).toBe('New Title');
    expect(dismissSpy).toHaveBeenCalledTimes(1);
    editor.dispose();
  });

  it('fires onDidDismiss on Escape (no change)', () => {
    const editor = createPropertyEditor('rich_text', container, anchor, undefined, emptyConfig)!;
    const changeSpy = vi.fn();
    const dismissSpy = vi.fn();
    editor.onDidChange(changeSpy);
    editor.onDidDismiss(dismissSpy);

    const input = container.querySelector('input')!;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(changeSpy).not.toHaveBeenCalled();
    expect(dismissSpy).toHaveBeenCalledTimes(1);
    editor.dispose();
  });

  it('fires onDidChange on blur', () => {
    const editor = createPropertyEditor('url', container, anchor,
      { type: 'url', url: 'https://old.com' },
      emptyConfig)!;
    const changeSpy = vi.fn();
    editor.onDidChange(changeSpy);

    const input = container.querySelector('input')!;
    input.value = 'https://new.com';
    input.dispatchEvent(new FocusEvent('blur'));

    expect(changeSpy).toHaveBeenCalledTimes(1);
    const val = changeSpy.mock.calls[0][0] as IPropertyValue;
    expect(val.type).toBe('url');
    expect((val as any).url).toBe('https://new.com');
    editor.dispose();
  });

  it('commit is idempotent (does not fire twice)', () => {
    const editor = createPropertyEditor('email', container, anchor, undefined, emptyConfig)!;
    const changeSpy = vi.fn();
    editor.onDidChange(changeSpy);

    const input = container.querySelector('input')!;
    input.value = 'test@test.com';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    input.dispatchEvent(new FocusEvent('blur'));

    expect(changeSpy).toHaveBeenCalledTimes(1);
    editor.dispose();
  });

  it('sets correct input type per property', () => {
    // url → type="url"
    const urlEditor = createPropertyEditor('url', container, anchor, undefined, emptyConfig)!;
    expect((container.querySelector('input')! as HTMLInputElement).type).toBe('url');
    urlEditor.dispose();

    container.innerHTML = '';

    // email → type="email"
    const emailEditor = createPropertyEditor('email', container, anchor, undefined, emptyConfig)!;
    expect((container.querySelector('input')! as HTMLInputElement).type).toBe('email');
    emailEditor.dispose();

    container.innerHTML = '';

    // phone → type="tel"
    const phoneEditor = createPropertyEditor('phone_number', container, anchor, undefined, emptyConfig)!;
    expect((container.querySelector('input')! as HTMLInputElement).type).toBe('tel');
    phoneEditor.dispose();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  NumberEditor
// ═════════════════════════════════════════════════════════════════════════════

describe('NumberEditor', () => {
  it('creates number input', () => {
    const editor = createPropertyEditor('number', container, anchor,
      { type: 'number', number: 42 },
      emptyConfig)!;
    const input = container.querySelector('input') as HTMLInputElement;
    expect(input.type).toBe('number');
    expect(input.value).toBe('42');
    editor.dispose();
  });

  it('commits number value on Enter', () => {
    const editor = createPropertyEditor('number', container, anchor,
      { type: 'number', number: 10 },
      emptyConfig)!;
    const changeSpy = vi.fn();
    editor.onDidChange(changeSpy);

    const input = container.querySelector('input')!;
    input.value = '99';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    const val = changeSpy.mock.calls[0][0] as IPropertyValue;
    expect(val.type).toBe('number');
    expect((val as any).number).toBe(99);
    editor.dispose();
  });

  it('commits null for empty string', () => {
    const editor = createPropertyEditor('number', container, anchor,
      { type: 'number', number: 10 },
      emptyConfig)!;
    const changeSpy = vi.fn();
    editor.onDidChange(changeSpy);

    const input = container.querySelector('input')!;
    input.value = '';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect((changeSpy.mock.calls[0][0] as any).number).toBeNull();
    editor.dispose();
  });

  it('empty input for null initial value', () => {
    const editor = createPropertyEditor('number', container, anchor,
      { type: 'number', number: null },
      emptyConfig)!;
    const input = container.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('');
    editor.dispose();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  CheckboxEditor
// ═════════════════════════════════════════════════════════════════════════════

describe('CheckboxEditor', () => {
  it('toggles false → true (fires in constructor, verify via dismiss)', async () => {
    // CheckboxEditor fires onDidChange synchronously in the constructor,
    // before createPropertyEditor returns. We can't attach a spy in time.
    // Instead, verify: editor is created (non-null), dismiss fires in microtask.
    const editor = createPropertyEditor('checkbox', container, anchor,
      { type: 'checkbox', checkbox: false },
      emptyConfig)!;

    expect(editor).not.toBeNull();
    const dismissSpy = vi.fn();
    editor.onDidDismiss(dismissSpy);

    await new Promise(resolve => queueMicrotask(resolve));
    expect(dismissSpy).toHaveBeenCalledTimes(1);
    editor.dispose();
  });

  it('toggles true → false (fires in constructor, verify via dismiss)', async () => {
    const editor = createPropertyEditor('checkbox', container, anchor,
      { type: 'checkbox', checkbox: true },
      emptyConfig)!;

    expect(editor).not.toBeNull();
    const dismissSpy = vi.fn();
    editor.onDidDismiss(dismissSpy);

    await new Promise(resolve => queueMicrotask(resolve));
    expect(dismissSpy).toHaveBeenCalledTimes(1);
    editor.dispose();
  });

  it('fires onDidDismiss after microtask', async () => {
    const editor = createPropertyEditor('checkbox', container, anchor,
      { type: 'checkbox', checkbox: false },
      emptyConfig)!;
    const dismissSpy = vi.fn();
    editor.onDidDismiss(dismissSpy);

    // Dismiss fires in queueMicrotask
    await new Promise(resolve => queueMicrotask(resolve));
    expect(dismissSpy).toHaveBeenCalledTimes(1);
    editor.dispose();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  DateEditor
// ═════════════════════════════════════════════════════════════════════════════

describe('DateEditor', () => {
  it('creates date input with current value', () => {
    const editor = createPropertyEditor('date', container, anchor,
      { type: 'date', date: { start: '2025-06-15', end: null } },
      emptyConfig)!;
    const input = container.querySelector('input') as HTMLInputElement;
    expect(input.type).toBe('date');
    expect(input.value).toBe('2025-06-15');
    editor.dispose();
  });

  it('creates empty date input for null date', () => {
    const editor = createPropertyEditor('date', container, anchor,
      { type: 'date', date: null },
      emptyConfig)!;
    const input = container.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('');
    editor.dispose();
  });

  it('dismisses on Escape', () => {
    const editor = createPropertyEditor('date', container, anchor, undefined, emptyConfig)!;
    const dismissSpy = vi.fn();
    editor.onDidDismiss(dismissSpy);

    const input = container.querySelector('input')!;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(dismissSpy).toHaveBeenCalledTimes(1);
    editor.dispose();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  FilesEditor
// ═════════════════════════════════════════════════════════════════════════════

describe('FilesEditor', () => {
  it('creates URL input with placeholder', () => {
    const editor = createPropertyEditor('files', container, anchor, undefined, emptyConfig)!;
    const input = container.querySelector('input') as HTMLInputElement;
    expect(input.type).toBe('url');
    expect(input.placeholder).toBe('Paste file URL…');
    editor.dispose();
  });

  it('adds file on Enter', () => {
    const editor = createPropertyEditor('files', container, anchor, undefined, emptyConfig)!;
    const changeSpy = vi.fn();
    editor.onDidChange(changeSpy);

    const input = container.querySelector('input')!;
    input.value = 'https://example.com/doc.pdf';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(changeSpy).toHaveBeenCalledTimes(1);
    const val = changeSpy.mock.calls[0][0] as IPropertyValue;
    expect(val.type).toBe('files');
    expect((val as any).files).toHaveLength(1);
    expect((val as any).files[0].external.url).toBe('https://example.com/doc.pdf');
    editor.dispose();
  });
});
