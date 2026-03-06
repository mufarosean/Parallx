// retrievalSection.ts — Retrieval settings section (M20 Task C.3)
//
// Fields:
//   - Auto-RAG (Toggle)
//   - RAG Top K (Slider: 1–30)
//   - Score Threshold (Slider: 0.0–1.0, step 0.05)
//   - Context Budget: 4 linked sliders (System / RAG / History / User) summing to 100%
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

  // Context budget sliders
  private _systemPromptSlider!: Slider;
  private _ragContextSlider!: Slider;
  private _historySlider!: Slider;
  private _userMessageSlider!: Slider;

  // Budget value labels
  private _systemPromptValue!: HTMLElement;
  private _ragContextValue!: HTMLElement;
  private _historyValue!: HTMLElement;
  private _userMessageValue!: HTMLElement;

  // Budget visual bar
  private _budgetBar!: HTMLElement;
  private _budgetSegments!: HTMLElement[];

  private readonly _unifiedService: IUnifiedAIConfigService | undefined;
  private _isBudgetAdjusting = false;

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
    }));
    this._addRow(thresholdRow.row);

    // ── Context Budget Allocation ──
    this._buildBudgetControls(defaults);
  }

  private _buildBudgetControls(defaults: typeof DEFAULT_UNIFIED_CONFIG.retrieval): void {
    const budgetRow = createSettingRow({
      label: 'Context Budget',
      description: 'Allocate token budget across system prompt, RAG context, history, and user message (must sum to 100%)',
      key: 'retrieval.contextBudget',
    });

    const budgetContainer = $('div.ai-settings-budget');

    // Visual bar
    this._budgetBar = $('div.ai-settings-budget__bar');
    this._budgetSegments = [];
    const segmentColors = ['#4a8', '#38b', '#c84', '#a5a'];
    const segmentLabels = ['System', 'RAG', 'History', 'User'];
    for (let i = 0; i < 4; i++) {
      const seg = $('div.ai-settings-budget__segment');
      seg.style.background = segmentColors[i];
      seg.title = segmentLabels[i];
      this._budgetSegments.push(seg);
      this._budgetBar.appendChild(seg);
    }
    budgetContainer.appendChild(this._budgetBar);

    // Individual sliders
    const budget = defaults.contextBudget;

    // System Prompt
    const sysRow = $('div.ai-settings-budget__slider-row');
    sysRow.appendChild($('span.ai-settings-budget__label', 'System Prompt'));
    this._systemPromptSlider = this._register(new Slider(sysRow, {
      min: 0, max: 100, step: 5, value: budget.systemPrompt, ariaLabel: 'System prompt budget',
    }));
    this._systemPromptValue = $('span.ai-settings-budget__pct', `${budget.systemPrompt}%`);
    sysRow.appendChild(this._systemPromptValue);
    budgetContainer.appendChild(sysRow);

    // RAG Context
    const ragRow = $('div.ai-settings-budget__slider-row');
    ragRow.appendChild($('span.ai-settings-budget__label', 'RAG Context'));
    this._ragContextSlider = this._register(new Slider(ragRow, {
      min: 0, max: 100, step: 5, value: budget.ragContext, ariaLabel: 'RAG context budget',
    }));
    this._ragContextValue = $('span.ai-settings-budget__pct', `${budget.ragContext}%`);
    ragRow.appendChild(this._ragContextValue);
    budgetContainer.appendChild(ragRow);

    // History
    const histRow = $('div.ai-settings-budget__slider-row');
    histRow.appendChild($('span.ai-settings-budget__label', 'History'));
    this._historySlider = this._register(new Slider(histRow, {
      min: 0, max: 100, step: 5, value: budget.history, ariaLabel: 'History budget',
    }));
    this._historyValue = $('span.ai-settings-budget__pct', `${budget.history}%`);
    histRow.appendChild(this._historyValue);
    budgetContainer.appendChild(histRow);

    // User Message
    const userRow = $('div.ai-settings-budget__slider-row');
    userRow.appendChild($('span.ai-settings-budget__label', 'User Message'));
    this._userMessageSlider = this._register(new Slider(userRow, {
      min: 0, max: 100, step: 5, value: budget.userMessage, ariaLabel: 'User message budget',
    }));
    this._userMessageValue = $('span.ai-settings-budget__pct', `${budget.userMessage}%`);
    userRow.appendChild(this._userMessageValue);
    budgetContainer.appendChild(userRow);

    // Link sliders — adjusting one redistributes the remaining among the others
    const sliders = [
      this._systemPromptSlider,
      this._ragContextSlider,
      this._historySlider,
      this._userMessageSlider,
    ];
    const valueLabels = [
      this._systemPromptValue,
      this._ragContextValue,
      this._historyValue,
      this._userMessageValue,
    ];

    for (let i = 0; i < 4; i++) {
      this._register(sliders[i].onDidChange(() => {
        if (this._isBudgetAdjusting) return;
        this._isBudgetAdjusting = true;
        this._redistributeBudget(i, sliders, valueLabels);
        this._isBudgetAdjusting = false;
      }));
    }

    budgetRow.controlSlot.appendChild(budgetContainer);
    this._addRow(budgetRow.row);

    this._updateBudgetBar();
  }

  /**
   * When slider `changedIndex` moves, redistribute the difference among the other 3
   * proportionally, keeping the total at 100.
   */
  private _redistributeBudget(
    changedIndex: number,
    sliders: Slider[],
    labels: HTMLElement[],
  ): void {
    const values = sliders.map(s => s.value);
    const total = values.reduce((a, b) => a + b, 0);
    const diff = total - 100;

    if (diff !== 0) {
      // Distribute the diff among the other sliders proportionally
      const others = values.filter((_, i) => i !== changedIndex);
      const othersSum = others.reduce((a, b) => a + b, 0);

      for (let i = 0; i < 4; i++) {
        if (i === changedIndex) continue;
        if (othersSum > 0) {
          values[i] = Math.max(0, Math.round(values[i] - diff * (values[i] / othersSum)));
        } else {
          // All others are 0 — distribute equally
          values[i] = Math.max(0, Math.round(-diff / 3));
        }
      }

      // Fix rounding — ensure exact 100
      const newTotal = values.reduce((a, b) => a + b, 0);
      if (newTotal !== 100) {
        // Adjust the largest non-changed slider
        const adjustIdx = values
          .map((v, i) => ({ v, i }))
          .filter(x => x.i !== changedIndex)
          .sort((a, b) => b.v - a.v)[0]?.i;
        if (adjustIdx !== undefined) {
          values[adjustIdx] += 100 - newTotal;
          values[adjustIdx] = Math.max(0, values[adjustIdx]);
        }
      }
    }

    // Update sliders and labels
    for (let i = 0; i < 4; i++) {
      if (i !== changedIndex) {
        sliders[i].value = values[i];
      }
      labels[i].textContent = `${values[i]}%`;
    }
    // Update label for changed slider too
    labels[changedIndex].textContent = `${values[changedIndex]}%`;

    this._updateBudgetBar();

    // Persist
    this._updateRetrieval({
      contextBudget: {
        systemPrompt: values[0],
        ragContext: values[1],
        history: values[2],
        userMessage: values[3],
      },
    });
  }

  private _updateBudgetBar(): void {
    const values = [
      this._systemPromptSlider.value,
      this._ragContextSlider.value,
      this._historySlider.value,
      this._userMessageSlider.value,
    ];
    for (let i = 0; i < 4; i++) {
      this._budgetSegments[i].style.width = `${values[i]}%`;
    }
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

    // Budget
    const b = config.contextBudget;
    if (this._systemPromptSlider.value !== b.systemPrompt) {
      this._systemPromptSlider.value = b.systemPrompt;
      this._systemPromptValue.textContent = `${b.systemPrompt}%`;
    }
    if (this._ragContextSlider.value !== b.ragContext) {
      this._ragContextSlider.value = b.ragContext;
      this._ragContextValue.textContent = `${b.ragContext}%`;
    }
    if (this._historySlider.value !== b.history) {
      this._historySlider.value = b.history;
      this._historyValue.textContent = `${b.history}%`;
    }
    if (this._userMessageSlider.value !== b.userMessage) {
      this._userMessageSlider.value = b.userMessage;
      this._userMessageValue.textContent = `${b.userMessage}%`;
    }

    this._updateBudgetBar();
  }
}
