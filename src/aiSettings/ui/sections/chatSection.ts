// chatSection.ts — Chat settings section (M15 Task 2.4)
//
// Fields:
//   - Response Length (Dropdown)
//   - Communication Tone (SegmentedControl)
//   - Domain Focus (Dropdown)
//   - Custom Focus (Textarea, visible only when Domain = Custom)
//   - Chat System Prompt (collapsible Textarea)
//   - Override System Prompt (Toggle)
//   - Effective System Prompt preview (read-only)

import { $ } from '../../../ui/dom.js';
import { Dropdown } from '../../../ui/dropdown.js';
import { SegmentedControl } from '../../../ui/segmentedControl.js';
import { Textarea } from '../../../ui/textarea.js';
import { Toggle } from '../../../ui/toggle.js';
import type { IAISettingsService, AISettingsProfile, AIResponseLength, AITone, AIFocusDomain } from '../../aiSettingsTypes.js';
import { DEFAULT_PROFILE } from '../../aiSettingsDefaults.js';
import { generateChatSystemPrompt, buildGenInputFromProfile } from '../../systemPromptGenerator.js';
import { SettingsSection, createSettingRow } from '../sectionBase.js';

// ─── ChatSection ─────────────────────────────────────────────────────────────

export class ChatSection extends SettingsSection {

  private _responseLengthDropdown!: Dropdown;
  private _toneControl!: SegmentedControl;
  private _domainDropdown!: Dropdown;
  private _customFocusTextarea!: Textarea;
  private _customFocusRow!: HTMLElement;
  private _systemPromptTextarea!: Textarea;
  private _overrideToggle!: Toggle;
  private _effectivePromptTextarea!: Textarea;
  private _overrideWarning!: HTMLElement;
  private _promptCollapsible!: HTMLElement;
  private _promptCollapseBtn!: HTMLButtonElement;

  constructor(service: IAISettingsService) {
    super(service, 'chat', 'Chat');
  }

