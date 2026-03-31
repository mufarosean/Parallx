// modelSection.ts — Model settings section (M15 Task 2.6)
//
// Fields:
//   - Default Model (dropdown populated from available Ollama models)
//   - Creativity / Temperature (Slider 0.0–1.0, 5 labeled stops)
//   - Max Response Tokens (InputBox, number, 0 = model default)
//
// Temperature slider has labeled stops: Precise (0) · Focused (0.25) ·
// Balanced (0.5) · Expressive (0.75) · Creative (1.0).
// Current value shown as plain text below the slider.

import { $ } from '../../../ui/dom.js';
import { Slider } from '../../../ui/slider.js';
import { InputBox } from '../../../ui/inputBox.js';
import type { IAISettingsService, AISettingsProfile } from '../../aiSettingsTypes.js';
import { DEFAULT_PROFILE } from '../../aiSettingsDefaults.js';
import { SettingsSection, createSettingRow } from '../sectionBase.js';
import type { ILanguageModelsService } from '../../../services/chatTypes.js';

// ─── ModelSection ────────────────────────────────────────────────────────────

export class ModelSection extends SettingsSection {

  private _temperatureSlider!: Slider;
  private _temperatureValue!: HTMLElement;
  private _maxTokensInput!: InputBox;
  private _maxTokensWarning!: HTMLElement;
  private _defaultModelSelect!: HTMLSelectElement;

  constructor(service: IAISettingsService, private readonly _languageModelsService?: ILanguageModelsService) {
    super(service, 'model', 'Model');
  }

  build(): void {
    // ── Default Model ──
    const defaultModelRow = createSettingRow({
      label: 'Default Model',
      description: 'Model used for new chat sessions. Empty = auto-select the most recently used model.',
      key: 'model.defaultModel',
      onReset: () => this._service.updateActiveProfile({
        model: { defaultModel: DEFAULT_PROFILE.model.defaultModel },
      }),
    });
    this._defaultModelSelect = document.createElement('select');
    this._defaultModelSelect.className = 'ai-settings-select';
    this._defaultModelSelect.setAttribute('aria-label', 'Default model');
    defaultModelRow.controlSlot.appendChild(this._defaultModelSelect);

    // Populate model list
    this._populateModelDropdown();

    // Re-populate when models change
    if (this._languageModelsService) {
      this._register(this._languageModelsService.onDidChangeModels(() => this._populateModelDropdown()));
    }

    this._defaultModelSelect.addEventListener('change', () => {
      const selected = this._defaultModelSelect.value;
      this._service.updateActiveProfile({ model: { defaultModel: selected } });
      this._notifySaved('model.defaultModel');
    });
    this._addRow(defaultModelRow.row);

    // ── Temperature ──
    const tempRow = createSettingRow({
      label: 'Creativity / Temperature',
      description: 'Controls randomness. Lower = more focused, higher = more creative. Default: 0.7',
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
      this._notifySaved('model.temperature');
    }));
    this._addRow(tempRow.row);

    // ── Max Response Tokens ──
    const maxTokensRow = createSettingRow({
      label: 'Max Response Tokens',
      description: 'Maximum length of AI responses. Higher = longer answers but slower. 0 = no limit.',
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
        this._notifySaved('model.maxTokens');
      }
    }));
    this._addRow(maxTokensRow.row);

    // ── Reset section link ──
    this._addResetSectionLink('model');
  }

  update(profile: AISettingsProfile): void {
    // Default model
    if (this._defaultModelSelect.value !== profile.model.defaultModel) {
      this._defaultModelSelect.value = profile.model.defaultModel;
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
  }

  private _populateModelDropdown(): void {
    this._defaultModelSelect.innerHTML = '';

    // "Auto" option (empty string = auto-select)
    const autoOpt = document.createElement('option');
    autoOpt.value = '';
    autoOpt.textContent = 'Auto (most recently used)';
    this._defaultModelSelect.appendChild(autoOpt);

    if (!this._languageModelsService) return;

    this._languageModelsService.getModels().then((models) => {
      for (const model of models) {
        const opt = document.createElement('option');
        opt.value = model.id;
        opt.textContent = `${model.displayName} (${model.parameterSize})`;
        this._defaultModelSelect.appendChild(opt);
      }
      // Restore selection
      const profile = this._service.getActiveProfile();
      this._defaultModelSelect.value = profile.model.defaultModel || '';
    }).catch(() => {
      // Models not available — keep auto option only
    });
  }
}
