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
import type { IToolPickerServices, ToolCategory as ToolCategoryKind } from '../../../services/chatTypes.js';
import type { IUnifiedAIConfigService } from '../../unifiedConfigTypes.js';
import { SettingsSection } from '../sectionBase.js';
import type { IAISettingsService, AISettingsProfile } from '../../aiSettingsTypes.js';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ToolSubGroup {
  /** Display label (e.g. "Canvas", "File System", "Memory"). */
  label: string;
  /** Stable key used in the collapsed-state map. */
  collapseKey: string;
  /** Sort order (lower first). */
  order: number;
  collapsed: boolean;
  tools: { name: string; description: string; enabled: boolean }[];
}

/**
 * M81 P10 — display metadata per `ToolCategory`. Lives next to the union so
 * the settings UI and the system prompt builder use the same labels and the
 * same ordering. If you add a category, add it here.
 */
const CATEGORY_DISPLAY: Record<ToolCategoryKind, { label: string; order: number }> = {
  'canvas':      { label: 'Canvas',       order: 10 },
  'file-system': { label: 'File System',  order: 20 },
  'memory':      { label: 'Memory',       order: 30 },
  'transcript':  { label: 'Transcripts',  order: 40 },
  'linking':     { label: 'Linking',      order: 50 },
  'surface':     { label: 'Surface',      order: 60 },
  'subagent':    { label: 'Subagents',    order: 70 },
  'autonomy':    { label: 'Autonomy',     order: 80 },
  'cron':        { label: 'Scheduling',   order: 90 },
  'app-control': { label: 'App Control',  order: 100 },
  'terminal':    { label: 'Terminal',     order: 110 },
};

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

  /**
   * Build sub-groups from built-in tools using their `category` field.
   *
   * M81 P10 — replaces the legacy Pages/Files split, which hardcoded three
   * tool names and dumped everything else into "Pages". Sub-grouping is now
   * driven by `IChatTool.category`, the same field the system prompt's
   * tooling section uses. One source of truth: the category lives on the
   * tool definition.
   *
   * Tools without a declared category fall into an "Other" bucket so they
   * are still visible — extensions that haven't migrated to the field don't
   * disappear from the picker.
   */
  private _buildCategories(
    tools: readonly { name: string; description: string; enabled: boolean; category?: ToolCategoryKind }[],
  ): ToolSubGroup[] {
    const buckets = new Map<ToolCategoryKind | 'other', { name: string; description: string; enabled: boolean }[]>();
    for (const tool of tools) {
      const key: ToolCategoryKind | 'other' = tool.category ?? 'other';
      let bucket = buckets.get(key);
      if (!bucket) { bucket = []; buckets.set(key, bucket); }
      bucket.push({ name: tool.name, description: tool.description, enabled: tool.enabled });
    }

    const groups: ToolSubGroup[] = [];
    for (const [key, bucketTools] of buckets.entries()) {
      const label = key === 'other' ? 'Other' : CATEGORY_DISPLAY[key].label;
      const order = key === 'other' ? 9999 : CATEGORY_DISPLAY[key].order;
      const collapseKey = `built-in:${key}`;
      groups.push({
        label,
        collapseKey,
        order,
        collapsed: this._collapsedState.get(collapseKey) ?? false,
        tools: bucketTools.sort((a, b) => a.name.localeCompare(b.name)),
      });
    }
    groups.sort((a, b) => a.order - b.order);
    return groups;
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

    type ToolEntry = { name: string; description: string; enabled: boolean; extensionId?: string; category?: ToolCategoryKind };

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

    // ── M66: Group tools by extension ──
    // Built-in tools (no extensionId) appear under "Built-In"; tools contributed
    // by an extension are grouped under that extension's id. Order: built-ins
    // first, then extension groups alphabetically.
    const extGroups = new Map<string, ToolEntry[]>();
    for (const t of filtered) {
      const key = t.extensionId ?? 'built-in';
      let bucket = extGroups.get(key);
      if (!bucket) { bucket = []; extGroups.set(key, bucket); }
      bucket.push(t);
    }
    const orderedKeys = Array.from(extGroups.keys()).sort((a, b) => {
      if (a === 'built-in') return -1;
      if (b === 'built-in') return 1;
      return a.localeCompare(b);
    });

    for (const groupKey of orderedKeys) {
      const groupTools = extGroups.get(groupKey)!;
      const groupLabel = groupKey === 'built-in' ? 'Built-In' : groupKey;
      const groupCollapsed = this._collapsedState.get(groupLabel) ?? false;

      const groupHeader = $('div.ai-settings-tools-group-header');

      const groupChevron = $('span.ai-settings-tools-chevron');
      groupChevron.textContent = groupCollapsed ? '\u25B6' : '\u25BC';
      groupHeader.appendChild(groupChevron);

      const groupCb = document.createElement('input');
      groupCb.type = 'checkbox';
      groupCb.className = 'ai-settings-tools-checkbox';
      const groupEnabled = groupTools.filter((t) => t.enabled).length;
      groupCb.checked = groupEnabled > 0;
      groupCb.indeterminate = groupEnabled > 0 && groupEnabled < groupTools.length;
      groupHeader.appendChild(groupCb);

      const groupLabelEl = $('span.ai-settings-tools-group-label', groupLabel);
      groupHeader.appendChild(groupLabelEl);

      const groupDesc = $('span.ai-settings-tools-cat-desc');
      groupDesc.textContent = `${groupTools.length} tool${groupTools.length !== 1 ? 's' : ''}`;
      groupHeader.appendChild(groupDesc);

      this._treeContainer.appendChild(groupHeader);

      groupHeader.addEventListener('click', (e) => {
        if (e.target === groupCb) return;
        this._collapsedState.set(groupLabel, !groupCollapsed);
        this._renderTree(this._searchInput.value);
      });

      groupCb.addEventListener('change', () => {
        const enable = groupCb.checked;
        for (const tool of groupTools) {
          services.setToolEnabled(tool.name, enable);
          this._persistToolOverride(tool.name, enable);
        }
        this._renderTree(this._searchInput.value);
        this._updateSummary();
      });

      if (groupCollapsed && !q) continue;

      // ── Sub-categories within this group (driven by IChatTool.category) ──
      // Only built-in tools currently carry categories; extension groups skip
      // the sub-header. When only one sub-group exists, the header is
      // redundant and tools render directly under the group.
      const categories = this._buildCategories(groupTools);
      for (const cat of categories) {
        const renderCatHeader = groupKey === 'built-in' && categories.length > 1;

        if (renderCatHeader) {
          const catHeader = $('div.ai-settings-tools-cat-header');

          const catChevron = $('span.ai-settings-tools-chevron');
          catChevron.textContent = cat.collapsed ? '\u25B6' : '\u25BC';
          catHeader.appendChild(catChevron);

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

          catHeader.addEventListener('click', (e) => {
            if (e.target === catCb) return;
            this._collapsedState.set(cat.collapseKey, !cat.collapsed);
            this._renderTree(this._searchInput.value);
          });

          catCb.addEventListener('change', () => {
            const enable = catCb.checked;
            for (const tool of cat.tools) {
              services.setToolEnabled(tool.name, enable);
              this._persistToolOverride(tool.name, enable);
            }
            this._renderTree(this._searchInput.value);
            this._updateSummary();
          });

          if (cat.collapsed && !q) continue;
        }

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

          toolCb.addEventListener('change', () => {
            services.setToolEnabled(tool.name, toolCb.checked);
            this._persistToolOverride(tool.name, toolCb.checked);
            this._renderTree(this._searchInput.value);
            this._updateSummary();
          });

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
