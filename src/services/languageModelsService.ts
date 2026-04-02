// languageModelsService.ts — ILanguageModelsService implementation (M9 Task 1.1)
//
// Manages language model providers, aggregates models, tracks active model
// selection, and delegates chat requests to the appropriate provider.
//
// Active model persistence:
//   The user's last-selected model is persisted to IStorage so it survives
//   app restarts. On refresh, the persisted ID is validated against available
//   models. If the model is gone, the service falls back to:
//     1. A configured default model from AI Settings  (defaultModel field)
//     2. The first non-embedding model from the provider
//
// VS Code reference:
//   src/vs/workbench/contrib/chat/common/languageModels.ts

import { Disposable } from '../platform/lifecycle.js';
import { Emitter } from '../platform/events.js';
import { toDisposable } from '../platform/lifecycle.js';
import type { IDisposable } from '../platform/lifecycle.js';
import type { Event } from '../platform/events.js';
import type { IStorage } from '../platform/storage.js';
import type {
  ILanguageModelsService,
  ILanguageModelProvider,
  ILanguageModelInfo,
  IProviderStatus,
  IChatMessage,
  IChatRequestOptions,
  IChatResponseChunk,
  ModelCapability,
} from './chatTypes.js';

/** Storage key for the persisted active model ID. */
const ACTIVE_MODEL_STORAGE_KEY = 'languageModels.activeModelId';

/**
 * Singleton service managing language model providers.
 *
 * Providers register themselves (e.g. OllamaProvider) and the service
 * aggregates their models, tracks the user's active model selection,
 * and delegates `sendChatRequest()` to the correct provider.
 */
export class LanguageModelsService extends Disposable implements ILanguageModelsService {

  // ── Provider registry ──

  private readonly _providers = new Map<string, ILanguageModelProvider>();

  /** Maps model ID → provider ID for fast lookup during chat requests. */
  private readonly _modelToProvider = new Map<string, string>();

  /** Cached model list from the last aggregation. */
  private _cachedModels: readonly ILanguageModelInfo[] = [];

  // ── Model intelligence cache (M42 Phase 2) ──

  /** Model ID → detected context length from /api/show. */
  private readonly _modelContextLengths = new Map<string, number>();

  /** Model ID → detected capabilities from /api/show. */
  private readonly _modelCapabilities = new Map<string, readonly ModelCapability[]>();

  /** Model ID → parameter size string (e.g. '8.0B'). */
  private readonly _modelParameterSizes = new Map<string, string>();

  // ── Active model ──

  private _activeModelId: string | undefined;

  // ── Storage (optional — late-bound via setStorage) ──

  private _storage: IStorage | undefined;

  /**
   * Configured default model from AI Settings.
   * Used as fallback when no persisted model exists or persisted model is gone.
   */
  private _defaultModelId: string | undefined;

  // ── Events ──

  private readonly _onDidChangeProviders = this._register(new Emitter<void>());
  readonly onDidChangeProviders: Event<void> = this._onDidChangeProviders.event;

  private readonly _onDidChangeModels = this._register(new Emitter<void>());
  readonly onDidChangeModels: Event<void> = this._onDidChangeModels.event;

  // ── Provider Registration ──

  registerProvider(provider: ILanguageModelProvider): IDisposable {
    if (this._providers.has(provider.id)) {
      throw new Error(`Language model provider '${provider.id}' is already registered.`);
    }

    this._providers.set(provider.id, provider);
    this._onDidChangeProviders.fire();

    // Refresh model list asynchronously after provider registration
    this._refreshModels();

    // When the provider's status changes (e.g. Ollama comes online after
    // Parallx is already running), refresh the model list so the UI
    // picks up newly available models without requiring a click.
    let statusSub: IDisposable | undefined;
    if (provider.onDidChangeStatus) {
      statusSub = provider.onDidChangeStatus((status) => {
        if (status.available) {
          this._refreshModels();
        }
      });
    }

    return toDisposable(() => {
      statusSub?.dispose();
      this._providers.delete(provider.id);

      // BUG FIX: Check whether the active model belongs to this provider
      // BEFORE deleting its mappings.  Previously the check ran after the
      // delete loop, so .get() always returned undefined and _activeModelId
      // was never cleared — leaving a stale ghost model ID.
      if (this._activeModelId && this._modelToProvider.get(this._activeModelId) === provider.id) {
        this._activeModelId = undefined;
        this._persistActiveModel();
      }

      // Now safe to remove the mappings
      for (const [modelId, providerId] of this._modelToProvider) {
        if (providerId === provider.id) {
          this._modelToProvider.delete(modelId);
        }
      }

      this._onDidChangeProviders.fire();
      this._onDidChangeModels.fire();
    });
  }

  getProviders(): readonly ILanguageModelProvider[] {
    return [...this._providers.values()];
  }

  // ── Model Enumeration ──

