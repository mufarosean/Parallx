// personaSection.ts — Persona settings section (M15 Task 2.3)
//
// Fields:
//   - Agent Name (InputBox)
//   - Description (InputBox, short)
//   - Avatar (emoji picker — 12 options)
//
// Each field has a per-field reset icon. Section-level reset link at bottom.

import { $ } from '../../../ui/dom.js';
import { InputBox } from '../../../ui/inputBox.js';
import type { IAISettingsService, AISettingsProfile } from '../../aiSettingsTypes.js';
import { DEFAULT_PROFILE } from '../../aiSettingsDefaults.js';
import { SettingsSection, createSettingRow } from '../sectionBase.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const AVATAR_EMOJIS = ['🧠', '💼', '✍️', '💰', '🔬', '📊', '🎯', '🤖', '🦊', '🌊', '⚡', '🧩'];

// ─── PersonaSection ──────────────────────────────────────────────────────────

export class PersonaSection extends SettingsSection {

  private _nameInput!: InputBox;
  private _descInput!: InputBox;
  private _avatarButtons: HTMLElement[] = [];
  private _currentAvatar = DEFAULT_PROFILE.persona.avatarEmoji;

  constructor(service: IAISettingsService) {
    super(service, 'persona', 'Persona');
  }

  build(): void {
    // ── Agent Name ──
    const nameRow = createSettingRow({
      label: 'Agent Name',
      description: 'The name used in suggestion cards and chat headers',
      key: 'persona.name',
      onReset: () => this._service.updateActiveProfile({
        persona: { name: DEFAULT_PROFILE.persona.name },
      }),
    });
    this._nameInput = this._register(new InputBox(nameRow.controlSlot, {
      placeholder: 'e.g. Friday, Sage, Parallx AI',
      ariaLabel: 'Agent name',
    }));
    this._register(this._nameInput.onDidChange((value) => {
      this._service.updateActiveProfile({ persona: { name: value } });
    }));
    this._addRow(nameRow.row);

    // ── Description ──
    const descRow = createSettingRow({
      label: 'Description',
      description: 'One-line description of this persona',
      key: 'persona.description',
      onReset: () => this._service.updateActiveProfile({
        persona: { description: DEFAULT_PROFILE.persona.description },
      }),
    });
    this._descInput = this._register(new InputBox(descRow.controlSlot, {
      placeholder: 'e.g. Your intelligent workspace assistant',
      ariaLabel: 'Persona description',
    }));
    this._register(this._descInput.onDidChange((value) => {
      this._service.updateActiveProfile({ persona: { description: value } });
    }));
    this._addRow(descRow.row);

    // ── Avatar ──
    const avatarRow = createSettingRow({
      label: 'Avatar',
      description: 'Icon shown next to suggestions',
      key: 'persona.avatar',
      onReset: () => this._service.updateActiveProfile({
        persona: { avatarEmoji: DEFAULT_PROFILE.persona.avatarEmoji },
      }),
    });
    const avatarGrid = $('div.ai-settings-avatar-grid');
    for (const emoji of AVATAR_EMOJIS) {
      const btn = $('button.ai-settings-avatar-btn');
      btn.setAttribute('type', 'button');
      btn.textContent = emoji;
      btn.title = emoji;
      btn.setAttribute('aria-label', `Select avatar ${emoji}`);
      btn.addEventListener('click', () => {
        this._service.updateActiveProfile({ persona: { avatarEmoji: emoji } });
      });
      avatarGrid.appendChild(btn);
      this._avatarButtons.push(btn);
    }
    avatarRow.controlSlot.appendChild(avatarGrid);
    this._addRow(avatarRow.row);

    // ── Reset section link ──
    this._addResetSectionLink('persona');
  }

  update(profile: AISettingsProfile): void {
    // Update inputs (only if value differs to avoid cursor jumping)
    if (this._nameInput.value !== profile.persona.name) {
      this._nameInput.value = profile.persona.name;
    }
    if (this._descInput.value !== profile.persona.description) {
      this._descInput.value = profile.persona.description;
    }

    // Update avatar selection
    this._currentAvatar = profile.persona.avatarEmoji;
    for (const btn of this._avatarButtons) {
      const isActive = btn.textContent === this._currentAvatar;
      btn.classList.toggle('ai-settings-avatar-btn--active', isActive);
    }
  }
}
