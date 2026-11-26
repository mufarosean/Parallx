// @vitest-environment jsdom
// sheetToolbar.test.ts — the sheet's toolbar (Worksheets' 2B): what it shows is
// read from the sheet, what it does goes to the sheet as one act, and the
// commands do nothing when no sheet is live.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { formatCells, mountSheetToolbar, showSheetMenu } from '../../src/built-in/worksheet/panes/sheetToolbar';
import { NUMBER_FORMATS, numberFormatLabel, type ISheetFormat, type SheetFormatAction, type SheetFormatState } from '../../src/built-in/worksheet/sheetFormat';
import { hasIcon } from '../../src/ui/iconRegistry';

const BLANK: SheetFormatState = {
  range: 'A1', bold: false, italic: false, underline: false, strike: false, wrap: false, overflow: 'overflow', merged: false, align: '', valign: '',
  numberFormat: '', fontFamily: '', fontSize: 0, rotation: 0, frozenRows: 0, frozenColumns: 0, filter: false, painter: false, canUndo: false, canRedo: false,
};

function fakeSheet(start: Partial<SheetFormatState> = {}) {
  let state: SheetFormatState = { ...BLANK, ...start };
  const ran: SheetFormatAction[] = [];
  const listeners = new Set<() => void>();
  const format: ISheetFormat = {
    state: () => state,
    run: (action) => { ran.push(action); return true; },
    onChange: (l) => { listeners.add(l); return { dispose: () => { listeners.delete(l); } }; },
    selectionText: () => ({ range: state.range, text: '1\t2', cells: 2 }),
    selectionRect: () => null,
  };
  return { format, ran, set: (next: Partial<SheetFormatState>) => { state = { ...state, ...next }; for (const l of [...listeners]) l(); }, listeners };
}

function mount(free: boolean, start: Partial<SheetFormatState> = {}) {
  const pane = document.createElement('div');
  const sheetEl = document.createElement('div');
  pane.appendChild(sheetEl);
  document.body.appendChild(pane);
  const sheet = fakeSheet(start);
  const toolbar = mountSheetToolbar(sheetEl, sheet.format, { free, title: 'Budget' });
  const row = pane.querySelector<HTMLElement>('.ws-toolbar')!;
  const ids = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('button')].map((b) => b.dataset.pxId!.split('.').pop());
  const button = (id: string) => row.querySelector<HTMLButtonElement>(`[data-px-id="worksheet.toolbar.${id}"]`)!;
  return { pane, sheetEl, sheet, toolbar, row, ids, button };
}

