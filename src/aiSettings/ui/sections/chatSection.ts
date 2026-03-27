// chatSection.ts — Chat settings section
//
// Fields:
//   - Workspace Description (Textarea, workspace-scoped)

import { Textarea } from '../../../ui/textarea.js';
import type { IAISettingsService, AISettingsProfile } from '../../aiSettingsTypes.js';
import type { IUnifiedAIConfigService } from '../../unifiedConfigTypes.js';
import { DEFAULT_UNIFIED_CONFIG } from '../../unifiedConfigTypes.js';
import { SettingsSection, createSettingRow } from '../sectionBase.js';

// ─── ChatSection ─────────────────────────────────────────────────────────────

export class ChatSection extends SettingsSection {

  private _workspaceDescriptionTextarea!: Textarea;

  private readonly _unifiedService: IUnifiedAIConfigService | undefined;

  constructor(service: IAISettingsService, unifiedService?: IUnifiedAIConfigService) {
    super(service, 'chat', 'Chat');
    this._unifiedService = unifiedService;
  }

  build(): void {
    // ── Workspace Description (always workspace-scoped) ──
    const wsDescRow = createSettingRow({
      label: 'Workspace Description',
      description: 'Describe what this workspace contains so the AI understands what "workspace" means in context. This is unique to each workspace. Leave empty for auto-generated.',
      key: 'chat.workspaceDescription',
      onReset: () => {
        this._unifiedService?.clearWorkspaceOverride('chat.workspaceDescription');
        this._workspaceDescriptionTextarea.value = '';
        this._notifySaved('chat.workspaceDescription');
      },
      scopePath: 'chat.workspaceDescription',
      unifiedService: this._unifiedService,
    });
    this._workspaceDescriptionTextarea = this._register(new Textarea(wsDescRow.controlSlot, {
      placeholder: 'e.g. This workspace contains my auto insurance documents, claims guides, agent contacts, and vehicle information for managing my car insurance.',
      rows: 3,
      ariaLabel: 'Workspace description',
    }));
    this._register(this._workspaceDescriptionTextarea.onDidChange((value) => {
      // Write to workspace override, NOT global preset — each workspace has its own description
      this._unifiedService?.updateWorkspaceOverride({ chat: { workspaceDescription: value } });
      this._notifySaved('chat.workspaceDescription');
    }));
    this._addRow(wsDescRow.row);

    // ── Reset section link ──
    this._addResetSectionLink('chat');
  }

  update(_profile: AISettingsProfile): void {
    // Workspace description (from unified config)
    const wsDesc = this._unifiedService
      ? this._unifiedService.getEffectiveConfig().chat.workspaceDescription
      : DEFAULT_UNIFIED_CONFIG.chat.workspaceDescription;
    if (this._workspaceDescriptionTextarea.value !== wsDesc) {
      this._workspaceDescriptionTextarea.value = wsDesc;
    }
  }
}