  async getModels(): Promise<readonly ILanguageModelInfo[]> {
    if (this._cachedModels.length === 0) {
      // First call ever — must await to populate
      await this._refreshModels();
    }
    return this._cachedModels;
  }

  // ── Active Model ──

  getActiveModel(): string | undefined {
    return this._activeModelId;
  }

  setActiveModel(modelId: string): void {
    if (this._activeModelId === modelId) {
      return;
    }
    this._activeModelId = modelId;
    this._persistActiveModel();
    this._probeActiveModel(modelId);
    // Reset provider streaming state to avoid stale parser artifacts
    // across model switches (e.g. thinking tag tracker, no-think cache)
    this._resetProviderStreamState();
    this._onDidChangeModels.fire();
  }

  // ── Storage (late-bound) ──

  /**
   * Bind persistent storage.  Called after Phase 1 when IStorage becomes
   * available.  Restores the persisted active model ID (if still valid).
   */
  async setStorage(storage: IStorage): Promise<void> {
    this._storage = storage;
    const persisted = await storage.get(ACTIVE_MODEL_STORAGE_KEY);
    if (persisted && !this._activeModelId) {
      // Don't validate yet — providers may not have registered.
      // _refreshModels() will validate when providers fire.
      this._activeModelId = persisted;
    }
  }

  /**
   * Set the default model from AI Settings.  Used as fallback when the
   * persisted model is unavailable.
   *
   * When the new default is a valid, available model, it also becomes
   * the active model immediately — so newly created chat sessions use it.
   */
  setDefaultModel(modelId: string | undefined): void {
    this._defaultModelId = modelId;

    // If the model is currently available, switch to it right away so
    // new chat sessions pick it up via getActiveModel().
    if (modelId && this._modelToProvider.has(modelId) && this._activeModelId !== modelId) {
      this._activeModelId = modelId;
      this._persistActiveModel();
      this._onDidChangeModels.fire();
    }
  }

  /** Fire-and-forget persist of the active model ID. */
  private _persistActiveModel(): void {
    if (!this._storage) { return; }
    if (this._activeModelId) {
      this._storage.set(ACTIVE_MODEL_STORAGE_KEY, this._activeModelId);
    } else {
      this._storage.delete(ACTIVE_MODEL_STORAGE_KEY);
    }
  }

  /** Reset streaming state on all providers (thinking tag parser, no-think cache). */
  private _resetProviderStreamState(): void {
    for (const provider of this._providers.values()) {
      if (typeof (provider as any).resetStreamState === 'function') {
        (provider as any).resetStreamState();
      }
    }
  }

  // ── Model Intelligence (M42 Phase 2) ──

  /**
   * Probe a model via getModelInfo and cache context length + capabilities.
   * Retries up to 3× with exponential backoff on failure.
   * Fire-and-forget — does not block model switch.
   */
  private _probeActiveModel(modelId: string): void {
    if (this._modelContextLengths.has(modelId)) {
      return; // Already cached
    }
    const providerId = this._modelToProvider.get(modelId);
    if (!providerId) { return; }
    const provider = this._providers.get(providerId);
    if (!provider) { return; }

    const MAX_RETRIES = 3;
    const attempt = (retry: number): void => {
      provider.getModelInfo(modelId).then(info => {
        if (info.contextLength > 0) {
          this._modelContextLengths.set(modelId, info.contextLength);
        }
        if (info.capabilities.length > 0) {
          this._modelCapabilities.set(modelId, info.capabilities);
        }
        if (info.parameterSize) {
          this._modelParameterSizes.set(modelId, info.parameterSize);
        }
        this._onDidChangeModels.fire();
      }).catch((err) => {
        if (retry < MAX_RETRIES) {
          const delay = 1000 * Math.pow(2, retry); // 1s, 2s, 4s
          setTimeout(() => attempt(retry + 1), delay);
        } else {
          console.warn(`[LanguageModelsService] Model probe failed for "${modelId}" after ${MAX_RETRIES} retries:`, err);
        }
      });
    };
    attempt(0);
  }

  /**
   * Get the detected context length for the active model.
   * Falls back to 4096 if not probed yet.
   */
  getActiveModelContextLength(): number {
    if (!this._activeModelId) { return 4096; }
    return this._modelContextLengths.get(this._activeModelId) ?? 4096;
  }

  /**
   * Get the detected capabilities for the active model.
   * Returns ['completion'] if not probed yet.
   */
  getActiveModelCapabilities(): readonly ModelCapability[] {
    if (!this._activeModelId) { return ['completion']; }
    return this._modelCapabilities.get(this._activeModelId) ?? ['completion'];
  }

