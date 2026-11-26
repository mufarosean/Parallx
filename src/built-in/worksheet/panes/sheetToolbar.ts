// sheetToolbar.ts — the sheet's toolbar: one row of the app's own controls
// over the grid, in place of the engine's ribbon (his 2B), and a short bar
// that comes to the selection for a finger (2C).
//
// Every control runs a command (worksheet.formatCells, worksheet.showSheetMenu,
// worksheet.askAboutSelection), so each is in reach of the keyboard, the
// palette's keybindings and the chat as well as the mouse. What the bar shows
// as on (Bold, Wrap, the number format's name) is read back from the engine
// after every change, never kept here.

import { createButton, createIconButton, createMenu } from '../../../ui/kit.js';
import { createToolbar, markToolbarMenu, setToolbarPressed, type IKitToolbar } from '../../../ui/toolbar.js';
import { registerIcon, unregisterIcon } from '../../../ui/iconRegistry.js';
import type { IExtensionMenuItem } from '../../../ui/contextMenu.js';
import {
  NUMBER_FORMATS, SHEET_BORDER_BLACK, SHEET_BORDER_LINES, SHEET_MENU_EVENT, SHEET_COLORS, SHEET_FONTS, SHEET_FONT_SIZES, SHEET_ROTATIONS, numberFormatLabel,
  type ISheetFormat, type SheetBorderLine, type SheetBorders, type SheetFormatAction, type SheetFormatState,
} from '../sheetFormat.js';
import { state } from '../state.js';

export const FORMAT_COMMAND = 'worksheet.formatCells';
export const MENU_COMMAND = 'worksheet.showSheetMenu';
export const ASK_COMMAND = 'worksheet.askAboutSelection';

export type SheetMenuName = 'number' | 'textColor' | 'fill' | 'borders' | 'align' | 'sum' | 'sort' | 'freeze' | 'more' | 'insert';

export interface ISheetToolbarOptions {
  /** A sheet of one's own: it has Sort and Filter. A sheet held to the exam's limits has neither, as the exam tool has neither. */
  readonly free: boolean;
  /** What the sheet is called, for the chat ("Budget 2026"). */
  readonly title: string;
}

interface Bar {
  readonly kit: IKitToolbar;
  /** Buttons that show a state, by what they show. */
  readonly toggles: Map<'bold' | 'italic' | 'underline' | 'wrap' | 'merge' | 'filter', HTMLElement>;
  readonly undo?: HTMLButtonElement;
  readonly redo?: HTMLButtonElement;
  readonly number?: HTMLElement;
}

interface Live {
  readonly format: ISheetFormat;
  readonly options: ISheetToolbarOptions;
  readonly bars: Bar[];
}

/** The line and colour the next border is drawn with: chosen in the Borders menu, kept while the app runs. */
let borderLine: SheetBorderLine = 'thin';
let borderColor = SHEET_BORDER_BLACK;

/** The sheet the commands act on. The engine is built for one live sheet a window, so there is one or none. */
let live: Live | null = null;

// ── Commands ─────────────────────────────────────────────────────────────────

/** worksheet.formatCells: one act on the live sheet's selection. False when no sheet is live or it was refused. */
export function formatCells(action: unknown): boolean {
  if (!live || !action || typeof action !== 'object' || typeof (action as { do?: unknown }).do !== 'string') return false;
  const done = live.format.run(action as SheetFormatAction);
  keysBackToGrid(live);
  return done;
}

/**
 * After a press on the toolbar with the mouse or a finger the keys go back to
 * the grid, so the next thing typed lands in the cell, as it did before the
 * press. A person working the toolbar by keys stays on it.
 */
function keysBackToGrid(on: Live, always = false): void {
  if (!always && document.documentElement.dataset.inputModality === 'keyboard') return;
  const within = document.activeElement?.closest?.('.px-toolbar, .context-menu');
  if (always || within || document.activeElement === document.body) on.format.focusGrid();
}

