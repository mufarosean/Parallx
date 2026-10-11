// tokenRegistry.ts — one registry shape for colour tokens and design tokens.
//
// A token has an id ("editor.background", "fontFamily.ui"), a description
// and a default per theme type, and becomes a CSS custom property under a
// prefix. ColorRegistry and DesignTokenRegistry are this class with a
// prefix each; they keep their own method names for their callers.

import { ThemeType } from './themeTypes.js';

/** A value per theme type. */
export interface TokenDefaults {
  readonly dark: string;
  readonly light: string;
  readonly hcDark: string;
  readonly hcLight: string;
}

export interface TokenRegistration<D extends TokenDefaults = TokenDefaults> {
  readonly id: string;
  readonly description: string;
  readonly defaults: D;
}

export class TokenRegistry<D extends TokenDefaults = TokenDefaults> {
  private readonly _tokens = new Map<string, TokenRegistration<D>>();

  constructor(private readonly _cssPrefix: string, private readonly _kind: string) {}

  /** Register a token. Throws if the id is taken. */
  register(id: string, description: string, defaults: D): TokenRegistration<D> {
    if (this._tokens.has(id)) {
      throw new Error(`${this._kind} '${id}' is already registered`);
    }
    const registration: TokenRegistration<D> = { id, description, defaults };
    this._tokens.set(id, registration);
    return registration;
  }

  get(id: string): TokenRegistration<D> | undefined {
    return this._tokens.get(id);
  }

  list(): ReadonlyArray<TokenRegistration<D>> {
    return [...this._tokens.values()];
  }

  /** The default value for a token under a theme type; undefined when unregistered. */
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

  /** 'editor.background' → '--<prefix>-editor-background': dots become hyphens. */
  asCssVariableName(id: string): string {
    return `--${this._cssPrefix}-${id.replace(/\./g, '-')}`;
  }

  get size(): number {
    return this._tokens.size;
  }
}
