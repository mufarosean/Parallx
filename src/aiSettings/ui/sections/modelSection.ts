// modelSection.ts — Providers + Default Model + Default Context Length.
//
// The section leads with a PROVIDERS group where the user enables the model
// providers they want in this workspace and enters API keys for cloud ones:
//   - Ollama (local)        — enable toggle (default on).
//   - Claude (Anthropic)    — enable toggle (default off) + API key entry.
//   - OpenAI-compatible     — enable toggle (default off) + server URL + an
//                             optional API key, bound to that server.
// Enabling/disabling a provider registers/unregisters it live (its models
// appear/vanish in the Default Model picker below). Enable state is a
// workspace-scoped registry setting (`ai.providers.<id>.enabled`); the Claude
// API key is sent straight to the main process (safeStorage) and never held in
// the renderer.
//
// Below Providers: Default Model + Default Context Length (workspace-scoped
// unified config, unchanged).

import { createInput, declareControl, sceneSlug } from '../../../ui/kit.js';
import { addDisposableListener } from '../../../ui/dom.js';
import { Emitter } from '../../../platform/events.js';
import { InputBox } from '../../../ui/inputBox.js';
import { Dropdown } from '../../../ui/dropdown.js';
import type {
  IUnifiedAIConfigService,
  IUnifiedAIConfig,
} from '../../unifiedConfigTypes.js';
import type { DeepPartial } from '../../aiSettingsTypes.js';
import { DEFAULT_UNIFIED_CONFIG } from '../../unifiedConfigTypes.js';
import { SettingsSection, createSettingRow } from '../sectionBase.js';
import type { IAISettingsService, AISettingsProfile } from '../../aiSettingsTypes.js';
import type {
  ILanguageModelsService,
  ILanguageModelInfo,
} from '../../../services/chatTypes.js';
import { getGlobalSettingsRegistry } from '../../../services/settingsRegistryService.js';

// Minimal view of the main-process key bridges (electron/anthropicBridge.cjs,
// electron/openaiCompatibleBridge.cjs). Accessed inline (not imported from
// built-in/chat) to keep the settings UI layer free of a dependency on the chat
// extension. API keys live only in main. A server-bound key (OpenAI-compatible)
// is saved for, and checked against, the server URL set at the time.
interface ICloudKeyBridge {
  hasKey(baseUrl?: string): Promise<boolean>;
  setKey(key: string, baseUrl?: string): Promise<{ ok: boolean; error?: string }>;
  clearKey(): Promise<unknown>;
}
function cloudKeyBridge(d: IProviderDescriptor, baseUrl: () => string): ICloudKeyBridge | undefined {
  const all = (globalThis as { parallxElectron?: Record<string, ICloudKeyBridge | undefined> }).parallxElectron;
  const b = all?.[d.id];
  if (!b || !d.baseUrlKey) return b;
  return { hasKey: () => b.hasKey(baseUrl()), setKey: (key) => b.setKey(key, baseUrl()), clearKey: () => b.clearKey() };
}

/** Declarative provider catalog for the Providers group. Extend to add providers. */
interface IProviderDescriptor {
  readonly id: string;
  readonly name: string;
  readonly kind: 'Local' | 'Cloud' | 'Server';
  /** Workspace-scoped registry key toggling this provider. */
  readonly enabledKey: string;
  readonly enabledDefault: boolean;
  /** Cloud providers show an inline API-key field backed by the main bridge. */
  readonly hasApiKey: boolean;
  readonly keyPlaceholder?: string;
  readonly keyHelp?: string;
  /** The key is optional (the status says so instead of asking for one). */
  readonly keyOptional?: boolean;
  /** Workspace-scoped registry key holding the server URL, for providers that have one. */
  readonly baseUrlKey?: string;
  readonly baseUrlDefault?: string;
}

const PROVIDERS: readonly IProviderDescriptor[] = [
  {
    id: 'ollama', name: 'Ollama', kind: 'Local',
    enabledKey: 'ai.providers.ollama.enabled', enabledDefault: true, hasApiKey: false,
  },
  {
    id: 'anthropic', name: 'Claude (Anthropic)', kind: 'Cloud',
    enabledKey: 'ai.providers.anthropic.enabled', enabledDefault: false, hasApiKey: true,
    keyPlaceholder: 'sk-ant-…',
    keyHelp: 'Anthropic API key. Stored encrypted on this machine, never in settings files or the renderer. Get one at console.anthropic.com.',
  },
  {
    id: 'openaiCompatible', name: 'OpenAI-Compatible Server', kind: 'Server',
    enabledKey: 'ai.providers.openaiCompatible.enabled', enabledDefault: false, hasApiKey: true,
    keyOptional: true, keyPlaceholder: 'API key (optional)',
    baseUrlKey: 'ai.providers.openaiCompatible.baseUrl', baseUrlDefault: 'http://localhost:1234/v1',
    keyHelp: 'LM Studio, llama.cpp server, vLLM, LocalAI or any service with /v1/chat/completions. The URL ends in /v1 (LM Studio: http://localhost:1234/v1, llama.cpp: http://localhost:8080/v1). The API key is optional, stored encrypted on this machine and sent only to the server it was saved for.',
  },
];