  /**
   * Derive a model tier from parameter size.
   * small: ≤8B, medium: 9-30B, large: >30B
   */
  getActiveModelTier(): 'small' | 'medium' | 'large' {
    if (!this._activeModelId) { return 'medium'; }
    const sizeStr = this._modelParameterSizes.get(this._activeModelId);
    if (!sizeStr) { return 'medium'; }
    const match = sizeStr.match(/([\d.]+)B/i);
    if (!match) { return 'medium'; }
    const sizeB = parseFloat(match[1]);
    if (sizeB <= 8) { return 'small'; }
    if (sizeB <= 30) { return 'medium'; }
    return 'large';
  }

  // ── Chat Request Delegation ──

  async *sendChatRequest(
    messages: readonly IChatMessage[],
    options?: IChatRequestOptions,
    signal?: AbortSignal,
  ): AsyncIterable<IChatResponseChunk> {
    const modelId = this._activeModelId;
    if (!modelId) {
      throw new Error('No active model selected. Please select a model before sending a request.');
    }

    const providerId = this._modelToProvider.get(modelId);
    if (!providerId) {
      throw new Error(`No provider found for model '${modelId}'. The model may no longer be available.`);
    }

    const provider = this._providers.get(providerId);
    if (!provider) {
      throw new Error(`Provider '${providerId}' is no longer registered.`);
    }

    try {
      yield* provider.sendChatRequest(modelId, messages, options, signal);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // Request was cancelled — not an error
        return;
      }
      throw new Error(
        `Chat request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Send a chat request to a **specific model** without mutating the global
   * active-model state.
   *
   * This is the isolation-safe entry point used by the extension API bridge
   * (`parallx.lm.sendChatRequest`).  It resolves the provider for `modelId`
   * directly — no call to `setActiveModel`, no storage write, no streaming-
   * state reset, no `onDidChangeModels` event.  Multiple concurrent callers
   * (OpenClaw, text-generator, inline AI) can therefore dispatch requests to
   * different models without interfering with each other.
   *
   * The existing `sendChatRequest(messages)` (no modelId) is preserved for
   * internal callers that operate on the UI-selected active model.
   */
  async *sendChatRequestForModel(
    modelId: string,
    messages: readonly IChatMessage[],
    options?: IChatRequestOptions,
    signal?: AbortSignal,
  ): AsyncIterable<IChatResponseChunk> {
    if (!modelId) {
      throw new Error('No model ID provided.');
    }

    const providerId = this._modelToProvider.get(modelId);
    if (!providerId) {
      throw new Error(`No provider found for model '${modelId}'. The model may no longer be available.`);
    }

    const provider = this._providers.get(providerId);
    if (!provider) {
      throw new Error(`Provider '${providerId}' is no longer registered.`);
    }

    try {
      yield* provider.sendChatRequest(modelId, messages, options, signal);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      throw new Error(
        `Chat request failed for model '${modelId}': ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ── Provider Status ──

  async checkStatus(): Promise<IProviderStatus> {
    // Use the first provider (Ollama) for status check
    const provider = this._providers.values().next().value;
    if (!provider) {
      return { available: false, error: 'No language model provider registered.' };
    }
    try {
      return await provider.checkAvailability();
    } catch (err) {
      return {
        available: false,
        error: `Status check failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // ── Internal ──

  private async _refreshModels(): Promise<void> {
    const allModels: ILanguageModelInfo[] = [];
    this._modelToProvider.clear();

    for (const [providerId, provider] of this._providers) {
      try {
        const models = await provider.listModels();
        for (const model of models) {
          allModels.push(model);
          this._modelToProvider.set(model.id, providerId);
        }
      } catch {
        // Provider failed to list models — skip but don't crash
        console.warn(`[LanguageModelsService] Failed to list models from provider '${providerId}'.`);
      }
    }

    this._cachedModels = allModels;

    // ── Active model fallback chain ──
    // 1. Keep current active model if it's still available
    if (this._activeModelId && this._modelToProvider.has(this._activeModelId)) {
      // Model still valid — nothing to do
      this._onDidChangeModels.fire();
      return;
    }

    // 2. Try the configured default model from AI Settings
    if (this._defaultModelId && this._modelToProvider.has(this._defaultModelId)) {
      this._activeModelId = this._defaultModelId;
      this._persistActiveModel();
      this._onDidChangeModels.fire();
      return;
    }

    // 3. Fall back to first non-embedding model, or first model available
    if (allModels.length > 0) {
      const chatModel = allModels.find(m => !this._isEmbeddingModel(m));
      this._activeModelId = chatModel?.id ?? allModels[0].id;
      this._persistActiveModel();
    } else {
      // No models available — clear
      this._activeModelId = undefined;
      this._persistActiveModel();
    }

    this._onDidChangeModels.fire();
  }

  /**
   * Heuristic: embedding models have 'embed' in their name or belong to
   * embedding-only model families (e.g. nomic-bert).
   */
  private _isEmbeddingModel(model: ILanguageModelInfo): boolean {
    const id = model.id.toLowerCase();
    const family = model.family.toLowerCase();
    return id.includes('embed') || family.includes('bert');
  }
}
