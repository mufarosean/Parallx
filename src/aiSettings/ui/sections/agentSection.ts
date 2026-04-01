// agentSection.ts — Agent settings section
//
// Fields:
//   - Max Iterations (Slider: 1–50)
//   - Agent Configuration (list of registered agents with per-agent overrides)
//
// Reads/writes through IUnifiedAIConfigService.
// Upstream: src/commands/agents.config.ts (agent config management), ui/src/ui/views/agents.ts

import { $ } from '../../../ui/dom.js';
import { Slider } from '../../../ui/slider.js';
import type { IUnifiedAIConfigService, IUnifiedAIConfig, IAgentConfigData } from '../../unifiedConfigTypes.js';
import { DEFAULT_UNIFIED_CONFIG } from '../../unifiedConfigTypes.js';
import { SettingsSection, createSettingRow } from '../sectionBase.js';
import type { IAISettingsService, AISettingsProfile } from '../../aiSettingsTypes.js';
import { DEFAULT_AGENT_CONFIGS } from '../../../openclaw/agents/openclawAgentConfig.js';

// ─── AgentSection ────────────────────────────────────────────────────────────

export class AgentSection extends SettingsSection {

  private _maxIterationsSlider!: Slider;
  private _maxIterationsValue!: HTMLElement;
  private _agentListContainer!: HTMLElement;

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
      description: 'How many steps the agent can take before pausing. Higher = more autonomous work.',
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

