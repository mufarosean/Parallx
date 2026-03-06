// advancedSection.ts — Advanced settings section (M15 Task 2.7)
//
// Fields:
//   - Export Profile (button: "Export as JSON")
//   - Import Profile (file picker)
//   - Reset All (danger button with confirmation)
//   - Generated Prompt Preview (read-only textarea)

import { $ } from '../../../ui/dom.js';
import { Button } from '../../../ui/button.js';
import { Textarea } from '../../../ui/textarea.js';
import type { IAISettingsService, AISettingsProfile } from '../../aiSettingsTypes.js';
import { generateChatSystemPrompt, buildGenInputFromProfile } from '../../systemPromptGenerator.js';
import { SettingsSection, createSettingRow } from '../sectionBase.js';

// ─── AdvancedSection ─────────────────────────────────────────────────────────

export class AdvancedSection extends SettingsSection {

  private _promptPreview!: Textarea;

  constructor(service: IAISettingsService) {
    super(service, 'advanced', 'Advanced');
  }

  build(): void {
    // ── Export Profile ──
    const exportRow = createSettingRow({
      label: 'Export Profile',
      description: 'Download the active profile as a JSON file',
      key: 'advanced.export',
    });
    const exportBtn = this._register(new Button(exportRow.controlSlot, {
      label: 'Export as JSON',
    }));
    this._register(exportBtn.onDidClick(() => this._exportProfile()));
    this._addRow(exportRow.row);

    // ── Import Profile ──
    const importRow = createSettingRow({
      label: 'Import Profile',
      description: 'Import a profile from a JSON file (missing fields filled from defaults)',
      key: 'advanced.import',
    });
    const importBtn = this._register(new Button(importRow.controlSlot, {
      label: 'Import from JSON',
      secondary: true,
    }));
    // Hidden file input
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json';
    fileInput.style.display = 'none';
    importRow.controlSlot.appendChild(fileInput);

    this._register(importBtn.onDidClick(() => fileInput.click()));
    fileInput.addEventListener('change', () => {
      if (fileInput.files && fileInput.files.length > 0) {
        this._importProfile(fileInput.files[0]);
        fileInput.value = ''; // reset for re-import
      }
    });

    // Import status message
    const importStatus = $('div.ai-settings-import-status');
    importRow.controlSlot.appendChild(importStatus);
    (this as any)._importStatus = importStatus;
    this._addRow(importRow.row);

    // ── Reset All ──
    const resetRow = createSettingRow({
      label: 'Reset All Settings',
      description: 'Reset the active profile to factory defaults (cannot be undone)',
      key: 'advanced.resetAll',
    });
    const resetBtn = this._register(new Button(resetRow.controlSlot, {
      label: 'Reset to Defaults',
    }));
    resetBtn.element.classList.add('ai-settings-danger-btn');
    this._register(resetBtn.onDidClick(() => this._confirmResetAll()));
    this._addRow(resetRow.row);

    // ── Generated Prompt Preview ──
    const previewRow = createSettingRow({
      label: 'Generated Prompt Preview',
      description: 'The effective system prompt based on current settings',
      key: 'advanced.promptPreview',
    });
    this._promptPreview = this._register(new Textarea(previewRow.controlSlot, {
      rows: 8,
      readonly: true,
      ariaLabel: 'Generated prompt preview',
    }));
    this._addRow(previewRow.row);
  }

  update(profile: AISettingsProfile): void {
    const prompt = generateChatSystemPrompt(buildGenInputFromProfile(profile));
    if (this._promptPreview.value !== prompt) {
      this._promptPreview.value = prompt;
    }
  }

  // ─── Export ────────────────────────────────────────────────────────

  private _exportProfile(): void {
    const profile = this._service.getActiveProfile();
    const dateStr = new Date().toISOString().slice(0, 10);
    const safeName = profile.presetName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `parallx-profile-${safeName}-${dateStr}.json`;

    const blob = new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ─── Import ────────────────────────────────────────────────────────

  private async _importProfile(file: File): Promise<void> {
    const statusEl = (this as any)._importStatus as HTMLElement;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);

      if (typeof parsed !== 'object' || parsed === null) {
        throw new Error('File does not contain a valid JSON object');
      }

      // Validate required structure
      const requiredKeys: Array<keyof AISettingsProfile> = ['persona', 'chat', 'model', 'suggestions'];
      for (const key of requiredKeys) {
        if (parsed[key] === undefined) {
          statusEl.textContent = `Invalid profile: missing field '${key}'. Check the export format.`;
          statusEl.className = 'ai-settings-import-status ai-settings-import-status--error';
          return;
        }
      }

      // Create as a new custom profile
      const name = parsed.presetName
        ? `${parsed.presetName} (Imported)`
        : `Imported ${new Date().toLocaleDateString()}`;
      await this._service.createProfile(name);

      // Apply imported values (deep merge happens in updateActiveProfile)
      await this._service.updateActiveProfile({
        persona: parsed.persona,
        chat: parsed.chat,
        model: parsed.model,
        suggestions: parsed.suggestions,
      });

      statusEl.textContent = `✓ Imported as "${name}"`;
      statusEl.className = 'ai-settings-import-status ai-settings-import-status--success';
    } catch (e) {
      statusEl.textContent = `Import failed: ${(e as Error).message}`;
      statusEl.className = 'ai-settings-import-status ai-settings-import-status--error';
    }
  }

  // ─── Reset All ─────────────────────────────────────────────────────

  private _confirmResetAll(): void {
    // Simple inline confirmation — replace button temporarily
    const profile = this._service.getActiveProfile();
    if (profile.isBuiltIn) return; // built-in presets can't be reset

    // Create confirmation dialog inline
    const dialog = $('div.ai-settings-confirm-dialog');
    const msg = $('span.ai-settings-confirm-dialog__msg',
      `Reset "${profile.presetName}" to factory defaults?`);
    dialog.appendChild(msg);

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'ui-button ai-settings-danger-btn';
    confirmBtn.textContent = 'Reset';
    dialog.appendChild(confirmBtn);

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'ui-button ui-button--secondary';
    cancelBtn.textContent = 'Cancel';
    dialog.appendChild(cancelBtn);

    // Insert dialog
    this.contentElement.appendChild(dialog);

    const cleanup = () => { if (dialog.parentNode) dialog.remove(); };
    confirmBtn.addEventListener('click', () => {
      this._service.resetAll();
      cleanup();
    });
    cancelBtn.addEventListener('click', cleanup);
  }
}
