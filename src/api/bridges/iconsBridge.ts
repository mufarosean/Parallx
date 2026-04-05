// iconsBridge.ts — bridges parallx.icons to the internal icon registry
//
// Provides read-only access to the Lucide icon registry for extensions.
// No state mutation, no subscriptions — purely a lookup layer.

import { getIcon, hasIcon, getFileTypeIcon } from '../../ui/iconRegistry.js';
import { LUCIDE_ICONS } from '../../ui/iconRegistry.generated.js';
import { FILE_TYPE_ICONS } from '../../ui/fileTypeIcons.js';

/**
 * Bridge for the `parallx.icons` API namespace.
 */
export class IconsBridge {
  private _allIds: string[] | undefined;

  /**
   * Get the SVG markup for an icon by its registry ID.
   * Returns an empty string if the ID is unknown.
   */
  getIcon(id: string): string {
    return getIcon(id);
  }

  /**
   * Check whether an icon ID exists in the registry.
   */
  hasIcon(id: string): boolean {
    return hasIcon(id);
  }

  /**
   * Get all registered icon IDs.
   * Result is cached after first call.
   */
  getAllIconIds(): string[] {
    if (!this._allIds) {
      this._allIds = [...Object.keys(LUCIDE_ICONS), ...Object.keys(FILE_TYPE_ICONS)];
    }
    return this._allIds;
  }

  /**
   * Get an icon wrapped in a styled `<span>` HTML string, ready for innerHTML.
   * Matches the pattern used by `createIconElement()` in the internal registry.
   */
  createIconHtml(id: string, size = 16): string {
    const svg = getIcon(id);
    if (!svg) return '';
    const sized = svg.replace('<svg ', `<svg width="${size}" height="${size}" `);
    return `<span class="svg-icon" style="width:${size}px;height:${size}px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0">${sized}</span>`;
  }

  /**
   * Get the SVG markup for a file-type icon based on file extension.
   */
  getFileTypeIcon(ext: string): string {
    return getFileTypeIcon(ext);
  }
}
