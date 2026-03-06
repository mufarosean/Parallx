// toolsSection.ts — Tools configuration section (M20 Task E.1)
//
// Renders the tool tree inline in the AI Hub panel (same checkbox-tree UX
// as the modal ChatToolPicker, but embedded as a settings section).
//
// Features:
//   - Search/filter input within the section
//   - "N tools enabled" summary at the section header
//   - Categorised tree: "Pages" and "Files" with tri-state checkboxes
//   - Collapse/expand per category
//   - Individual tool checkboxes

import { $ } from '../../../ui/dom.js';
import { InputBox } from '../../../ui/inputBox.js';
import type { IToolPickerServices } from '../../../services/chatTypes.js';
import type { IUnifiedAIConfigService } from '../../unifiedConfigTypes.js';
import { SettingsSection } from '../sectionBase.js';
import type { IAISettingsService, AISettingsProfile } from '../../aiSettingsTypes.js';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ToolCategory {
  label: string;
  collapsed: boolean;
  tools: { name: string; description: string; enabled: boolean }[];
}

// ─── ToolsSection ────────────────────────────────────────────────────────────

export class ToolsSection extends SettingsSection {

  private _toolServices: IToolPickerServices | undefined;
  private readonly _unifiedService: IUnifiedAIConfigService | undefined;
  private _searchInput!: InputBox;
  private _summaryEl!: HTMLElement;
  private _treeContainer!: HTMLElement;
  private readonly _collapsedState = new Map<string, boolean>();

  constructor(
    service: IAISettingsService,
    toolServices?: IToolPickerServices,
    unifiedService?: IUnifiedAIConfigService,
  ) {
    super(service, 'tools', 'Tools');
    this._toolServices = toolServices;
    this._unifiedService = unifiedService;
  }

  /** Late-bind tool services (if not available at construction time). */
  setToolServices(services: IToolPickerServices): void {
    this._toolServices = services;
    this._renderTree('');
    this._updateSummary();
  }

  build(): void {
    // ── Summary badge in section header ──
    this._summaryEl = $('span.ai-settings-tools-summary');
    this._summaryEl.textContent = this._getSummaryText();
    this.headerElement.appendChild(this._summaryEl);

    // ── Search input ──
    const searchRow = $('div.ai-settings-tools-search');
    this._searchInput = this._register(new InputBox(searchRow, {
      placeholder: 'Filter tools…',
      ariaLabel: 'Filter tools',
    }));
    this._register(this._searchInput.onDidChange((query) => {
      this._renderTree(query);
    }));
    this.contentElement.appendChild(searchRow);

    // ── Tool tree container ──
    this._treeContainer = $('div.ai-settings-tools-tree');
    this.contentElement.appendChild(this._treeContainer);

    // ── Initial render ──
    this._renderTree('');

    // ── Listen for external tool changes ──
    if (this._toolServices) {
      this._register(this._toolServices.onDidChangeTools(() => {
        this._renderTree(this._searchInput.value);
        this._updateSummary();
      }));
    }
  }

  update(_profile: AISettingsProfile): void {
    // Tools are not profile-driven — they come from IToolPickerServices.
    // Just re-render to pick up any changes.
    this._renderTree(this._searchInput?.value ?? '');
    this._updateSummary();
  }

  // ─── Private ───────────────────────────────────────────────────────

  /** Build categorised tool list (mirrors ChatToolPicker.buildCategories). */
  private _buildCategories(
    tools: readonly { name: string; description: string; enabled: boolean }[],
  ): ToolCategory[] {
    const pageTools: { name: string; description: string; enabled: boolean }[] = [];
    const fileTools: { name: string; description: string; enabled: boolean }[] = [];

    for (const tool of tools) {
      if (['list_files', 'read_file', 'search_files'].includes(tool.name)) {
        fileTools.push(tool);
      } else {
        pageTools.push(tool);
      }
    }

    const categories: ToolCategory[] = [];
    if (pageTools.length > 0) {
      categories.push({
        label: 'Pages',
        collapsed: this._collapsedState.get('Pages') ?? false,
        tools: pageTools,
      });
    }
    if (fileTools.length > 0) {
      categories.push({
        label: 'Files',
        collapsed: this._collapsedState.get('Files') ?? false,
        tools: fileTools,
      });
    }
    return categories;
  }

  /** Render the tool tree into _treeContainer. */
  private _renderTree(query: string): void {
    if (!this._treeContainer) return;
    this._treeContainer.innerHTML = '';

    if (!this._toolServices) {
      const empty = $('div.ai-settings-tools-empty', 'No tools available');
      this._treeContainer.appendChild(empty);
      return;
    }

    const services = this._toolServices;
    const allTools = services.getTools();
    const q = query.toLowerCase().trim();

    type ToolEntry = { name: string; description: string; enabled: boolean };

    // Filter by search
    const filtered: ToolEntry[] = q
      ? allTools.filter(
          (t: ToolEntry) => t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q),
        )
      : [...allTools];

    if (filtered.length === 0 && q) {
      const empty = $('div.ai-settings-tools-empty', 'No tools match your search');
      this._treeContainer.appendChild(empty);
      return;
    }

    // ── Top-level "Built-In" group ──
    const builtInHeader = $('div.ai-settings-tools-group-header');

    const builtInChevron = $('span.ai-settings-tools-chevron');
    const builtInCollapsed = this._collapsedState.get('Built-In') ?? false;
    builtInChevron.textContent = builtInCollapsed ? '\u25B6' : '\u25BC'; // ▶ or ▼
    builtInHeader.appendChild(builtInChevron);

