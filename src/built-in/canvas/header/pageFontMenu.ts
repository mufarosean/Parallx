// pageFontMenu.ts — the page menu's Font section: the current font, the
// list to pick from (with set-as-default and remove), and the upload.

import type { IPage } from '../canvasTypes.js';
import { $ } from '../../../ui/dom.js';
import { createIconElement } from '../config/blockRegistry.js';
import {
listFonts, getWorkspaceDefaultFontId, setWorkspaceDefaultFontId,
registerCustomFont, removeCustomFont, fontFormatFromExtension, type CanvasFont, getFont } from '../config/fontRegistry.js';
import { declareControl, sceneSlug } from '../../../ui/kit.js';

export interface IFontSectionHost {
readonly page: IPage | null;
readonly locked: boolean;
/** Sets the page's font ('default' for none). */
applyFont(id: string): void;
}

export function buildFontSection(dd: HTMLElement, host: IFontSectionHost): void {

  const fontLabel = $('div.canvas-page-menu-label');
  fontLabel.textContent = 'Font';
  dd.appendChild(fontLabel);

  const currentId = host.page?.fontFamily || 'default';

  // One row shows the current font (in its own face). Clicking it opens the
  // list below; picking a font closes it again. The menu used to spend half
  // its height on every font at once.
  const current = $('button.canvas-page-menu-font-current');
  const currentName = $('span.canvas-page-menu-font-current-name');
  const paintCurrent = (): void => {
    const font = getFont(host.page?.fontFamily || 'default') ?? getFont('default');
    currentName.textContent = font?.label ?? 'Default';
    currentName.style.fontFamily = font?.stack ?? '';
  };
  current.appendChild(currentName);
  current.appendChild(createIconElement('chevron-down', 12));
  current.title = 'Choose the font for this page.';
  current.setAttribute('aria-haspopup', 'listbox');
  declareControl(current, { id: 'canvas.font.current', label: 'Font', hint: current.title, state: () => ({ kind: 'value', value: currentName.textContent ?? '' }) });
  dd.appendChild(current);

  const list = $('div.canvas-page-menu-font-list');
  list.hidden = true;
  if (host.locked) {
    current.setAttribute('aria-disabled', 'true');
    current.title = 'This page is locked.';
  }
  current.addEventListener('click', (e) => {
    e.stopPropagation();
    if (host.locked) return;
    list.hidden = !list.hidden;
    current.classList.toggle('canvas-page-menu-font-current--open', !list.hidden);
  });

  const refreshDefaultBadges = (): void => {
    const defId = getWorkspaceDefaultFontId();
    list.querySelectorAll<HTMLElement>('.canvas-page-menu-font-row').forEach((row) => {
      const isDef = row.dataset.fontId === defId;
      row.classList.toggle('canvas-page-menu-font-row--default', isDef);
    });
  };

  const renderRow = (font: CanvasFont): void => {
    const row = $('div.canvas-page-menu-font-row');
    row.dataset.fontId = font.id;
    if (font.id === currentId) row.classList.add('canvas-page-menu-font-row--active');

    // The name previews itself in its own font.
    const pick = $('button.canvas-page-menu-font-pick');
    pick.style.fontFamily = font.stack;
    const name = $('span.canvas-page-menu-font-name');
    name.textContent = font.label;
    pick.appendChild(name);
    declareControl(pick, { id: `canvas.font.pick.${sceneSlug(font.id)}`, label: font.label, state: () => ({ kind: 'pressed', value: row.classList.contains('canvas-page-menu-font-row--active') }) });
    const defBadge = $('span.canvas-page-menu-font-default-badge');
    defBadge.textContent = 'default';
    pick.appendChild(defBadge);
    pick.addEventListener('click', () => {
      if (host.locked) return;
      host.applyFont(font.id);
      list.querySelectorAll('.canvas-page-menu-font-row').forEach((r) => r.classList.remove('canvas-page-menu-font-row--active'));
      row.classList.add('canvas-page-menu-font-row--active');
      currentName.textContent = font.label;
      currentName.style.fontFamily = font.stack;
      list.hidden = true;
      current.classList.remove('canvas-page-menu-font-current--open');
    });
    row.appendChild(pick);

    const actions = $('span.canvas-page-menu-font-actions');
    const setDefault = $('button.canvas-page-menu-font-action');
    setDefault.classList.add('canvas-page-menu-font-action--pin');
    setDefault.title = 'Set as default for new pages';
    declareControl(setDefault, { id: `canvas.font.default.${sceneSlug(font.id)}`, label: `Set ${font.label} as default`, kind: 'iconButton' });
    setDefault.appendChild(createIconElement('pin', 12));
    setDefault.addEventListener('click', (e) => {
      e.stopPropagation();
      void setWorkspaceDefaultFontId(font.id).then(refreshDefaultBadges);
    });
    actions.appendChild(setDefault);

    if (font.source === 'custom') {
      const del = $('button.canvas-page-menu-font-action');
      del.classList.add('canvas-page-menu-font-action--danger');
      del.title = 'Remove custom font';
      declareControl(del, { id: `canvas.font.remove.${sceneSlug(font.id)}`, label: `Remove ${font.label}`, kind: 'iconButton' });
      del.appendChild(createIconElement('trash', 12));
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        void removeCustomFont(font.id).then(() => {
          if (host.page?.fontFamily === font.id) {
            host.applyFont('default');
          }
          row.remove();
        });
      });
      actions.appendChild(del);
    }
    row.appendChild(actions);
    list.appendChild(row);
  };

  for (const font of listFonts()) renderRow(font);
  dd.appendChild(list);
  refreshDefaultBadges();
  paintCurrent();

  const upload = $('button.canvas-page-menu-font-upload');
  upload.appendChild(createIconElement('upload', 13));
  const uploadLabel = $('span');
  uploadLabel.textContent = ' Upload font…';
  declareControl(upload, { id: 'canvas.font.upload', label: 'Upload font…' });
  upload.appendChild(uploadLabel);
  upload.addEventListener('click', (e) => {
    e.stopPropagation();
    void uploadCustomFont(host, list, renderRow);
  });
  list.appendChild(upload);
}

