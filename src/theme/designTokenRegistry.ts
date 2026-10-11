// designTokenRegistry.ts — centralized design token registry
//
// Parallel to colorRegistry.ts but for non-color tokens: typography,
// spacing, border-radius, shadows. Tokens are injected as CSS custom
// properties with the `--parallx-` prefix by ThemeService.
//
// VS Code reference: None — Parallx extension.

import type { ThemeType } from './themeTypes.js';
import { TokenRegistry } from './tokenRegistry.js';

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
export class DesignTokenRegistry extends TokenRegistry<DesignTokenDefault> implements IDesignTokenRegistry {
  constructor() { super('parallx', 'Design token'); }
  registerToken(id: string, description: string, defaults: DesignTokenDefault): DesignTokenRegistration { return this.register(id, description, defaults); }
  getRegisteredToken(id: string): DesignTokenRegistration | undefined { return this.get(id); }
  getRegisteredTokens(): ReadonlyArray<DesignTokenRegistration> { return this.list(); }
}

// ─── Singleton Instance ──────────────────────────────────────────────────────

/**
 * The global design token registry instance.
 * Import this from modules that need to register or query design tokens.
 */
export const designTokenRegistry = new DesignTokenRegistry();
