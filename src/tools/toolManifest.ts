// toolManifest.ts — tool manifest types and schema
//
// Defines the TypeScript interfaces for a Parallx tool manifest.
// A tool manifest is the `parallx-manifest.json` file that lives in
// the root of every tool directory. It declares the tool's identity,
// entry point, activation events, and contributions.
//
// This is the Parallx equivalent of VS Code's extension `package.json`.

// ─── Manifest Version ────────────────────────────────────────────────────────

/**
 * The current manifest schema version.
 * Bumped when the manifest shape changes in a breaking way.
 */
export const CURRENT_MANIFEST_VERSION = 1;

// ─── Activation Events ──────────────────────────────────────────────────────

/**
 * Supported activation event types in M2.
 *
 * - `*` — Eager activation (activates immediately on startup)
 * - `onStartupFinished` — Activates after workbench is fully ready
 * - `onCommand:<commandId>` — Activates when a specific command is executed
 * - `onView:<viewId>` — Activates when a specific view is opened
 */
export type ActivationEventType = '*' | 'onStartupFinished' | `onCommand:${string}` | `onView:${string}`;

/**
 * The set of activation event prefixes supported in M2.
 */
export const SUPPORTED_ACTIVATION_PREFIXES = ['*', 'onStartupFinished', 'onCommand:', 'onView:'] as const;

// ─── Contribution Types ──────────────────────────────────────────────────────

/**
 * A contributed view descriptor declared in a tool manifest.
 */
export interface IManifestViewDescriptor {
  /** Unique view ID (must be globally unique across all tools). */
  readonly id: string;
  /** Human-readable name shown in tabs and menus. */
  readonly name: string;
  /** Icon identifier (CSS class or codicon name). */
  readonly icon?: string;
  /** Default container where the view should appear. */
  readonly defaultContainerId?: string;
  /** When-clause expression controlling visibility. */
  readonly when?: string;
}

/**
 * A contributed view container declared in a tool manifest.
 */
export interface IManifestViewContainerDescriptor {
  /** Unique container ID. */
  readonly id: string;
  /** Human-readable title. */
  readonly title: string;
  /** Icon identifier. */
  readonly icon?: string;
  /** Where the container should appear: 'sidebar' | 'panel' | 'auxiliaryBar'. */
  readonly location: 'sidebar' | 'panel' | 'auxiliaryBar';
}

/**
 * A contributed command declared in a tool manifest.
 */
export interface IManifestCommandDescriptor {
  /** Unique command ID. */
  readonly id: string;
  /** Human-readable title shown in the command palette. */
  readonly title: string;
  /** Optional category for grouping. */
  readonly category?: string;
  /** Optional icon identifier. */
  readonly icon?: string;
  /** Optional default keybinding string. */
  readonly keybinding?: string;
  /** When-clause expression controlling availability. */
  readonly when?: string;
}

/**
 * A contributed configuration section declared in a tool manifest.
 */
export interface IManifestConfigurationDescriptor {
  /** Configuration section title. */
  readonly title: string;
  /** Configuration properties. */
  readonly properties: Readonly<Record<string, IManifestConfigurationProperty>>;
}

/**
 * A single configuration property.
 */
export interface IManifestConfigurationProperty {
  /** Property type: 'string' | 'number' | 'boolean' | 'object' | 'array'. */
  readonly type: string;
  /** Default value. */
  readonly default?: unknown;
  /** Human-readable description. */
  readonly description?: string;
  /** Enum values (for string properties). */
  readonly enum?: readonly string[];
}

/**
 * A contributed menu item declared in a tool manifest.
 */
export interface IManifestMenuItem {
  /** Command ID this menu item invokes. */
  readonly command: string;
  /** Menu location ID (e.g., 'commandPalette', 'view/title', 'view/context'). */
  readonly group?: string;
  /** When-clause expression controlling visibility. */
  readonly when?: string;
}

/**
 * A contributed keybinding declared in a tool manifest.
 */
export interface IManifestKeybinding {
  /** Command ID this keybinding invokes. */
  readonly command: string;
  /** Keybinding string (e.g., 'Ctrl+Shift+P'). */
  readonly key: string;
  /** When-clause expression controlling when the keybinding is active. */
  readonly when?: string;
}

/**
 * The `contributes` section of a tool manifest.
 * Each key is a contribution point; the shell reads these at load time.
 */
export interface IManifestContributions {
  /** View descriptors contributed by this tool. */
  readonly views?: readonly IManifestViewDescriptor[];
  /** View container descriptors contributed by this tool. */
  readonly viewContainers?: readonly IManifestViewContainerDescriptor[];
  /** Command descriptors contributed by this tool. */
  readonly commands?: readonly IManifestCommandDescriptor[];
  /** Configuration sections contributed by this tool. */
  readonly configuration?: readonly IManifestConfigurationDescriptor[];
  /** Menu items contributed by this tool. */
  readonly menus?: Readonly<Record<string, readonly IManifestMenuItem[]>>;
  /** Keybindings contributed by this tool. */
  readonly keybindings?: readonly IManifestKeybinding[];
}

/**
 * Engine compatibility declaration.
 */
export interface IManifestEngines {
  /** Minimum Parallx version required (semver range, e.g., "^0.1.0"). */
  readonly parallx: string;
}

// ─── Tool Manifest ───────────────────────────────────────────────────────────

/**
 * The complete tool manifest — the contents of `parallx-manifest.json`.
 */
export interface IToolManifest {
  // ── Identity ──

  /** Schema version (currently 1). */
  readonly manifestVersion: number;

  /** Unique tool identifier, e.g., `'parallx.explorer'` or `'my-publisher.my-tool'`. */
  readonly id: string;

  /** Human-readable tool name. */
  readonly name: string;

  /** Semver version string. */
  readonly version: string;

  /** Publisher name or identifier. */
  readonly publisher: string;

  /** Human-readable description. */
  readonly description?: string;

  // ── Entry Point ──

  /**
   * Relative path to the JS/TS module that exports `activate` and optionally `deactivate`.
   * Resolved relative to the tool's root directory.
   */
  readonly main: string;

  // ── Activation ──

  /**
   * Events that trigger this tool's activation.
   * The tool is loaded and `activate()` is called when any of these events occur.
   */
  readonly activationEvents: readonly string[];

  // ── Contributions ──

  /**
   * Declarative contributions to the shell (views, commands, config, etc.).
   * The shell reads these at load time, before the tool is activated.
   */
  readonly contributes?: IManifestContributions;

  // ── Compatibility ──

  /**
   * Engine compatibility requirements.
   */
  readonly engines: IManifestEngines;
}

/**
 * A resolved tool description — manifest plus runtime metadata
 * added during scanning/registration.
 */
export interface IToolDescription {
  /** The parsed and validated manifest. */
  readonly manifest: IToolManifest;

  /** Absolute path (or URI) to the tool's root directory. */
  readonly toolPath: string;

  /** Whether this is a built-in tool (shipped with the shell). */
  readonly isBuiltin: boolean;
}

// ─── Manifest Filename ───────────────────────────────────────────────────────

/** The filename the scanner looks for in each tool directory. */
export const TOOL_MANIFEST_FILENAME = 'parallx-manifest.json';
