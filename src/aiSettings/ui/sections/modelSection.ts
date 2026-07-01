// modelSection.ts — Default Model + Default Context Length (workspace-scoped)
//
// Two settings:
//   - Default Model       (string  → unified config `model.chatModel`)
//   - Default Context Length (number → unified config `model.contextWindow`)
//
// Both are workspace-scoped: edits write to the workspace override layer
// via IUnifiedAIConfigService.updateWorkspaceOverride. The scope badge
// rendered by createSettingRow reflects this automatically.
//
// On startup, src/built-in/chat/main.ts reads
//   unifiedConfigService.getEffectiveConfig().model.chatModel
//   unifiedConfigService.getEffectiveConfig().model.contextWindow
// and applies them via ILanguageModelsService.setDefaultModel /
// OllamaProvider.setContextLengthOverride. It also subscribes to
// onDidChangeConfig so edits take effect live without a restart.

import { addDisposableListener } from '../../../ui/dom.js';
import { InputBox } from '../../../ui/inputBox.js';
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

// Minimal view of the main-process Claude key bridge (electron/anthropicBridge.cjs).
// Accessed inline (not imported from built-in/chat) to keep the settings UI layer
// free of a dependency on the chat extension. The API key lives only in main.
interface ICloudKeyBridge {
  hasKey(): Promise<boolean>;
  setKey(key: string): Promise<{ ok: boolean; error?: string }>;
  clearKey(): Promise<unknown>;
}
function cloudKeyBridge(): ICloudKeyBridge | undefined {
  return (globalThis as { parallxElectron?: { anthropic?: ICloudKeyBridge } })
    .parallxElectron?.anthropic;
}

// ─── ModelSection ────────────────────────────────────────────────────────────

export class ModelSection extends SettingsSection {

  private readonly _unifiedService: IUnifiedAIConfigService | undefined;
  private readonly _lms: ILanguageModelsService | undefined;

  private _modelSelect!: HTMLSelectElement;
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

    // ── Default Model (dropdown) ─────────────────────────────────────────
    const modelRow = createSettingRow({
      label: 'Default Model',
      description: 'The model used by new chat sessions. Leave on “Auto” to pick the first available model.',
      key: 'model.chatModel',
      onReset: () => {
        void this._writeWorkspace({ model: { chatModel: defaults.chatModel } })
          .then(() => this._notifySaved('model.chatModel'));
        this._modelSelect.value = '';
      },
      scopePath: 'model.chatModel',
      unifiedService: this._unifiedService,
    });

    this._modelSelect = document.createElement('select');
    this._modelSelect.className = 'ai-settings-select';
    this._modelSelect.setAttribute('aria-label', 'Default model');
    // Placeholder option until models load
    this._appendOption('', 'Auto — first available', true);
    modelRow.controlSlot.appendChild(this._modelSelect);

    this._register(addDisposableListener(this._modelSelect, 'change', () => {
      const value = this._modelSelect.value;
      void this._writeWorkspace({ model: { chatModel: value } })
        .then(() => this._notifySaved('model.chatModel'));
    }));

    this._addRow(modelRow.row);

    // Populate now + on provider/model changes
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
    this._contextInput.element.classList.add('ai-settings-number-input');
    this._contextInput.inputElement.type = 'number';
    this._contextInput.inputElement.min = '0';
    this._contextInput.inputElement.step = '1';

    const saveContext = () => {
      const raw = this._contextInput.value.trim();
      const n = raw === '' ? 0 : Math.max(0, Math.floor(Number(raw) || 0));
      this._contextInput.value = String(n);
      void this._writeWorkspace({ model: { contextWindow: n } })
        .then(() => this._notifySaved('model.contextWindow'));
    };
    this._register(this._contextInput.onDidSubmit(saveContext));
    this._register(addDisposableListener(this._contextInput.inputElement, 'blur', saveContext));

    this._addRow(ctxRow.row);