describe('the sheet toolbar', () => {
  let open: ReturnType<typeof mount> | null = null;
  afterEach(() => { open?.toolbar.dispose(); open?.pane.remove(); open = null; document.body.innerHTML = ''; });

  it('is one named row before the sheet, with the drawing\'s controls in its order', () => {
    open = mount(true);
    expect(open.row.getAttribute('role')).toBe('toolbar');
    expect(open.row.getAttribute('aria-label')).toBe('Sheet toolbar');
    expect(open.row.nextElementSibling).toBe(open.sheetEl);
    expect(open.ids(open.row)).toEqual(['undo', 'redo', 'number', 'percent', 'bold', 'italic', 'underline', 'textColor', 'fill', 'borders', 'align', 'wrap', 'merge', 'sum', 'sort', 'filter', 'freeze', 'ask', 'more']);
  });

  it('a sheet held to the exam\'s limits has no Sort and no Filter, and no Sort menu to open', () => {
    open = mount(false);
    expect(open.ids(open.row)).not.toContain('sort');
    expect(open.ids(open.row)).not.toContain('filter');
    expect(showSheetMenu('sort')).toBe(false);
  });

  it('every control has a name, and a control that opens a menu says so', () => {
    open = mount(true);
    for (const b of open.row.querySelectorAll('button')) expect((b.getAttribute('aria-label') || b.textContent || '').trim()).not.toBe('');
    for (const id of ['number', 'textColor', 'fill', 'borders', 'align', 'sum', 'sort', 'freeze', 'more']) expect(open.button(id).getAttribute('aria-haspopup')).toBe('menu');
    expect(open.button('bold').getAttribute('aria-haspopup')).toBeNull();
  });

  it('shows what the active cell has: the marks that are on, the number format\'s name, Undo and Redo', () => {
    open = mount(true, { bold: true, wrap: true, numberFormat: '0.00%', canUndo: true });
    expect(open.button('bold').getAttribute('aria-pressed')).toBe('true');
    expect(open.button('italic').getAttribute('aria-pressed')).toBe('false');
    expect(open.button('wrap').getAttribute('aria-pressed')).toBe('true');
    expect(open.button('number').textContent).toContain('Percent');
    expect(open.button('number').getAttribute('aria-label')).toBe('Number Format, Percent');
    expect(open.button('undo').disabled).toBe(false);
    expect(open.button('redo').disabled).toBe(true);
    // The selection moves to a plain cell: the row follows.
    open.sheet.set({ bold: false, wrap: false, numberFormat: '', merged: true, filter: true, canRedo: true });
    expect(open.button('bold').getAttribute('aria-pressed')).toBe('false');
    expect(open.button('merge').getAttribute('aria-pressed')).toBe('true');
    expect(open.button('filter').getAttribute('aria-pressed')).toBe('true');
    expect(open.button('number').textContent).toContain('General');
    expect(open.button('redo').disabled).toBe(false);
  });

  it('the command does one act on the live sheet, and nothing without one', () => {
    expect(formatCells({ do: 'bold' })).toBe(false);
    open = mount(true);
    expect(formatCells({ do: 'bold' })).toBe(true);
    expect(formatCells({ do: 'numberFormat', pattern: '0.00%' })).toBe(true);
    expect(open.sheet.ran).toEqual([{ do: 'bold' }, { do: 'numberFormat', pattern: '0.00%' }]);
    // Not an act: refused, and the sheet is not asked.
    expect(formatCells(undefined)).toBe(false);
    expect(formatCells('bold')).toBe(false);
    expect(formatCells({ what: 'bold' })).toBe(false);
    expect(open.sheet.ran).toHaveLength(2);
    open.toolbar.dispose();
    expect(formatCells({ do: 'bold' })).toBe(false);
  });

  it('taken down, it leaves nothing: no row, no bar at the selection, no listener, no colour icons', () => {
    open = mount(true);
    expect(hasIcon('ws-swatch-fill-yellow')).toBe(true);
    expect(open.sheet.listeners.size).toBe(1);
    open.toolbar.dispose();
    expect(open.pane.querySelector('.ws-toolbar')).toBeNull();
    expect(open.pane.querySelector('.ws-touchbar')).toBeNull();
    expect(open.sheet.listeners.size).toBe(0);
    expect(hasIcon('ws-swatch-fill-yellow')).toBe(false);
  });

  it('the bar at the selection is hidden until a finger is used, and has the short set', () => {
    open = mount(true);
    const bar = open.pane.querySelector<HTMLElement>('.ws-touchbar')!;
    expect(bar.hidden).toBe(true);
    expect(bar.getAttribute('aria-label')).toBe('Selection toolbar');
    expect(open.ids(bar)).toEqual(['number', 'bold', 'italic', 'fill', 'sum', 'sort', 'filter', 'ask', 'more']);
  });

  it('Left and Right walk the row, Home and End go to its ends', () => {
    open = mount(true, { canUndo: true, canRedo: true });
    // jsdom lays nothing out: every button counts as drawn.
    const rects = vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
    const key = (k: string) => (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    open.button('bold').focus();
    key('ArrowRight');
    expect(document.activeElement).toBe(open.button('italic'));
    key('ArrowLeft'); key('ArrowLeft');
    expect(document.activeElement).toBe(open.button('percent'));
    key('Home');
    expect(document.activeElement).toBe(open.button('undo'));
    key('End');
    expect(document.activeElement).toBe(open.button('more'));
    key('ArrowRight');
    expect(document.activeElement).toBe(open.button('undo'));
    rects.mockRestore();
  });
});

describe('number formats', () => {
  it('a pattern is named as the menu names it, General for none, Custom for one not on the list', () => {
    expect(numberFormatLabel('')).toBe('General');
    expect(numberFormatLabel('General')).toBe('General');
    expect(numberFormatLabel('0.00%')).toBe('Percent');
    expect(numberFormatLabel('$#,##0.00')).toBe('Currency');
    expect(numberFormatLabel('0.000')).toBe('Custom');
    expect(new Set(NUMBER_FORMATS.map((f) => f.pattern)).size).toBe(NUMBER_FORMATS.length);
  });
});