    // ── Agent Configuration ──
    this._buildAgentList();
  }

  /** Build the agent configuration list below the max iterations slider. */
  private _buildAgentList(): void {
    const container = $('div.ai-settings-agent-list');
    this._agentListContainer = container;

    const header = $('div.ai-settings-agent-list__header');
    const headerText = $('span', 'Agent Configuration');
    header.appendChild(headerText);
    const headerDesc = $('span.ai-settings-agent-list__header-desc');
    headerDesc.textContent = 'Per-agent model, behavior, and tool access';
    header.appendChild(headerDesc);
    container.appendChild(header);

    // Agent cards container
    const list = $('div.ai-settings-agent-list__cards');
    this._renderAgentCards(list);
    container.appendChild(list);

    // Add Agent button
    const addBtn = $('button.ai-settings-agent-list__add-btn', '+ Add Agent');
    addBtn.addEventListener('click', () => this._addAgent());
    container.appendChild(addBtn);

    this.contentElement.appendChild(container);
  }

  /** Render agent cards. Merges built-in defaults with persisted definitions. */
  private _renderAgentCards(list: HTMLElement): void {
    const mergedMap = new Map<string, IAgentConfigData>();
    for (const builtin of DEFAULT_AGENT_CONFIGS) mergedMap.set(builtin.id, builtin);
    const persisted = this._unifiedService?.getEffectiveConfig().agent.agentDefinitions;
    if (persisted) {
      for (const def of persisted) mergedMap.set(def.id, def);
    }

    for (const agent of mergedMap.values()) {
      const isBuiltIn = DEFAULT_AGENT_CONFIGS.some(b => b.id === agent.id);
      const card = this._renderAgentCard(agent, isBuiltIn);
      list.appendChild(card);
    }
  }

  /** Render a single agent card (collapsed row with expand-to-edit). */
  private _renderAgentCard(agent: IAgentConfigData, isBuiltIn: boolean): HTMLElement {
    const card = $('div.ai-settings-agent-card');
    card.dataset.agentId = agent.id;

    // ── Summary row (always visible, clickable to expand) ──
    const summary = $('div.ai-settings-agent-card__summary');

    const nameEl = $('span.ai-settings-agent-card__name', agent.name);
    summary.appendChild(nameEl);

    const badges = $('span.ai-settings-agent-card__badges');
    if (agent.surface) {
      const surfaceBadge = $('span.ai-settings-agent-card__badge', agent.surface);
      badges.appendChild(surfaceBadge);
    }
    if (isBuiltIn) {
      const builtinBadge = $('span.ai-settings-agent-card__badge.ai-settings-agent-card__badge--builtin', 'built-in');
      badges.appendChild(builtinBadge);
    }
    summary.appendChild(badges);

    const meta = $('span.ai-settings-agent-card__meta');
    meta.textContent = agent.model ? agent.model : 'global model';
    summary.appendChild(meta);

    // Actions (appear on hover)
    const actions = $('span.ai-settings-agent-card__actions');
    const editBtn = $('button.ai-settings-agent-card__action-btn');
    editBtn.textContent = 'Configure';
    editBtn.title = `Configure ${agent.name}`;
    actions.appendChild(editBtn);

    if (!isBuiltIn) {
      const removeBtn = $('button.ai-settings-agent-card__action-btn.ai-settings-agent-card__action-btn--danger');
      removeBtn.textContent = '✕';
      removeBtn.title = `Remove ${agent.name}`;
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._removeAgent(agent.id);
      });
      actions.appendChild(removeBtn);
    }
    summary.appendChild(actions);

    summary.addEventListener('click', () => this._toggleAgentPanel(card, agent));
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._toggleAgentPanel(card, agent);
    });
    card.appendChild(summary);

    return card;
  }

  /** Toggle the inline edit panel for an agent card. */
  private _toggleAgentPanel(card: HTMLElement, agent: IAgentConfigData): void {
    const existing = card.querySelector('.ai-settings-agent-card__panel');
    if (existing) {
      existing.remove();
      card.classList.remove('ai-settings-agent-card--expanded');
      return;
    }

    // Collapse any other open panels
    const openPanels = this._agentListContainer.querySelectorAll('.ai-settings-agent-card__panel');
    openPanels.forEach(p => {
      p.parentElement?.classList.remove('ai-settings-agent-card--expanded');
      p.remove();
    });

    card.classList.add('ai-settings-agent-card--expanded');
    const panel = $('div.ai-settings-agent-card__panel');

    // Model override
    const modelField = this._createField('Model override', 'text', agent.model ?? '', '(use global default)');
    panel.appendChild(modelField.container);

    // Temperature
    const tempField = this._createField('Temperature', 'number', agent.temperature != null ? String(agent.temperature) : '', '(global)');
    (tempField.input as HTMLInputElement).min = '0';
    (tempField.input as HTMLInputElement).max = '2';
    (tempField.input as HTMLInputElement).step = '0.1';
    panel.appendChild(tempField.container);

    // System prompt overlay
    const overlayField = this._createTextareaField('System prompt overlay', agent.systemPromptOverlay ?? '', 'Additional instructions for this agent...');
    panel.appendChild(overlayField.container);

    // Button row
    const btnRow = $('div.ai-settings-agent-card__btn-row');
    const saveBtn = $('button.ai-settings-agent-card__save-btn', 'Save');
    saveBtn.addEventListener('click', () => {
      const updated: IAgentConfigData = {
        ...agent,
        model: (modelField.input as HTMLInputElement).value.trim() || undefined,
        temperature: (tempField.input as HTMLInputElement).value ? parseFloat((tempField.input as HTMLInputElement).value) : undefined,
        systemPromptOverlay: (overlayField.input as HTMLTextAreaElement).value.trim() || undefined,
      };
      this._persistAgentDefinition(updated);
      this._refreshAgentList();
    });
    const cancelBtn = $('button.ai-settings-agent-card__cancel-btn', 'Cancel');
    cancelBtn.addEventListener('click', () => {
      card.classList.remove('ai-settings-agent-card--expanded');
      panel.remove();
    });
    btnRow.appendChild(saveBtn);
    btnRow.appendChild(cancelBtn);
    panel.appendChild(btnRow);

    card.appendChild(panel);
  }

  /** Create a labeled input field. */
  private _createField(label: string, type: string, value: string, placeholder: string): { container: HTMLElement; input: HTMLInputElement } {
    const container = $('div.ai-settings-agent-card__field');
    const labelEl = $('label.ai-settings-agent-card__field-label', label);
    const input = $('input.ai-settings-agent-card__field-input') as HTMLInputElement;
    input.type = type;
    input.value = value;
    input.placeholder = placeholder;
    container.appendChild(labelEl);
    container.appendChild(input);
    return { container, input };
  }

  /** Create a labeled textarea field. */
  private _createTextareaField(label: string, value: string, placeholder: string): { container: HTMLElement; input: HTMLTextAreaElement } {
    const container = $('div.ai-settings-agent-card__field');
    const labelEl = $('label.ai-settings-agent-card__field-label', label);
    const input = $('textarea.ai-settings-agent-card__field-input') as HTMLTextAreaElement;
    input.rows = 3;
    input.value = value;
    input.placeholder = placeholder;
    container.appendChild(labelEl);
    container.appendChild(input);
    return { container, input };
  }

  /** Add a new custom agent. */
  private _addAgent(): void {
    const id = `custom-${Date.now()}`;
    const newAgent: IAgentConfigData = { id, name: 'New Agent' };
    this._persistAgentDefinition(newAgent);
    this._refreshAgentList();
  }

  /** Remove a custom agent. */
  private _removeAgent(id: string): void {
    const config = this._unifiedService?.getEffectiveConfig();
    const current = config?.agent.agentDefinitions ?? [];
    const filtered = current.filter(a => a.id !== id);
    this._updateAgent({ agentDefinitions: filtered });
    this._refreshAgentList();
  }

  /** Persist an agent definition (add or update). */
  private _persistAgentDefinition(agent: IAgentConfigData): void {
    const config = this._unifiedService?.getEffectiveConfig();
    const current = [...(config?.agent.agentDefinitions ?? [])];
    const idx = current.findIndex(a => a.id === agent.id);
    if (idx >= 0) {
      current[idx] = agent;
    } else {
      current.push(agent);
    }
    this._updateAgent({ agentDefinitions: current });
  }

  /** Refresh the agent list after changes. */
  private _refreshAgentList(): void {
    if (this._agentListContainer) {
      this._agentListContainer.remove();
    }
    this._buildAgentList();
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
