// presetSwitcher.ts — AI Settings Preset Switcher (M15 Task 2.1)
//
// Vertical list of saved profiles with:
//   - Active indicator (filled dot)
//   - Built-in badge
//   - Click to switch
//   - [+ New Preset] button
//   - Right-click context menu (Rename, Duplicate, Delete / Duplicate only for built-in)

import { Disposable } from '../../platform/lifecycle.js';
import { Emitter } from '../../platform/events.js';
import type { Event } from '../../platform/events.js';
import { $, clearNode } from '../../ui/dom.js';
import { Button } from '../../ui/button.js';
import { InputBox } from '../../ui/inputBox.js';
import { ContextMenu } from '../../ui/contextMenu.js';
import type { IAISettingsService, AISettingsProfile } from '../aiSettingsTypes.js';

// ─── PresetSwitcher ──────────────────────────────────────────────────────────

export class PresetSwitcher extends Disposable {

  readonly element: HTMLElement;

  private readonly _listEl: HTMLElement;
  private readonly _newPresetBtn: Button;
  private _inlineInput: InputBox | null = null;

  private readonly _onDidRequestNewPreset = this._register(new Emitter<string>());
  readonly onDidRequestNewPreset: Event<string> = this._onDidRequestNewPreset.event;

  constructor(
    container: HTMLElement,
    private readonly _service: IAISettingsService,
  ) {
    super();

    // Root wrapper
    this.element = $('div.ai-settings-preset-switcher');

    // Header
    const header = $('div.ai-settings-preset-switcher__header', 'Presets');
    this.element.appendChild(header);

    // Profile list
    this._listEl = $('div.ai-settings-preset-switcher__list');
    this.element.appendChild(this._listEl);

    // New Preset button
    const btnContainer = $('div.ai-settings-preset-switcher__new');
    this._newPresetBtn = this._register(new Button(btnContainer, {
      label: '+ New Preset',
      secondary: true,
    }));
    this._register(this._newPresetBtn.onDidClick(() => this._showInlineInput()));
    this.element.appendChild(btnContainer);

    // Render initial state
    this._renderList();

    // Re-render on service changes
    this._register(this._service.onDidChange(() => this._renderList()));

    container.appendChild(this.element);
  }

  // ─── Rendering ─────────────────────────────────────────────────────

  private _renderList(): void {
    clearNode(this._listEl);

    const profiles = this._service.getAllProfiles();
    const activeProfile = this._service.getActiveProfile();

    for (const profile of profiles) {
      const isActive = profile.id === activeProfile.id;
      const row = $('div.ai-settings-preset-switcher__item');
      if (isActive) row.classList.add('ai-settings-preset-switcher__item--active');

      // Active indicator
      const indicator = $('span.ai-settings-preset-switcher__indicator');
      indicator.textContent = isActive ? '●' : '○';
      row.appendChild(indicator);

      // Name + built-in badge
      const label = $('span.ai-settings-preset-switcher__label', profile.presetName);
      row.appendChild(label);

      if (profile.isBuiltIn) {
        const badge = $('span.ai-settings-preset-switcher__badge', 'built-in');
        row.appendChild(badge);
      }

      // Click to switch
      row.addEventListener('click', () => {
        this._service.setActiveProfile(profile.id);
      });

      // Right-click context menu
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this._showContextMenu(profile, e);
      });

      this._listEl.appendChild(row);
    }
  }

  // ─── Context Menu ──────────────────────────────────────────────────

  private _showContextMenu(profile: AISettingsProfile, e: MouseEvent): void {
    const items = profile.isBuiltIn
      ? [
        { id: 'duplicate', label: 'Duplicate', group: 'main' },
      ]
      : [
        { id: 'rename', label: 'Rename', group: 'main' },
        { id: 'duplicate', label: 'Duplicate', group: 'main' },
        { id: 'delete', label: 'Delete', group: 'danger', className: 'context-menu-item--danger' },
      ];

    const menu = ContextMenu.show({
      items,
      anchor: { x: e.clientX, y: e.clientY },
    });

    this._register(menu.onDidSelect(async (ev) => {
      switch (ev.item.id) {
        case 'rename':
          this._showRenameInput(profile);
          break;
        case 'duplicate':
          await this._service.createProfile(`${profile.presetName} (Copy)`, profile.id);
          break;
        case 'delete':
          await this._service.deleteProfile(profile.id);
          break;
      }
    }));
  }

  // ─── Inline Input (New Preset) ────────────────────────────────────

  private _showInlineInput(): void {
    if (this._inlineInput) return;

    const wrapper = $('div.ai-settings-preset-switcher__input-row');
    this._inlineInput = new InputBox(wrapper, {
      placeholder: 'Preset name…',
      ariaLabel: 'New preset name',
    });
    this._listEl.appendChild(wrapper);
    this._inlineInput.focus();

    const commit = (name: string) => {
      const trimmed = name.trim();
      if (trimmed) {
        this._service.createProfile(trimmed);
        this._onDidRequestNewPreset.fire(trimmed);
      }
      cleanup();
    };

    const cleanup = () => {
      if (this._inlineInput) {
        this._inlineInput.dispose();
        this._inlineInput = null;
      }
      if (wrapper.parentNode) wrapper.remove();
    };

    this._inlineInput.onDidSubmit(commit);
    this._inlineInput.onDidCancel(cleanup);

    // Also commit on blur (if value is non-empty)
    const blurHandler = () => {
      if (this._inlineInput && this._inlineInput.value.trim()) {
        commit(this._inlineInput.value);
      } else {
        cleanup();
      }
    };
    this._inlineInput.inputElement.addEventListener('blur', blurHandler);
  }

  // ─── Inline Input (Rename) ────────────────────────────────────────

  private _showRenameInput(profile: AISettingsProfile): void {
    // Find the row for this profile and replace label with input
    const rows = this._listEl.querySelectorAll('.ai-settings-preset-switcher__item');
    for (const row of rows) {
      const label = row.querySelector('.ai-settings-preset-switcher__label');
      if (label && label.textContent === profile.presetName) {
        const wrapper = $('div.ai-settings-preset-switcher__input-row');
        const input = new InputBox(wrapper, {
          value: profile.presetName,
          ariaLabel: 'Rename preset',
        });
        label.replaceWith(wrapper);
        input.focus();
        input.select();

        const commit = (name: string) => {
          const trimmed = name.trim();
          if (trimmed && trimmed !== profile.presetName) {
            this._service.renameProfile(profile.id, trimmed);
          } else {
            this._renderList(); // revert
          }
          input.dispose();
        };

        input.onDidSubmit(commit);
        input.onDidCancel(() => {
          this._renderList();
          input.dispose();
        });
        input.inputElement.addEventListener('blur', () => {
          commit(input.value);
        });
        break;
      }
    }
  }
}