    // ── Claude (cloud) API key ───────────────────────────────────────────
    this._buildCloudKeyRow();
  }

  /**
   * Claude API key entry. The key is sent to the main process (safeStorage) and
   * never returned to the renderer — this row only sets/clears it and shows
   * whether one is stored. Cloud models are additionally gated per-workspace by
   * the `ai.allowCloudModels` toggle (auto-rendered in the Settings hub).
   */
  private _buildCloudKeyRow(): void {
    const keyRow = createSettingRow({
      label: 'Claude (cloud) API key',
      description: 'Anthropic API key, used when cloud models are enabled for a workspace. Stored encrypted on this machine — never in settings files or the renderer. Get one at console.anthropic.com. Enable cloud models per-workspace via Settings → AI → “Allow cloud models”.',
      key: 'ai.anthropic.apiKey',
    });
    keyRow.row.classList.add('ai-settings-key-row');

    const bridge = cloudKeyBridge();
    if (!bridge) {
      const na = document.createElement('span');
      na.className = 'ai-settings-key-status';
      na.textContent = 'Cloud models are unavailable in this build.';
      keyRow.controlSlot.appendChild(na);
      this._addRow(keyRow.row);
      return;
    }

    const input = this._register(new InputBox(keyRow.controlSlot, {
      value: '',
      placeholder: 'sk-ant-…',
      ariaLabel: 'Claude API key',
    }));
    input.inputElement.type = 'password';
    input.inputElement.autocomplete = 'off';

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'ai-settings-key-btn';
    saveBtn.textContent = 'Save';

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'ai-settings-key-btn';
    clearBtn.textContent = 'Clear';

    const status = document.createElement('span');
    status.className = 'ai-settings-key-status';

    keyRow.controlSlot.append(saveBtn, clearBtn, status);

    const refresh = async (): Promise<void> => {
      const has = await bridge.hasKey().catch(() => false);
      status.textContent = has ? '✓ Key saved' : 'No key set';
      clearBtn.style.display = has ? '' : 'none';
    };
    void refresh();

    this._register(addDisposableListener(saveBtn, 'click', () => {
      const value = input.value.trim();
      if (!value) { status.textContent = 'Enter a key first'; return; }
      status.textContent = 'Saving…';
      void bridge.setKey(value).then((r) => {
        if (r && r.ok) { input.value = ''; void refresh(); }
        else { status.textContent = `Couldn’t save: ${r?.error ?? 'unknown error'}`; }
      });
    }));

    this._register(addDisposableListener(clearBtn, 'click', () => {
      void bridge.clearKey().then(() => { input.value = ''; void refresh(); });
    }));

    this._addRow(keyRow.row);
  }

  update(_profile: AISettingsProfile): void {
    // Re-sync controls in case workspace override or active preset changed
    // out from under us.
    const current = this._currentModelId();
    if (this._modelSelect && this._modelSelect.value !== current) {
      // Only update if the option exists (avoid wiping selection mid-load)
      const has = Array.from(this._modelSelect.options).some(o => o.value === current);
      if (has) this._modelSelect.value = current;
    }
    if (this._contextInput) {
      const ctx = String(this._currentContextWindow());
      if (this._contextInput.value !== ctx) this._contextInput.value = ctx;
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────

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
    if (!this._lms || !this._modelSelect) return;
    let models: readonly ILanguageModelInfo[] = [];
    try {
      models = await this._lms.getModels();
    } catch {
      models = [];
    }

    const current = this._currentModelId();
    this._modelSelect.replaceChildren();
    this._appendOption('', 'Auto — first available', current === '');

    // Group by family for readability
    const sorted = [...models].sort((a, b) => {
      if (a.family !== b.family) return a.family.localeCompare(b.family);
      return a.displayName.localeCompare(b.displayName);
    });
    for (const m of sorted) {
      const label = m.parameterSize
        ? `${m.displayName} · ${m.parameterSize}`
        : m.displayName;
      this._appendOption(m.id, label, m.id === current);
    }

    // If the persisted model isn't present (e.g. uninstalled), keep it
    // visible so the user can see what was set.
    if (current && !sorted.some(m => m.id === current)) {
      this._appendOption(current, `${current} (not installed)`, true);
    }
  }

  private _appendOption(value: string, label: string, selected: boolean): void {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    if (selected) opt.selected = true;
    this._modelSelect.appendChild(opt);
  }
}
