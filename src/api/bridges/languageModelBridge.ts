// languageModelBridge.ts — bridges parallx.lm to ILanguageModelsService (M9 Cap 8 Task 8.3)
//
// Scopes language model access for tools and tracks disposables.

import type { IDisposable } from '../../platform/lifecycle.js';
import type {
  ILanguageModelsService,
  ILanguageModelProvider,
  ILanguageModelInfo,
  IChatMessage,
  IChatRequestOptions,
  IChatResponseChunk,
} from '../../services/chatTypes.js';
import type { Event } from '../../platform/events.js';

/**
 * Bridge for the `parallx.lm` API namespace.
 * All provider registrations through this bridge are attributed to the tool.
 */
export class LanguageModelBridge {
  private readonly _registrations: IDisposable[] = [];
  private _disposed = false;

  constructor(
    private readonly _toolId: string,
    private readonly _service: ILanguageModelsService,
    private readonly _subscriptions: IDisposable[],
  ) {}

  /**
   * Get all available language models.
   */
  async getModels(): Promise<readonly ILanguageModelInfo[]> {
    this._throwIfDisposed();
    return this._service.getModels();
  }

  /**
   * Send a chat request to a specific model.
   *
   * Note: The internal service uses the active model by default.
   * The bridge delegates to the provider based on modelId.
   */
  sendChatRequest(
    modelId: string,
    messages: readonly IChatMessage[],
    options?: IChatRequestOptions,
  ): AsyncIterable<IChatResponseChunk> {
    this._throwIfDisposed();
    // The internal service doesn't take modelId directly on sendChatRequest —
    // it routes based on the active model. For the API, we set the active
    // model before sending. This is a simplification; a future version may
    // support concurrent model requests.
    this._service.setActiveModel(modelId);
    return this._service.sendChatRequest(messages, options);
  }

  /**
   * Register a language model provider.
   */
  registerProvider(provider: ILanguageModelProvider): IDisposable {
    this._throwIfDisposed();
    const disposable = this._service.registerProvider(provider);
    this._registrations.push(disposable);
    this._subscriptions.push(disposable);
    return disposable;
  }

  /**
   * Event that fires when available models change.
   */
  get onDidChangeModels(): Event<void> {
    return this._service.onDidChangeModels;
  }

  /**
   * Dispose all registrations made by this tool.
   */
  dispose(): void {
    this._disposed = true;
    for (const d of this._registrations) {
      d.dispose();
    }
    this._registrations.length = 0;
  }

  private _throwIfDisposed(): void {
    if (this._disposed) {
      throw new Error(`[LanguageModelBridge] tool "${this._toolId}" is disposed`);
    }
  }
}
