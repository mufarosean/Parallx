// toolModuleLoader.ts — loads tool entry point modules
//
// Imports a tool's `main` entry point via dynamic import() and extracts
// the `activate` and optional `deactivate` exports. In M2, tools run
// in-process — no separate worker or extension host process.

import type { IToolDescription } from './toolManifest.js';
import type { ToolModule, ActivateFunction, DeactivateFunction } from './toolTypes.js';
export type { ToolContext, ActivateFunction, DeactivateFunction, ToolModule } from './toolTypes.js';

/**
 * Minimal Memento interface for tool state.
 * Canonical definition lives in configuration/configurationTypes.ts.
 */
import type { Memento } from '../configuration/configurationTypes.js';
export type { Memento };

/**
 * Result of a module load attempt.
 */
type LoadModuleResult =
  | { success: true; module: ToolModule }
  | { success: false; error: string };

// ─── ToolModuleLoader ────────────────────────────────────────────────────────

/**
 * Loads tool entry point modules via dynamic import().
 *
 * Supports:
 * - `.js` and `.ts` (compiled) entry points
 * - Built-in tools (path relative to source tree)
 * - External tools (path relative to manifest directory)
 * - Clear error reporting for syntax errors, missing files, etc.
 */
export class ToolModuleLoader {

  /**
   * Load a tool's entry point module.
   *
   * Built-in tools are loaded via the existing file:// URL path.
   * External tools are loaded via the Electron IPC bridge: the main process
   * reads the JS source, the renderer creates a blob URL, and dynamic import()
   * loads it. This avoids Chromium's cross-origin restriction that blocks
   * file:// imports from an http:// origin.
   *
   * @param toolDescription The tool description containing manifest and toolPath.
   * @returns A LoadModuleResult indicating success or failure.
   */
  async loadModule(toolDescription: IToolDescription): Promise<LoadModuleResult> {
    const { manifest, toolPath, isBuiltin } = toolDescription;
    const mainEntry = manifest.main;

    let rawModule: Record<string, unknown>;

    if (isBuiltin) {
      // ── Built-in tools: existing file:// URL path (unchanged) ──
      const resolvedPath = this._resolveEntryPath(toolPath, mainEntry);
      console.log(`[ToolModuleLoader] Loading built-in tool "${manifest.id}" from: ${resolvedPath}`);

      try {
        rawModule = await import(/* webpackIgnore: true */ resolvedPath);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          error: `Failed to load module for tool "${manifest.id}" at "${resolvedPath}": ${errorMsg}`,
        };
      }
    } else {
      // ── External tools: blob URL path via IPC ──
      const resolvedFsPath = this._resolveFileSystemPath(toolPath, mainEntry);
      console.log(`[ToolModuleLoader] Loading external tool "${manifest.id}" from: ${resolvedFsPath}`);

      try {
        rawModule = await this._loadViaBlob(manifest.id, resolvedFsPath);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          error: `Failed to load module for tool "${manifest.id}" at "${resolvedFsPath}": ${errorMsg}`,
        };
      }
    }

    // Validate the module exports an `activate` function
    if (typeof rawModule.activate !== 'function') {
      return {
        success: false,
        error: `Tool "${manifest.id}" module does not export an "activate" function. ` +
               `Found exports: [${Object.keys(rawModule).join(', ')}]`,
      };
    }

    // Check for optional `deactivate`
    const deactivate = typeof rawModule.deactivate === 'function'
      ? rawModule.deactivate as DeactivateFunction
      : undefined;

    if (rawModule.deactivate !== undefined && typeof rawModule.deactivate !== 'function') {
      console.warn(
        `[ToolModuleLoader] Tool "${manifest.id}" exports "deactivate" but it is not a function (${typeof rawModule.deactivate}). Ignoring.`,
      );
    }

    return {
      success: true,
      module: {
        activate: rawModule.activate as ActivateFunction,
        deactivate,
        rawModule,
      },
    };
  }

  /**
   * Resolve the entry path for a tool module.
   *
   * External tools live on disk and are loaded via dynamic `import()` in the
   * Electron renderer. The browser's `import()` requires a URL, so we convert
   * absolute filesystem paths to `file:///` URLs. This mirrors VS Code's
   * extension loader which converts paths before calling `require()` /
   * `import()` inside the Extension Host.
   *
   * The returned value is always a `file:///` URL for external (non-builtin)
   * tools, ensuring the browser's module loader can find the file and resolve
   * any relative imports within the tool directory.
   */
  private _resolveEntryPath(toolPath: string, mainEntry: string): string {
    // Security: reject http/https URLs to prevent remote code execution
    if (mainEntry.startsWith('http://') || mainEntry.startsWith('https://')) {
      throw new Error(
        `Refusing to load remote entry point "${mainEntry}". ` +
        `Tool entry points must be local file paths.`,
      );
    }

    // Already a file: URL — use as-is
    if (mainEntry.startsWith('file:')) {
      return mainEntry;
    }

    // Absolute POSIX path
    if (mainEntry.startsWith('/')) {
      return this._pathToFileUrl(mainEntry);
    }

    // Absolute Windows path (e.g., C:\Users\...)
    if (/^[A-Za-z]:[\\/]/.test(mainEntry)) {
      return this._pathToFileUrl(mainEntry);
    }

    // Relative path — resolve against toolPath, then convert to file:// URL
    const sep = toolPath.includes('\\') ? '\\' : '/';
    const base = toolPath.endsWith('/') || toolPath.endsWith('\\')
      ? toolPath
      : toolPath + sep;
    const resolved = base + mainEntry;

    // If toolPath looks like a real filesystem path, convert to file:// URL
    if (/^[A-Za-z]:[\\/]/.test(resolved) || resolved.startsWith('/')) {
      return this._pathToFileUrl(resolved);
    }

    // Built-in tools use a virtual path like "built-in/parallx.explorer"
    // — these are never loaded via ToolModuleLoader (activateBuiltin skips it)
    return resolved;
  }

  /**
   * Convert a filesystem path to a file:// URL.
   * Handles Windows drive letters (C:\...) and POSIX paths alike.
   */
  private _pathToFileUrl(fsPath: string): string {
    // Normalize backslashes to forward slashes
    let normalized = fsPath.replace(/\\/g, '/');

    // Windows drive letter: ensure leading slash (C:/... → /C:/...)
    if (/^[A-Za-z]:\//.test(normalized)) {
      normalized = '/' + normalized;
    }

    return 'file://' + normalized;
  }

  // ── External tool loading (blob URL path) ──────────────────────────────────

  /**
   * Load an external tool module by reading its source via IPC and importing
   * from a blob URL.
   *
   * Chromium blocks dynamic import() of file:// URLs from http:// origins.
   * Instead, we ask the Electron main process to read the file, then create
   * a blob URL and import that.
   */
  private async _loadViaBlob(toolId: string, fsPath: string): Promise<Record<string, unknown>> {
    const bridge = (globalThis as any).parallxElectron;
    if (!bridge?.readToolModule) {
      throw new Error('No Electron bridge for tool module loading');
    }
    // A blob URL cannot resolve a relative import, so every `./x.js` the
    // entry (or anything it imports) names is read and given a blob URL of
    // its own first, and the specifiers are rewritten to those URLs. That
    // is what lets an extension be more than one file.
    const created: string[] = [];
    const done = new Map<string, string>();
    const inProgress = new Set<string>();
    const blobUrlFor = async (modulePath: string): Promise<string> => {
      const key = modulePath.replace(/\\/g, '/').toLowerCase();
      const known = done.get(key);
      if (known) return known;
      if (inProgress.has(key)) {
        throw new Error(`Tool "${toolId}": circular import at "${modulePath}" (relative imports between an external tool's files must not form a cycle)`);
      }
      inProgress.add(key);
      const result = await bridge.readToolModule(modulePath);
      if (result.error) {
        throw new Error(`${result.error} (while loading "${modulePath}")`);
      }
      let source = String(result.source);
      const specifiers = collectRelativeImports(source);
      if (specifiers.length > 0) {
        const urls = new Map<string, string>();
        for (const spec of specifiers) {
          urls.set(spec, await blobUrlFor(resolveRelativeModulePath(modulePath, spec)));
        }
        source = rewriteRelativeImports(source, (spec) => urls.get(spec) ?? spec);
      }
      const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      created.push(url);
      done.set(key, url);
      inProgress.delete(key);
      return url;
    };
    try {
      const entryUrl = await blobUrlFor(fsPath);
      return await import(/* webpackIgnore: true */ entryUrl);
    } finally {
      // The module graph is linked and evaluated once the import resolves;
      // the URLs are only needed until then.
      for (const url of created) URL.revokeObjectURL(url);
    }
  }

  /**
   * Resolve the filesystem path for an external tool's entry module.
   * Returns an absolute filesystem path (not a URL).
   */
  private _resolveFileSystemPath(toolPath: string, mainEntry: string): string {
    // Security: reject http/https URLs to prevent remote code execution
    if (mainEntry.startsWith('http://') || mainEntry.startsWith('https://')) {
      throw new Error(
        `Refusing to load remote entry point "${mainEntry}". ` +
        `Tool entry points must be local file paths.`,
      );
    }

    // Strip file:// prefix if present
    if (mainEntry.startsWith('file:///')) {
      const stripped = mainEntry.slice(7);
      // Windows: file:///C:/... → C:/...
      return /^\/[A-Za-z]:\//.test(stripped) ? stripped.slice(1) : stripped;
    }

    // Absolute path — use directly
    if (mainEntry.startsWith('/') || /^[A-Za-z]:[\\/]/.test(mainEntry)) {
      return mainEntry;
    }

    // Relative path — resolve against toolPath
    const sep = toolPath.includes('\\') ? '\\' : '/';
    const base = toolPath.endsWith('/') || toolPath.endsWith('\\')
      ? toolPath
      : toolPath + sep;
    return base + mainEntry;
  }
}

