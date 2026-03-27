// previewSection.ts — Preview section for AI Settings panel (M15 Task 2.8)
//
// The user types a test message and sees how the AI responds with current
// settings — before committing to a full chat session.
//
// - Text input + Run button
// - Three starter prompts as clickable chips
// - Response area with spinner while waiting
// - Metadata line: active preset, temperature, tone
// - "Open in chat" button

import { $ } from '../../../ui/dom.js';
import { InputBox } from '../../../ui/inputBox.js';
import { Button } from '../../../ui/button.js';
import type { IAISettingsService, AISettingsProfile } from '../../aiSettingsTypes.js';
import { SettingsSection } from '../sectionBase.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const STARTER_PROMPTS = [
  'Hello, who are you?',
  'Summarize what you know about me.',
  'What would you suggest I do today?',
];

// ─── PreviewSection ──────────────────────────────────────────────────────────

export class PreviewSection extends SettingsSection {

  private _promptInput!: InputBox;
  private _runBtn!: Button;
  private _responseArea!: HTMLElement;
  private _metadataLine!: HTMLElement;
  private _openInChatBtn!: Button;
  private _isRunning = false;

  constructor(service: IAISettingsService) {
    super(service, 'preview', 'Preview');
  }

  build(): void {
    // ── Starter Chips ──
    const chipsRow = $('div.ai-settings-preview__chips');
    for (const prompt of STARTER_PROMPTS) {
      const chip = $('button.ai-settings-preview__chip');
      chip.setAttribute('type', 'button');
      chip.textContent = prompt;
      chip.addEventListener('click', () => {
        this._promptInput.value = prompt;
        this._run(prompt);
      });
      chipsRow.appendChild(chip);
    }
    this.contentElement.appendChild(chipsRow);

    // ── Input + Run ──
    const inputRow = $('div.ai-settings-preview__input-row');
    this._promptInput = this._register(new InputBox(inputRow, {
      placeholder: 'Type a test message…',
      ariaLabel: 'Preview test message',
    }));
    this._runBtn = this._register(new Button(inputRow, {
      label: 'Run',
    }));
    this._register(this._runBtn.onDidClick(() => {
      if (this._promptInput.value.trim()) {
        this._run(this._promptInput.value.trim());
      }
    }));
    this._register(this._promptInput.onDidSubmit((value) => {
      if (value.trim()) this._run(value.trim());
    }));
    this.contentElement.appendChild(inputRow);

    // ── Metadata ──
    this._metadataLine = $('div.ai-settings-preview__metadata');
    this.contentElement.appendChild(this._metadataLine);

    // ── Response Area ──
    this._responseArea = $('div.ai-settings-preview__response');
    this._responseArea.textContent = 'Response will appear here after running a test.';
    this.contentElement.appendChild(this._responseArea);

    // ── Open in Chat ──
    const openRow = $('div.ai-settings-preview__open');
    this._openInChatBtn = this._register(new Button(openRow, {
      label: 'Open in chat',
      secondary: true,
    }));
    this._openInChatBtn.enabled = false;
    this.contentElement.appendChild(openRow);
  }

  update(profile: AISettingsProfile): void {
    this._metadataLine.textContent =
      `Preset: ${profile.presetName} · Temperature: ${profile.model.temperature.toFixed(2)}`;
  }

  // ─── Run Preview ───────────────────────────────────────────────────

  private async _run(message: string): Promise<void> {
    if (this._isRunning) return;
    this._isRunning = true;
    this._runBtn.enabled = false;

    // Show spinner
    this._responseArea.textContent = '';
    this._responseArea.classList.add('ai-settings-preview__response--loading');
    const spinner = $('div.ai-settings-preview__spinner');
    spinner.textContent = '⏳ Generating response…';
    this._responseArea.appendChild(spinner);

    try {
      const response = await this._service.runPreviewTest(message);
      this._responseArea.textContent = response;
      this._responseArea.classList.remove('ai-settings-preview__response--loading');
      this._openInChatBtn.enabled = true;
    } catch (e) {
      this._responseArea.classList.remove('ai-settings-preview__response--loading');
      this._responseArea.textContent = '';

      const errorMsg = $('div.ai-settings-preview__error');
      errorMsg.textContent = `Error: ${(e as Error).message}`;
      this._responseArea.appendChild(errorMsg);

      const retryBtn = $('button.ai-settings-preview__retry');
      retryBtn.setAttribute('type', 'button');
      retryBtn.textContent = 'Retry';
      retryBtn.addEventListener('click', () => this._run(message));
      this._responseArea.appendChild(retryBtn);
    } finally {
      this._isRunning = false;
      this._runBtn.enabled = true;
    }
  }

  // Search override: preview section has no standard "settings rows" to dim,
  // but we want it visible in searches for "preview" or "test"
  override applySearch(query: string): number {
    if (!query) {
      this.element.classList.remove('ai-settings-section--no-matches');
      return 1;
    }
    const q = query.toLowerCase();
    const isMatch = 'preview'.includes(q) || 'test'.includes(q);
    this.element.classList.toggle('ai-settings-section--no-matches', !isMatch);
    return isMatch ? 1 : 0;
  }
}
