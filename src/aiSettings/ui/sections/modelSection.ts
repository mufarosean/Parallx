// modelSection.ts — Model settings section (M15 Task 2.6)
//
// Fields:
//   - Default Model (Dropdown — populated from ILanguageModelsService)
//   - Creativity / Temperature (Slider 0.0–1.0, 5 labeled stops)
//   - Max Response Tokens (InputBox, number, 0 = model default)
//   - Context Window (InputBox, number, 0 = model default)
//
// Temperature slider has labeled stops: Precise (0) · Focused (0.25) ·
// Balanced (0.5) · Expressive (0.75) · Creative (1.0).
// Current value shown as plain text below the slider.

import { $ } from '../../../ui/dom.js';
import { Slider } from '../../../ui/slider.js';
import { InputBox } from '../../../ui/inputBox.js';
import { Dropdown } from '../../../ui/dropdown.js';
import type { IDropdownItem } from '../../../ui/dropdown.js';
import type { ILanguageModelsService } from '../../../services/chatTypes.js';
import type { IAISettingsService, AISettingsProfile } from '../../aiSettingsTypes.js';
import { DEFAULT_PROFILE } from '../../aiSettingsDefaults.js';
import { SettingsSection, createSettingRow } from '../sectionBase.js';

// ─── ModelSection ────────────────────────────────────────────────────────────

export class ModelSection extends SettingsSection {

  private _defaultModelDropdown!: Dropdown;
  private _temperatureSlider!: Slider;
  private _temperatureValue!: HTMLElement;
  private _maxTokensInput!: InputBox;
  private _maxTokensWarning!: HTMLElement;
  private _contextWindowInput!: InputBox;

  private readonly _languageModelsService: ILanguageModelsService | undefined;

  constructor(service: IAISettingsService, languageModelsService?: ILanguageModelsService) {
    super(service, 'model', 'Model');
    this._languageModelsService = languageModelsService;
  }

  build(): void {
    // ── Default Model ──
    const defaultModelRow = createSettingRow({
      label: 'Default Model',
      description: 'Model used for new chats. Auto-select picks the first available chat model.',
      key: 'model.defaultModel',
      onReset: () => this._service.updateActiveProfile({
        model: { defaultModel: DEFAULT_PROFILE.model.defaultModel },
      }),
    });
    this._defaultModelDropdown = this._register(new Dropdown(defaultModelRow.controlSlot, {
      items: [{ value: '', label: 'Auto-select' }],
      selected: '',
      placeholder: 'Auto-select',
      ariaLabel: 'Default model',
    }));

    this._register(this._defaultModelDropdown.onDidChange((value) => {
      this._service.updateActiveProfile({ model: { defaultModel: value } });
    }));
    this._addRow(defaultModelRow.row);

    // Populate dropdown from language models service (async)
    this._loadModelOptions();
    // Re-populate when models change
    if (this._languageModelsService) {
      this._register(this._languageModelsService.onDidChangeModels(() => {
        this._loadModelOptions();
      }));
    }

    // ── Temperature ──
    const tempRow = createSettingRow({
      label: 'Creativity / Temperature',
      description: 'Controls output randomness — lower values are more deterministic',
      key: 'model.temperature',
      onReset: () => this._service.updateActiveProfile({
        model: { temperature: DEFAULT_PROFILE.model.temperature },
      }),
    });
    this._temperatureSlider = this._register(new Slider(tempRow.controlSlot, {
      min: 0,
      max: 100,
      step: 1,
      value: 70, // 0.7 * 100
      labeledStops: [
        { value: 0, label: 'Precise' },
        { value: 25, label: 'Focused' },
        { value: 50, label: 'Balanced' },
        { value: 75, label: 'Expressive' },
        { value: 100, label: 'Creative' },
      ],
      ariaLabel: 'Temperature / creativity',
    }));

    this._temperatureValue = $('div.ai-settings-temperature-value');
    this._temperatureValue.textContent = 'Current value: 0.70';
    tempRow.controlSlot.appendChild(this._temperatureValue);

    this._register(this._temperatureSlider.onDidChange((value) => {
      const temp = value / 100;
      this._service.updateActiveProfile({ model: { temperature: temp } });
      this._temperatureValue.textContent = `Current value: ${temp.toFixed(2)}`;
    }));
    this._addRow(tempRow.row);

    // ── Max Response Tokens ──
    const maxTokensRow = createSettingRow({
      label: 'Max Response Tokens',
      description: 'Hard cap on response length (0 = model default)',
      key: 'model.maxTokens',
      onReset: () => this._service.updateActiveProfile({
        model: { maxTokens: DEFAULT_PROFILE.model.maxTokens },
      }),
    });
    this._maxTokensInput = this._register(new InputBox(maxTokensRow.controlSlot, {
      placeholder: '0',
      ariaLabel: 'Max response tokens',
    }));
    this._maxTokensInput.inputElement.type = 'number';
    this._maxTokensInput.inputElement.min = '0';

    this._maxTokensWarning = $('div.ai-settings-warning');
    this._maxTokensWarning.textContent = 'Very low — the AI may truncate responses mid-sentence.';
    this._maxTokensWarning.style.display = 'none';
    maxTokensRow.controlSlot.appendChild(this._maxTokensWarning);

    this._register(this._maxTokensInput.onDidChange((value) => {
      const n = parseInt(value, 10);
      if (!isNaN(n) && n >= 0) {
        this._service.updateActiveProfile({ model: { maxTokens: n } });
        this._maxTokensWarning.style.display = (n > 0 && n < 200) ? '' : 'none';
      }
    }));
    this._addRow(maxTokensRow.row);

    // ── Context Window ──
    const ctxRow = createSettingRow({
      label: 'Context Window',
      description: 'How much history the model sees (0 = model default)',
      key: 'model.contextWindow',
      onReset: () => this._service.updateActiveProfile({
        model: { contextWindow: DEFAULT_PROFILE.model.contextWindow },
      }),
    });
    this._contextWindowInput = this._register(new InputBox(ctxRow.controlSlot, {
      placeholder: '0',
      ariaLabel: 'Context window size',
    }));
    this._contextWindowInput.inputElement.type = 'number';
    this._contextWindowInput.inputElement.min = '0';

    this._register(this._contextWindowInput.onDidChange((value) => {
      const n = parseInt(value, 10);
      if (!isNaN(n) && n >= 0) {
        this._service.updateActiveProfile({ model: { contextWindow: n } });
      }
    }));
    this._addRow(ctxRow.row);

    // ── Reset section link ──
    this._addResetSectionLink('model');
  }

