// memorySection.ts — Memory management section (M20 Task F.1)
//
// Provides:
//   - Summary stats: memories, concepts, preferences count
//   - Memory toggle (enable/disable automatic creation)
//   - Memory list: scrollable, expandable summaries, delete per item
//   - Concept list: scrollable with delete per item
//   - Preferences list: key-value pairs with delete per item
//   - Clear All button with inline confirmation
//
// Uses IMemoryService for data access.

import { $ } from '../../../ui/dom.js';
import { Toggle } from '../../../ui/toggle.js';
import type { IUnifiedAIConfigService, IUnifiedAIConfig } from '../../unifiedConfigTypes.js';
import { DEFAULT_UNIFIED_CONFIG } from '../../unifiedConfigTypes.js';
import { SettingsSection, createSettingRow } from '../sectionBase.js';
import type { IAISettingsService, AISettingsProfile } from '../../aiSettingsTypes.js';

// ─── IMemoryService subset needed by this section ────────────────────────────

export interface IMemorySectionServices {
  getAllMemories(): Promise<{ sessionId: string; summary: string; createdAt: string; messageCount: number }[]>;
  getAllConcepts(): Promise<{ id?: number; concept: string; category: string; summary: string; masteryLevel: number; encounterCount: number; decayScore: number }[]>;
  getPreferences(): Promise<{ key: string; value: string; frequency: number; updatedAt: string }[]>;
  deleteMemory(sessionId: string): Promise<void>;
  deleteConcept(conceptId: number): Promise<void>;
  deletePreference(key: string): Promise<void>;
  clearAll(): Promise<void>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen - 1) + '\u2026';
}

// ─── MemorySection ───────────────────────────────────────────────────────────

export class MemorySection extends SettingsSection {

  private _memoryServices: IMemorySectionServices | undefined;
  private readonly _unifiedService: IUnifiedAIConfigService | undefined;

  private _summaryEl!: HTMLElement;
  private _statsEl!: HTMLElement;
  private _memoryToggle!: Toggle;
  private _memoryListEl!: HTMLElement;
  private _conceptListEl!: HTMLElement;
  private _preferenceListEl!: HTMLElement;
  private _clearAllBtn!: HTMLButtonElement;
  private _clearConfirm: HTMLElement | undefined;

  constructor(
    service: IAISettingsService,
    memoryServices?: IMemorySectionServices,
    unifiedService?: IUnifiedAIConfigService,
  ) {
    super(service, 'memory', 'Memory');
    this._memoryServices = memoryServices;
    this._unifiedService = unifiedService;
  }

  build(): void {
    // ── Summary badge in header ──
    this._summaryEl = $('span.ai-settings-memory-summary');
    this.headerElement.appendChild(this._summaryEl);

    // ── Summary stats ──
    this._statsEl = $('div.ai-settings-memory-stats');
    this._statsEl.textContent = 'Loading…';
    this.contentElement.appendChild(this._statsEl);

    // ── Memory toggle ──
    const defaults = DEFAULT_UNIFIED_CONFIG.memory;
    const toggleRow = createSettingRow({
      label: 'Automatic Memory',
      description: 'Automatically create session summaries and extract concepts after conversations',
      key: 'memory.memoryEnabled',
      onReset: () => this._updateMemoryConfig({ memoryEnabled: defaults.memoryEnabled }),
      scopePath: 'memory.memoryEnabled',
      unifiedService: this._unifiedService,
    });
    this._memoryToggle = this._register(new Toggle(toggleRow.controlSlot, {
      ariaLabel: 'Enable automatic memory creation',
    }));
    this._register(this._memoryToggle.onDidChange((checked) => {
      this._updateMemoryConfig({ memoryEnabled: checked });
      this._notifySaved('memory.memoryEnabled');
    }));
    this._addRow(toggleRow.row);

    // ── Memories subsection ──
    const memHeader = $('div.ai-settings-memory-subheader', 'Session Memories');
    this.contentElement.appendChild(memHeader);
    this._memoryListEl = $('div.ai-settings-memory-list');
    this.contentElement.appendChild(this._memoryListEl);

    // ── Concepts subsection ──
    const conceptHeader = $('div.ai-settings-memory-subheader', 'Learning Concepts');
    this.contentElement.appendChild(conceptHeader);
    this._conceptListEl = $('div.ai-settings-memory-list');
    this.contentElement.appendChild(this._conceptListEl);

    // ── Preferences subsection ──
    const prefHeader = $('div.ai-settings-memory-subheader', 'Preferences');
    this.contentElement.appendChild(prefHeader);
    this._preferenceListEl = $('div.ai-settings-memory-list');
    this.contentElement.appendChild(this._preferenceListEl);

    // ── Clear All ──
    const clearRow = $('div.ai-settings-memory-clear-row');
    this._clearAllBtn = document.createElement('button');
    this._clearAllBtn.type = 'button';
    this._clearAllBtn.className = 'ai-settings-memory-clear-btn';
    this._clearAllBtn.textContent = 'Clear All Memories';
    this._clearAllBtn.addEventListener('click', () => this._handleClearAll());
    clearRow.appendChild(this._clearAllBtn);
    this.contentElement.appendChild(clearRow);

    // ── Load data ──
    this._refreshAll();
  }

