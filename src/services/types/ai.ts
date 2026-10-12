// ai.ts — service interfaces for AI configuration and operations: AI settings, the unified config, MCP clients, diagnostics, observability.
//
// One file of services/types/; serviceTypes.ts re-exports them all, so import
// from '../serviceTypes.js' as before.

import { createServiceIdentifier } from '../../platform/types.js';
import { IDisposable } from '../../platform/lifecycle.js';
import { Event } from '../../platform/events.js';
import type { IAISettingsService as IAISettingsServiceType } from '../../aiSettings/aiSettingsTypes.js';
import type { IUnifiedAIConfigService as IUnifiedAIConfigServiceType } from '../../aiSettings/unifiedConfigTypes.js';
import type { IMcpServerConfig, IMcpToolSchema, IMcpToolCallResult, McpConnectionState, IMcpHealthInfo } from '../../openclaw/mcp/mcpTypes.js';
import type { IStorage } from '../../platform/storage.js';

// ─── IAISettingsService ────────────────────────────────────────────────

/**
 * Manages AI personality & behavior settings profiles.
 *
 * Persists profiles to IStorage, emits change events so consumers
 * (chat prompt builder, proactive suggestions) react immediately.
 *
 * Interface defined in aiSettings/aiSettingsTypes.ts.
 * DI identifier created here to follow the serviceTypes.ts pattern.
 */

export const IAISettingsService = createServiceIdentifier<IAISettingsServiceType>('IAISettingsService');

// ─── IUnifiedAIConfigService ──────────────────────────────────────────

/**
 * Unified AI Configuration Service — replaces both AISettingsService
 * and ParallxConfigService with a single source of truth.
 *
 * Provides preset management, workspace overrides, and merged effective config.
 * Interface defined in aiSettings/unifiedConfigTypes.ts.
 */

export const IUnifiedAIConfigService = createServiceIdentifier<IUnifiedAIConfigServiceType>('IUnifiedAIConfigService');

// ─── IDiagnosticsService ───────────────────────────────────────────────────

export interface IDiagnosticResult {
  readonly name: string;
  readonly status: 'pass' | 'fail' | 'warn';
  readonly detail: string;
  readonly timestamp: number;
  readonly category?: 'connection' | 'model' | 'rag' | 'config' | 'workspace' | 'workbench';
}

export type IDiagnosticCheckProducer = (deps: IDiagnosticCheckDeps) => Promise<IDiagnosticResult>;

export interface IDiagnosticCheckDeps {
  readonly checkProviderStatus?: () => Promise<{ available: boolean; version?: string; error?: string }>;
  readonly getActiveModel?: () => string | undefined;
  readonly listModels?: () => Promise<readonly { id: string; name: string; size?: number }[]>;
  readonly isRAGAvailable?: () => boolean;
  readonly isIndexing?: () => boolean;
  readonly getFileCount?: () => Promise<number>;
  readonly getWorkspaceName: () => string;
  readonly existsRelative?: (path: string) => Promise<boolean>;
  readonly getModelContextLength?: () => number;
  readonly getEffectiveConfig?: () => unknown;
  readonly checkEmbedding?: () => Promise<boolean>;
  readonly getEmbeddingModelInfo?: () => { name: string; dimensions: number; installed: boolean };
  readonly getEmbeddingContextLength?: () => Promise<number>;
  readonly checkVectorStore?: () => Promise<boolean>;
  readonly checkDocumentExtraction?: () => Promise<boolean>;
  readonly checkMemoryService?: () => Promise<boolean>;
  // Observability integration
  readonly getObservabilityMetrics?: () => ISessionMetrics;
}

export interface IDiagnosticsService {
  runChecks(): Promise<readonly IDiagnosticResult[]>;
  getLastResults(): readonly IDiagnosticResult[];
  updateDeps(patch: Partial<IDiagnosticCheckDeps>): void;
  /**
   * Add checks after construction (SYSTEM_INTEGRITY.md Phase C: the
   * workbench registers its own health checks once introspection exists —
   * the check list was fixed at construction and 15/15 about the AI stack).
   */
  addChecks(checks: readonly IDiagnosticCheckProducer[]): void;
  readonly onDidChange: Event<readonly IDiagnosticResult[]>;
}

export const IDiagnosticsService = createServiceIdentifier<IDiagnosticsService>('IDiagnosticsService');

// ─── IObservabilityService ──────────────────────────────────────────────────

