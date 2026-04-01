// designTokenRegistry.ts — centralized design token registry
//
// Parallel to colorRegistry.ts but for non-color tokens: typography,
// spacing, border-radius, shadows. Tokens are injected as CSS custom
// properties with the `--parallx-` prefix by ThemeService.
//
// VS Code reference: None — Parallx extension.

import { ThemeType } from './themeTypes.js';

// ─── Token Default ───────────────────────────────────────────────────────────

/**
 * Default token values for each theme type.
 * Each value is a CSS value string appropriate for the token category.
 */
export interface DesignTokenDefault {
  readonly dark: string;
  readonly light: string;
  readonly hcDark: string;
  readonly hcLight: string;
}

// ─── Token Registration ──────────────────────────────────────────────────────

/**
 * A registered design token with its key, description, and defaults.
 */
export interface DesignTokenRegistration {
  readonly id: string;
  readonly description: string;
  readonly defaults: DesignTokenDefault;
}

// ─── IDesignTokenRegistry ────────────────────────────────────────────────────

/**
 * The design token registry interface.
 */
export interface IDesignTokenRegistry {
  /**
   * Register a design token. Throws if duplicate ID.
   */
  registerToken(id: string, description: string, defaults: DesignTokenDefault): DesignTokenRegistration;

  /**
   * Returns a registered token by ID, or undefined if not found.
   */
  getRegisteredToken(id: string): DesignTokenRegistration | undefined;

  /**
   * Returns all registered tokens.
   */
  getRegisteredTokens(): ReadonlyArray<DesignTokenRegistration>;

  /**
   * Resolves the default value for a token ID and theme type.
   * Returns undefined if the token is not registered.
   */
  resolveDefault(id: string, themeType: ThemeType): string | undefined;

  /**
   * Converts a token ID to a CSS custom property name.
   * e.g., 'fontFamily.ui' → '--parallx-fontFamily-ui'
   */
  asCssVariableName(id: string): string;

  /**
   * Returns the number of registered tokens.
   */
  readonly size: number;
}

// ─── DesignTokenRegistry Implementation ──────────────────────────────────────

/**
 * Central registry of all workbench design tokens (non-color).
 */
export class DesignTokenRegistry implements IDesignTokenRegistry {
  private readonly _tokens = new Map<string, DesignTokenRegistration>();

  registerToken(id: string, description: string, defaults: DesignTokenDefault): DesignTokenRegistration {
    if (this._tokens.has(id)) {
      throw new Error(`Design token '${id}' is already registered`);
    }
    const registration: DesignTokenRegistration = { id, description, defaults };
    this._tokens.set(id, registration);
    return registration;
  }

  getRegisteredToken(id: string): DesignTokenRegistration | undefined {
    return this._tokens.get(id);
  }

  getRegisteredTokens(): ReadonlyArray<DesignTokenRegistration> {
    return [...this._tokens.values()];
  }

  resolveDefault(id: string, themeType: ThemeType): string | undefined {
    const reg = this._tokens.get(id);
    if (!reg) { return undefined; }
    switch (themeType) {
      case ThemeType.DARK: return reg.defaults.dark;
      case ThemeType.LIGHT: return reg.defaults.light;
      case ThemeType.HIGH_CONTRAST_DARK: return reg.defaults.hcDark;
      case ThemeType.HIGH_CONTRAST_LIGHT: return reg.defaults.hcLight;
    }
  }

  /**
   * Converts 'fontFamily.ui' → '--parallx-fontFamily-ui'
   * Dots become hyphens within the key.
   */
  asCssVariableName(id: string): string {
    return `--parallx-${id.replace(/\./g, '-')}`;
  }

  get size(): number {
    return this._tokens.size;
  }
}

// ─── Singleton Instance ──────────────────────────────────────────────────────

/**
 * The global design token registry instance.
 * Import this from modules that need to register or query design tokens.
 */
export const designTokenRegistry = new DesignTokenRegistry();