  update(profile: AISettingsProfile): void {
    // Default model
    if (this._defaultModelDropdown.value !== profile.model.defaultModel) {
      this._defaultModelDropdown.value = profile.model.defaultModel;
    }

    // Temperature (service stores 0–1, slider uses 0–100)
    const tempPct = Math.round(profile.model.temperature * 100);
    if (this._temperatureSlider.value !== tempPct) {
      this._temperatureSlider.value = tempPct;
      this._temperatureValue.textContent = `Current value: ${profile.model.temperature.toFixed(2)}`;
    }

    // Max tokens
    const maxStr = String(profile.model.maxTokens);
    if (this._maxTokensInput.value !== maxStr) {
      this._maxTokensInput.value = maxStr;
    }
    this._maxTokensWarning.style.display =
      (profile.model.maxTokens > 0 && profile.model.maxTokens < 200) ? '' : 'none';

    // Context window
    const ctxStr = String(profile.model.contextWindow);
    if (this._contextWindowInput.value !== ctxStr) {
      this._contextWindowInput.value = ctxStr;
    }
  }

  // ── Internal ──

  /**
   * Populate the Default Model dropdown from the language models service.
   * Always includes an "Auto-select" entry with value ''.
   */
  private async _loadModelOptions(): Promise<void> {
    if (!this._languageModelsService) { return; }
    try {
      const models = await this._languageModelsService.getModels();
      const items: IDropdownItem[] = [{ value: '', label: 'Auto-select' }];
      for (const m of models) {
        // Skip embedding models — they can't handle chat
        if (m.id.toLowerCase().includes('embed') || m.family.toLowerCase().includes('bert')) {
          continue;
        }
        items.push({ value: m.id, label: m.displayName || m.id });
      }
      this._defaultModelDropdown.items = items;
      // Re-set value so the dropdown re-renders the correct label
      const profile = this._service.getActiveProfile();
      this._defaultModelDropdown.value = profile.model.defaultModel;
    } catch {
      // Models unavailable — keep the "Auto-select" default
    }
  }
}