/** worksheet.showSheetMenu: opens one of the toolbar's menus under its button. */
export function showSheetMenu(name: unknown): boolean {
  if (!live || typeof name !== 'string') return false;
  const items = menuItems(name as SheetMenuName, live);
  if (!items) return false;
  // Under the button that was pressed: the bar at the selection has the same menus as the row on top.
  const buttons = Array.from(document.querySelectorAll<HTMLElement>(`[data-ws-menu="${name}"]`)).filter((b) => b.getClientRects().length > 0);
  // A menu with no button of its own (Insert, asked for by its key) opens at the selection.
  const cell = buttons.length ? null : live.format.selectionRect();
  const anchor = buttons.find((b) => b === document.activeElement) ?? buttons[0] ?? (cell ? new DOMRect(cell.left, cell.top, cell.right - cell.left, cell.bottom - cell.top) : null);
  if (!anchor) return false;
  // Opened by a key (its own, or Enter on its button), the first entry is highlighted, so Enter takes it.
  const fromGrid = !buttons.length;
  const byKey = fromGrid || document.documentElement.dataset.inputModality === 'keyboard';
  // A menu that came to the selection takes the keys out of the grid while it is open (the grid would act on
  // each arrow and Enter as well), and gives them back when it closes.
  const on = live;
  if (fromGrid) on.bars[0]?.kit.element.focus({ preventScroll: true });
  createMenu(anchor, { id: `worksheet.toolbar.menu.${name}`, label: MENU_LABELS[name as SheetMenuName], items, menu: { anchorPosition: 'below', autoSelectFirst: byKey, onClose: () => { if (live === on) setTimeout(() => keysBackToGrid(on, fromGrid), 0); } } });
  return true;
}

/** worksheet.askAboutSelection: the selected cells go to the chat as an attachment, with nothing sent. */
export async function askAboutSelection(): Promise<boolean> {
  const cmds = state.api?.commands;
  const picked = live?.format.selectionText();
  if (!live || !picked || !cmds?.executeCommand) return false;
  if (!picked.text.trim()) {
    void state.api?.window?.showInformationMessage?.('The selected cells are empty. Select the cells to ask about first.');
    return false;
  }
  const name = `${live.options.title}: ${picked.range}`;
  try {
    // chat.show is the reveal that never toggles.
    await cmds.executeCommand('chat.show');
    await cmds.executeCommand('chat.addSelectionContext', {
      kind: 'selection', id: `worksheet:selection/${Date.now()}`, name, fullPath: `worksheet:selection/${picked.range}`,
      isImplicit: false, selectedText: `Cells ${picked.range} of the sheet "${live.options.title}" (tab-separated, a row a line):\n${picked.text}`, surface: 'worksheet',
    });
  } catch {
    return false;
  }
  return true;
}

// ── Menus ────────────────────────────────────────────────────────────────────

const MENU_LABELS: Record<SheetMenuName, string> = {
  number: 'Number Format', textColor: 'Text Colour', fill: 'Fill Colour', borders: 'Borders', align: 'Alignment',
  sum: 'Functions', sort: 'Sort', freeze: 'Freeze', more: 'More Actions', insert: 'Insert',
};

const SEP: IExtensionMenuItem = { separator: true };

