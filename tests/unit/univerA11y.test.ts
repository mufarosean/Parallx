// @vitest-environment jsdom
// univerA11y.test.ts — the spreadsheet for a screen reader: what a cell says,
// the names the engine's unnamed controls take, and the live region that
// speaks as the selection moves. docs/ACCESSIBILITY.md, section 9.

import { describe, it, expect, vi } from 'vitest';
import { describeCell, engineControlName, installSheetAccess, type ISheetCell } from '../../src/built-in/worksheet/univerA11y';

describe('the sheet for a screen reader', () => {
  it('says the cell, its formula and its value', () => {
    expect(describeCell({ cell: 'B7', value: '42', formula: '=A1*2' })).toBe('B7, =A1*2, 42');
    expect(describeCell({ cell: 'C1', value: '', formula: '' })).toBe('C1, empty');
    expect(describeCell({ cell: null, value: '', formula: '' })).toBe('');
  });

  it('names an engine control from its tooltip, title or icon', () => {
    const b = document.createElement('div');
    b.setAttribute('data-tooltip', 'sheet.command.set-range-bold');
    expect(engineControlName(b)).toBe('Set range bold');
    const t = document.createElement('button');
    t.title = 'Merge Cells';
    expect(engineControlName(t)).toBe('Merge cells');
    const labelled = document.createElement('button');
    labelled.textContent = 'Sum';
    expect(engineControlName(labelled)).toBe(''); // its text already names it
  });

  it('speaks the cell as the selection moves, once per change', async () => {
    vi.useFakeTimers();
    const box = document.createElement('div');
    document.body.appendChild(box);
    let cell: ISheetCell = { cell: 'A1', value: '3', formula: '' };
    let fire = (): void => {};
    const access = installSheetAccess(box, () => cell, (cb) => { fire = cb; return { dispose() {} }; });
    const live = box.querySelector('[role="status"]')!;
    expect(live.getAttribute('aria-live')).toBe('polite');
    fire(); vi.advanceTimersByTime(200);
    expect(live.textContent).toBe('A1, 3');
    cell = { cell: 'B2', value: '', formula: '=A1' };
    fire(); vi.advanceTimersByTime(200);
    expect(live.textContent).toBe('B2, =A1, empty');
    access.dispose();
    expect(box.querySelector('[role="status"]')).toBeNull();
    vi.useRealTimers();
  });
});
