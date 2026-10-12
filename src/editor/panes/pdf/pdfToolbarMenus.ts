// pdfToolbarMenus.ts — the PDF toolbar's two menus: zoom presets, and ⋯
// (rotate, two-page spread, scroll direction, print, open in the system
// viewer, and the entries running tools add for PDFs).

import type { PDFViewer, SpreadMode, ScrollMode } from 'pdfjs-dist/web/pdf_viewer.mjs';
import { ContextMenu } from '../../../ui/contextMenu.js';
import type { IContextMenuItem } from '../../../ui/contextMenu.js';
import { getEditorTitleActions } from '../../../contributions/menuContribution.js';
import { ICON } from './pdfIcons.js';
import type { IPaneCommandService } from './pdfTypes.js';

/** The zoom presets menu: fixed percentages, then the two fit modes. */
export function showZoomPresets(x: number, y: number, applyScale: (value: string) => void): ContextMenu {
  const presets = [50, 75, 100, 125, 150, 200, 400];
  const menu = ContextMenu.show({
    items: [
      ...presets.map((p) => ({ id: `zoom.${p}`, label: `${p}%` })),
      { id: 'zoom.page-width', label: 'Fit Width', group: 'fit' },
      { id: 'zoom.page-fit', label: 'Fit Page', group: 'fit' },
    ],
    anchor: { x, y },
  });
  menu.onDidSelect((e) => {
    const v = e.item.id.slice('zoom.'.length);
    applyScale(v === 'page-width' || v === 'page-fit' ? v : String(parseInt(v, 10) / 100));
  });
  return menu;
}

/** What the ⋯ menu needs from the pane. */
export interface PdfOverflowMenuHost {
  viewer(): PDFViewer | null;
  /** pdf.js's spread and scroll modes, once it has loaded. */
  modes(): { SpreadMode: typeof SpreadMode; ScrollMode: typeof ScrollMode } | null;
  /** The open file. */
  file(): { uri: string; fsPath: string } | null;
  commands(): IPaneCommandService | undefined;
  rotate(): void;
}

/** The ⋯ menu under `anchor`; null before pdf.js has loaded. */
export function showOverflowMenu(anchor: HTMLElement, host: PdfOverflowMenuHost): ContextMenu | null {
  const modes = host.modes();
  if (!modes) return null;
  const { SpreadMode, ScrollMode } = modes;
  const viewer = host.viewer();
  const r = anchor.getBoundingClientRect();
  const spread = viewer?.spreadMode ?? SpreadMode.NONE;
  const scroll = viewer?.scrollMode ?? ScrollMode.VERTICAL;
  // Every submenu item gets an icon slot so labels stay aligned; only the
  // current mode draws the check. The slot has no CSS size of its own, so
  // it (and the SVG) is sized here, as the view container's menu does.
  const checked = (on: boolean) => (el: HTMLElement) => {
    el.style.width = '16px';
    el.style.display = 'inline-flex';
    el.style.alignItems = 'center';
    if (on) {
      el.innerHTML = ICON.check;
      const svg = el.querySelector('svg');
      if (svg) { svg.style.width = '13px'; svg.style.height = '13px'; }
    }
  };

  // Entries running tools added through the `editor/title` menu location
  // (when: activeEditor == this pane's typeId). The pane names no tool: it
  // lists what is there, with the tool's name at the right so the user can
  // tell what added it. ContextMenu has no slot for trailing text other than
  // the keybinding span (muted, right-aligned), so the name goes there.
  const toolActions = getEditorTitleActions();
  const toolItems: IContextMenuItem[] = toolActions.map((a) => ({
    id: `tool:${a.commandId}`,
    label: a.label,
    keybinding: a.toolName,
    group: 'tools',
  }));

  const menu = ContextMenu.show({
    items: [
      { id: 'pdf.rotate', label: 'Rotate 90°', keybinding: 'R' },
      {
        id: 'pdf.spread',
        label: 'Two-page spread',
        submenu: [
          { id: 'pdf.spread.none', label: 'Off',        renderIcon: checked(spread === SpreadMode.NONE) },
          { id: 'pdf.spread.odd',  label: 'Odd Pages',  renderIcon: checked(spread === SpreadMode.ODD) },
          { id: 'pdf.spread.even', label: 'Even Pages', renderIcon: checked(spread === SpreadMode.EVEN) },
        ],
      },
      {
        id: 'pdf.scroll',
        label: 'Scroll Direction',
        submenu: [
          { id: 'pdf.scroll.vertical',   label: 'Vertical',    renderIcon: checked(scroll === ScrollMode.VERTICAL) },
          { id: 'pdf.scroll.horizontal', label: 'Horizontal',  renderIcon: checked(scroll === ScrollMode.HORIZONTAL) },
          { id: 'pdf.scroll.wrapped',    label: 'Wrapped',     renderIcon: checked(scroll === ScrollMode.WRAPPED) },
          { id: 'pdf.scroll.page',       label: 'Single Page', renderIcon: checked(scroll === ScrollMode.PAGE) },
        ],
      },
      { id: 'pdf.print', label: 'Print…', group: 'doc' },
      { id: 'pdf.openExternal', label: 'Open in System Viewer', group: 'doc' },
      ...toolItems,
    ],
    anchor: { x: r.left, y: r.bottom + 4 },
  });

  menu.onDidSelect((e) => {
    const id = e.item.id;
    const toolAction = toolActions.find((a) => `tool:${a.commandId}` === id);
    if (toolAction) {
      // One argument: where the reader is. The command decides what to do with it.
      const file = host.file();
      const commands = host.commands();
      if (!file || !commands) return;
      void commands.executeCommand(toolAction.commandId, {
        uri: file.uri,
        fsPath: file.fsPath,
        page: host.viewer()?.currentPageNumber ?? 1,
      }).catch((err) => console.error(`[PdfEditorPane] "${toolAction.commandId}" failed:`, err));
      return;
    }
    const v = host.viewer();
    if (id === 'pdf.rotate') host.rotate();
    else if (id === 'pdf.print') printFile(host.file()?.fsPath);
    else if (id === 'pdf.openExternal') openExternal(host.file()?.fsPath);
    else if (id.startsWith('pdf.spread.') && v) {
      const mode = id.slice('pdf.spread.'.length);
      v.spreadMode = mode === 'odd' ? SpreadMode.ODD : mode === 'even' ? SpreadMode.EVEN : SpreadMode.NONE;
    } else if (id.startsWith('pdf.scroll.') && v) {
      const mode = id.slice('pdf.scroll.'.length);
      v.scrollMode = mode === 'horizontal' ? ScrollMode.HORIZONTAL
        : mode === 'wrapped' ? ScrollMode.WRAPPED
        : mode === 'page' ? ScrollMode.PAGE
        : ScrollMode.VERTICAL;
    }
  });
  return menu;
}

// The renderer hosts the whole workbench, so window.print() would print the
// app chrome, and the Chromium PDF plugin is disabled. The file goes to the
// system's PDF viewer, which prints it faithfully.
function printFile(fsPath: string | undefined): void {
  if (!fsPath) return;
  const shell = (globalThis as any).parallxElectron?.shell;
  if (shell?.openPath) void shell.openPath(fsPath);
  else window.print();
}

function openExternal(fsPath: string | undefined): void {
  if (!fsPath) return;
  const shell = (globalThis as any).parallxElectron?.shell;
  if (shell?.openPath) void shell.openPath(fsPath);
  else if (shell?.showItemInFolder) void shell.showItemInFolder(fsPath);
}