/**
 * Prompt for a font file, embed it as a data URL, register it, and apply it
 * to the current page. Mirrors the cover-image upload flow.
 */
async function uploadCustomFont(
host: IFontSectionHost,
list: HTMLElement,
renderRow: (font: CanvasFont) => void,
): Promise<void> {
  const electron = (window as any).parallxElectron;
  if (!electron?.dialog?.openFile || !electron?.fs?.readFile) return;

  const filePaths = await electron.dialog.openFile({
    title: 'Upload font',
    filters: [{ name: 'Fonts', extensions: ['woff2', 'woff', 'ttf', 'otf'] }],
    properties: ['openFile'],
  });
  const filePath = Array.isArray(filePaths) ? filePaths[0] : filePaths;
  if (!filePath || typeof filePath !== 'string') return;

  const ext = filePath.split('.').pop() ?? '';
  const fmt = fontFormatFromExtension(ext);
  if (!fmt) return;

  const result = await electron.fs.readFile(filePath);
  if (!result?.content || result.encoding !== 'base64') return;
  // Guard against bloating the workspace settings file. ~3.2M base64 chars
  // ≈ 2.4 MB of font bytes — plenty for a woff2/ttf face.
  if (result.content.length > 3_200_000) {
    console.warn('[canvas] custom font too large — pick a woff2 under ~2 MB');
    return;
  }

  const dataUrl = `data:${fmt.mime};base64,${result.content}`;
  const rawName = (filePath.split(/[\\/]/).pop() ?? 'Custom font').replace(/\.[^.]+$/, '');
  const label = rawName.replace(/[_-]+/g, ' ').trim() || 'Custom font';

  const font = await registerCustomFont(label, dataUrl, fmt.format);
  // Show the new font in the open list and apply it to the current page.
  if (!list.querySelector(`[data-font-id="${font.id}"]`)) renderRow(font);
  host.applyFont(font.id);
}