// ─── ModelSection ────────────────────────────────────────────────────────────

export class ModelSection extends SettingsSection {

  private readonly _unifiedService: IUnifiedAIConfigService | undefined;
  private readonly _lms: ILanguageModelsService | undefined;
  /** Fires after a provider's server URL is saved (its key status depends on it). */
  private readonly _baseUrlChanged = this._register(new Emitter<void>());

  private _modelDropdown!: Dropdown;
  private _contextInput!: InputBox;

  constructor(
    service: IAISettingsService,
    unifiedService?: IUnifiedAIConfigService,
    languageModelsService?: ILanguageModelsService,
  ) {
    super(service, 'model', 'Model');
    this._unifiedService = unifiedService;
    this._lms = languageModelsService;
  }

  build(): void {
    const defaults = DEFAULT_UNIFIED_CONFIG.model;

    // ── Providers ────────────────────────────────────────────────────────
    this._buildProvidersGroup();

    // ── Default Model (dropdown) ─────────────────────────────────────────
    const modelRow = createSettingRow({
      label: 'Default Model',
      description: 'The model used by new chat sessions. Leave on “Auto” to pick the first available model. Only enabled providers appear here.',
      key: 'model.chatModel',
      onReset: () => {
        void this._writeWorkspace({ model: { chatModel: defaults.chatModel } })
          .then(() => this._notifySaved('model.chatModel'));
        this._modelDropdown.value = '';
      },
      scopePath: 'model.chatModel',
      unifiedService: this._unifiedService,
    });

    this._modelDropdown = this._register(new Dropdown(modelRow.controlSlot, {
      items: [{ value: '', label: 'Auto (first available)' }],
      selected: '',
      ariaLabel: 'Default model',
    }));
    this._register(declareControl(this._modelDropdown.element, { id: 'aiSettings.model.default', label: 'Default model', kind: 'select', state: () => ({ kind: 'value', value: this._modelDropdown.value ?? '' }) }));
    this._register(this._modelDropdown.onDidChange((value: string) => {
      void this._writeWorkspace({ model: { chatModel: value } })
        .then(() => this._notifySaved('model.chatModel'));
    }));

    this._addRow(modelRow.row);

    // Populate now + on provider/model changes (toggling a provider fires these).
    void this._refreshModels();
    if (this._lms) {
      this._register(this._lms.onDidChangeModels(() => void this._refreshModels()));
      this._register(this._lms.onDidChangeProviders(() => void this._refreshModels()));
    }

    // ── Default Context Length ───────────────────────────────────────────
    const ctxRow = createSettingRow({
      label: 'Default Context Length',
      description: 'Max context window (in tokens) used by new chats. 0 = use the model’s reported maximum. Increase only if the model actually supports it.',
      key: 'model.contextWindow',
      onReset: () => {
        this._contextInput.value = String(defaults.contextWindow);
        void this._writeWorkspace({ model: { contextWindow: defaults.contextWindow } })
          .then(() => this._notifySaved('model.contextWindow'));
      },
      scopePath: 'model.contextWindow',
      unifiedService: this._unifiedService,
    });

    this._contextInput = this._register(new InputBox(ctxRow.controlSlot, {
      value: String(this._currentContextWindow()),
      placeholder: '0',
      ariaLabel: 'Default context length in tokens',
      validationFn: (raw) => {
        if (raw === '') return null;
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
          return 'Enter 0 or a positive whole number';
        }
        if (n > 1_000_000) return 'Maximum is 1,000,000';
        return null;
      },
    }));
    this._register(declareControl(this._contextInput.element, { id: 'aiSettings.model.contextLength', label: 'Default context length in tokens', kind: 'input', state: () => ({ kind: 'value', value: this._contextInput.value }) }));
    this._contextInput.element.classList.add('ai-settings-number-input');
    this._contextInput.inputElement.type = 'number';
    this._contextInput.inputElement.min = '0';
    this._contextInput.inputElement.step = '1';

