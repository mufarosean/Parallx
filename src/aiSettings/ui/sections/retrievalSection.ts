// retrievalSection.ts — Retrieval settings section (M20 Task C.3, G.2)
//
// Fields:
//   - Auto-RAG (Toggle)
//   - RAG Top K (Slider: 1–50)
//   - Max Per Source (Slider: 1–20)
//   - Token Budget (Slider: 0–50000, 0 = auto)
//   - Score Threshold (Slider: 0.000–0.100, step 0.001)
//   - Cosine Threshold (Slider: 0.00–1.00, step 0.05, 0 = disabled)
//   - Drop-off Ratio (Slider: 0.00–1.00, step 0.05, 0 = disabled)
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
  private _maxPerSourceSlider!: Slider;
  private _maxPerSourceValue!: HTMLElement;
  private _tokenBudgetSlider!: Slider;
  private _tokenBudgetValue!: HTMLElement;
  private _thresholdSlider!: Slider;
  private _thresholdValue!: HTMLElement;
  private _cosineSlider!: Slider;
  private _cosineValue!: HTMLElement;
  private _dropoffSlider!: Slider;
  private _dropoffValue!: HTMLElement;

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
      label: 'Top K Results',
      description: 'Maximum chunks to return from hybrid search (1–50)',
      key: 'retrieval.ragTopK',
      onReset: () => this._updateRetrieval({ ragTopK: defaults.ragTopK }),
      scopePath: 'retrieval.ragTopK',
      unifiedService: this._unifiedService,
    });
    this._topKSlider = this._register(new Slider(topKRow.controlSlot, {
      min: 1,
      max: 50,
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

    // ── Max Per Source ──
    const maxPerSourceRow = createSettingRow({
      label: 'Max Per Source',
      description: 'Maximum chunks from any single document (1–20)',
      key: 'retrieval.ragMaxPerSource',
      onReset: () => this._updateRetrieval({ ragMaxPerSource: defaults.ragMaxPerSource }),
      scopePath: 'retrieval.ragMaxPerSource',
      unifiedService: this._unifiedService,
    });
    this._maxPerSourceSlider = this._register(new Slider(maxPerSourceRow.controlSlot, {
      min: 1,
      max: 20,
      step: 1,
      value: defaults.ragMaxPerSource,
      ariaLabel: 'Max chunks per source',
    }));
    this._maxPerSourceValue = $('span.ai-settings-row__value', String(defaults.ragMaxPerSource));
    maxPerSourceRow.controlSlot.appendChild(this._maxPerSourceValue);
    this._register(this._maxPerSourceSlider.onDidChange((value) => {
      this._maxPerSourceValue.textContent = String(value);
      this._updateRetrieval({ ragMaxPerSource: value });
      this._notifySaved('retrieval.ragMaxPerSource');
    }));
    this._addRow(maxPerSourceRow.row);

    // ── Token Budget ──
    const tokenBudgetRow = createSettingRow({
      label: 'Token Budget',
      description: 'Max tokens for retrieved context. 0 = auto (30% of context window).',
      key: 'retrieval.ragTokenBudget',
      onReset: () => this._updateRetrieval({ ragTokenBudget: defaults.ragTokenBudget }),
      scopePath: 'retrieval.ragTokenBudget',
      unifiedService: this._unifiedService,
    });
    this._tokenBudgetSlider = this._register(new Slider(tokenBudgetRow.controlSlot, {
      min: 0,
      max: 50000,
      step: 500,
      value: defaults.ragTokenBudget,
      ariaLabel: 'Token budget',
    }));
    this._tokenBudgetValue = $('span.ai-settings-row__value', defaults.ragTokenBudget === 0 ? 'Auto' : String(defaults.ragTokenBudget));
    tokenBudgetRow.controlSlot.appendChild(this._tokenBudgetValue);
    this._register(this._tokenBudgetSlider.onDidChange((value) => {
      this._tokenBudgetValue.textContent = value === 0 ? 'Auto' : String(value);
      this._updateRetrieval({ ragTokenBudget: value });
      this._notifySaved('retrieval.ragTokenBudget');
    }));
    this._addRow(tokenBudgetRow.row);

    // ── Score Threshold ──
    const thresholdRow = createSettingRow({
      label: 'Score Threshold',
      description: 'Minimum RRF score to include a result (0.000–0.100). Lower = more results.',
      key: 'retrieval.ragScoreThreshold',
      onReset: () => this._updateRetrieval({ ragScoreThreshold: defaults.ragScoreThreshold }),
      scopePath: 'retrieval.ragScoreThreshold',
      unifiedService: this._unifiedService,
    });
    this._thresholdSlider = this._register(new Slider(thresholdRow.controlSlot, {
      min: 0,
      max: 100,
      step: 1,
      value: Math.round(defaults.ragScoreThreshold * 1000),
      ariaLabel: 'Score threshold',
    }));
    this._thresholdValue = $('span.ai-settings-row__value', defaults.ragScoreThreshold.toFixed(3));
    thresholdRow.controlSlot.appendChild(this._thresholdValue);
    this._register(this._thresholdSlider.onDidChange((value) => {
      const threshold = value / 1000;
      this._thresholdValue.textContent = threshold.toFixed(3);
      this._updateRetrieval({ ragScoreThreshold: threshold });
      this._notifySaved('retrieval.ragScoreThreshold');
    }));
    this._addRow(thresholdRow.row);

    // ── Cosine Threshold ──
    const cosineRow = createSettingRow({
      label: 'Cosine Threshold',
      description: 'Minimum cosine similarity for re-ranking (0.00–1.00). 0 = disabled.',
      key: 'retrieval.ragCosineThreshold',
      onReset: () => this._updateRetrieval({ ragCosineThreshold: defaults.ragCosineThreshold }),
      scopePath: 'retrieval.ragCosineThreshold',
      unifiedService: this._unifiedService,
    });
    this._cosineSlider = this._register(new Slider(cosineRow.controlSlot, {
      min: 0,
      max: 100,
      step: 5,
      value: Math.round(defaults.ragCosineThreshold * 100),
      ariaLabel: 'Cosine threshold',
    }));
    this._cosineValue = $('span.ai-settings-row__value', defaults.ragCosineThreshold.toFixed(2));
    cosineRow.controlSlot.appendChild(this._cosineValue);
    this._register(this._cosineSlider.onDidChange((value) => {
      const cosine = value / 100;
      this._cosineValue.textContent = cosine.toFixed(2);
      this._updateRetrieval({ ragCosineThreshold: cosine });
      this._notifySaved('retrieval.ragCosineThreshold');
    }));
    this._addRow(cosineRow.row);

    // ── Drop-off Ratio ──
    const dropoffRow = createSettingRow({
      label: 'Drop-off Ratio',
      description: 'Drop results below top_score × ratio (0.00–1.00). 0 = disabled.',
      key: 'retrieval.ragDropoffRatio',
      onReset: () => this._updateRetrieval({ ragDropoffRatio: defaults.ragDropoffRatio }),
      scopePath: 'retrieval.ragDropoffRatio',
      unifiedService: this._unifiedService,
    });
    this._dropoffSlider = this._register(new Slider(dropoffRow.controlSlot, {
      min: 0,
      max: 100,
      step: 5,
      value: Math.round(defaults.ragDropoffRatio * 100),
      ariaLabel: 'Drop-off ratio',
    }));
    this._dropoffValue = $('span.ai-settings-row__value', defaults.ragDropoffRatio === 0 ? 'Off' : defaults.ragDropoffRatio.toFixed(2));
    dropoffRow.controlSlot.appendChild(this._dropoffValue);
    this._register(this._dropoffSlider.onDidChange((value) => {
      const ratio = value / 100;
      this._dropoffValue.textContent = ratio === 0 ? 'Off' : ratio.toFixed(2);
      this._updateRetrieval({ ragDropoffRatio: ratio });
      this._notifySaved('retrieval.ragDropoffRatio');
    }));
    this._addRow(dropoffRow.row);
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
    if (this._maxPerSourceSlider.value !== config.ragMaxPerSource) {
      this._maxPerSourceSlider.value = config.ragMaxPerSource;
      this._maxPerSourceValue.textContent = String(config.ragMaxPerSource);
    }
    if (this._tokenBudgetSlider.value !== config.ragTokenBudget) {
      this._tokenBudgetSlider.value = config.ragTokenBudget;
      this._tokenBudgetValue.textContent = config.ragTokenBudget === 0 ? 'Auto' : String(config.ragTokenBudget);
    }
    const thresholdSliderVal = Math.round(config.ragScoreThreshold * 1000);
    if (this._thresholdSlider.value !== thresholdSliderVal) {
      this._thresholdSlider.value = thresholdSliderVal;
      this._thresholdValue.textContent = config.ragScoreThreshold.toFixed(3);
    }
    const cosineSliderVal = Math.round(config.ragCosineThreshold * 100);
    if (this._cosineSlider.value !== cosineSliderVal) {
      this._cosineSlider.value = cosineSliderVal;
      this._cosineValue.textContent = config.ragCosineThreshold.toFixed(2);
    }
    const dropoffSliderVal = Math.round(config.ragDropoffRatio * 100);
    if (this._dropoffSlider.value !== dropoffSliderVal) {
      this._dropoffSlider.value = dropoffSliderVal;
      this._dropoffValue.textContent = config.ragDropoffRatio === 0 ? 'Off' : config.ragDropoffRatio.toFixed(2);
    }
  }
}