  update(_profile: AISettingsProfile): void {
    // Update toggle from unified config
    const config = this._unifiedService
      ? this._unifiedService.getEffectiveConfig().memory
      : DEFAULT_UNIFIED_CONFIG.memory;

    if (this._memoryToggle && this._memoryToggle.checked !== config.memoryEnabled) {
      this._memoryToggle.checked = config.memoryEnabled;
    }

    this._refreshAll();
  }

  // ─── Data Refresh ──────────────────────────────────────────────────

  private async _refreshAll(): Promise<void> {
    if (!this._memoryServices) {
      this._statsEl.textContent = 'Memory service not available';
      this._memoryListEl.innerHTML = '';
      this._conceptListEl.innerHTML = '';
      this._preferenceListEl.innerHTML = '';
      this._summaryEl.textContent = '';
      return;
    }

    try {
      const [memories, concepts, preferences] = await Promise.all([
        this._memoryServices.getAllMemories(),
        this._memoryServices.getAllConcepts(),
        this._memoryServices.getPreferences(),
      ]);

      // Stats
      this._statsEl.textContent =
        `${memories.length} session memor${memories.length !== 1 ? 'ies' : 'y'}, ` +
        `${concepts.length} concept${concepts.length !== 1 ? 's' : ''}, ` +
        `${preferences.length} preference${preferences.length !== 1 ? 's' : ''}`;
      this._summaryEl.textContent = `${memories.length + concepts.length + preferences.length} items`;

      // Render lists
      this._renderMemoryList(memories);
      this._renderConceptList(concepts);
      this._renderPreferenceList(preferences);
    } catch {
      this._statsEl.textContent = 'Failed to load memory data';
    }
  }

  // ─── Memory List ───────────────────────────────────────────────────

  private _renderMemoryList(
    memories: { sessionId: string; summary: string; createdAt: string; messageCount: number }[],
  ): void {
    this._memoryListEl.innerHTML = '';

    if (memories.length === 0) {
      const empty = $('div.ai-settings-memory-empty', 'No session memories stored');
      this._memoryListEl.appendChild(empty);
      return;
    }

    for (const mem of memories) {
      const item = $('div.ai-settings-memory-item');

      // Header row: date + message count + delete button
      const header = $('div.ai-settings-memory-item-header');

      const date = $('span.ai-settings-memory-item-date', formatDate(mem.createdAt));
      header.appendChild(date);

      const meta = $('span.ai-settings-memory-item-meta', `${mem.messageCount} messages`);
      header.appendChild(meta);

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'ai-settings-memory-delete-btn';
      deleteBtn.textContent = '\u2715'; // ✕
      deleteBtn.title = 'Delete this memory';
      deleteBtn.setAttribute('aria-label', `Delete memory for session`);
      deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await this._memoryServices!.deleteMemory(mem.sessionId);
        this._refreshAll();
      });
      header.appendChild(deleteBtn);

      item.appendChild(header);

      // Summary text (truncated, expandable on click)
      const summaryEl = $('div.ai-settings-memory-item-summary');
      const fullText = mem.summary;
      const shortText = truncate(fullText, 120);
      summaryEl.textContent = shortText;
      let expanded = false;

      if (fullText.length > 120) {
        summaryEl.classList.add('ai-settings-memory-item-summary--truncated');
        item.addEventListener('click', () => {
          expanded = !expanded;
          summaryEl.textContent = expanded ? fullText : shortText;
          summaryEl.classList.toggle('ai-settings-memory-item-summary--truncated', !expanded);
          summaryEl.classList.toggle('ai-settings-memory-item-summary--expanded', expanded);
        });
      }