export interface ITurnMetrics {
  readonly model: string;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  readonly durationMs: number;
  readonly timestamp: number;
  readonly budgetUtilization?: {
    readonly system: number;  // actual / allocated ratio (0-1)
    readonly rag: number;
    readonly history: number;
    readonly user: number;
  };
  /** D6-8: Number of overflow-triggered compactions during the turn. */
  readonly overflowCompactions?: number;
  /** D6-8: Number of timeout-triggered compactions during the turn. */
  readonly timeoutCompactions?: number;
  /** D6-2: Best quality score from compaction quality audit (0-1). */
  readonly compactionQualityScore?: number;
  /** D6-3: Number of quality-based retries performed during compaction. */
  readonly compactionQualityRetries?: number;
}

export interface ISessionMetrics {
  readonly turnCount: number;
  readonly totalPromptTokens: number;
  readonly totalCompletionTokens: number;
  readonly totalTokens: number;
  readonly totalDurationMs: number;
  readonly avgDurationMs: number;
  readonly avgPromptTokens: number;
  readonly avgCompletionTokens: number;
}

export interface IModelMetrics {
  readonly model: string;
  readonly turnCount: number;
  readonly totalTokens: number;
  readonly avgDurationMs: number;
  readonly avgPromptTokens: number;
  readonly avgCompletionTokens: number;
}

export interface IObservabilityService {
  recordTurn(metrics: ITurnMetrics): void;
  getSessionMetrics(): ISessionMetrics;
  getModelMetrics(model?: string): readonly IModelMetrics[];
  getTurnHistory(): readonly ITurnMetrics[];
  readonly onDidRecordTurn: Event<ITurnMetrics>;
}

export const IObservabilityService = createServiceIdentifier<IObservabilityService>('IObservabilityService');

// ---------------------------------------------------------------------------
// Runtime Hook Registry
// ---------------------------------------------------------------------------

/** D4-5: Observer for model call lifecycle events. */
export interface IChatRuntimeMessageObserver {
  onBeforeModelCall?(messages: readonly { role: string; content: string }[], model: string): void;
  onAfterModelCall?(messages: readonly { role: string; content: string }[], model: string, durationMs: number): void;
}

/** D4-4: Registry for runtime hooks — tool observers and message observers. */
export interface IRuntimeHookRegistry {
  /** Register a tool invocation observer. Returns a disposable to unregister. */
  registerToolObserver(observer: import('../../services/chatRuntimeTypes.js').IChatRuntimeToolInvocationObserver): IDisposable;
  /** Register a message lifecycle observer. Returns a disposable to unregister. */
  registerMessageObserver(observer: IChatRuntimeMessageObserver): IDisposable;
  /** Get a composite tool observer that fires all registered observers (error-isolated). */
  getCompositeToolObserver(): import('../../services/chatRuntimeTypes.js').IChatRuntimeToolInvocationObserver;
  /** Get a composite message observer that fires all registered observers (error-isolated). */
  getCompositeMessageObserver(): IChatRuntimeMessageObserver;
}

export const IRuntimeHookRegistry = createServiceIdentifier<IRuntimeHookRegistry>('IRuntimeHookRegistry');

// ── MCP Client Service ──────────────────────────────────────────────────────

export interface IMcpClientService extends IDisposable {
  /** Load the workspace's server configs. Env values (tokens) live in `secrets` when it is available. */
  initStorage(storage: IStorage, secrets?: import('../secretStorageService.js').ISecretStorageService): Promise<void>;
  /** A sealed workspace runs no MCP server: running ones stop and none connects until unsealed. */
  setSealed(sealed: boolean): Promise<void>;
  /** True while the workspace is sealed (no server runs). */
  readonly isSealed: boolean;
  getConfiguredServers(): readonly IMcpServerConfig[];
  addServerConfig(config: IMcpServerConfig): Promise<void>;
  removeServerConfig(serverId: string): Promise<void>;
  connectServer(config: IMcpServerConfig): Promise<void>;
  disconnectServer(serverId: string): Promise<void>;
  getServerStatus(serverId: string): McpConnectionState;
  getConnectedServers(): readonly string[];
  listTools(serverId: string): Promise<readonly IMcpToolSchema[]>;
  callTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<IMcpToolCallResult>;
  ping(serverId: string): Promise<number>;
  getHealthInfo(serverId: string): IMcpHealthInfo | undefined;
  readonly onDidChangeStatus: Event<{ serverId: string; status: McpConnectionState }>;
  readonly onDidReceiveNotification: Event<{ serverId: string; method: string; params?: Record<string, unknown> }>;
}

export const IMcpClientService = createServiceIdentifier<IMcpClientService>('IMcpClientService');
