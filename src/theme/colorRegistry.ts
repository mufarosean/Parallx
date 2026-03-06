// colorRegistry.ts — centralized workbench color token registry
//
// Defines every color token used by the Parallx workbench.
// Each registration declares a key (matching VS Code naming), description,
// and default values per theme type. CSS files reference only registered tokens.
//
// VS Code reference: src/vs/platform/theme/common/colorRegistry.ts

import { ThemeType } from './themeTypes.js';
export { ThemeType } from './themeTypes.js';

// ─── Color Default ───────────────────────────────────────────────────────────

/**
 * Default color values for each theme type.
 * Each value is a CSS color string (hex, rgb, rgba, transparent, inherit, etc.).
 */
interface ColorDefault {
  readonly dark: string;
  readonly light: string;
  readonly hcDark: string;
  readonly hcLight: string;
}

// ─── Color Registration ──────────────────────────────────────────────────────

/**
 * A registered color token with its key, description, and defaults.
 */
interface ColorRegistration {
  readonly id: string;
  readonly description: string;
  readonly defaults: ColorDefault;
}

// ─── IColorRegistry ──────────────────────────────────────────────────────────

/**
 * The color registry interface.
 */
export interface IColorRegistry {
  /**
   * Register a color token. Throws if duplicate ID.
   */
  registerColor(id: string, description: string, defaults: ColorDefault): ColorRegistration;

  /**
   * Returns a registered color by ID, or undefined if not found.
   */
  getRegisteredColor(id: string): ColorRegistration | undefined;

  /**
   * Returns all registered colors.
   */
  getRegisteredColors(): ReadonlyArray<ColorRegistration>;

  /**
   * Resolves the default value for a color ID and theme type.
   * Returns undefined if the color is not registered.
   */
  resolveDefault(id: string, themeType: ThemeType): string | undefined;

  /**
   * Converts a color ID to a CSS custom property name.
   * e.g., 'editor.background' → '--vscode-editor-background'
   */
  asCssVariableName(id: string): string;

  /**
   * Returns the number of registered colors.
   */
  readonly size: number;
}

// ─── ColorRegistry Implementation ────────────────────────────────────────────

/**
 * Central registry of all workbench color tokens.
 *
 * VS Code reference: ColorRegistry in src/vs/platform/theme/common/colorRegistry.ts
 */
export class ColorRegistry implements IColorRegistry {
  private readonly _colors = new Map<string, ColorRegistration>();

  registerColor(id: string, description: string, defaults: ColorDefault): ColorRegistration {
    if (this._colors.has(id)) {
      throw new Error(`Color '${id}' is already registered`);
    }
    const registration: ColorRegistration = { id, description, defaults };
    this._colors.set(id, registration);
    return registration;
  }

  getRegisteredColor(id: string): ColorRegistration | undefined {
    return this._colors.get(id);
  }

  getRegisteredColors(): ReadonlyArray<ColorRegistration> {
    return [...this._colors.values()];
  }

  resolveDefault(id: string, themeType: ThemeType): string | undefined {
    const reg = this._colors.get(id);
    if (!reg) { return undefined; }
    switch (themeType) {
      case ThemeType.DARK: return reg.defaults.dark;
      case ThemeType.LIGHT: return reg.defaults.light;
      case ThemeType.HIGH_CONTRAST_DARK: return reg.defaults.hcDark;
      case ThemeType.HIGH_CONTRAST_LIGHT: return reg.defaults.hcLight;
    }
  }

  /**
   * Converts 'editor.background' → '--vscode-editor-background'
   * Dots become hyphens within the key.
   *
   * VS Code reference: asCssVariableName() in src/vs/platform/theme/common/colorUtils.ts
   */
  asCssVariableName(id: string): string {
    return `--vscode-${id.replace(/\./g, '-')}`;
  }

  get size(): number {
    return this._colors.size;
  }
}

// ─── Singleton Instance ──────────────────────────────────────────────────────

/**
 * The global color registry instance.
 * Import this from modules that need to register or query colors.
 */
export const colorRegistry = new ColorRegistry();

// ─── Built-in Color Registrations ────────────────────────────────────────────
// Note: Core workbench colors (foreground, background, editor, list, input,
// button, badge, menu, scrollbar, etc.) are registered in workbenchColors.ts.
// Only tokens NOT covered there are registered below.

// --- Layout & Structure (supplemental) ---

colorRegistry.registerColor('widget.border', 'Border color for floating widgets', {
  dark: 'rgba(255, 255, 255, 0.08)',
  light: 'rgba(0, 0, 0, 0.1)',
  hcDark: '#6FC3DF',
  hcLight: '#0F4A85',
});

// --- List (supplemental) ---

colorRegistry.registerColor('list.dropBackground', 'Background color when dragging over a valid drop target', {
  dark: 'rgba(35, 131, 226, 0.17)',
  light: 'rgba(35, 131, 226, 0.12)',
  hcDark: 'rgba(35, 131, 226, 0.3)',
  hcLight: 'rgba(35, 131, 226, 0.2)',
});

// --- Editor (supplemental) ---

colorRegistry.registerColor('editor.selectionBackground', 'Background for selected text in the editor', {
  dark: 'rgba(38, 79, 120, 0.6)',
  light: 'rgba(173, 214, 255, 0.6)',
  hcDark: 'rgba(38, 79, 120, 0.8)',
  hcLight: 'rgba(0, 90, 180, 0.3)',
});