      item.appendChild(summaryEl);
      this._memoryListEl.appendChild(item);
    }
  }

  // ─── Concept List ──────────────────────────────────────────────────

  private _renderConceptList(
    concepts: { id?: number; concept: string; category: string; summary: string; masteryLevel: number; encounterCount: number; decayScore: number }[],
  ): void {
    this._conceptListEl.innerHTML = '';

    if (concepts.length === 0) {
      const empty = $('div.ai-settings-memory-empty', 'No learning concepts tracked');
      this._conceptListEl.appendChild(empty);
      return;
    }

    for (const concept of concepts) {
      const item = $('div.ai-settings-memory-item');

      // Header row: concept name + category + delete
      const header = $('div.ai-settings-memory-item-header');

      const nameEl = $('span.ai-settings-memory-concept-name', concept.concept);
      header.appendChild(nameEl);

      const catEl = $('span.ai-settings-memory-concept-category', concept.category);
      header.appendChild(catEl);

      if (concept.id != null) {
        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'ai-settings-memory-delete-btn';
        deleteBtn.textContent = '\u2715';
        deleteBtn.title = 'Delete this concept';
        deleteBtn.setAttribute('aria-label', `Delete concept: ${concept.concept}`);
        deleteBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          await this._memoryServices!.deleteConcept(concept.id!);
          this._refreshAll();
        });
        header.appendChild(deleteBtn);
      }

      item.appendChild(header);

      // Info row: mastery bar + encounters + decay
      const info = $('div.ai-settings-memory-concept-info');

      // Mastery bar
      const masteryWrap = $('span.ai-settings-memory-mastery-wrap');
      const masteryLabel = $('span.ai-settings-memory-mastery-label', 'Mastery');
      masteryWrap.appendChild(masteryLabel);
      const masteryBar = $('span.ai-settings-memory-mastery-bar');
      const masteryFill = $('span.ai-settings-memory-mastery-fill');
      masteryFill.style.width = `${Math.round(concept.masteryLevel * 100)}%`;
      masteryBar.appendChild(masteryFill);
      masteryWrap.appendChild(masteryBar);
      info.appendChild(masteryWrap);

      const encounters = $('span.ai-settings-memory-item-meta', `${concept.encounterCount} encounters`);
      info.appendChild(encounters);

      // Decay indicator
      const decayEl = $('span.ai-settings-memory-decay');
      const decayPct = Math.round(concept.decayScore * 100);
      decayEl.textContent = `Decay: ${decayPct}%`;
      decayEl.title = `Memory freshness: ${decayPct}%${decayPct < 30 ? ' (fading)' : ''}`;
      if (decayPct < 30) decayEl.classList.add('ai-settings-memory-decay--low');
      info.appendChild(decayEl);

      item.appendChild(info);

      // Summary
      const summaryEl = $('div.ai-settings-memory-item-summary', truncate(concept.summary, 100));
      item.appendChild(summaryEl);

      this._conceptListEl.appendChild(item);
    }
  }

  // ─── Preference List ───────────────────────────────────────────────

  private _renderPreferenceList(
    preferences: { key: string; value: string; frequency: number; updatedAt: string }[],
  ): void {
    this._preferenceListEl.innerHTML = '';

    if (preferences.length === 0) {
      const empty = $('div.ai-settings-memory-empty', 'No learned preferences');
      this._preferenceListEl.appendChild(empty);
      return;
    }

    for (const pref of preferences) {
      const item = $('div.ai-settings-memory-item.ai-settings-memory-pref-item');

      // Key-value row
      const header = $('div.ai-settings-memory-item-header');

      const keyEl = $('span.ai-settings-memory-pref-key', pref.key);
      header.appendChild(keyEl);

      const valueEl = $('span.ai-settings-memory-pref-value', pref.value);
      header.appendChild(valueEl);

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'ai-settings-memory-delete-btn';
      deleteBtn.textContent = '\u2715';
      deleteBtn.title = 'Delete this preference';
      deleteBtn.setAttribute('aria-label', `Delete preference: ${pref.key}`);
      deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await this._memoryServices!.deletePreference(pref.key);
        this._refreshAll();
      });
      header.appendChild(deleteBtn);

      item.appendChild(header);

      // Meta: frequency + last updated
      const meta = $('div.ai-settings-memory-pref-meta');
      meta.textContent = `Seen ${pref.frequency} time${pref.frequency !== 1 ? 's' : ''} · Last updated ${formatDate(pref.updatedAt)}`;
      item.appendChild(meta);

      this._preferenceListEl.appendChild(item);
    }
  }

  // ─── Clear All ─────────────────────────────────────────────────────

  private _handleClearAll(): void {
    // Show inline confirmation
    if (this._clearConfirm) return; // Already showing

    const confirm = $('div.ai-settings-memory-clear-confirm');
    confirm.textContent = 'This will permanently delete all memories, concepts, and preferences. ';

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'ai-settings-memory-clear-confirm-btn';
    confirmBtn.textContent = 'Yes, Clear All';
    confirmBtn.addEventListener('click', async () => {
      await this._memoryServices!.clearAll();
      this._removeClearConfirm();
      this._refreshAll();
    });
    confirm.appendChild(confirmBtn);

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'ai-settings-memory-clear-cancel-btn';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => this._removeClearConfirm());
    confirm.appendChild(cancelBtn);

    this._clearConfirm = confirm;
    this._clearAllBtn.parentElement!.appendChild(confirm);
  }

  private _removeClearConfirm(): void {
    if (this._clearConfirm) {
      this._clearConfirm.remove();
      this._clearConfirm = undefined;
    }
  }

  // ─── Config Update ─────────────────────────────────────────────────

  private _updateMemoryConfig(patch: Partial<IUnifiedAIConfig['memory']>): void {
    if (this._unifiedService) {
      this._unifiedService.updateActivePreset({ memory: patch });
    }
  }
}
