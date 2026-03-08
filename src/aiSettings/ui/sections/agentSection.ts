// agentSection.ts — Agent settings section (M20 Task C.4)
//
// Fields:
//   - Max Iterations (Slider: 1–50)
//   - Execution preferences (Dropdowns)
//   - Auto-RAG reminder (read-only info linking to Retrieval section)
//
// Reads/writes through IUnifiedAIConfigService.

import { $ } from '../../../ui/dom.js';
import { Slider } from '../../../ui/slider.js';
import { Dropdown } from '../../../ui/dropdown.js';
import type { IUnifiedAIConfigService, IUnifiedAIConfig } from '../../unifiedConfigTypes.js';
import { AGENT_APPROVAL_STRICTNESS_OPTIONS, AGENT_EXECUTION_STYLE_OPTIONS, AGENT_PROACTIVITY_OPTIONS, AGENT_VERBOSITY_OPTIONS, DEFAULT_UNIFIED_CONFIG } from '../../unifiedConfigTypes.js';
import { SettingsSection, createSettingRow } from '../sectionBase.js';
import type { IAISettingsService, AISettingsProfile } from '../../aiSettingsTypes.js';

// ─── AgentSection ────────────────────────────────────────────────────────────

export class AgentSection extends SettingsSection {

  private _maxIterationsSlider!: Slider;
  private _maxIterationsValue!: HTMLElement;
  private _verbosityDropdown!: Dropdown;
  private _approvalStrictnessDropdown!: Dropdown;
  private _executionStyleDropdown!: Dropdown;
  private _proactivityDropdown!: Dropdown;

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

    const verbosityRow = createSettingRow({
      label: 'Agent Verbosity',
      description: 'How much detail the agent should include in runtime explanations and blockers',
      key: 'agent.verbosity',
      onReset: () => this._updateAgent({ verbosity: defaults.verbosity }),
      scopePath: 'agent.verbosity',
      unifiedService: this._unifiedService,
    });
    this._verbosityDropdown = this._register(new Dropdown(verbosityRow.controlSlot, {
      items: AGENT_VERBOSITY_OPTIONS.map((value) => ({ value, label: value[0]!.toUpperCase() + value.slice(1) })),
      ariaLabel: 'Agent verbosity',
      selected: defaults.verbosity,
    }));
    this._register(this._verbosityDropdown.onDidChange((value) => {
      this._updateAgent({ verbosity: value as IUnifiedAIConfig['agent']['verbosity'] });
      this._notifySaved('agent.verbosity');
    }));
    this._addRow(verbosityRow.row);

    const strictnessRow = createSettingRow({
      label: 'Approval Strictness',
      description: 'How often the agent should stop for approval before acting',
      key: 'agent.approvalStrictness',
      onReset: () => this._updateAgent({ approvalStrictness: defaults.approvalStrictness }),
      scopePath: 'agent.approvalStrictness',
      unifiedService: this._unifiedService,
    });
    this._approvalStrictnessDropdown = this._register(new Dropdown(strictnessRow.controlSlot, {
      items: AGENT_APPROVAL_STRICTNESS_OPTIONS.map((value) => ({ value, label: value[0]!.toUpperCase() + value.slice(1) })),
      ariaLabel: 'Approval strictness',
      selected: defaults.approvalStrictness,
    }));
    this._register(this._approvalStrictnessDropdown.onDidChange((value) => {
      this._updateAgent({ approvalStrictness: value as IUnifiedAIConfig['agent']['approvalStrictness'] });
      this._notifySaved('agent.approvalStrictness');
    }));
    this._addRow(strictnessRow.row);

    const styleRow = createSettingRow({
      label: 'Execution Style',
      description: 'Whether the agent should work stepwise or in longer autonomous batches',
      key: 'agent.executionStyle',
      onReset: () => this._updateAgent({ executionStyle: defaults.executionStyle }),
      scopePath: 'agent.executionStyle',
      unifiedService: this._unifiedService,
    });
    this._executionStyleDropdown = this._register(new Dropdown(styleRow.controlSlot, {
      items: AGENT_EXECUTION_STYLE_OPTIONS.map((value) => ({ value, label: value[0]!.toUpperCase() + value.slice(1) })),
      ariaLabel: 'Execution style',
      selected: defaults.executionStyle,
    }));
    this._register(this._executionStyleDropdown.onDidChange((value) => {
      this._updateAgent({ executionStyle: value as IUnifiedAIConfig['agent']['executionStyle'] });
      this._notifySaved('agent.executionStyle');
    }));
    this._addRow(styleRow.row);

    const proactivityRow = createSettingRow({
      label: 'Proactivity',
      description: 'How far the agent should continue before checking back in',
      key: 'agent.proactivity',
      onReset: () => this._updateAgent({ proactivity: defaults.proactivity }),
      scopePath: 'agent.proactivity',
      unifiedService: this._unifiedService,
    });
    this._proactivityDropdown = this._register(new Dropdown(proactivityRow.controlSlot, {
      items: AGENT_PROACTIVITY_OPTIONS.map((value) => ({ value, label: value[0]!.toUpperCase() + value.slice(1) })),
      ariaLabel: 'Proactivity',
      selected: defaults.proactivity,
    }));
    this._register(this._proactivityDropdown.onDidChange((value) => {
      this._updateAgent({ proactivity: value as IUnifiedAIConfig['agent']['proactivity'] });
      this._notifySaved('agent.proactivity');
    }));
    this._addRow(proactivityRow.row);

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

    if (this._verbosityDropdown.value !== config.verbosity) {
      this._verbosityDropdown.value = config.verbosity;
    }

    if (this._approvalStrictnessDropdown.value !== config.approvalStrictness) {
      this._approvalStrictnessDropdown.value = config.approvalStrictness;
    }

    if (this._executionStyleDropdown.value !== config.executionStyle) {
      this._executionStyleDropdown.value = config.executionStyle;
    }

    if (this._proactivityDropdown.value !== config.proactivity) {
      this._proactivityDropdown.value = config.proactivity;
    }
  }
}
