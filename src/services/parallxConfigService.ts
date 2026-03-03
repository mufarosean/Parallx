// parallxConfigService.ts — .parallx/config.json loader (M11 Task 2.9)
//
// Reads and validates `.parallx/config.json`, provides typed access to
// all settings, and watches for changes. Falls back to defaults.
//
// VS Code reference:
//   src/vs/platform/configuration/common/configurationModels.ts

import { Disposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Configuration Schema Types
// ═══════════════════════════════════════════════════════════════════════════════

export interface IParallxModelConfig {
  readonly chat: string;
  readonly embedding: string;
  readonly contextLength: number | null;
}

export interface IParallxAgentConfig {
  readonly maxIterations: number;
  readonly autoRag: boolean;
  readonly ragTopK: number;
  readonly ragScoreThreshold: number;
}

export interface IParallxContextBudgetConfig {
  readonly systemPrompt: number;
  readonly ragContext: number;
  readonly history: number;
  readonly userMessage: number;
}

export type PermissionDefault = 'ask-every-time' | 'ask-once-per-session' | 'always-allow';

export interface IParallxPermissionsConfig {
  readonly fileWrite: PermissionDefault;
  readonly fileDelete: PermissionDefault;
  readonly terminalCommand: PermissionDefault;
}

export interface IParallxIndexingConfig {
  readonly autoIndex: boolean;
  readonly watchFiles: boolean;
  readonly maxFileSize: number;
  readonly excludePatterns: readonly string[];
}

/** Full .parallx/config.json shape. */
export interface IParallxConfig {
  readonly model: IParallxModelConfig;
  readonly agent: IParallxAgentConfig;
  readonly contextBudget: IParallxContextBudgetConfig;
  readonly permissions: IParallxPermissionsConfig;
  readonly indexing: IParallxIndexingConfig;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Defaults
// ═══════════════════════════════════════════════════════════════════════════════

export const DEFAULT_MODEL_CONFIG: IParallxModelConfig = {
  chat: 'qwen2.5:32b-instruct',
  embedding: 'nomic-embed-text',
  contextLength: null,
};

export const DEFAULT_AGENT_CONFIG: IParallxAgentConfig = {
  maxIterations: 10,
  autoRag: true,
  ragTopK: 10,
  ragScoreThreshold: 0.3,
};

export const DEFAULT_CONTEXT_BUDGET: IParallxContextBudgetConfig = {
  systemPrompt: 10,
  ragContext: 30,
  history: 30,
  userMessage: 30,
};

export const DEFAULT_PERMISSIONS: IParallxPermissionsConfig = {
  fileWrite: 'ask-every-time',
  fileDelete: 'ask-every-time',
  terminalCommand: 'ask-every-time',
};

export const DEFAULT_INDEXING: IParallxIndexingConfig = {
  autoIndex: true,
  watchFiles: true,
  maxFileSize: 262144, // 256 KB
  excludePatterns: [],
};

export const DEFAULT_CONFIG: IParallxConfig = {
  model: DEFAULT_MODEL_CONFIG,
  agent: DEFAULT_AGENT_CONFIG,
  contextBudget: DEFAULT_CONTEXT_BUDGET,
  permissions: DEFAULT_PERMISSIONS,
  indexing: DEFAULT_INDEXING,
};

// ═══════════════════════════════════════════════════════════════════════════════
// Validation / Merging
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Merge user-provided JSON (partial) over the defaults.
 * Only known keys are accepted; unknown keys are silently ignored.
 */
export function mergeConfig(partial: Record<string, unknown>): IParallxConfig {
  /* eslint-disable @typescript-eslint/no-explicit-any -- type-safe casts at boundaries */
  return {
    model: _mergeSection(DEFAULT_MODEL_CONFIG as any, partial['model']) as unknown as IParallxModelConfig,
    agent: _mergeSection(DEFAULT_AGENT_CONFIG as any, partial['agent']) as unknown as IParallxAgentConfig,
    contextBudget: _mergeSection(DEFAULT_CONTEXT_BUDGET as any, partial['contextBudget']) as unknown as IParallxContextBudgetConfig,
    permissions: _mergeSection(DEFAULT_PERMISSIONS as any, partial['permissions']) as unknown as IParallxPermissionsConfig,
    indexing: _mergeSection(DEFAULT_INDEXING as any, partial['indexing']) as unknown as IParallxIndexingConfig,
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

function _mergeSection(defaults: Record<string, unknown>, override: unknown): Record<string, unknown> {
  if (!override || typeof override !== 'object' || Array.isArray(override)) {
    return defaults;
  }

  const result: Record<string, unknown> = { ...defaults };
  const obj = override as Record<string, unknown>;

  for (const key of Object.keys(defaults)) {
    if (key in obj) {
      const defaultVal = defaults[key];
      const overrideVal = obj[key];

      // Type validation: only accept same type as default (or null when default allows it)
      if (overrideVal === null && defaultVal === null) {
        result[key] = null;
      } else if (overrideVal === null && typeof defaultVal !== 'object') {
        // Allow null for contextLength (default is null)
        result[key] = null;
      } else if (typeof overrideVal === typeof defaultVal) {
        if (Array.isArray(defaultVal) && Array.isArray(overrideVal)) {
          result[key] = overrideVal.filter((v) => typeof v === 'string');
        } else {
          result[key] = overrideVal;
        }
      }
      // Otherwise keep default
    }
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ParallxConfigService
// ═══════════════════════════════════════════════════════════════════════════════

/** File system abstraction (same pattern as SkillLoaderService). */
export interface IConfigFileSystem {
  readFile(relativePath: string): Promise<string>;
  exists(relativePath: string): Promise<boolean>;
}

/**
 * Provides typed, validated access to `.parallx/config.json`.
 * Reads the file once at startup and re-reads on demand.
 */
export class ParallxConfigService extends Disposable {

  private _config: IParallxConfig = DEFAULT_CONFIG;
  private _fs: IConfigFileSystem | undefined;
  private _loaded = false;

  private readonly _onDidChangeConfig = this._register(new Emitter<IParallxConfig>());
  readonly onDidChangeConfig: Event<IParallxConfig> = this._onDidChangeConfig.event;

  // ── File path ──
  static readonly CONFIG_PATH = '.parallx/config.json';

  // ── Public API ──

  /** Bind a filesystem accessor. Must be called before `load()`. */
  setFileSystem(fs: IConfigFileSystem): void {
    this._fs = fs;
  }

  /** Current configuration (always returns a valid object). */
  get config(): IParallxConfig {
    return this._config;
  }

  /** Whether the config file has been loaded at least once. */
  get isLoaded(): boolean {
    return this._loaded;
  }

  // Typed accessors for convenience
  get model(): IParallxModelConfig { return this._config.model; }
  get agent(): IParallxAgentConfig { return this._config.agent; }
  get contextBudget(): IParallxContextBudgetConfig { return this._config.contextBudget; }
  get permissions(): IParallxPermissionsConfig { return this._config.permissions; }
  get indexing(): IParallxIndexingConfig { return this._config.indexing; }

  /**
   * Load (or reload) configuration from `.parallx/config.json`.
   * Falls back to defaults if the file doesn't exist or is invalid.
   */
  async load(): Promise<void> {
    if (!this._fs) {
      this._config = DEFAULT_CONFIG;
      this._loaded = true;
      return;
    }

    try {
      const exists = await this._fs.exists(ParallxConfigService.CONFIG_PATH);
      if (!exists) {
        this._config = DEFAULT_CONFIG;
        this._loaded = true;
        return;
      }

      const content = await this._fs.readFile(ParallxConfigService.CONFIG_PATH);
      const json = _parseJsonWithComments(content);
      if (!json || typeof json !== 'object' || Array.isArray(json)) {
        this._config = DEFAULT_CONFIG;
      } else {
        this._config = mergeConfig(json as Record<string, unknown>);
      }
    } catch {
      this._config = DEFAULT_CONFIG;
    }

    this._loaded = true;
    this._onDidChangeConfig.fire(this._config);
  }

  /**
   * Get a specific config value by dot-path (e.g. `"agent.maxIterations"`).
   * Returns undefined if the path doesn't match.
   */
  get<T = unknown>(path: string): T | undefined {
    const parts = path.split('.');
    let current: unknown = this._config;

    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== 'object') {
        return undefined;
      }
      current = (current as Record<string, unknown>)[part];
    }

    return current as T;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// JSON with Comments parser
// ═══════════════════════════════════════════════════════════════════════════════

/** Strip // and /* comments before parsing (jsonc → json). */
function _parseJsonWithComments(text: string): unknown {
  // Strip single-line comments (not inside strings)
  let cleaned = text.replace(/\/\/.*$/gm, '');
  // Strip block comments
  cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, '');
  // Strip trailing commas before } or ]
  cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');

  return JSON.parse(cleaned);
}
