// pageFontMenu.ts — the page menu's Font submenu: every font (each with a
// sample in its own face), the default for new pages, the upload, and the
// removal of an uploaded font.

import type { IPage } from '../canvasTypes.js';
import type { IExtensionMenuItem } from '../../../ui/contextMenu.js';
import {
listFonts, getWorkspaceDefaultFontId, setWorkspaceDefaultFontId,
registerCustomFont, removeCustomFont, fontFormatFromExtension } from '../config/fontRegistry.js';

export interface IFontSectionHost {
readonly page: IPage | null;
/** Sets the page's font ('default' for none). */
applyFont(id: string): void;
}

/** The Font submenu's rows. */
export function fontMenuItems(host: IFontSectionHost): IExtensionMenuItem[] {
  const currentId = host.page?.fontFamily || 'default';
  const defaultId = getWorkspaceDefaultFontId();
  const fonts = listFonts();
  const custom = fonts.filter((f) => f.source === 'custom');
  const current = fonts.find((f) => f.id === currentId);

  const items: IExtensionMenuItem[] = fonts.map((font) => ({
    label: font.label,
    checked: font.id === currentId,
    onSelect: () => host.applyFont(font.id),
  }));
  items.push({ separator: true });
  items.push({
    label: 'Use for New Pages',
    checked: currentId === defaultId,
    tooltip: current ? `New pages start in ${current.label}.` : undefined,
    onSelect: () => { void setWorkspaceDefaultFontId(currentId); },
  });
  items.push({ label: 'Upload Font…', onSelect: () => { void uploadCustomFont(host); } });
  if (custom.length > 0) {
    items.push({
      label: 'Remove Uploaded Font',
      submenu: custom.map((font) => ({
        label: font.label,
        danger: true,
        onSelect: () => {
          void removeCustomFont(font.id).then(() => {
            if (host.page?.fontFamily === font.id) host.applyFont('default');
          });
        },
      })),
    });
  }
  return items;
}

/**
 * Prompt for a font file, embed it as a data URL, register it, and apply it
 * to the current page. Mirrors the cover-image upload flow.
 */
async function uploadCustomFont(host: IFontSectionHost): Promise<void> {
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
  host.applyFont(font.id);
}