  build(): void {
    // ── Response Length ──
    const lengthRow = createSettingRow({
      label: 'Response Length',
      description: 'How long the AI responses should be',
      key: 'chat.responseLength',
      onReset: () => this._service.updateActiveProfile({
        chat: { responseLength: DEFAULT_PROFILE.chat.responseLength },
      }),
    });
    this._responseLengthDropdown = this._register(new Dropdown(lengthRow.controlSlot, {
      items: [
        { value: 'short', label: 'Short' },
        { value: 'medium', label: 'Medium' },
        { value: 'long', label: 'Long' },
        { value: 'adaptive', label: 'Adaptive' },
      ],
      ariaLabel: 'Response length',
    }));
    this._register(this._responseLengthDropdown.onDidChange((value) => {
      this._service.updateActiveProfile({ chat: { responseLength: value as AIResponseLength } });
      this._notifySaved('chat.responseLength');
    }));
    this._addRow(lengthRow.row);

    // ── Communication Tone ──
    const toneRow = createSettingRow({
      label: 'Communication Tone',
      description: 'Overall communication style shared with suggestions',
      key: 'suggestions.tone',
      onReset: () => this._service.updateActiveProfile({
        suggestions: { tone: DEFAULT_PROFILE.suggestions.tone },
      }),
    });
    this._toneControl = this._register(new SegmentedControl(toneRow.controlSlot, {
      segments: [
        { value: 'concise', label: 'Concise' },
        { value: 'balanced', label: 'Balanced' },
        { value: 'detailed', label: 'Detailed' },
      ],
      ariaLabel: 'Communication tone',
    }));
    this._register(this._toneControl.onDidChange((value) => {
      this._service.updateActiveProfile({ suggestions: { tone: value as AITone } });
      this._notifySaved('suggestions.tone');
    }));
    this._addRow(toneRow.row);

    // ── Domain Focus ──
    const domainRow = createSettingRow({
      label: 'Domain Focus',
      description: 'The domain the AI pays extra attention to',
      key: 'suggestions.focusDomain',
      onReset: () => this._service.updateActiveProfile({
        suggestions: { focusDomain: DEFAULT_PROFILE.suggestions.focusDomain },
      }),
    });
    this._domainDropdown = this._register(new Dropdown(domainRow.controlSlot, {
      items: [
        { value: 'general', label: 'General' },
        { value: 'finance', label: 'Finance' },
        { value: 'writing', label: 'Writing' },
        { value: 'coding', label: 'Coding' },
        { value: 'research', label: 'Research' },
        { value: 'custom', label: 'Custom' },
      ],
      ariaLabel: 'Domain focus',
    }));
    this._register(this._domainDropdown.onDidChange((value) => {
      this._service.updateActiveProfile({ suggestions: { focusDomain: value as AIFocusDomain } });
      this._toggleCustomFocus(value === 'custom');
      this._notifySaved('suggestions.focusDomain');
    }));
    this._addRow(domainRow.row);

    // ── Custom Focus (conditionally visible) ──
    const customFocusRow = createSettingRow({
      label: 'Custom Focus',
      description: 'Describe what the AI should pay attention to',
      key: 'suggestions.customFocusDescription',
      onReset: () => this._service.updateActiveProfile({
        suggestions: { customFocusDescription: DEFAULT_PROFILE.suggestions.customFocusDescription },
      }),
    });
    this._customFocusRow = customFocusRow.row;
    this._customFocusTextarea = this._register(new Textarea(customFocusRow.controlSlot, {
      placeholder: 'e.g. Focus on budgeting, recurring expenses, and savings goals',
      rows: 3,
      ariaLabel: 'Custom focus description',
    }));
    this._register(this._customFocusTextarea.onDidChange((value) => {
      this._service.updateActiveProfile({ suggestions: { customFocusDescription: value } });
      this._notifySaved('suggestions.customFocusDescription');
    }));
    this._addRow(customFocusRow.row);

    // ── System Prompt (collapsible) ──
    const promptRow = createSettingRow({
      label: 'System Prompt',
      description: 'The system prompt injected into every chat conversation (auto-generated)',
      key: 'chat.systemPrompt',
      onReset: () => this._service.updateActiveProfile({
        chat: { systemPrompt: '', systemPromptIsCustom: false },
      }),
    });

    // Collapse toggle button
    this._promptCollapseBtn = document.createElement('button');
    this._promptCollapseBtn.type = 'button';
    this._promptCollapseBtn.className = 'ai-settings-collapse-btn';
    this._promptCollapseBtn.textContent = '▸ Show system prompt';
    this._promptCollapsible = $('div.ai-settings-collapsible');
    this._promptCollapsible.style.display = 'none';

    this._systemPromptTextarea = this._register(new Textarea(this._promptCollapsible, {
      rows: 6,
      readonly: true,
      ariaLabel: 'System prompt',
    }));

    this._promptCollapseBtn.addEventListener('click', () => {
      const isVisible = this._promptCollapsible.style.display !== 'none';
      this._promptCollapsible.style.display = isVisible ? 'none' : '';
      this._promptCollapseBtn.textContent = isVisible ? '▸ Show system prompt' : '▾ Hide system prompt';
    });

    promptRow.controlSlot.appendChild(this._promptCollapseBtn);
    promptRow.controlSlot.appendChild(this._promptCollapsible);
    this._addRow(promptRow.row);

    // ── Override System Prompt ──
    const overrideRow = createSettingRow({
      label: 'Override System Prompt',
      description: 'When on, you can edit the system prompt directly. Changes to Tone and Domain will not affect it.',
      key: 'chat.systemPromptIsCustom',
      onReset: () => this._service.updateActiveProfile({
        chat: { systemPromptIsCustom: false },
      }),
    });
    this._overrideToggle = this._register(new Toggle(overrideRow.controlSlot, {
      ariaLabel: 'Override system prompt',
    }));
    this._register(this._overrideToggle.onDidChange((checked) => {
      this._service.updateActiveProfile({
        chat: { systemPromptIsCustom: checked },
      });
      this._systemPromptTextarea.readonly = !checked;
      this._notifySaved('chat.systemPromptIsCustom');
    }));

    // Warning message
    this._overrideWarning = $('div.ai-settings-warning');
    this._overrideWarning.style.display = 'none';
    const warningText = document.createTextNode("You're using a custom system prompt. Changes to Tone and Domain will not affect it. ");
    this._overrideWarning.appendChild(warningText);
    const revertLink = $('button.ai-settings-link');
    revertLink.setAttribute('type', 'button');
    revertLink.textContent = 'Revert to generated';
    revertLink.addEventListener('click', () => {
      this._service.updateActiveProfile({ chat: { systemPromptIsCustom: false } });
    });
    this._overrideWarning.appendChild(revertLink);
    overrideRow.controlSlot.appendChild(this._overrideWarning);
    this._addRow(overrideRow.row);

    // ── Effective System Prompt ──
    const effectiveRow = createSettingRow({
      label: 'Effective System Prompt',
      description: 'The prompt currently sent to the AI — updates live as you change settings above',
      key: 'chat.effectivePrompt',
    });
    this._effectivePromptTextarea = this._register(new Textarea(effectiveRow.controlSlot, {
      rows: 8,
      readonly: true,
      ariaLabel: 'Effective system prompt (read-only)',
    }));

    // Copy button
    const copyBtn = $('button.ai-settings-copy-btn');
    copyBtn.setAttribute('type', 'button');
    copyBtn.textContent = '📋 Copy';
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(this._effectivePromptTextarea.value);
      copyBtn.textContent = '✓ Copied';
      setTimeout(() => { copyBtn.textContent = '📋 Copy'; }, 1500);
    });
    effectiveRow.controlSlot.appendChild(copyBtn);
    this._addRow(effectiveRow.row);

    // ── Events: system prompt textarea changes ──
    this._register(this._systemPromptTextarea.onDidChange((value) => {
      this._service.updateActiveProfile({ chat: { systemPrompt: value } });
      this._notifySaved('chat.systemPrompt');
    }));

    // ── Reset section link ──
    this._addResetSectionLink('chat');
  }

  update(profile: AISettingsProfile): void {
    // Response length
    if (this._responseLengthDropdown.value !== profile.chat.responseLength) {
      this._responseLengthDropdown.value = profile.chat.responseLength;
    }

    // Tone
    if (this._toneControl.value !== profile.suggestions.tone) {
      this._toneControl.value = profile.suggestions.tone;
    }

    // Domain
    if (this._domainDropdown.value !== profile.suggestions.focusDomain) {
      this._domainDropdown.value = profile.suggestions.focusDomain;
    }
    this._toggleCustomFocus(profile.suggestions.focusDomain === 'custom');

    // Custom focus
    if (this._customFocusTextarea.value !== profile.suggestions.customFocusDescription) {
      this._customFocusTextarea.value = profile.suggestions.customFocusDescription;
    }

    // System prompt
    if (this._systemPromptTextarea.value !== profile.chat.systemPrompt) {
      this._systemPromptTextarea.value = profile.chat.systemPrompt;
    }

    // Override toggle
    if (this._overrideToggle.checked !== profile.chat.systemPromptIsCustom) {
      this._overrideToggle.checked = profile.chat.systemPromptIsCustom;
    }
    this._systemPromptTextarea.readonly = !profile.chat.systemPromptIsCustom;
    this._overrideWarning.style.display = profile.chat.systemPromptIsCustom ? '' : 'none';

    // Effective prompt
    const effectivePrompt = profile.chat.systemPromptIsCustom
      ? profile.chat.systemPrompt
      : generateChatSystemPrompt(buildGenInputFromProfile(profile));
    if (this._effectivePromptTextarea.value !== effectivePrompt) {
      this._effectivePromptTextarea.value = effectivePrompt;
    }
  }

  private _toggleCustomFocus(show: boolean): void {
    this._customFocusRow.style.display = show ? '' : 'none';
  }
}
