// indexingSection.ts — Indexing settings section (M20 Task C.5)
//
// Fields:
//   - Auto-index (Toggle)
//   - Watch Files (Toggle)
//   - Max File Size (InputBox, human-readable)
//   - Exclude Patterns (Textarea, glob patterns)
//
// Reads/writes through IUnifiedAIConfigService.

import { Toggle } from '../../../ui/toggle.js';
import { InputBox } from '../../../ui/inputBox.js';
import { Textarea } from '../../../ui/textarea.js';
import type { IUnifiedAIConfigService, IUnifiedAIConfig } from '../../unifiedConfigTypes.js';
import { DEFAULT_UNIFIED_CONFIG } from '../../unifiedConfigTypes.js';
import { SettingsSection, createSettingRow } from '../sectionBase.js';
import type { IAISettingsService, AISettingsProfile } from '../../aiSettingsTypes.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return 'No limit';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function parseBytes(str: string): number {
  const trimmed = str.trim().toLowerCase();
  if (!trimmed || trimmed === 'no limit' || trimmed === '0') return 0;
  const match = trimmed.match(/^([\d.]+)\s*(b|kb|mb|gb)?$/);
  if (!match) return 0;
  const num = parseFloat(match[1]);
  const unit = match[2] || 'b';
  switch (unit) {
    case 'gb': return Math.round(num * 1024 * 1024 * 1024);
    case 'mb': return Math.round(num * 1024 * 1024);
    case 'kb': return Math.round(num * 1024);
    default: return Math.round(num);
  }
}

// ─── IndexingSection ─────────────────────────────────────────────────────────

export class IndexingSection extends SettingsSection {

  private _autoIndexToggle!: Toggle;
  private _watchFilesToggle!: Toggle;
  private _maxFileSizeInput!: InputBox;
  private _excludeTextarea!: Textarea;

  private readonly _unifiedService: IUnifiedAIConfigService | undefined;

  constructor(service: IAISettingsService, unifiedService?: IUnifiedAIConfigService) {
    super(service, 'indexing', 'Indexing');
    this._unifiedService = unifiedService;
  }

  build(): void {
    const defaults = DEFAULT_UNIFIED_CONFIG.indexing;

    // ── Auto-index ──
    const autoRow = createSettingRow({
      label: 'Auto-Index',
      description: 'Automatically index workspace files when the workspace opens',
      key: 'indexing.autoIndex',
      onReset: () => this._updateIndexing({ autoIndex: defaults.autoIndex }),
      scopePath: 'indexing.autoIndex',
      unifiedService: this._unifiedService,
    });
    this._autoIndexToggle = this._register(new Toggle(autoRow.controlSlot, {
      ariaLabel: 'Enable auto-indexing',
    }));
    this._register(this._autoIndexToggle.onDidChange((checked) => {
      this._updateIndexing({ autoIndex: checked });
      this._notifySaved('indexing.autoIndex');
    }));
    this._addRow(autoRow.row);

    // ── Watch Files ──
    const watchRow = createSettingRow({
      label: 'Watch Files',
      description: 'Watch files for changes and re-index automatically',
      key: 'indexing.watchFiles',
      onReset: () => this._updateIndexing({ watchFiles: defaults.watchFiles }),
      scopePath: 'indexing.watchFiles',
      unifiedService: this._unifiedService,
    });
    this._watchFilesToggle = this._register(new Toggle(watchRow.controlSlot, {
      ariaLabel: 'Enable file watching',
    }));
    this._register(this._watchFilesToggle.onDidChange((checked) => {
      this._updateIndexing({ watchFiles: checked });
      this._notifySaved('indexing.watchFiles');
    }));
    this._addRow(watchRow.row);

    // ── Max File Size ──
    const sizeRow = createSettingRow({
      label: 'Max File Size',
      description: 'Maximum file size to index (e.g. "256 KB", "1 MB", 0 = no limit)',
      key: 'indexing.maxFileSize',
      onReset: () => this._updateIndexing({ maxFileSize: defaults.maxFileSize }),
      scopePath: 'indexing.maxFileSize',
      unifiedService: this._unifiedService,
    });
    this._maxFileSizeInput = this._register(new InputBox(sizeRow.controlSlot, {
      placeholder: '256 KB',
      ariaLabel: 'Max file size',
    }));
    this._register(this._maxFileSizeInput.onDidChange((value) => {
      const bytes = parseBytes(value);
      this._updateIndexing({ maxFileSize: bytes });
      this._notifySaved('indexing.maxFileSize');
    }));
    this._addRow(sizeRow.row);

    // ── Exclude Patterns ──
    const excludeRow = createSettingRow({
      label: 'Exclude Patterns',
      description: 'Glob patterns to exclude from indexing (one per line)',
      key: 'indexing.excludePatterns',
      onReset: () => this._updateIndexing({ excludePatterns: defaults.excludePatterns as string[] }),
      scopePath: 'indexing.excludePatterns',
      unifiedService: this._unifiedService,
    });
    this._excludeTextarea = this._register(new Textarea(excludeRow.controlSlot, {
      rows: 4,
      placeholder: 'node_modules/**\n*.min.js\ndist/**',
      ariaLabel: 'Exclude patterns',
    }));
    this._register(this._excludeTextarea.onDidChange((value) => {
      const patterns = value.split('\n').map(l => l.trim()).filter(Boolean);
      this._updateIndexing({ excludePatterns: patterns });
      this._notifySaved('indexing.excludePatterns');
    }));
    this._addRow(excludeRow.row);
  }

  private _updateIndexing(patch: Partial<IUnifiedAIConfig['indexing']>): void {
    if (this._unifiedService) {
      this._unifiedService.updateActivePreset({ indexing: patch });
    }
  }

  update(_profile: AISettingsProfile): void {
    const config = this._unifiedService
      ? this._unifiedService.getEffectiveConfig().indexing
      : DEFAULT_UNIFIED_CONFIG.indexing;

    if (this._autoIndexToggle.checked !== config.autoIndex) {
      this._autoIndexToggle.checked = config.autoIndex;
    }
    if (this._watchFilesToggle.checked !== config.watchFiles) {
      this._watchFilesToggle.checked = config.watchFiles;
    }

    const formatted = formatBytes(config.maxFileSize);
    if (this._maxFileSizeInput.value !== formatted) {
      this._maxFileSizeInput.value = formatted;
    }

    const patterns = config.excludePatterns.join('\n');
    if (this._excludeTextarea.value !== patterns) {
      this._excludeTextarea.value = patterns;
    }
  }
}