colorRegistry.registerColor('editor.findMatchBackground', 'Background for the current active find match', {
  dark: 'rgba(81, 92, 106, 0.6)',
  light: 'rgba(161, 222, 253, 0.6)',
  hcDark: 'rgba(81, 92, 106, 0.8)',
  hcLight: 'rgba(161, 222, 253, 0.8)',
});

colorRegistry.registerColor('editor.hoverHighlightBackground', 'Background when hovering a reference', {
  dark: 'rgba(38, 79, 120, 0.25)',
  light: 'rgba(173, 214, 255, 0.4)',
  hcDark: 'rgba(38, 79, 120, 0.4)',
  hcLight: 'rgba(0, 90, 180, 0.2)',
});

// --- Diff Editor ---

colorRegistry.registerColor('diffEditor.insertedLineBackground', 'Background for inserted lines in diff', {
  dark: 'rgba(129, 184, 139, 0.12)',
  light: 'rgba(129, 184, 139, 0.2)',
  hcDark: 'rgba(129, 184, 139, 0.2)',
  hcLight: 'rgba(0, 150, 50, 0.15)',
});

colorRegistry.registerColor('diffEditor.removedLineBackground', 'Background for removed lines in diff', {
  dark: 'rgba(199, 78, 57, 0.12)',
  light: 'rgba(199, 78, 57, 0.2)',
  hcDark: 'rgba(199, 78, 57, 0.2)',
  hcLight: 'rgba(200, 50, 30, 0.15)',
});

// --- Validation ---

colorRegistry.registerColor('inputValidation.errorBackground', 'Background for input validation errors', {
  dark: 'rgba(244, 71, 71, 0.06)',
  light: 'rgba(244, 71, 71, 0.08)',
  hcDark: 'rgba(244, 71, 71, 0.1)',
  hcLight: 'rgba(220, 0, 0, 0.08)',
});

colorRegistry.registerColor('inputValidation.errorBorder', 'Border for input validation errors', {
  dark: 'rgba(220, 38, 38, 0.4)',
  light: 'rgba(220, 38, 38, 0.5)',
  hcDark: '#f48771',
  hcLight: '#b5200d',
});

// --- Testing ---

colorRegistry.registerColor('testing.iconPassed', 'Color for passed tests / success status', {
  dark: '#73c991',
  light: '#388a34',
  hcDark: '#73c991',
  hcLight: '#388a34',
});

colorRegistry.registerColor('testing.iconFailed', 'Color for failed tests / error status', {
  dark: '#f14c4c',
  light: '#f14c4c',
  hcDark: '#f14c4c',
  hcLight: '#b5200d',
});

// --- Warning ---

colorRegistry.registerColor('editorWarning.foreground', 'Warning squiggly / warning indicator color', {
  dark: '#cca700',
  light: '#bf8803',
  hcDark: '#cca700',
  hcLight: '#945d00',
});

// --- Terminal ---

colorRegistry.registerColor('terminal.ansiGreen', 'Terminal ANSI green', {
  dark: '#6a9955',
  light: '#388a34',
  hcDark: '#89d185',
  hcLight: '#388a34',
});

colorRegistry.registerColor('terminal.ansiBlue', 'Terminal ANSI blue', {
  dark: '#569cd6',
  light: '#0451a5',
  hcDark: '#9cdcfe',
  hcLight: '#0451a5',
});

colorRegistry.registerColor('terminal.ansiCyan', 'Terminal ANSI cyan', {
  dark: '#4ec9b0',
  light: '#0598bc',
  hcDark: '#4ec9b0',
  hcLight: '#0598bc',
});

// --- Syntax Highlighting ---

colorRegistry.registerColor('debugTokenExpression.string', 'Token color for strings', {
  dark: '#ce9178',
  light: '#a31515',
  hcDark: '#ce9178',
  hcLight: '#a31515',
});

colorRegistry.registerColor('debugTokenExpression.name', 'Token color for names / keywords', {
  dark: '#569cd6',
  light: '#0451a5',
  hcDark: '#9cdcfe',
  hcLight: '#0451a5',
});

colorRegistry.registerColor('debugTokenExpression.number', 'Token color for numbers', {
  dark: '#b5cea8',
  light: '#098658',
  hcDark: '#b5cea8',
  hcLight: '#098658',
});

colorRegistry.registerColor('debugTokenExpression.type', 'Token color for types', {
  dark: '#4ec9b0',
  light: '#267f99',
  hcDark: '#4ec9b0',
  hcLight: '#267f99',
});

colorRegistry.registerColor('debugTokenExpression.error', 'Token color for errors / regex', {
  dark: '#d16969',
  light: '#cd3131',
  hcDark: '#d16969',
  hcLight: '#cd3131',
});

colorRegistry.registerColor('symbolIcon.functionForeground', 'Color for function symbol icons', {
  dark: '#dcdcaa',
  light: '#795e26',
  hcDark: '#dcdcaa',
  hcLight: '#795e26',
});

// --- Title Bar ---

colorRegistry.registerColor('titleBar.closeForeground', 'Color for the window close button', {
  dark: '#e81123',
  light: '#e81123',
  hcDark: '#ffffff',
  hcLight: '#e81123',
});
