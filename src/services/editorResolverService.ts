// editorResolverService.ts — Editor Resolver Service
//
// Maps file extensions to appropriate EditorInput + EditorPane creators.
// Mirrors VS Code's src/vs/workbench/services/editor/browser/editorResolverService.ts
//
// The resolver is consulted when a file URI is opened. It determines:
//  1. What EditorInput to create (e.g., FileEditorInput for text, ImageEditorInput for images)
//  2. What EditorPane to use for rendering (e.g., TextEditorPane, MarkdownEditorPane)
//
// Registrations are priority-sorted. Higher priority wins for overlapping extensions.

import { Disposable } from '../platform/lifecycle.js';
import { toDisposable, type IDisposable } from '../platform/lifecycle.js';
import { URI } from '../platform/uri.js';
import type { IEditorInput } from '../editor/editorInput.js';
import type { EditorPane } from '../editor/editorPane.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export const enum EditorResolverPriority {
  /** Built-in fallback (e.g., text editor). */
  Builtin = 0,
  /** Default handler for a specific extension set. */
  Default = 100,
  /** User-configurable option. */
  Option = 200,
  /** Exclusive — overrides all others. */
  Exclusive = 300,
}

interface EditorResolverRegistration {
  /** Unique id for this registration (e.g., `parallx.editor.image`). */
  id: string;
  /** Human-readable name (e.g., "Image Viewer"). */
  name: string;
  /** File extensions this registration handles (e.g., `['.png', '.jpg']`). Use `['.*']` for wildcard. */
  extensions: string[];
  /** Priority — higher wins when multiple registrations match. */
  priority: EditorResolverPriority;
  /** Factory for the EditorInput. */
  createInput: (uri: URI) => IEditorInput;
  /** Factory for the EditorPane. */
  createPane: () => EditorPane;
}

interface EditorResolution {
  input: IEditorInput;
  pane: EditorPane;
  registration: EditorResolverRegistration;
}

// ─── EditorResolverService ───────────────────────────────────────────────────

export class EditorResolverService extends Disposable {
  private readonly _registrations: EditorResolverRegistration[] = [];

  constructor() {
    super();
  }

  // ── Registration ──

  /**
   * Register an editor for a set of file extensions.
   * Returns a disposable to unregister.
   */
  registerEditor(registration: EditorResolverRegistration): IDisposable {
    this._registrations.push(registration);
    // Keep sorted by priority descending (highest first)
    this._registrations.sort((a, b) => b.priority - a.priority);

    return toDisposable(() => {
      const idx = this._registrations.indexOf(registration);
      if (idx >= 0) this._registrations.splice(idx, 1);
    });
  }

  // ── Resolution ──

  /**
   * Resolve a URI to the best matching EditorInput + EditorPane.
   * Returns undefined if no registration matches.
   */
  resolve(uri: URI): EditorResolution | undefined {
    const ext = this._getExtension(uri);

    for (const reg of this._registrations) {
      if (this._matches(reg, ext)) {
        return {
          input: reg.createInput(uri),
          pane: reg.createPane(),
          registration: reg,
        };
      }
    }

    return undefined;
  }

  /**
   * Find the registration that would handle a given URI, without creating instances.
   */
  findRegistration(uri: URI): EditorResolverRegistration | undefined {
    const ext = this._getExtension(uri);
    for (const reg of this._registrations) {
      if (this._matches(reg, ext)) return reg;
    }
    return undefined;
  }

  /**
   * Find a registration by its ID.
   */
  findById(id: string): EditorResolverRegistration | undefined {
    return this._registrations.find(r => r.id === id);
  }

  /**
   * Get all registrations.
   */
  getRegistrations(): readonly EditorResolverRegistration[] {
    return this._registrations;
  }

  // ── Internals ──

  private _getExtension(uri: URI): string {
    const name = uri.basename;
    const dotIdx = name.lastIndexOf('.');
    return dotIdx >= 0 ? name.substring(dotIdx).toLowerCase() : '';
  }

  private _matches(reg: EditorResolverRegistration, ext: string): boolean {
    for (const regExt of reg.extensions) {
      if (regExt === '.*') return true; // wildcard
      if (regExt.toLowerCase() === ext) return true;
    }
    return false;
  }
}