    // Built-In checkbox (tri-state)
    const builtInCb = document.createElement('input');
    builtInCb.type = 'checkbox';
    builtInCb.className = 'ai-settings-tools-checkbox';
    const enabledCount = filtered.filter((t: ToolEntry) => t.enabled).length;
    builtInCb.checked = enabledCount > 0;
    builtInCb.indeterminate = enabledCount > 0 && enabledCount < filtered.length;
    builtInHeader.appendChild(builtInCb);

    const builtInLabel = $('span.ai-settings-tools-group-label', 'Built-In');
    builtInHeader.appendChild(builtInLabel);
    this._treeContainer.appendChild(builtInHeader);

    // Toggle collapse
    builtInHeader.addEventListener('click', (e) => {
      if (e.target === builtInCb) return;
      this._collapsedState.set('Built-In', !builtInCollapsed);
      this._renderTree(this._searchInput.value);
    });

    // Toggle all tools
    builtInCb.addEventListener('change', () => {
      const enable = builtInCb.checked;
      for (const tool of allTools) {
        services.setToolEnabled(tool.name, enable);
        this._persistToolOverride(tool.name, enable);
      }
      this._renderTree(this._searchInput.value);
      this._updateSummary();
    });

    if (builtInCollapsed && !q) return;

    // ── Sub-categories ──
    const categories = this._buildCategories(filtered);
    for (const cat of categories) {
      const catHeader = $('div.ai-settings-tools-cat-header');

      const catChevron = $('span.ai-settings-tools-chevron');
      catChevron.textContent = cat.collapsed ? '\u25B6' : '\u25BC';
      catHeader.appendChild(catChevron);

      // Category checkbox (tri-state)
      const catCb = document.createElement('input');
      catCb.type = 'checkbox';
      catCb.className = 'ai-settings-tools-checkbox';
      const catEnabled = cat.tools.filter((t) => t.enabled).length;
      catCb.checked = catEnabled > 0;
      catCb.indeterminate = catEnabled > 0 && catEnabled < cat.tools.length;
      catHeader.appendChild(catCb);

      const catLabel = $('span.ai-settings-tools-cat-label', cat.label);
      catHeader.appendChild(catLabel);

      const catDesc = $('span.ai-settings-tools-cat-desc');
      catDesc.textContent = `${cat.tools.length} tool${cat.tools.length !== 1 ? 's' : ''}`;
      catHeader.appendChild(catDesc);

      this._treeContainer.appendChild(catHeader);

      // Toggle category collapse
      catHeader.addEventListener('click', (e) => {
        if (e.target === catCb) return;
        this._collapsedState.set(cat.label, !cat.collapsed);
        this._renderTree(this._searchInput.value);
      });

      // Toggle all tools in category
      catCb.addEventListener('change', () => {
        const enable = catCb.checked;
        for (const tool of cat.tools) {
          services.setToolEnabled(tool.name, enable);
          this._persistToolOverride(tool.name, enable);
        }
        this._renderTree(this._searchInput.value);
        this._updateSummary();
      });

      // ── Individual tools (if not collapsed) ──
      if (!cat.collapsed || q) {
        for (const tool of cat.tools) {
          const toolRow = $('div.ai-settings-tools-tool-row');

          const toolCb = document.createElement('input');
          toolCb.type = 'checkbox';
          toolCb.className = 'ai-settings-tools-checkbox';
          toolCb.checked = tool.enabled;
          toolRow.appendChild(toolCb);

          const toolInfo = $('div.ai-settings-tools-tool-info');
          const toolName = $('span.ai-settings-tools-tool-name', tool.name);
          toolInfo.appendChild(toolName);

          const toolDesc = $('span.ai-settings-tools-tool-desc');
          toolDesc.textContent = `\u2014 ${tool.description}`;
          toolInfo.appendChild(toolDesc);

          toolRow.appendChild(toolInfo);
          this._treeContainer.appendChild(toolRow);

          // Toggle individual tool
          toolCb.addEventListener('change', () => {
            services.setToolEnabled(tool.name, toolCb.checked);
            this._persistToolOverride(tool.name, toolCb.checked);
            this._renderTree(this._searchInput.value);
            this._updateSummary();
          });

          // Clicking the row also toggles
          toolRow.addEventListener('click', (e) => {
            if (e.target === toolCb) return;
            toolCb.checked = !toolCb.checked;
            services.setToolEnabled(tool.name, toolCb.checked);
            this._persistToolOverride(tool.name, toolCb.checked);
            this._renderTree(this._searchInput.value);
            this._updateSummary();
          });
        }
      }
    }
  }

  /** Get human-readable summary text. */
  private _getSummaryText(): string {
    if (!this._toolServices) return '';
    const count = this._toolServices.getEnabledCount();
    const total = this._toolServices.getTools().length;
    return `${count}/${total} enabled`;
  }

  /** Update the summary badge in the section header. */
  private _updateSummary(): void {
    if (this._summaryEl) {
      this._summaryEl.textContent = this._getSummaryText();
    }
  }

  /** Persist a tool enable/disable to workspace override (M20 E.3). */
  private _persistToolOverride(toolName: string, enabled: boolean): void {
    if (!this._unifiedService) return;
    const current = this._unifiedService.getEffectiveConfig().tools?.enabledOverrides ?? {};
    const updated = { ...current, [toolName]: enabled };
    this._unifiedService.updateActivePreset({ tools: { enabledOverrides: updated } });
  }
}
