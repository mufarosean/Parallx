// aiSettingsPanel.ts — AI Hub Panel Shell (M20 Task C.1, originally M15 Task 2.2)
//
// Two-column layout:
//   Left (200px): section navigation + preset switcher
//   Right (flex): search bar + scrollable section content
//
// Sections: Behavior (Persona+Chat merged), Suggestions, Model, Retrieval,
// Agent, Indexing, Advanced, Preview
//
// All sections stack vertically. Navigation smooth-scrolls to section headers.
// Search bar dims non-matching fields (never hides them).

import { Disposable } from '../../platform/lifecycle.js';
import { $ } from '../../ui/dom.js';
import { InputBox } from '../../ui/inputBox.js';
import type { IAISettingsService, AISettingsProfile } from '../aiSettingsTypes.js';
import type { ILanguageModelsService } from '../../services/chatTypes.js';
import type { IUnifiedAIConfigService } from '../unifiedConfigTypes.js';
import { PresetSwitcher } from './presetSwitcher.js';
import type { SettingsSection } from './sectionBase.js';
import { ModelSection } from './sections/modelSection.js';
import { RetrievalSection } from './sections/retrievalSection.js';
import { AgentSection } from './sections/agentSection.js';
import { ToolsSection } from './sections/toolsSection.js';
import { AdvancedSection } from './sections/advancedSection.js';
import { PreviewSection } from './sections/previewSection.js';
import { McpSection } from './sections/mcpSection.js';
import type { IToolPickerServices } from '../../services/chatTypes.js';
import type { IMcpClientService } from '../../services/serviceTypes.js';
import './aiSettings.css';

// ─── AISettingsPanel ─────────────────────────────────────────────────────────

export class AISettingsPanel extends Disposable {

  readonly element: HTMLElement;

  private readonly _sections: SettingsSection[] = [];
  private readonly _navItems: { id: string; el: HTMLElement }[] = [];
  private _searchBox!: InputBox;

  constructor(
    container: HTMLElement,
    private readonly _service: IAISettingsService,
    _languageModelsService?: ILanguageModelsService,
    private readonly _unifiedConfigService?: IUnifiedAIConfigService,
    private readonly _toolPickerServices?: IToolPickerServices,
    private readonly _mcpClientService?: IMcpClientService,
  ) {
    super();

    // Root two-column layout
    this.element = $('div.ai-settings-panel');

    // ── Left Column ──
    const leftCol = $('div.ai-settings-panel__left');
    this.element.appendChild(leftCol);

    // Section navigation
    const nav = $('nav.ai-settings-nav');
    nav.setAttribute('aria-label', 'Settings sections');
    leftCol.appendChild(nav);
    this._buildNav(nav);

    // Preset Switcher (below nav)
    this._register(new PresetSwitcher(leftCol, this._service));

    // ── Right Column ──
    const rightCol = $('div.ai-settings-panel__right');
    this.element.appendChild(rightCol);

    // Search bar
    const searchRow = $('div.ai-settings-panel__search');
    this._searchBox = this._register(new InputBox(searchRow, {
      placeholder: 'Search settings…',
      ariaLabel: 'Search AI settings',
    }));
    rightCol.appendChild(searchRow);

    // Scrollable content area
    const content = $('div.ai-settings-panel__content');
    rightCol.appendChild(content);

    // ── Build Sections ──
    this._sections = [
      this._register(new ModelSection(this._service, _languageModelsService)),
      this._register(new RetrievalSection(this._service, this._unifiedConfigService)),
      this._register(new AgentSection(this._service, this._unifiedConfigService)),
      this._register(new ToolsSection(this._service, this._toolPickerServices, this._unifiedConfigService)),
      this._register(new AdvancedSection(this._service)),
      this._register(new PreviewSection(this._service)),
      this._register(new McpSection(this._service, this._mcpClientService)),
    ];

    for (const section of this._sections) {
      section.build();
      content.appendChild(section.element);
    }

    // Initial render with current profile
    this._updateSections(this._service.getActiveProfile());

    // ── Events ──

    // Search filtering
    this._register(this._searchBox.onDidChange((query) => {
      for (const section of this._sections) {
        section.applySearch(query);
      }
    }));

    // Profile changes → update all sections
    this._register(this._service.onDidChange((profile) => {
      this._updateSections(profile);
    }));

    container.appendChild(this.element);
  }

  // ─── Navigation ────────────────────────────────────────────────────

  private _buildNav(nav: HTMLElement): void {
    const navSections = [
      { id: 'chat', label: 'Chat' },
      { id: 'model', label: 'Model' },
      { id: 'retrieval', label: 'Retrieval' },
      { id: 'agent', label: 'Agent' },
      { id: 'tools', label: 'Tools' },
      { id: 'advanced', label: 'Advanced' },
      { id: 'preview', label: 'Preview' },
      { id: 'mcp', label: 'MCP Servers' },
    ];

    for (const s of navSections) {
      const item = $('button.ai-settings-nav__item');
      item.setAttribute('type', 'button');
      item.textContent = s.label;
      item.dataset.sectionId = s.id;
      item.addEventListener('click', () => this._scrollToSection(s.id));
      nav.appendChild(item);
      this._navItems.push({ id: s.id, el: item });
    }
  }

  private _scrollToSection(sectionId: string): void {
    const header = this.element.querySelector(`#ai-settings-section-${sectionId}`);
    if (header) {
      header.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // Highlight active nav item
    for (const item of this._navItems) {
      item.el.classList.toggle('ai-settings-nav__item--active', item.id === sectionId);
    }
  }

  /** Scroll to a named section (public API for external callers like wrench icon redirect). */
  scrollToSection(sectionId: string): void {
    this._scrollToSection(sectionId);
  }

  // ─── Update ────────────────────────────────────────────────────────

  private _updateSections(profile: AISettingsProfile): void {
    for (const section of this._sections) {
      section.update(profile);
    }
  }
}
