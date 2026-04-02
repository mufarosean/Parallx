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
   * External tools are loaded via the Electron IPC bridge: the main process
   * reads the JS source, the renderer creates a blob URL, and dynamic import()
   * loads it. This avoids Chromium's cross-origin restriction that blocks
   * file:// imports from an http:// origin.
   *
   * @param toolDescription The tool description containing manifest and toolPath.
   * @returns A LoadModuleResult indicating success or failure.
   */
  async loadModule(toolDescription: IToolDescription): Promise<LoadModuleResult> {
    const { manifest, toolPath } = toolDescription;
    const mainEntry = manifest.main;

    // Resolve the full filesystem path to the entry module
    const resolvedFsPath = this._resolveFileSystemPath(toolPath, mainEntry);

    console.log(`[ToolModuleLoader] Loading tool "${manifest.id}" from: ${resolvedFsPath}`);

    let rawModule: Record<string, unknown>;
    try {
      rawModule = await this._loadViaBlob(manifest.id, resolvedFsPath);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: `Failed to load module for tool "${manifest.id}" at "${resolvedFsPath}": ${errorMsg}`,
      };
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
   * Load a module by reading its source via IPC and importing from a data URL.
   *
   * Chromium blocks dynamic import() of file:// URLs from http:// origins.
   * Instead, we ask the Electron main process to read the file, then encode
   * the source as a data: URL and import that.
   */
  private async _loadViaBlob(_toolId: string, fsPath: string): Promise<Record<string, unknown>> {
    const bridge = (globalThis as any).parallxElectron;
    if (!bridge?.readToolModule) {
      throw new Error('No Electron bridge for tool module loading');
    }

    const result = await bridge.readToolModule(fsPath);
    if (result.error) {
      throw new Error(result.error);
    }

    // Use blob: URL — origin-scoped and CSP-safe (script-src includes blob:)
    const blob = new Blob([result.source], { type: 'text/javascript' });
    const blobUrl = URL.createObjectURL(blob);
    try {
      return await import(/* webpackIgnore: true */ blobUrl);
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  }

  /**
   * Resolve the filesystem path for a tool's entry module.
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