function menuItems(name: SheetMenuName, on: Live): IExtensionMenuItem[] | null {
  const s = on.format.state();
  const act = (action: SheetFormatAction) => () => { on.format.run(action); };
  switch (name) {
    case 'number': return [
      ...NUMBER_FORMATS.map((f) => ({ label: f.label, tooltip: `Shown as ${f.sample}`, checked: (s?.numberFormat ?? '') === f.pattern, onSelect: act({ do: 'numberFormat', pattern: f.pattern }) })),
      SEP,
      { label: 'More Decimals', icon: 'decimals-arrow-right', onSelect: act({ do: 'moreDecimals' }) },
      { label: 'Fewer Decimals', icon: 'decimals-arrow-left', onSelect: act({ do: 'fewerDecimals' }) },
      SEP,
      { label: 'More Number Formats…', icon: 'hash', onSelect: act({ do: 'numberFormats' }) },
    ];
    case 'textColor': return [
      { label: 'Automatic', icon: 'baseline', onSelect: act({ do: 'textColor', color: null }) },
      SEP,
      ...SHEET_COLORS.map((c) => ({ label: c.name, icon: swatchId('text', c.name), onSelect: act({ do: 'textColor', color: c.text }) })),
    ];
    case 'fill': return [
      { label: 'No Fill', icon: 'ban', onSelect: act({ do: 'fill', color: null }) },
      SEP,
      ...SHEET_COLORS.map((c) => ({ label: c.name, icon: swatchId('fill', c.name), onSelect: act({ do: 'fill', color: c.fill }) })),
    ];
    case 'borders': {
      const border = (kind: SheetBorders) => act({ do: 'borders', kind, line: borderLine, color: borderColor });
      return [
        { label: 'All Borders', icon: 'grid-3x3', onSelect: border('all') },
        { label: 'Outside Borders', icon: 'square', onSelect: border('outside') },
        { label: 'Inside Borders', icon: 'frame', onSelect: border('inside') },
        SEP,
        { label: 'Top Border', icon: 'panel-top', onSelect: border('top') },
        { label: 'Bottom Border', icon: 'panel-bottom', onSelect: border('bottom') },
        { label: 'Left Border', icon: 'panel-left', onSelect: border('left') },
        { label: 'Right Border', icon: 'panel-right', onSelect: border('right') },
        SEP,
        { label: 'No Borders', icon: 'square-dashed', onSelect: border('none') },
        SEP,
        // What the next border is drawn with.
        { label: 'Line', icon: 'minus', submenu: SHEET_BORDER_LINES.map((l) => ({ label: l.label, checked: borderLine === l.id, onSelect: () => { borderLine = l.id; } })) },
        { label: 'Line Colour', icon: 'palette', submenu: [
          { label: 'Black', icon: swatchId('text', 'Black'), checked: borderColor === SHEET_BORDER_BLACK, onSelect: () => { borderColor = SHEET_BORDER_BLACK; } },
          ...SHEET_COLORS.map((c) => ({ label: c.name, icon: swatchId('text', c.name), checked: borderColor === c.text, onSelect: () => { borderColor = c.text; } })),
        ] },
      ];
    }
    case 'align': return [
      { label: 'Align Left', icon: 'align-left', checked: s?.align === 'left', onSelect: act({ do: 'align', to: 'left' }) },
      { label: 'Align Center', icon: 'align-center', checked: s?.align === 'center', onSelect: act({ do: 'align', to: 'center' }) },
      { label: 'Align Right', icon: 'align-right', checked: s?.align === 'right', onSelect: act({ do: 'align', to: 'right' }) },
    ];
    case 'sum': return [
      { label: 'Sum', icon: 'sigma', onSelect: act({ do: 'sum', fn: 'SUM' }) },
      { label: 'Average', onSelect: act({ do: 'sum', fn: 'AVERAGE' }) },
      { label: 'Count', onSelect: act({ do: 'sum', fn: 'COUNT' }) },
      { label: 'Largest', onSelect: act({ do: 'sum', fn: 'MAX' }) },
      { label: 'Smallest', onSelect: act({ do: 'sum', fn: 'MIN' }) },
      SEP,
      { label: 'All Functions…', icon: 'function-square', onSelect: act({ do: 'functions' }) },
    ];
    case 'sort': return on.options.free ? [
      { label: 'Sort Smallest to Largest', icon: 'arrow-up-narrow-wide', tooltip: 'Sorts the selected cells, or the block of data around the cell, by the column the cell is in. A heading row stays on top.', onSelect: act({ do: 'sort', ascending: true }) },
      { label: 'Sort Largest to Smallest', icon: 'arrow-down-wide-narrow', onSelect: act({ do: 'sort', ascending: false }) },
      SEP,
      { label: 'Custom Sort…', icon: 'list-ordered', tooltip: 'Sort the selected cells by more than one column.', onSelect: act({ do: 'customSort' }) },
      SEP,
      { label: 'Clear Filter Conditions', icon: 'funnel-x', disabled: !s?.filter, onSelect: act({ do: 'clearFilter' }) },
      { label: 'Reapply Filter', icon: 'refresh-cw', disabled: !s?.filter, onSelect: act({ do: 'reapplyFilter' }) },
    ] : null;
    case 'freeze': return [
      { label: 'Freeze Top Row', icon: 'table-rows-split', checked: !!s && s.frozenRows === 1 && s.frozenColumns === 0, onSelect: act({ do: 'freeze', what: 'row' }) },
      { label: 'Freeze First Column', icon: 'table-columns-split', checked: !!s && s.frozenColumns === 1 && s.frozenRows === 0, onSelect: act({ do: 'freeze', what: 'column' }) },
      { label: 'Freeze Above and Left of This Cell', icon: 'snowflake', tooltip: 'Rows above the selected cell and columns to its left stay in view.', onSelect: act({ do: 'freeze', what: 'here' }) },
      SEP,
      { label: 'Unfreeze', icon: 'x', disabled: !s || (s.frozenRows === 0 && s.frozenColumns === 0), onSelect: act({ do: 'freeze', what: 'none' }) },
    ];
    case 'insert': return [
      { label: 'Insert Row Above', icon: 'arrow-up-to-line', onSelect: act({ do: 'insert', what: 'rowAbove' }) },
      { label: 'Insert Row Below', icon: 'arrow-down-to-line', onSelect: act({ do: 'insert', what: 'rowBelow' }) },
      { label: 'Insert Column Left', icon: 'arrow-left-to-line', onSelect: act({ do: 'insert', what: 'columnLeft' }) },
      { label: 'Insert Column Right', icon: 'arrow-right-to-line', onSelect: act({ do: 'insert', what: 'columnRight' }) },
      SEP,
      { label: 'Insert Cells, Shifting Right', icon: 'move-right', onSelect: act({ do: 'insert', what: 'cellsRight' }) },
      { label: 'Insert Cells, Shifting Down', icon: 'move-down', onSelect: act({ do: 'insert', what: 'cellsDown' }) },
    ];
    case 'more': return [
      { label: 'Font', icon: 'type', submenu: SHEET_FONTS.map((family) => ({ label: family, checked: s?.fontFamily === family, onSelect: act({ do: 'font', family }) })) },
      { label: 'Size', icon: 'a-large-small', submenu: [
        { label: 'Larger', icon: 'a-arrow-up', onSelect: act({ do: 'largerText' }) },
        { label: 'Smaller', icon: 'a-arrow-down', onSelect: act({ do: 'smallerText' }) },
        SEP,
        ...SHEET_FONT_SIZES.map((size) => ({ label: String(size), checked: s?.fontSize === size, onSelect: act({ do: 'fontSize', size }) })),
      ] },
      { label: 'Strikethrough', icon: 'strikethrough', checked: !!s?.strike, onSelect: act({ do: 'strike' }) },
      { label: 'Currency', icon: 'dollar-sign', onSelect: act({ do: 'currency' }) },
      SEP,
      { label: 'Vertical Alignment', icon: 'align-vertical-justify-center', submenu: [
        { label: 'Top', icon: 'align-vertical-justify-start', checked: s?.valign === 'top', onSelect: act({ do: 'valign', to: 'top' }) },
        { label: 'Middle', icon: 'align-vertical-justify-center', checked: s?.valign === 'middle', onSelect: act({ do: 'valign', to: 'middle' }) },
        { label: 'Bottom', icon: 'align-vertical-justify-end', checked: s?.valign === 'bottom', onSelect: act({ do: 'valign', to: 'bottom' }) },
      ] },
      { label: 'Rotation', icon: 'rotate-cw', submenu: [
        ...SHEET_ROTATIONS.map((r) => ({ label: r.label, checked: (s?.rotation ?? 0) === r.degrees, onSelect: act({ do: 'rotate', degrees: r.degrees }) })),
        { label: 'Stacked', tooltip: 'One letter under another.', onSelect: act({ do: 'stackText' }) },
      ] },
      { label: 'Long Text', icon: 'wrap-text', submenu: [
        { label: 'Overflow', tooltip: 'Runs on over the empty cells beside it.', checked: s?.overflow === 'overflow', onSelect: act({ do: 'overflow', to: 'overflow' }) },
        { label: 'Wrap', tooltip: 'Goes on to more lines inside the cell.', checked: s?.overflow === 'wrap', onSelect: act({ do: 'overflow', to: 'wrap' }) },
        { label: 'Clip', tooltip: 'Is cut at the cell\'s edge.', checked: s?.overflow === 'clip', onSelect: act({ do: 'overflow', to: 'clip' }) },
      ] },
      { label: 'Merge', icon: 'merge', submenu: [
        { label: 'Merge All', onSelect: act({ do: 'merge' }), disabled: !!s?.merged },
        { label: 'Merge Across Each Row', onSelect: act({ do: 'mergeAcross' }) },
        { label: 'Merge Down Each Column', onSelect: act({ do: 'mergeDown' }) },
        SEP,
        { label: 'Unmerge', onSelect: act({ do: 'unmerge' }) },
      ] },
      SEP,
      { label: 'Format Painter', icon: 'paintbrush', checked: !!s?.painter, tooltip: 'Copies the selected cell\'s format; the next cells selected take it.', onSelect: act({ do: 'painter' }) },
      { label: 'Clear Formatting', icon: 'eraser', onSelect: act({ do: 'clearFormat' }) },
      { label: 'Clear Contents and Formatting', icon: 'trash-2', onSelect: act({ do: 'clearAll' }) },
      { label: 'Text to Number', icon: 'binary', tooltip: 'Turns numbers kept as text in the selection into numbers.', onSelect: act({ do: 'textToNumber' }) },
      SEP,
      { label: 'Insert Image…', icon: 'image', onSelect: act({ do: 'insertImage' }) },
      { label: 'Insert Image in a Cell…', icon: 'image-plus', onSelect: act({ do: 'insertCellImage' }) },
      { label: 'Protect Cells…', icon: 'lock', onSelect: act({ do: 'protect' }) },
    ];
    default: return null;
  }
}

