// modelSection.ts — Model settings section (M15 Task 2.6)
//
// Fields:
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
import type { IAISettingsService, AISettingsProfile } from '../../aiSettingsTypes.js';
import { DEFAULT_PROFILE } from '../../aiSettingsDefaults.js';
import { SettingsSection, createSettingRow } from '../sectionBase.js';

// ─── ModelSection ────────────────────────────────────────────────────────────

export class ModelSection extends SettingsSection {

  private _temperatureSlider!: Slider;
  private _temperatureValue!: HTMLElement;
  private _maxTokensInput!: InputBox;
  private _maxTokensWarning!: HTMLElement;
  private _contextWindowInput!: InputBox;

  constructor(service: IAISettingsService) {
    super(service, 'model', 'Model');
  }

  build(): void {
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
}
