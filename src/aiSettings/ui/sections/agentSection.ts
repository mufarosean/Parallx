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
    header.textContent = 'Agent Configuration';
    container.appendChild(header);

    const desc = $('div.ai-settings-agent-list__description');
    desc.textContent = 'Configure per-agent model, behavior, and tool access. Built-in agents can be customized; additional agents can be added.';
    container.appendChild(desc);

    const table = $('div.ai-settings-agent-list__table');
    table.setAttribute('role', 'table');

    // Header row
    const headRow = $('div.ai-settings-agent-list__row.ai-settings-agent-list__row--header');
    headRow.setAttribute('role', 'row');
    for (const col of ['Name', 'Surface', 'Model', '']) {
      const cell = $('div.ai-settings-agent-list__cell');
      cell.setAttribute('role', 'columnheader');
      cell.textContent = col;
      headRow.appendChild(cell);
    }
    table.appendChild(headRow);

    // Render agents
    this._renderAgentRows(table);
    container.appendChild(table);
    this.contentElement.appendChild(container);
  }

  /** Render agent rows. Merges built-in defaults with persisted definitions. */
  private _renderAgentRows(table: HTMLElement): void {
    const mergedMap = new Map<string, IAgentConfigData>();
    for (const builtin of DEFAULT_AGENT_CONFIGS) mergedMap.set(builtin.id, builtin);
    const persisted = this._unifiedService?.getEffectiveConfig().agent.agentDefinitions;
    if (persisted) {
      for (const def of persisted) mergedMap.set(def.id, def);
    }

    for (const agent of mergedMap.values()) {
      const isBuiltIn = DEFAULT_AGENT_CONFIGS.some(b => b.id === agent.id);
      const row = $('div.ai-settings-agent-list__row');
      row.setAttribute('role', 'row');
      row.dataset.agentId = agent.id;

      // Name
      const nameCell = $('div.ai-settings-agent-list__cell');
      nameCell.textContent = agent.name;
      row.appendChild(nameCell);

      // Surface
      const surfaceCell = $('div.ai-settings-agent-list__cell');
      surfaceCell.textContent = agent.surface ?? '—';
      row.appendChild(surfaceCell);

      // Model
      const modelCell = $('div.ai-settings-agent-list__cell');
      modelCell.textContent = agent.model ?? '(global)';
      row.appendChild(modelCell);

      // Edit button
      const actionCell = $('div.ai-settings-agent-list__cell');
      const editBtn = $('button.ai-settings-agent-list__edit');
      editBtn.textContent = '✏️';
      editBtn.title = `Edit ${agent.name}`;
      editBtn.addEventListener('click', () => this._toggleAgentEdit(row, agent, isBuiltIn));
      actionCell.appendChild(editBtn);

      if (!isBuiltIn) {
        const removeBtn = $('button.ai-settings-agent-list__remove');
        removeBtn.textContent = '✕';
        removeBtn.title = `Remove ${agent.name}`;
        removeBtn.addEventListener('click', () => this._removeAgent(agent.id));
        actionCell.appendChild(removeBtn);
      }
      row.appendChild(actionCell);
      table.appendChild(row);
    }

    // Add Agent button
    const addRow = $('div.ai-settings-agent-list__add');
    const addBtn = $('button.ai-settings-agent-list__add-btn');
    addBtn.textContent = '+ Add Agent';
    addBtn.addEventListener('click', () => this._addAgent());
    addRow.appendChild(addBtn);
    table.appendChild(addRow);
  }

  /** Toggle inline edit panel for an agent row. */
  private _toggleAgentEdit(row: HTMLElement, agent: IAgentConfigData, _isBuiltIn: boolean): void {
    const existing = row.nextElementSibling;
    if (existing?.classList.contains('ai-settings-agent-list__edit-panel')) {
      existing.remove();
      return;
    }

    const panel = $('div.ai-settings-agent-list__edit-panel');

    // Model override
    const modelRow = $('div.ai-settings-agent-list__edit-field');
    const modelLabel = $('label', 'Model override');
    const modelInput = $('input') as HTMLInputElement;
    modelInput.type = 'text';
    modelInput.placeholder = '(use global default)';
    modelInput.value = agent.model ?? '';
    modelRow.appendChild(modelLabel);
    modelRow.appendChild(modelInput);
    panel.appendChild(modelRow);

    // Temperature
    const tempRow = $('div.ai-settings-agent-list__edit-field');
    const tempLabel = $('label', 'Temperature');
    const tempInput = $('input') as HTMLInputElement;
    tempInput.type = 'number';
    tempInput.min = '0';
    tempInput.max = '2';
    tempInput.step = '0.1';
    tempInput.value = agent.temperature != null ? String(agent.temperature) : '';
    tempInput.placeholder = '(global)';
    tempRow.appendChild(tempLabel);
    tempRow.appendChild(tempInput);
    panel.appendChild(tempRow);

    // System prompt overlay
    const overlayRow = $('div.ai-settings-agent-list__edit-field');
    const overlayLabel = $('label', 'System prompt overlay');
    const overlayInput = $('textarea') as HTMLTextAreaElement;
    overlayInput.rows = 3;
    overlayInput.placeholder = 'Additional instructions for this agent...';
    overlayInput.value = agent.systemPromptOverlay ?? '';
    overlayRow.appendChild(overlayLabel);
    overlayRow.appendChild(overlayInput);
    panel.appendChild(overlayRow);

    // Save button
    const saveBtn = $('button.ai-settings-agent-list__save-btn');
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', () => {
      const updated: IAgentConfigData = {
        ...agent,
        model: modelInput.value.trim() || undefined,
        temperature: tempInput.value ? parseFloat(tempInput.value) : undefined,
        systemPromptOverlay: overlayInput.value.trim() || undefined,
      };
      this._persistAgentDefinition(updated);
      panel.remove();
      this._refreshAgentList();
    });
    panel.appendChild(saveBtn);

    row.after(panel);
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