// ── Colour swatches ──────────────────────────────────────────────────────────
// A colour in a menu is shown as itself: a small filled square, registered as
// an icon while a toolbar is up.

const swatchId = (kind: 'text' | 'fill', name: string): string => `ws-swatch-${kind}-${name.toLowerCase()}`;
const swatchSvg = (colour: string): string => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="4" fill="${colour}" stroke="currentColor" stroke-opacity="0.35" stroke-width="1"/></svg>`;
let swatchUsers = 0;
function useSwatches(): { dispose(): void } {
  const all = (each: (id: string, colour: string) => void): void => {
    each(swatchId('text', 'Black'), SHEET_BORDER_BLACK);
    for (const c of SHEET_COLORS) { each(swatchId('text', c.name), c.text); each(swatchId('fill', c.name), c.fill); }
  };
  if (swatchUsers++ === 0) all((id, colour) => registerIcon(id, swatchSvg(colour)));
  return { dispose: () => { if (--swatchUsers === 0) all((id) => { unregisterIcon(id); }); } };
}

// ── The bars ─────────────────────────────────────────────────────────────────

/** One bar's controls. `p` is the bar's id prefix: the row on top and the bar at the selection each have their own. */
function fillBar(kit: IKitToolbar, p: string, which: 'row' | 'touch', free: boolean): Bar {
  const bar = kit.element;
  const toggles: Bar['toggles'] = new Map();
  const act = (action: SheetFormatAction) => ({ command: FORMAT_COMMAND, args: [action] as const });
  const icon = (id: string, glyph: string, title: string, action: SheetFormatAction, hint?: string): HTMLButtonElement =>
    createIconButton(bar, { id: `${p}.${id}`, icon: glyph, title, size: 'sm', hint, ...act(action) });
  const toggle = (id: 'bold' | 'italic' | 'underline' | 'wrap' | 'merge' | 'filter', glyph: string, title: string, action: SheetFormatAction): void => {
    const b = icon(id, glyph, title, action);
    setToolbarPressed(b, false);
    toggles.set(id, b);
  };
  const menu = (name: SheetMenuName, glyph: string, title: string, label?: string): HTMLButtonElement => {
    const b = label
      ? createButton(bar, { id: `${p}.${name}`, label, icon: glyph, kind: 'ghost', size: 'sm', title, command: MENU_COMMAND, args: [name] })
      : createIconButton(bar, { id: `${p}.${name}`, icon: glyph, title, size: 'sm', command: MENU_COMMAND, args: [name] });
    b.dataset.wsMenu = name;
    markToolbarMenu(b, name !== 'more');
    return b;
  };

  let undo: HTMLButtonElement | undefined;
  let redo: HTMLButtonElement | undefined;
  if (which === 'row') {
    undo = icon('undo', 'undo-2', 'Undo', { do: 'undo' });
    redo = icon('redo', 'redo-2', 'Redo', { do: 'redo' });
    kit.separator();
  }
  const number = menu('number', 'hash', 'Number Format', 'General');
  number.setAttribute('aria-label', 'Number Format, General');
  if (which === 'row') icon('percent', 'percent', 'Percent', { do: 'percent' });
  kit.separator();
  toggle('bold', 'bold', 'Bold', { do: 'bold' });
  toggle('italic', 'italic', 'Italic', { do: 'italic' });
  if (which === 'row') {
    toggle('underline', 'underline', 'Underline', { do: 'underline' });
    menu('textColor', 'baseline', 'Text Colour');
  }
  menu('fill', 'paint-bucket', 'Fill Colour');
  if (which === 'row') {
    menu('borders', 'grid-3x3', 'Borders');
    kit.separator();
    menu('align', 'align-left', 'Alignment');
    toggle('wrap', 'wrap-text', 'Wrap Text', { do: 'wrap' });
    toggle('merge', 'merge', 'Merge Cells', { do: 'merge' });
  }
  kit.separator();
  menu('sum', 'sigma', 'Insert a Function', which === 'row' ? 'Sum' : undefined);
  if (free) {
    menu('sort', 'arrow-up-down', 'Sort');
    toggle('filter', 'funnel', 'Filter', { do: 'filter' });
  }
  if (which === 'row') {
    menu('freeze', 'snowflake', 'Freeze Rows and Columns');
    kit.spacer();
    createButton(bar, { id: `${p}.ask`, label: 'Ask', icon: 'sparkles', kind: 'ghost', size: 'sm', title: 'Ask About the Selected Cells in Chat', command: ASK_COMMAND });
  } else {
    kit.separator();
    createIconButton(bar, { id: `${p}.ask`, icon: 'sparkles', title: 'Ask About the Selected Cells in Chat', size: 'sm', command: ASK_COMMAND });
  }
  menu('more', 'ellipsis', 'More Actions');
  return { kit, toggles, undo, redo, number };
}

function paint(bar: Bar, s: SheetFormatState | null): void {
  const on: Record<string, boolean> = { bold: !!s?.bold, italic: !!s?.italic, underline: !!s?.underline, wrap: !!s?.wrap, merge: !!s?.merged, filter: !!s?.filter };
  for (const [id, button] of bar.toggles) setToolbarPressed(button, on[id]);
  if (bar.undo) bar.undo.disabled = !s?.canUndo;
  if (bar.redo) bar.redo.disabled = !s?.canRedo;
  // The number format's button is named for the format the cell has; a screen reader hears what the button is, then that.
  const label = bar.number?.querySelector('.px-btn__label');
  const name = numberFormatLabel(s?.numberFormat ?? '');
  if (label && label.textContent !== name) { label.textContent = name; bar.number?.setAttribute('aria-label', `Number Format, ${name}`); }
}

export interface ISheetToolbar {
  dispose(): void;
}

/**
 * Puts the toolbar over a mounted sheet: the row before `sheetEl` in its
 * parent (a column), and the bar that comes to the selection inside it.
 */
export function mountSheetToolbar(sheetEl: HTMLElement, format: ISheetFormat, options: ISheetToolbarOptions): ISheetToolbar {
  const parent = sheetEl.parentElement;
  const swatches = useSwatches();
  const row = createToolbar(null, { label: 'Sheet toolbar' });
  row.element.classList.add('ws-toolbar');
  parent?.insertBefore(row.element, sheetEl);
  // Beside the sheet, never inside it: the engine owns what is in its own element.
  const touch = createToolbar(parent, { label: 'Selection toolbar', kind: 'float' });
  touch.element.classList.add('ws-touchbar');
  touch.element.hidden = true;
  const bars = [fillBar(row, 'worksheet.toolbar', 'row', options.free), fillBar(touch, 'worksheet.touchbar', 'touch', options.free)];
  const mine: Live = { format, options, bars };
  live = mine;

  /** The bar at the selection: shown to a finger, just over the selection's first cell (under it when there is no room). */
  const placeTouchBar = (): void => {
    const el = touch.element;
    const byFinger = document.documentElement.dataset.inputModality === 'touch';
    const cell = byFinger ? format.selectionRect() : null;
    const sheet = sheetEl.getBoundingClientRect();
    const box = (parent ?? sheetEl).getBoundingClientRect();
    if (!cell || cell.bottom < sheet.top || cell.top > sheet.bottom) { el.hidden = true; return; }
    el.hidden = false;
    const h = el.offsetHeight;
    const w = el.offsetWidth;
    const gap = 8;
    // Over the cell while that keeps the bar on the sheet; else under it.
    const above = cell.top - h - gap;
    const top = (above >= sheet.top + gap ? above : Math.min(cell.bottom + gap, sheet.bottom - h - gap)) - box.top;
    const left = Math.min(Math.max(cell.left - box.left, gap), Math.max(gap, box.width - w - gap));
    el.style.top = `${Math.round(top)}px`;
    el.style.left = `${Math.round(left)}px`;
  };

  const refresh = (): void => {
    const s = format.state();
    for (const b of bars) paint(b, s);
    placeTouchBar();
  };
  const sub = format.onChange(refresh);
  // A key in the sheet that asks for one of these menus (Ctrl+Shift+Plus: Insert).
  // Opened once the key is done with: the engine takes the keys back to the grid as it finishes one, and the menu must have them after that.
  const onMenuKey = (e: Event): void => { const name = (e as CustomEvent).detail; setTimeout(() => { if (live === mine) showSheetMenu(name); }, 0); };
  sheetEl.addEventListener(SHEET_MENU_EVENT, onMenuKey);
  const modality = new MutationObserver(placeTouchBar);
  modality.observe(document.documentElement, { attributes: true, attributeFilter: ['data-input-modality'] });
  refresh();

  let gone = false;
  return {
    dispose: () => {
      if (gone) return;
      gone = true;
      sub.dispose();
      sheetEl.removeEventListener(SHEET_MENU_EVENT, onMenuKey);
      modality.disconnect();
      if (live === mine) live = null;
      row.dispose();
      touch.dispose();
      swatches.dispose();
    },
  };
}
