// toolScanner.ts — discovers and parses tool manifests from directories
//
// The scanner finds `parallx-manifest.json` files in configured tool
// directories, parses them, validates them, and returns structured results.
//
// Filesystem access is performed via the Electron IPC bridge
// (renderer cannot access the filesystem directly).

import { validateManifest, type ValidationResult } from './toolValidator.js';
import { type IToolManifest, type IToolDescription, TOOL_MANIFEST_FILENAME } from './toolManifest.js';

// ─── Electron Bridge Shape ───────────────────────────────────────────────────

/** Shape of the Electron bridge exposed via preload. */
interface ToolScanBridge {
  scanToolDirectory(dirPath: string): Promise<ScanDirectoryResult>;
  getToolDirectories(): Promise<{ builtinDir: string; userDir: string }>;
}

interface ScanDirectoryResult {
  entries: ScanEntry[];
  error: string | null;
}

interface ScanEntry {
  toolPath: string;
  manifestJson?: unknown;
  error?: string;
}

function _getBridge(): ToolScanBridge | undefined {
  return (globalThis as any).parallxElectron as ToolScanBridge | undefined;
}

// ─── Scan Result ─────────────────────────────────────────────────────────────

/** Result from scanning a single tool directory entry. */
interface ToolScanFailure {
  /** Path to the tool directory that failed. */
  readonly toolPath: string;
  /** Human-readable reason for the failure. */
  readonly reason: string;
  /** Validation errors, if parsing succeeded but validation failed. */
  readonly validationErrors?: readonly { path: string; message: string }[];
}

/** Aggregate result from scanning one or more directories. */
interface ToolScanResult {
  /** Successfully discovered and validated tool descriptions. */
  readonly tools: readonly IToolDescription[];
  /** Tools that failed parsing or validation. */
  readonly failures: readonly ToolScanFailure[];
  /** Directory-level errors (permissions, missing, etc.). */
  readonly directoryErrors: readonly { directory: string; error: string }[];
}

// ─── ToolScanner ─────────────────────────────────────────────────────────────

/**
 * Discovers tool manifests from configured directories.
 *
 * Supports:
 * - Scanning one or more directories for tool subdirectories
 * - Each subdirectory must contain a `parallx-manifest.json` file
 * - Manifests are parsed and validated before inclusion
 * - Built-in and user tool directories are supported
 * - Filesystem errors are handled gracefully
 */
class ToolScanner {

  /**
   * Scan the default tool directories (built-in + user).
   * Falls back gracefully if the Electron bridge is not available.
   */
  async scanDefaults(): Promise<ToolScanResult> {
    const bridge = _getBridge();
    if (!bridge) {
      console.warn('[ToolScanner] No Electron bridge — scanning skipped');
      return { tools: [], failures: [], directoryErrors: [] };
    }

    const dirs = await bridge.getToolDirectories();
    return this.scanDirectories([
      { path: dirs.builtinDir, isBuiltin: true },
      { path: dirs.userDir, isBuiltin: false },
    ]);
  }

  /**
   * Scan multiple directories for tool manifests.
   */
  async scanDirectories(
    directories: readonly { path: string; isBuiltin: boolean }[],
  ): Promise<ToolScanResult> {
    const allTools: IToolDescription[] = [];
    const allFailures: ToolScanFailure[] = [];
    const allDirErrors: { directory: string; error: string }[] = [];

    for (const dir of directories) {
      const result = await this.scanDirectory(dir.path, dir.isBuiltin);
      allTools.push(...result.tools);
      allFailures.push(...result.failures);
      allDirErrors.push(...result.directoryErrors);
    }

    return { tools: allTools, failures: allFailures, directoryErrors: allDirErrors };
  }

  /**
   * Scan a single directory for tool manifests.
   */
  async scanDirectory(dirPath: string, isBuiltin: boolean): Promise<ToolScanResult> {
    const bridge = _getBridge();
    if (!bridge) {
      return {
        tools: [],
        failures: [],
        directoryErrors: [{ directory: dirPath, error: 'No Electron bridge available' }],
      };
    }

    const tools: IToolDescription[] = [];
    const failures: ToolScanFailure[] = [];
    const directoryErrors: { directory: string; error: string }[] = [];

    let scanResult: ScanDirectoryResult;
    try {
      scanResult = await bridge.scanToolDirectory(dirPath);
    } catch (err) {
      directoryErrors.push({ directory: dirPath, error: String(err) });
      return { tools, failures, directoryErrors };
    }

    if (scanResult.error) {
      directoryErrors.push({ directory: dirPath, error: scanResult.error });
      return { tools, failures, directoryErrors };
    }

    for (const entry of scanResult.entries) {
      // Entry-level filesystem/parse error
      if (entry.error) {
        failures.push({ toolPath: entry.toolPath, reason: entry.error });
        continue;
      }

      // Validate the parsed manifest
      const validation = validateManifest(entry.manifestJson);
      if (!validation.valid) {
        failures.push({
          toolPath: entry.toolPath,
          reason: `Manifest validation failed with ${validation.errors.length} error(s)`,
          validationErrors: validation.errors,
        });
        continue;
      }

      // Log warnings (non-fatal)
      if (validation.warnings.length > 0) {
        console.warn(
          `[ToolScanner] Warnings for ${entry.toolPath}:`,
          validation.warnings.map(w => `${w.path}: ${w.message}`).join('; '),
        );
      }

      tools.push({
        manifest: entry.manifestJson as IToolManifest,
        toolPath: entry.toolPath,
        isBuiltin,
      });
    }

    return { tools, failures, directoryErrors };
  }

  /**
   * Create a tool description from a manifest object directly
   * (for built-in tools registered in code rather than discovered on disk).
   */
  registerFromManifest(manifest: IToolManifest, toolPath: string, isBuiltin: boolean): IToolDescription | ToolScanFailure {
    const validation = validateManifest(manifest);
    if (!validation.valid) {
      return {
        toolPath,
        reason: `Manifest validation failed with ${validation.errors.length} error(s)`,
        validationErrors: validation.errors,
      };
    }
    return { manifest, toolPath, isBuiltin };
  }
}
