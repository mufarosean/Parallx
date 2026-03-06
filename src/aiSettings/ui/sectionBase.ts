// sectionBase.ts — Base class and types for AI Settings panel sections
//
// Sections: Persona, Chat, Suggestions, Model, Retrieval, Agent, Indexing, Advanced, Preview
// Each extends SettingsSection for consistent layout, reset, scope indicators, and search.

import { Disposable } from '../../platform/lifecycle.js';
import { $ } from '../../ui/dom.js';
import type { IAISettingsService, AISettingsProfile } from '../aiSettingsTypes.js';
import type { IUnifiedAIConfigService } from '../unifiedConfigTypes.js';

// ─── Save Indicator ──────────────────────────────────────────────────────────

/**
 * Show a brief "✓ Saved" indicator next to a control.
 * Fades in, holds 1.5s, fades out. Removes itself from the DOM when done.
 */
export function showSaveIndicator(element: HTMLElement): void {
  // Remove any existing indicator on this element first
  const existing = element.querySelector('.ai-settings-save-indicator');
  if (existing) existing.remove();

  const indicator = document.createElement('span');
  indicator.className = 'ai-settings-save-indicator';
  indicator.textContent = '✓ Saved';
  element.appendChild(indicator);

  // Trigger fade-in (rAF allows CSS transition to kick in)
  requestAnimationFrame(() => {
    indicator.classList.add('ai-settings-save-indicator--visible');
  });

  // Hold 1.5s, then fade out
  setTimeout(() => {
    indicator.classList.remove('ai-settings-save-indicator--visible');
    // Remove from DOM after fade-out transition
    setTimeout(() => indicator.remove(), 300);
  }, 1500);
}

// ─── Setting Row ─────────────────────────────────────────────────────────────

export interface ISettingRowOptions {
  /** Label shown to the user. */
  readonly label: string;
  /** Description shown below the label. */
  readonly description: string;
  /** Unique key for search matching. */
  readonly key: string;
  /** Callback when reset icon is clicked. */
  readonly onReset?: () => void;
  /** Dot-path for scope indicator (e.g. 'retrieval.ragTopK'). When provided, shows Global/Workspace badge. */
  readonly scopePath?: string;
  /** Unified config service reference — needed for scope indicator. */
  readonly unifiedService?: IUnifiedAIConfigService;
}

/**
 * Creates a standard setting row with label, description, control slot,
 * and per-field reset icon (appears on hover).
 */
export function createSettingRow(options: ISettingRowOptions): {
  row: HTMLElement;
  controlSlot: HTMLElement;
} {
  const row = $('div.ai-settings-row');
  row.dataset.settingKey = options.key;
  row.dataset.searchLabel = options.label.toLowerCase();
  row.dataset.searchDesc = options.description.toLowerCase();

  // Header line: label + reset icon
  const headerLine = $('div.ai-settings-row__header');

  const label = $('div.ai-settings-row__label', options.label);
  headerLine.appendChild(label);

  // Scope indicator (M20 C.2)
  if (options.scopePath && options.unifiedService) {
    const scopeBadge = $('span.ai-settings-row__scope');
    const isWs = options.unifiedService.isOverridden(options.scopePath);
    scopeBadge.textContent = isWs ? 'Workspace ↩' : 'Global';
    scopeBadge.classList.toggle('ai-settings-row__scope--workspace', isWs);
    scopeBadge.title = isWs
      ? `This field is overridden for this workspace. Click to reset to global preset value.`
      : 'Using the global preset value';
    if (isWs) {
      scopeBadge.style.cursor = 'pointer';
      scopeBadge.addEventListener('click', (e) => {
        e.stopPropagation();
        options.unifiedService!.clearWorkspaceOverride(options.scopePath!);
      });
    }
    headerLine.appendChild(scopeBadge);
  }

  if (options.onReset) {
    const resetBtn = $('button.ai-settings-row__reset');
    resetBtn.setAttribute('type', 'button');
    resetBtn.title = 'Reset to default';
    resetBtn.textContent = '↺';
    resetBtn.setAttribute('aria-label', `Reset ${options.label} to default`);
    resetBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      options.onReset!();
    });
    headerLine.appendChild(resetBtn);
  }

  row.appendChild(headerLine);

  // Description
  const desc = $('div.ai-settings-row__description', options.description);
  row.appendChild(desc);

  // Control slot
  const controlSlot = $('div.ai-settings-row__control');
  row.appendChild(controlSlot);

  return { row, controlSlot };
}

// ─── SettingsSection ─────────────────────────────────────────────────────────

export abstract class SettingsSection extends Disposable {

  readonly element: HTMLElement;
  readonly headerElement: HTMLElement;
  readonly contentElement: HTMLElement;

  protected readonly _rows: HTMLElement[] = [];

  constructor(
    protected readonly _service: IAISettingsService,
    readonly sectionId: string,
    readonly title: string,
  ) {
    super();

    this.element = $('div.ai-settings-section');
    this.element.dataset.sectionId = sectionId;

    // Section header
    this.headerElement = $('div.ai-settings-section__header', title);
    this.headerElement.id = `ai-settings-section-${sectionId}`;
    this.element.appendChild(this.headerElement);

    // Content container
    this.contentElement = $('div.ai-settings-section__content');
    this.element.appendChild(this.contentElement);
  }

  /** Called by the panel after construction to build the section contents. */
  abstract build(): void;

  /** Called when the active profile changes — sections should update their controls. */
  abstract update(profile: AISettingsProfile): void;

  /**
   * Apply search filter: dims rows whose label/description don't match the query.
   * Returns the number of matching rows.
   */
  applySearch(query: string): number {
    if (!query) {
      // Show all
      for (const row of this._rows) {
        row.classList.remove('ai-settings-row--dimmed');
      }
      this.element.classList.remove('ai-settings-section--no-matches');
      return this._rows.length;
    }

    const q = query.toLowerCase();
    let matches = 0;

    for (const row of this._rows) {
      const searchLabel = row.dataset.searchLabel ?? '';
      const searchDesc = row.dataset.searchDesc ?? '';
      const isMatch = searchLabel.includes(q) || searchDesc.includes(q);
      row.classList.toggle('ai-settings-row--dimmed', !isMatch);
      if (isMatch) matches++;
    }

    this.element.classList.toggle('ai-settings-section--no-matches', matches === 0);
    return matches;
  }

  /** Add a "Reset section to defaults" link at the bottom. */
  protected _addResetSectionLink(sectionKey: string): void {
    const link = $('button.ai-settings-section__reset-link');
    link.setAttribute('type', 'button');
    link.textContent = 'Reset section to defaults';
    link.addEventListener('click', () => {
      this._service.resetSection(sectionKey as 'persona' | 'chat' | 'model' | 'suggestions');
    });
    this.contentElement.appendChild(link);
  }

  /** Helper: register a setting row and add it to the content. */
  protected _addRow(row: HTMLElement): void {
    this._rows.push(row);
    this.contentElement.appendChild(row);
  }

  /**
   * Show a "✓ Saved" indicator on the row matching the given setting key.
   * Call this after persisting a field change.
   */
  protected _notifySaved(key: string): void {
    const row = this._rows.find(r => r.dataset.settingKey === key);
    if (row) {
      showSaveIndicator(row);
    }
  }
}
