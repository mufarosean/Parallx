// sectionBase.ts — Base class and types for AI Settings panel sections
//
// Each section (Persona, Chat, Suggestions, Model, Advanced, Preview)
// extends SettingsSection to get a consistent layout, reset button,
// and search-dimming support.

import { Disposable } from '../../platform/lifecycle.js';
import { $ } from '../../ui/dom.js';
import type { IAISettingsService, AISettingsProfile } from '../aiSettingsTypes.js';

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
  protected _addResetSectionLink(sectionKey: 'persona' | 'chat' | 'model' | 'suggestions'): void {
    const link = $('button.ai-settings-section__reset-link');
    link.setAttribute('type', 'button');
    link.textContent = 'Reset section to defaults';
    link.addEventListener('click', () => {
      this._service.resetSection(sectionKey);
    });
    this.contentElement.appendChild(link);
  }

  /** Helper: register a setting row and add it to the content. */
  protected _addRow(row: HTMLElement): void {
    this._rows.push(row);
    this.contentElement.appendChild(row);
  }
}
