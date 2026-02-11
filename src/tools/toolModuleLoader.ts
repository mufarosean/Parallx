// toolModuleLoader.ts — loads tool entry point modules
//
// Imports a tool's `main` entry point via dynamic import() and extracts
// the `activate` and optional `deactivate` exports. In M2, tools run
// in-process — no separate worker or extension host process.

import type { IToolDescription } from './toolManifest.js';
import type { IDisposable } from '../platform/lifecycle.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Context passed to a tool's `activate()` function.
 * See parallx.d.ts → ToolContext.
 */
export interface ToolContext {
  /** Disposables registered by the tool. All disposed on deactivation. */
  readonly subscriptions: IDisposable[];
  /** Global state (Memento) — persists across workspaces. */
  readonly globalState: Memento;
  /** Workspace state (Memento) — persists within current workspace. */
  readonly workspaceState: Memento;
  /** Absolute path to the tool's root directory. */
  readonly toolPath: string;
  /** URI string for the tool's root. */
  readonly toolUri: string;
  /** Placeholder for future environment variable collection. */
  readonly environmentVariableCollection: Record<string, string>;
}

/**
 * Minimal Memento interface for tool state.
 * Full implementation lives in Cap 4 (ToolMemento).
 */
export interface Memento {
  get<T>(key: string): T | undefined;
  get<T>(key: string, defaultValue: T): T;
  update(key: string, value: unknown): Promise<void>;
  keys(): readonly string[];
}

/**
 * The activate function signature.
 * Tools export: `export function activate(api, context)`
 */
export type ActivateFunction = (api: unknown, context: ToolContext) => void | Promise<void>;

/**
 * The deactivate function signature (optional).
 * Tools export: `export function deactivate()`
 */
export type DeactivateFunction = () => void | Promise<void>;

/**
 * Loaded tool module with extracted exports.
 */
export interface ToolModule {
  /** The tool's activate function. */
  readonly activate: ActivateFunction;
  /** The tool's optional deactivate function. */
  readonly deactivate?: DeactivateFunction;
  /** The raw module for diagnostics. */
  readonly rawModule: Record<string, unknown>;
}

/**
 * Result of a module load attempt.
 */
export type LoadModuleResult =
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
   * @param toolDescription The tool description containing manifest and toolPath.
   * @returns A LoadModuleResult indicating success or failure.
   */
  async loadModule(toolDescription: IToolDescription): Promise<LoadModuleResult> {
    const { manifest, toolPath } = toolDescription;
    const mainEntry = manifest.main;

    // Resolve the full path to the entry module
    const resolvedPath = this._resolveEntryPath(toolPath, mainEntry);

    console.log(`[ToolModuleLoader] Loading tool "${manifest.id}" from: ${resolvedPath}`);

    let rawModule: Record<string, unknown>;
    try {
      rawModule = await import(/* webpackIgnore: true */ resolvedPath);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: `Failed to load module for tool "${manifest.id}" at "${resolvedPath}": ${errorMsg}`,
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
   * Resolve the entry path for a tool module.
   * For built-in tools, relative to source tree. For external, relative to toolPath.
   */
  private _resolveEntryPath(toolPath: string, mainEntry: string): string {
    // Security: reject http/https URLs to prevent remote code execution
    if (mainEntry.startsWith('http://') || mainEntry.startsWith('https://')) {
      throw new Error(
        `Refusing to load remote entry point "${mainEntry}". ` +
        `Tool entry points must be local file paths.`,
      );
    }

    // If mainEntry is already an absolute path or file URL, use as-is
    if (mainEntry.startsWith('/') || mainEntry.startsWith('file:')) {
      return mainEntry;
    }

    // Normalize tool path and entry
    const base = toolPath.endsWith('/') ? toolPath : toolPath + '/';
    return base + mainEntry;
  }
}
