// parallxConfigService.ts — .parallx/config.json loader (M11 Task 2.9)
//
// Reads and validates `.parallx/config.json`, provides typed access to
// all settings, and watches for changes. Falls back to defaults.
//
// VS Code reference:
//   src/vs/platform/configuration/common/configurationModels.ts

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

const DEFAULT_MODEL_CONFIG: IParallxModelConfig = {
  chat: 'qwen2.5:32b-instruct',
  embedding: 'nomic-embed-text',
  contextLength: null,
};

const DEFAULT_AGENT_CONFIG: IParallxAgentConfig = {
  maxIterations: 10,
  autoRag: true,
  ragTopK: 10,
  ragScoreThreshold: 0.3,
};

const DEFAULT_CONTEXT_BUDGET: IParallxContextBudgetConfig = {
  systemPrompt: 10,
  ragContext: 30,
  history: 30,
  userMessage: 30,
};

const DEFAULT_PERMISSIONS: IParallxPermissionsConfig = {
  fileWrite: 'ask-every-time',
  fileDelete: 'ask-every-time',
  terminalCommand: 'ask-every-time',
};

const DEFAULT_INDEXING: IParallxIndexingConfig = {
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
  /** Optional write capability — required for workspace override persistence (M20 B.1). */
  writeFile?(relativePath: string, content: string): Promise<void>;
}

// (ParallxConfigService class + its jsonc parser were deleted by the
// Retirement phase: UnifiedAIConfigService replaced it at M15/M61 and
// no construction site survived. mergeConfig, DEFAULT_CONFIG, and the
// config interfaces above remain — unified config imports them.)
