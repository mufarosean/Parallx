// themeData.ts — theme data model and parser
//
// Defines the JSON format for theme files and provides a typed parser.
// VS Code reference: src/vs/workbench/services/themes/common/colorThemeData.ts

import { ThemeType } from './themeTypes.js';
import type { ThemeSource, IColorTheme } from './themeTypes.js';
export type { ThemeSource, IColorTheme } from './themeTypes.js';
import { IColorRegistry } from './colorRegistry.js';

// ─── ColorThemeData ──────────────────────────────────────────────────────────

/**
 * Parsed and resolved theme data.
 *
 * VS Code reference: ColorThemeData in src/vs/workbench/services/themes/common/colorThemeData.ts
 */
export class ColorThemeData implements IColorTheme {
  readonly id: string;
  readonly label: string;
  readonly type: ThemeType;
  private readonly _colors: Map<string, string>;

  private constructor(id: string, label: string, type: ThemeType, colors: Map<string, string>) {
    this.id = id;
    this.label = label;
    this.type = type;
    this._colors = colors;
  }

  getColor(colorId: string): string | undefined {
    return this._colors.get(colorId);
  }

  /**
   * Parse a raw ThemeSource into a resolved ColorThemeData.
   * Validates color keys against the registry and logs warnings for unknown keys.
   */
  static fromSource(source: ThemeSource, registry: IColorRegistry): ColorThemeData {
    const type = uiThemeToThemeType(source.uiTheme);
    const colors = new Map<string, string>();

    for (const [key, value] of Object.entries(source.colors)) {
      const registered = registry.getRegisteredColor(key);
      if (!registered) {
        console.warn(`[ThemeData] Unknown color key '${key}' in theme '${source.id}' — ignoring`);
        continue;
      }
      colors.set(key, value);
    }

    return new ColorThemeData(source.id, source.label, type, colors);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Converts uiTheme string to ThemeType enum.
 */
function uiThemeToThemeType(uiTheme: string): ThemeType {
  switch (uiTheme) {
    case 'vs-dark': return ThemeType.DARK;
    case 'vs': return ThemeType.LIGHT;
    case 'hc-black': return ThemeType.HIGH_CONTRAST_DARK;
    case 'hc-light': return ThemeType.HIGH_CONTRAST_LIGHT;
    default: return ThemeType.DARK;
  }
}
