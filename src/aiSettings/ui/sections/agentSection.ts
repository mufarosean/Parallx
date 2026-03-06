// agentSection.ts — Agent settings section (M20 Task C.4)
//
// Fields:
//   - Max Iterations (Slider: 1–50)
//   - Auto-RAG reminder (read-only info linking to Retrieval section)
//
// Reads/writes through IUnifiedAIConfigService.

import { $ } from '../../../ui/dom.js';
import { Slider } from '../../../ui/slider.js';
import type { IUnifiedAIConfigService, IUnifiedAIConfig } from '../../unifiedConfigTypes.js';
import { DEFAULT_UNIFIED_CONFIG } from '../../unifiedConfigTypes.js';
import { SettingsSection, createSettingRow } from '../sectionBase.js';
import type { IAISettingsService, AISettingsProfile } from '../../aiSettingsTypes.js';

// ─── AgentSection ────────────────────────────────────────────────────────────

export class AgentSection extends SettingsSection {

  private _maxIterationsSlider!: Slider;
  private _maxIterationsValue!: HTMLElement;

  private readonly _unifiedService: IUnifiedAIConfigService | undefined;

  constructor(service: IAISettingsService, unifiedService?: IUnifiedAIConfigService) {
    super(service, 'agent', 'Agent');
    this._unifiedService = unifiedService;
  }

  build(): void {
    const defaults = DEFAULT_UNIFIED_CONFIG.agent;

    // ── Max Iterations ──
    const iterRow = createSettingRow({
      label: 'Max Iterations',
      description: 'Maximum number of agentic loop iterations before stopping (1–50)',
      key: 'agent.maxIterations',
      onReset: () => this._updateAgent({ maxIterations: defaults.maxIterations }),
      scopePath: 'agent.maxIterations',
      unifiedService: this._unifiedService,
    });
    this._maxIterationsSlider = this._register(new Slider(iterRow.controlSlot, {
      min: 1,
      max: 50,
      step: 1,
      value: defaults.maxIterations,
      ariaLabel: 'Max iterations',
      labeledStops: [
        { value: 1, label: '1' },
        { value: 10, label: '10' },
        { value: 25, label: '25' },
        { value: 50, label: '50' },
      ],
    }));
    this._maxIterationsValue = $('span.ai-settings-row__value', String(defaults.maxIterations));
    iterRow.controlSlot.appendChild(this._maxIterationsValue);
    this._register(this._maxIterationsSlider.onDidChange((value) => {
      this._maxIterationsValue.textContent = String(value);
      this._updateAgent({ maxIterations: value });
      this._notifySaved('agent.maxIterations');
    }));
    this._addRow(iterRow.row);

    // ── Info note ──
    const infoRow = $('div.ai-settings-section__info');
    infoRow.textContent = 'Auto-RAG and retrieval settings can be configured in the Retrieval section above.';
    this.contentElement.appendChild(infoRow);
  }

  private _updateAgent(patch: Partial<IUnifiedAIConfig['agent']>): void {
    if (this._unifiedService) {
      this._unifiedService.updateActivePreset({ agent: patch });
    }
  }

  update(_profile: AISettingsProfile): void {
    const config = this._unifiedService
      ? this._unifiedService.getEffectiveConfig().agent
      : DEFAULT_UNIFIED_CONFIG.agent;

    if (this._maxIterationsSlider.value !== config.maxIterations) {
      this._maxIterationsSlider.value = config.maxIterations;
      this._maxIterationsValue.textContent = String(config.maxIterations);
    }
  }
}
