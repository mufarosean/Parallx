// suggestionsSection.ts — Suggestions settings section (M15 Task 2.5)
//
// Fields:
//   - Proactive Suggestions (Toggle, default ON)
//   - Suggestion Confidence (Slider 0–100%, default 65%)
//   - Suggestion Backlog Limit (InputBox, number 1–20, default 5)
//
// Confidence slider has a live tooltip that updates with descriptive text
// based on the current value range.

import { $ } from '../../../ui/dom.js';
import { Toggle } from '../../../ui/toggle.js';
import { Slider } from '../../../ui/slider.js';
import { InputBox } from '../../../ui/inputBox.js';
import type { IAISettingsService, AISettingsProfile } from '../../aiSettingsTypes.js';
import { DEFAULT_PROFILE } from '../../aiSettingsDefaults.js';
import { SettingsSection, createSettingRow } from '../sectionBase.js';

// ─── Confidence Descriptions ─────────────────────────────────────────────────

function getConfidenceDescription(pct: number): string {
  if (pct <= 40) return 'Very sensitive — many suggestions, some may be low quality';
  if (pct <= 70) return 'Balanced — good mix of frequency and quality';
  if (pct <= 90) return 'Selective — only high-confidence suggestions surface';
  return 'Very selective — most signals will be silently ignored';
}

// ─── SuggestionsSection ──────────────────────────────────────────────────────

export class SuggestionsSection extends SettingsSection {

  private _enabledToggle!: Toggle;
  private _confidenceSlider!: Slider;
  private _confidenceDesc!: HTMLElement;
  private _backlogInput!: InputBox;

  constructor(service: IAISettingsService) {
    super(service, 'suggestions', 'Suggestions');
  }

  build(): void {
    // ── Proactive Suggestions ──
    const enabledRow = createSettingRow({
      label: 'Proactive Suggestions',
      description: 'Show suggestion cards based on workspace activity',
      key: 'suggestions.suggestionsEnabled',
      onReset: () => this._service.updateActiveProfile({
        suggestions: { suggestionsEnabled: DEFAULT_PROFILE.suggestions.suggestionsEnabled },
      }),
    });
    this._enabledToggle = this._register(new Toggle(enabledRow.controlSlot, {
      ariaLabel: 'Enable proactive suggestions',
    }));
    this._register(this._enabledToggle.onDidChange((checked) => {
      this._service.updateActiveProfile({ suggestions: { suggestionsEnabled: checked } });
      this._notifySaved('suggestions.suggestionsEnabled');
    }));
    this._addRow(enabledRow.row);

    // ── Suggestion Confidence ──
    const confidenceRow = createSettingRow({
      label: 'Suggestion Confidence',
      description: 'Minimum confidence to surface a suggestion (0–100%)',
      key: 'suggestions.suggestionConfidenceThreshold',
      onReset: () => this._service.updateActiveProfile({
        suggestions: { suggestionConfidenceThreshold: DEFAULT_PROFILE.suggestions.suggestionConfidenceThreshold },
      }),
    });
    this._confidenceSlider = this._register(new Slider(confidenceRow.controlSlot, {
      min: 0,
      max: 100,
      step: 1,
      value: 65,
      ariaLabel: 'Suggestion confidence threshold',
    }));
    this._confidenceDesc = $('div.ai-settings-confidence-desc');
    this._confidenceDesc.textContent = getConfidenceDescription(65);
    confidenceRow.controlSlot.appendChild(this._confidenceDesc);

    this._register(this._confidenceSlider.onDidChange((value) => {
      // Convert 0–100 scale to 0–1 for the service
      this._service.updateActiveProfile({
        suggestions: { suggestionConfidenceThreshold: value / 100 },
      });
      this._confidenceDesc.textContent = getConfidenceDescription(value);
      this._notifySaved('suggestions.suggestionConfidenceThreshold');
    }));
    this._addRow(confidenceRow.row);

    // ── Backlog Limit ──
    const backlogRow = createSettingRow({
      label: 'Suggestion Backlog Limit',
      description: 'Max suggestion cards visible at once (1–20)',
      key: 'suggestions.maxPendingSuggestions',
      onReset: () => this._service.updateActiveProfile({
        suggestions: { maxPendingSuggestions: DEFAULT_PROFILE.suggestions.maxPendingSuggestions },
      }),
    });
    this._backlogInput = this._register(new InputBox(backlogRow.controlSlot, {
      placeholder: '5',
      ariaLabel: 'Max pending suggestions',
      validationFn: (v) => {
        const n = parseInt(v, 10);
        if (isNaN(n) || n < 1 || n > 20) return 'Must be a number between 1 and 20';
        return null;
      },
    }));
    this._backlogInput.inputElement.type = 'number';
    this._backlogInput.inputElement.min = '1';
    this._backlogInput.inputElement.max = '20';

    this._register(this._backlogInput.onDidChange((value) => {
      const n = parseInt(value, 10);
      if (!isNaN(n) && n >= 1 && n <= 20) {
        this._service.updateActiveProfile({ suggestions: { maxPendingSuggestions: n } });
        this._notifySaved('suggestions.maxPendingSuggestions');
      }
    }));
    this._addRow(backlogRow.row);

    // ── Reset section link ──
    this._addResetSectionLink('suggestions');
  }

  update(profile: AISettingsProfile): void {
    // Enabled toggle
    if (this._enabledToggle.checked !== profile.suggestions.suggestionsEnabled) {
      this._enabledToggle.checked = profile.suggestions.suggestionsEnabled;
    }

    // Confidence slider (service stores 0–1, slider uses 0–100)
    const pct = Math.round(profile.suggestions.suggestionConfidenceThreshold * 100);
    if (this._confidenceSlider.value !== pct) {
      this._confidenceSlider.value = pct;
      this._confidenceDesc.textContent = getConfidenceDescription(pct);
    }

    // Backlog limit
    const backlogStr = String(profile.suggestions.maxPendingSuggestions);
    if (this._backlogInput.value !== backlogStr) {
      this._backlogInput.value = backlogStr;
    }
  }
}
