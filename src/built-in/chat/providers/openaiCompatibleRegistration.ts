// openaiCompatibleRegistration.ts — the OpenAI-compatible provider's settings
// and its live registration with the language-models service.
//
// Off by default. While it is off nothing is constructed, listed or polled:
// the provider exists only while `ai.providers.openaiCompatible.enabled` is on
// for this workspace (AI Settings › Model › Providers). Changing the server
// URL re-registers it, so the model list follows the new server. In a sealed
// workspace only a server on this machine is registered; the main process
// refuses any other as well.

import { toDisposable, type IDisposable } from '../../../platform/lifecycle.js';
import type { ILanguageModelsService } from '../../../services/chatTypes.js';
import type { ISettingsRegistryService } from '../../../services/settingsRegistryService.js';
import { isWorkspaceSealed, SEALED_WORKSPACE_SETTING } from '../../../services/sealedWorkspace.js';
import {
  OpenAICompatibleProvider,
  OPENAI_COMPATIBLE_DEFAULT_BASE_URL,
  getOpenAICompatibleBridge,
  isLoopbackUrl,
  normalizeBaseUrl,
  type IOpenAICompatibleBridge,
} from './openaiCompatibleProvider.js';

export const OPENAI_COMPATIBLE_ENABLED_SETTING = 'ai.providers.openaiCompatible.enabled';
export const OPENAI_COMPATIBLE_BASE_URL_SETTING = 'ai.providers.openaiCompatible.baseUrl';

type Registry = Pick<ISettingsRegistryService, 'register' | 'getSchema' | 'getValue' | 'onDidChange'>;

/** Register the provider's two settings once. */
export function registerOpenAICompatibleSettings(registry: Registry): void {
  if (!registry.getSchema(OPENAI_COMPATIBLE_ENABLED_SETTING)) {
    registry.register({
      key: OPENAI_COMPATIBLE_ENABLED_SETTING,
      type: 'boolean',
      default: false,
      scope: 'workspace',
      label: 'OpenAI-Compatible Server',
      description: 'Use models from a server that speaks the OpenAI API (LM Studio, llama.cpp server, vLLM, LocalAI) in this workspace. Off by default. A server on another machine receives your chats.',
      category: 'AI',
    });
  }
  if (!registry.getSchema(OPENAI_COMPATIBLE_BASE_URL_SETTING)) {
    registry.register({
      key: OPENAI_COMPATIBLE_BASE_URL_SETTING,
      type: 'string',
      default: OPENAI_COMPATIBLE_DEFAULT_BASE_URL,
      scope: 'workspace',
      label: 'OpenAI-Compatible Server URL',
      description: 'The server’s base URL, ending in /v1. LM Studio: http://localhost:1234/v1. llama.cpp server: http://localhost:8080/v1. vLLM: http://localhost:8000/v1.',
      category: 'AI',
    });
  }
}

/**
 * Keep the provider registered exactly while it is turned on. Returns a
 * disposable that unregisters it and stops listening.
 */
export function wireOpenAICompatibleProvider(
  registry: Registry | undefined,
  languageModels: Pick<ILanguageModelsService, 'registerProvider'>,
  bridge: IOpenAICompatibleBridge | undefined = getOpenAICompatibleBridge(),
): IDisposable {
  if (registry) registerOpenAICompatibleSettings(registry);
  if (!registry || !bridge) return toDisposable(() => { /* nothing registered */ });

  let provider: OpenAICompatibleProvider | undefined;
  let registration: IDisposable | undefined;

  const read = <T>(key: string): T | undefined => {
    try { return registry.getValue<T>(key); } catch { return undefined; }
  };
  const stop = (): void => {
    registration?.dispose(); registration = undefined;
    provider?.dispose(); provider = undefined;
  };
  const sync = (): void => {
    const baseUrl = normalizeBaseUrl(read<string>(OPENAI_COMPATIBLE_BASE_URL_SETTING));
    const sealedOut = isWorkspaceSealed(registry) && !isLoopbackUrl(baseUrl);
    const on = read<boolean>(OPENAI_COMPATIBLE_ENABLED_SETTING) === true && !sealedOut;
    if (!on) { stop(); return; }
    if (provider && provider.baseUrl === baseUrl) return;
    stop();
    provider = new OpenAICompatibleProvider(bridge, baseUrl);
    registration = languageModels.registerProvider(provider);
  };

  sync();
  const sub = registry.onDidChange((c) => {
    if (c.key === OPENAI_COMPATIBLE_ENABLED_SETTING || c.key === OPENAI_COMPATIBLE_BASE_URL_SETTING || c.key === SEALED_WORKSPACE_SETTING) sync();
  });
  return toDisposable(() => { sub.dispose(); stop(); });
}