// ── Relative imports inside an external tool ────────────────────────────────
// Static (`import x from './a.js'`, `import './a.js'`, `export * from './a.js'`)
// and dynamic (`import('./a.js')`) forms. Only specifiers starting with `./`
// or `../` count; packages and URLs are left alone. Comments are ignored when
// collecting so prose never turns into a file read.

const STATIC_RELATIVE_IMPORT = /(\b(?:import|export)\b(?:\s*[^'";]*?\bfrom)?\s*)(['"])(\.\.?\/[^'"\n]+)\2/g;
const DYNAMIC_RELATIVE_IMPORT = /(\bimport\s*\(\s*)(['"])(\.\.?\/[^'"\n]+)\2/g;

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
}

/** Every relative module specifier a source imports, in order, once each. */
export function collectRelativeImports(source: string): string[] {
  const clean = stripComments(source);
  const out: string[] = [];
  for (const re of [STATIC_RELATIVE_IMPORT, DYNAMIC_RELATIVE_IMPORT]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(clean))) {
      if (!out.includes(m[3])) out.push(m[3]);
    }
  }
  return out;
}

/** The same source with each relative specifier replaced by what `resolve` returns for it. */
export function rewriteRelativeImports(source: string, resolve: (specifier: string) => string): string {
  const swap = (_m: string, head: string, quote: string, spec: string) => `${head}${quote}${resolve(spec)}${quote}`;
  return source.replace(STATIC_RELATIVE_IMPORT, swap).replace(DYNAMIC_RELATIVE_IMPORT, swap);
}

/** `spec` resolved against the directory of `fromFile`, keeping that file's path style. */
export function resolveRelativeModulePath(fromFile: string, spec: string): string {
  const sep = fromFile.includes('\\') ? '\\' : '/';
  const parts = fromFile.split(/[\\/]/);
  parts.pop();
  for (const seg of spec.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { if (parts.length > 1) parts.pop(); continue; }
    parts.push(seg);
  }
  return parts.join(sep);
}
