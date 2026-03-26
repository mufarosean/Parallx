// retrievalSection.ts — Retrieval settings section (M20 Task C.3, G.2)
//
// Fields:
//   - Auto-RAG (Toggle)
//   - RAG Top K (Slider: 1–50)
//   - Max Per Source (Slider: 1–20)
//   - Token Budget (Slider: 0–50000, 0 = auto)
//   - Score Threshold (Slider: 0.000–0.100, step 0.001)
//
// Each control reads/writes through IUnifiedAIConfigService.

import { $ } from '../../../ui/dom.js';
import { Toggle } from '../../../ui/toggle.js';
import { Slider } from '../../../ui/slider.js';
import { Dropdown } from '../../../ui/dropdown.js';
import type { IUnifiedAIConfigService, IUnifiedAIConfig } from '../../unifiedConfigTypes.js';
import { DEFAULT_UNIFIED_CONFIG } from '../../unifiedConfigTypes.js';
import { SettingsSection, createSettingRow } from '../sectionBase.js';
import type { IAISettingsService, AISettingsProfile } from '../../aiSettingsTypes.js';

// ─── RetrievalSection ────────────────────────────────────────────────────────

export class RetrievalSection extends SettingsSection {

  private _autoRagToggle!: Toggle;
  private _decompositionModeDropdown!: Dropdown;
  private _candidateBreadthDropdown!: Dropdown;
  private _topKSlider!: Slider;
  private _topKValue!: HTMLElement;
  private _maxPerSourceSlider!: Slider;
  private _maxPerSourceValue!: HTMLElement;
  private _tokenBudgetSlider!: Slider;
  private _tokenBudgetValue!: HTMLElement;
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

    // ── Decomposition Mode ──
    const decompositionModeRow = createSettingRow({
      label: 'Decomposition Mode',
      description: 'Controls whether hard questions can be split into multiple retrieval queries. Off forces a single-query retrieval plan.',
      key: 'retrieval.ragDecompositionMode',
      onReset: () => this._updateRetrieval({ ragDecompositionMode: defaults.ragDecompositionMode }),
      scopePath: 'retrieval.ragDecompositionMode',
      unifiedService: this._unifiedService,
    });
    this._decompositionModeDropdown = this._register(new Dropdown(decompositionModeRow.controlSlot, {
      items: [
        { value: 'auto', label: 'Auto' },
        { value: 'off', label: 'Off' },
      ],
      selected: defaults.ragDecompositionMode,
      ariaLabel: 'Retrieval decomposition mode',
    }));
    this._register(this._decompositionModeDropdown.onDidChange((value) => {
      this._updateRetrieval({ ragDecompositionMode: value as IUnifiedAIConfig['retrieval']['ragDecompositionMode'] });
      this._notifySaved('retrieval.ragDecompositionMode');
    }));
    this._addRow(decompositionModeRow.row);

    // ── Candidate Breadth ──
    const candidateBreadthRow = createSettingRow({
      label: 'Candidate Breadth',
      description: 'Controls how aggressively first-stage retrieval widens hard-query candidate recall. Broad affects hard queries only.',
      key: 'retrieval.ragCandidateBreadth',
      onReset: () => this._updateRetrieval({ ragCandidateBreadth: defaults.ragCandidateBreadth }),
      scopePath: 'retrieval.ragCandidateBreadth',
      unifiedService: this._unifiedService,
    });
    this._candidateBreadthDropdown = this._register(new Dropdown(candidateBreadthRow.controlSlot, {
      items: [
        { value: 'balanced', label: 'Balanced' },
        { value: 'broad', label: 'Broad (Hard Queries)' },
      ],
      selected: defaults.ragCandidateBreadth,
      ariaLabel: 'Retrieval candidate breadth',
    }));
    this._register(this._candidateBreadthDropdown.onDidChange((value) => {
      this._updateRetrieval({ ragCandidateBreadth: value as IUnifiedAIConfig['retrieval']['ragCandidateBreadth'] });
      this._notifySaved('retrieval.ragCandidateBreadth');
    }));
    this._addRow(candidateBreadthRow.row);

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
    if (this._decompositionModeDropdown.value !== config.ragDecompositionMode) {
      this._decompositionModeDropdown.value = config.ragDecompositionMode;
    }
    if (this._candidateBreadthDropdown.value !== config.ragCandidateBreadth) {
      this._candidateBreadthDropdown.value = config.ragCandidateBreadth;
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
  }
}
