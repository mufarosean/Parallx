// colorRegistry.ts — centralized workbench color token registry
//
// Defines every color token used by the Parallx workbench.
// Each registration declares a key (matching VS Code naming), description,
// and default values per theme type. CSS files reference only registered tokens.
//
// VS Code reference: src/vs/platform/theme/common/colorRegistry.ts

// ─── Theme Type ──────────────────────────────────────────────────────────────

/**
 * The type of a color theme, matching VS Code's ColorSchemeType.
 */
export enum ThemeType {
  DARK = 'dark',
  LIGHT = 'light',
  HIGH_CONTRAST_DARK = 'hc-dark',
  HIGH_CONTRAST_LIGHT = 'hc-light',
}

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