    const saveContext = () => {
      const raw = this._contextInput.value.trim();
      const n = raw === '' ? 0 : Math.max(0, Math.floor(Number(raw) || 0));
      this._contextInput.value = String(n);
      if (n === this._currentContextWindow()) return; // unchanged: no save, no re-render
      void this._writeWorkspace({ model: { contextWindow: n } })
        .then(() => this._notifySaved('model.contextWindow'));
    };
    this._register(this._contextInput.onDidSubmit(saveContext));
    this._register(addDisposableListener(this._contextInput.inputElement, 'blur', saveContext));

    this._addRow(ctxRow.row);
  }

  update(_profile: AISettingsProfile): void {
    const current = this._currentModelId();
    if (this._modelDropdown && this._modelDropdown.value !== current) {
      this._modelDropdown.value = current;
    }
    if (this._contextInput) {
      const ctx = String(this._currentContextWindow());
      if (this._contextInput.value !== ctx) this._contextInput.value = ctx;
    }
  }

  // ─── Providers group ──────────────────────────────────────────────────

  private _buildProvidersGroup(): void {
    const registry = getGlobalSettingsRegistry();

    const heading = document.createElement('div');
    heading.className = 'ai-settings-subheading';
    heading.textContent = 'Providers';
    this.contentElement.appendChild(heading);

    const help = document.createElement('div');
    help.className = 'ai-settings-provider__grouphelp';
    help.textContent = 'Choose which model providers are available in this workspace. Local Ollama runs on your machine; Claude sends data to Anthropic’s cloud, and a server on another machine receives your chats, so enable those only for workspaces without sensitive material.';
    this.contentElement.appendChild(help);

    const isOn = (d: IProviderDescriptor): boolean => {
      try { const v = registry?.getValue<boolean>(d.enabledKey); return v === undefined ? d.enabledDefault : v === true; }
      catch { return d.enabledDefault; }
    };

    // Keep toggles in sync if the setting changes elsewhere (e.g. Settings hub).
    const toggles = new Map<string, HTMLInputElement>();
    if (registry) {
      this._register(registry.onDidChange((c) => {
        const cb = toggles.get(c.key);
        if (cb) cb.checked = c.value === true;
      }));
    }

    for (const d of PROVIDERS) {
      const wrap = document.createElement('div');
      wrap.className = 'ai-settings-provider';

      const head = document.createElement('div');
      head.className = 'ai-settings-provider__head';

      const name = document.createElement('span');
      name.className = 'ai-settings-provider__name';
      name.textContent = d.name;

      const badge = document.createElement('span');
      badge.className = 'ai-settings-provider__badge';
      badge.textContent = d.kind;

      const status = document.createElement('span');
      status.className = 'ai-settings-provider__status';

      const toggleLabel = document.createElement('label');
      toggleLabel.className = 'ai-settings-provider__toggle';
      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.checked = isOn(d);
      toggle.setAttribute('aria-label', `Enable ${d.name} in this workspace`);
      declareControl(toggle, { id: `aiSettings.provider.${sceneSlug(d.id)}`, label: `Enable ${d.name}`, kind: 'toggle', state: () => ({ kind: 'pressed', value: toggle.checked }) });
      const toggleText = document.createElement('span');
      toggleText.textContent = 'Enabled';
      toggleLabel.append(toggle, toggleText);
      toggles.set(d.enabledKey, toggle);

      this._register(addDisposableListener(toggle, 'change', () => {
        if (!registry) return;
        void registry.setValue(d.enabledKey, toggle.checked).catch(() => { toggle.checked = !toggle.checked; });
      }));

      head.append(name, badge, status, toggleLabel);
      wrap.appendChild(head);

      const baseUrl = d.baseUrlKey ? this._buildBaseUrl(wrap, d, registry) : () => '';
      if (d.hasApiKey) {
        this._buildProviderKey(wrap, status, d, baseUrl);
      } else {
        status.textContent = 'Runs locally';
      }

      this.contentElement.appendChild(wrap);
    }
  }

  /** The server URL field of a provider that has one; returns a reader of the current URL. */
  private _buildBaseUrl(wrap: HTMLElement, d: IProviderDescriptor, registry: ReturnType<typeof getGlobalSettingsRegistry>): () => string {
    const key = d.baseUrlKey!;
    const current = (): string => {
      try { const v = registry?.getValue<string>(key); return typeof v === 'string' && v.trim() ? v.trim() : (d.baseUrlDefault ?? ''); }
      catch { return d.baseUrlDefault ?? ''; }
    };
    const input = createInput(wrap, { id: `aiSettings.baseUrl.${sceneSlug(d.id)}`, label: `${d.name} URL`, placeholder: d.baseUrlDefault, value: current() });
    this._register(input);
    const save = (): void => {
      const value = input.value.trim().replace(/\/+$/, '') || (d.baseUrlDefault ?? '');
      input.value = value;
      if (!registry || value === current()) return;
      void registry.setValue(key, value).then(() => this._baseUrlChanged.fire()).catch(() => { input.value = current(); });
    };
    this._register(addDisposableListener(input.element, 'change', save));
    if (registry) {
      this._register(registry.onDidChange((c) => { if (c.key === key && input.value !== current()) input.value = current(); }));
    }
    return current;
  }

  /** Inline API-key entry for a cloud provider or a server that may ask for a key. */
  private _buildProviderKey(wrap: HTMLElement, status: HTMLElement, d: IProviderDescriptor, baseUrl: () => string): void {
    const bridge = cloudKeyBridge(d, baseUrl);
    if (!bridge) {
      status.textContent = 'Unavailable in this build';
      return;
    }

    const keyRow = document.createElement('div');
    keyRow.className = 'ai-settings-provider__key';

    const input = this._register(new InputBox(keyRow, {
      value: '',
      placeholder: d.keyPlaceholder ?? '',
      ariaLabel: `${d.name} API key`,
    }));
    input.inputElement.type = 'password';
    input.inputElement.autocomplete = 'off';
    declareControl(input.inputElement, { id: `aiSettings.key.${sceneSlug(d.id)}`, label: `${d.name} API key`, kind: 'input', state: () => ({ kind: 'value', value: input.inputElement.value ? '•••' : '' }) });

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'ai-settings-key-btn';
    saveBtn.textContent = 'Save';
    declareControl(saveBtn, { id: `aiSettings.key.${sceneSlug(d.id)}.save`, label: `Save ${d.name} API key` });

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'ai-settings-key-btn';
    clearBtn.textContent = 'Clear';
    declareControl(clearBtn, { id: `aiSettings.key.${sceneSlug(d.id)}.clear`, label: `Clear ${d.name} API key` });

    const keyStatus = document.createElement('span');
    keyStatus.className = 'ai-settings-key-status';

    keyRow.append(saveBtn, clearBtn, keyStatus);

    const refresh = async (): Promise<void> => {
      const has = await bridge.hasKey().catch(() => false);
      status.textContent = has ? 'API key set' : (d.keyOptional ? 'No API key (optional)' : 'No API key');
      keyStatus.textContent = has ? '✓ Key saved' : '';
      clearBtn.style.display = has ? '' : 'none';
    };
    void refresh();
    if (d.baseUrlKey) this._register(this._baseUrlChanged.event(() => void refresh()));

    this._register(addDisposableListener(saveBtn, 'click', () => {
      const value = input.value.trim();
      if (!value) { keyStatus.textContent = 'Enter a key first'; return; }
      keyStatus.textContent = 'Saving…';
      void bridge.setKey(value).then((r) => {
        if (r && r.ok) { input.value = ''; void refresh(); }
        else { keyStatus.textContent = `Couldn’t save: ${r?.error ?? 'unknown error'}`; }
      });
    }));

    this._register(addDisposableListener(clearBtn, 'click', () => {
      void bridge.clearKey().then(() => { input.value = ''; void refresh(); });
    }));

    if (d.keyHelp) {
      const kh = document.createElement('div');
      kh.className = 'ai-settings-provider__keyhelp';
      kh.textContent = d.keyHelp;
      wrap.appendChild(kh);
    }
    wrap.appendChild(keyRow);
  }

  // ─── Helpers (Default Model / Context) ────────────────────────────────

  private _currentModelId(): string {
    const cfg = this._unifiedService?.getEffectiveConfig().model;
    return cfg?.chatModel ?? '';
  }

  private _currentContextWindow(): number {
    const cfg = this._unifiedService?.getEffectiveConfig().model;
    return cfg?.contextWindow ?? 0;
  }

  private async _writeWorkspace(patch: DeepPartial<IUnifiedAIConfig>): Promise<void> {
    if (!this._unifiedService) return;
    await this._unifiedService.updateWorkspaceOverride(patch);
  }

  private async _refreshModels(): Promise<void> {
    if (!this._lms || !this._modelDropdown) return;
    let models: readonly ILanguageModelInfo[] = [];
    try {
      models = await this._lms.getModels();
    } catch {
      models = [];
    }

    const current = this._currentModelId();
    const sorted = [...models].sort((a, b) => {
      if (a.family !== b.family) return a.family.localeCompare(b.family);
      return a.displayName.localeCompare(b.displayName);
    });

    const items = [
      { value: '', label: 'Auto (first available)' },
      ...sorted.map((m) => ({
        value: m.id,
        label: m.parameterSize ? `${m.displayName} · ${m.parameterSize}` : m.displayName,
      })),
    ];
    if (current && !sorted.some(m => m.id === current)) {
      items.push({ value: current, label: `${current} (not installed)` });
    }
    this._modelDropdown.items = items;
    this._modelDropdown.value = current;
  }
}
