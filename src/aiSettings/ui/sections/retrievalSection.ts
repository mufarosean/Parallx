// retrievalSection.ts — Retrieval settings section (M20 Task C.3, G.2)
//
// Fields:
//   - Auto-RAG (Toggle)
//   - RAG Top K (Slider: 1–30)
//   - Score Threshold (Slider: 0.0–1.0, step 0.05)
//   - Context Budget: informational display (elastic allocation — M20 Phase G)
//
// Each control reads/writes through IUnifiedAIConfigService.

import { $ } from '../../../ui/dom.js';
import { Toggle } from '../../../ui/toggle.js';
import { Slider } from '../../../ui/slider.js';
import type { IUnifiedAIConfigService, IUnifiedAIConfig } from '../../unifiedConfigTypes.js';
import { DEFAULT_UNIFIED_CONFIG } from '../../unifiedConfigTypes.js';
import { SettingsSection, createSettingRow } from '../sectionBase.js';
import type { IAISettingsService, AISettingsProfile } from '../../aiSettingsTypes.js';

// ─── RetrievalSection ────────────────────────────────────────────────────────

export class RetrievalSection extends SettingsSection {

  private _autoRagToggle!: Toggle;
  private _topKSlider!: Slider;
  private _topKValue!: HTMLElement;
  private _thresholdSlider!: Slider;
  private _thresholdValue!: HTMLElement;

  private readonly _unifiedService: IUnifiedAIConfigService | undefined;

  constructor(service: IAISettingsService, unifiedService?: IUnifiedAIConfigService) {
    super(service, 'retrieval', 'Retrieval');
    this._unifiedService = unifiedService;
  }

  build(): void {
    const defaults = DEFAULT_UNIFIED_CONFIG.retrieval;

    // ── Auto-RAG ──
    const autoRagRow = createSettingRow({
      label: 'Automatic RAG',
      description: 'Automatically search workspace for context on every message',
      key: 'retrieval.autoRag',
      onReset: () => this._updateRetrieval({ autoRag: defaults.autoRag }),
      scopePath: 'retrieval.autoRag',
      unifiedService: this._unifiedService,
    });
    this._autoRagToggle = this._register(new Toggle(autoRagRow.controlSlot, {
      ariaLabel: 'Enable automatic RAG',
    }));
    this._register(this._autoRagToggle.onDidChange((checked) => {
      this._updateRetrieval({ autoRag: checked });
      this._notifySaved('retrieval.autoRag');
    }));
    this._addRow(autoRagRow.row);

    // ── RAG Top K ──
    const topKRow = createSettingRow({
      label: 'RAG Top K',
      description: 'Number of top results to return from hybrid search (1–30)',
      key: 'retrieval.ragTopK',
      onReset: () => this._updateRetrieval({ ragTopK: defaults.ragTopK }),
      scopePath: 'retrieval.ragTopK',
      unifiedService: this._unifiedService,
    });
    this._topKSlider = this._register(new Slider(topKRow.controlSlot, {
      min: 1,
      max: 30,
      step: 1,
      value: defaults.ragTopK,
      ariaLabel: 'RAG Top K',
    }));
    this._topKValue = $('span.ai-settings-row__value', String(defaults.ragTopK));
    topKRow.controlSlot.appendChild(this._topKValue);
    this._register(this._topKSlider.onDidChange((value) => {
      this._topKValue.textContent = String(value);
      this._updateRetrieval({ ragTopK: value });
      this._notifySaved('retrieval.ragTopK');
    }));
    this._addRow(topKRow.row);

    // ── Score Threshold ──
    const thresholdRow = createSettingRow({
      label: 'Score Threshold',
      description: 'Minimum score to include a retrieval result (0.0–1.0)',
      key: 'retrieval.ragScoreThreshold',
      onReset: () => this._updateRetrieval({ ragScoreThreshold: defaults.ragScoreThreshold }),
      scopePath: 'retrieval.ragScoreThreshold',
      unifiedService: this._unifiedService,
    });
    this._thresholdSlider = this._register(new Slider(thresholdRow.controlSlot, {
      min: 0,
      max: 100,
      step: 5,
      value: defaults.ragScoreThreshold * 100,
      ariaLabel: 'Score threshold',
    }));
    this._thresholdValue = $('span.ai-settings-row__value', (defaults.ragScoreThreshold).toFixed(2));
    thresholdRow.controlSlot.appendChild(this._thresholdValue);
    this._register(this._thresholdSlider.onDidChange((value) => {
      const threshold = value / 100;
      this._thresholdValue.textContent = threshold.toFixed(2);
      this._updateRetrieval({ ragScoreThreshold: threshold });
      this._notifySaved('retrieval.ragScoreThreshold');
    }));
    this._addRow(thresholdRow.row);
  }

  private _updateRetrieval(patch: Partial<IUnifiedAIConfig['retrieval']>): void {
    if (this._unifiedService) {
      this._unifiedService.updateActivePreset({ retrieval: patch });
    }
  }

  update(_profile: AISettingsProfile): void {
    // Read effective config from unified service if available
    const config = this._unifiedService
      ? this._unifiedService.getEffectiveConfig().retrieval
      : DEFAULT_UNIFIED_CONFIG.retrieval;

    if (this._autoRagToggle.checked !== config.autoRag) {
      this._autoRagToggle.checked = config.autoRag;
    }
    if (this._topKSlider.value !== config.ragTopK) {
      this._topKSlider.value = config.ragTopK;
      this._topKValue.textContent = String(config.ragTopK);
    }
    const thresholdPct = Math.round(config.ragScoreThreshold * 100);
    if (this._thresholdSlider.value !== thresholdPct) {
      this._thresholdSlider.value = thresholdPct;
      this._thresholdValue.textContent = config.ragScoreThreshold.toFixed(2);
    }
  }
}
