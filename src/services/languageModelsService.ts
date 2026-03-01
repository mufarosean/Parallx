// languageModelsService.ts — ILanguageModelsService implementation (M9 Task 1.1)
//
// Manages language model providers, aggregates models, tracks active model
// selection, and delegates chat requests to the appropriate provider.
//
// VS Code reference:
//   src/vs/workbench/contrib/chat/common/languageModels.ts

import { Disposable } from '../platform/lifecycle.js';
import { Emitter } from '../platform/events.js';
import { toDisposable } from '../platform/lifecycle.js';
import type { IDisposable } from '../platform/lifecycle.js';
import type { Event } from '../platform/events.js';
import type {
  ILanguageModelsService,
  ILanguageModelProvider,
  ILanguageModelInfo,
  IProviderStatus,
  IChatMessage,
  IChatRequestOptions,
  IChatResponseChunk,
} from './chatTypes.js';

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

  // ── Active model ──

  private _activeModelId: string | undefined;

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

    return toDisposable(() => {
      this._providers.delete(provider.id);
      // Clear model mappings for this provider
      for (const [modelId, providerId] of this._modelToProvider) {
        if (providerId === provider.id) {
          this._modelToProvider.delete(modelId);
        }
      }
      // If active model was from this provider, clear it
      if (this._activeModelId && this._modelToProvider.get(this._activeModelId) === provider.id) {
        this._activeModelId = undefined;
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
    await this._refreshModels();
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
    this._onDidChangeModels.fire();
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

    // Auto-select first model if none selected and models are available
    if (!this._activeModelId && allModels.length > 0) {
      this._activeModelId = allModels[0].id;
    }

    this._onDidChangeModels.fire();
  }
}
