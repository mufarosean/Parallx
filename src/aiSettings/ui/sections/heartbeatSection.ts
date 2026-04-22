// heartbeatSection.ts — Heartbeat (proactive tick) settings section (M58 W2)
//
// Fields:
//   - Enabled (Toggle) — default OFF
//   - Interval (Slider, 30s to 1h)
//   - Coalesce window (Slider, 0–10s) — burst-collapse file events
//   - Watch include extensions (Textarea, one per line)
//   - Watch exclude globs (Textarea, one per line)
//
// Safety: ships disabled. User must opt in. Reasons allowlist defaults to
// all 5 reasons (interval, system-event, cron, wake, hook); per-reason UI
// controls are deferred — the settings store still reads the full array so
// advanced users can edit ai-config.json.

import { $ } from '../../../ui/dom.js';
import { Toggle } from '../../../ui/toggle.js';
import { Slider } from '../../../ui/slider.js';
import { Textarea } from '../../../ui/textarea.js';
import type { IUnifiedAIConfigService, IUnifiedAIConfig } from '../../unifiedConfigTypes.js';
import { DEFAULT_UNIFIED_CONFIG } from '../../unifiedConfigTypes.js';
import { SettingsSection, createSettingRow } from '../sectionBase.js';
import type { IAISettingsService, AISettingsProfile } from '../../aiSettingsTypes.js';

const MIN_MS = 30 * 1000;      // mirror MIN_HEARTBEAT_INTERVAL_MS
const MAX_MS = 60 * 60 * 1000; // mirror MAX_HEARTBEAT_INTERVAL_MS
const STEP_MS = 30 * 1000;

const COALESCE_MIN_MS = 0;
const COALESCE_MAX_MS = 10 * 1000;
const COALESCE_STEP_MS = 250;

function formatInterval(ms: number): string {
  if (ms < 60 * 1000) return `${Math.round(ms / 1000)} s`;
  if (ms < 60 * 60 * 1000) return `${Math.round(ms / (60 * 1000))} min`;
  return `${(ms / (60 * 60 * 1000)).toFixed(1)} h`;
}

function formatCoalesce(ms: number): string {
  if (ms === 0) return 'off';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1)} s`;
}

export class HeartbeatSection extends SettingsSection {

  private _enabledToggle!: Toggle;
  private _intervalSlider!: Slider;
  private _intervalValue!: HTMLElement;
  private _coalesceSlider!: Slider;
  private _coalesceValue!: HTMLElement;
  private _includeTextarea!: Textarea;
  private _excludeTextarea!: Textarea;

  private readonly _unifiedService: IUnifiedAIConfigService | undefined;

  constructor(service: IAISettingsService, unifiedService?: IUnifiedAIConfigService) {
    super(service, 'heartbeat', 'Heartbeat');
    this._unifiedService = unifiedService;
  }

  build(): void {
    const defaults = DEFAULT_UNIFIED_CONFIG.heartbeat;

    // ── Intro copy ──
    const intro = $('div.ai-settings-section__info');
    intro.textContent =
      'Let the agent tick in the background and react to workspace events (file changes, index completion). Off by default — opt in to enable.';
    this.contentElement.appendChild(intro);

    // ── Enabled ──
    const enabledRow = createSettingRow({
      label: 'Enable Heartbeat',
      description: 'When on, a periodic tick runs between chats to react to events. Disabled by default.',
      key: 'heartbeat.enabled',
      onReset: () => this._updateHeartbeat({ enabled: defaults.enabled }),
      scopePath: 'heartbeat.enabled',
      unifiedService: this._unifiedService,
    });
    this._enabledToggle = this._register(new Toggle(enabledRow.controlSlot, {
      ariaLabel: 'Enable heartbeat',
    }));
    this._register(this._enabledToggle.onDidChange((checked) => {
      this._updateHeartbeat({ enabled: checked });
      this._notifySaved('heartbeat.enabled');
    }));
    this._addRow(enabledRow.row);

    // ── Interval ──
    const intervalRow = createSettingRow({
      label: 'Interval',
      description: 'How often the heartbeat ticks. Clamped to 30 s – 1 h.',
      key: 'heartbeat.intervalMs',
      onReset: () => this._updateHeartbeat({ intervalMs: defaults.intervalMs }),
      scopePath: 'heartbeat.intervalMs',
      unifiedService: this._unifiedService,
    });
    this._intervalSlider = this._register(new Slider(intervalRow.controlSlot, {
      min: MIN_MS,
      max: MAX_MS,
      step: STEP_MS,
      value: defaults.intervalMs,
      ariaLabel: 'Heartbeat interval',
      labeledStops: [
        { value: MIN_MS, label: '30s' },
        { value: 5 * 60 * 1000, label: '5m' },
        { value: 30 * 60 * 1000, label: '30m' },
        { value: MAX_MS, label: '1h' },
      ],
    }));
    this._intervalValue = $('span.ai-settings-row__value', formatInterval(defaults.intervalMs));
    intervalRow.controlSlot.appendChild(this._intervalValue);
    this._register(this._intervalSlider.onDidChange((value) => {
      this._intervalValue.textContent = formatInterval(value);
      this._updateHeartbeat({ intervalMs: value });
      this._notifySaved('heartbeat.intervalMs');
    }));
    this._addRow(intervalRow.row);

    // ── Coalesce window (Fix 4) ──
    const coalesceRow = createSettingRow({
      label: 'Coalesce Burst',
      description: 'Wait this long after a file change before running the turn. Collapses multi-file saves into one turn. Set to 0 to fire on every event.',
      key: 'heartbeat.coalesceWindowMs',
      onReset: () => this._updateHeartbeat({ coalesceWindowMs: defaults.coalesceWindowMs }),
      scopePath: 'heartbeat.coalesceWindowMs',
      unifiedService: this._unifiedService,
    });
    this._coalesceSlider = this._register(new Slider(coalesceRow.controlSlot, {
      min: COALESCE_MIN_MS,
      max: COALESCE_MAX_MS,
      step: COALESCE_STEP_MS,
      value: defaults.coalesceWindowMs,
      ariaLabel: 'Heartbeat burst coalesce window',
      labeledStops: [
        { value: 0, label: 'off' },
        { value: 2000, label: '2s' },
        { value: 5000, label: '5s' },
        { value: 10_000, label: '10s' },
      ],
    }));
    this._coalesceValue = $('span.ai-settings-row__value', formatCoalesce(defaults.coalesceWindowMs));
    coalesceRow.controlSlot.appendChild(this._coalesceValue);
    this._register(this._coalesceSlider.onDidChange((value) => {
      this._coalesceValue.textContent = formatCoalesce(value);
      this._updateHeartbeat({ coalesceWindowMs: value });
      this._notifySaved('heartbeat.coalesceWindowMs');
    }));
    this._addRow(coalesceRow.row);

    // ── Watch include extensions (Fix 3) ──
    const includeRow = createSettingRow({
      label: 'Watch Extensions',
      description: 'File-change events only wake the heartbeat when the path ends with one of these extensions (one per line, leading dot required). Empty = all extensions.',
      key: 'heartbeat.watchIncludeExtensions',
      onReset: () => this._updateHeartbeat({ watchIncludeExtensions: [...defaults.watchIncludeExtensions] }),
      scopePath: 'heartbeat.watchIncludeExtensions',
      unifiedService: this._unifiedService,
    });
    this._includeTextarea = this._register(new Textarea(includeRow.controlSlot, {
      rows: 4,
      placeholder: '.ts\n.md\n.json',
      ariaLabel: 'Watch extensions',
    }));
    this._register(this._includeTextarea.onDidChange((value) => {
      const exts = value.split('\n').map(l => l.trim()).filter(Boolean);
      this._updateHeartbeat({ watchIncludeExtensions: exts });
      this._notifySaved('heartbeat.watchIncludeExtensions');
    }));
    this._addRow(includeRow.row);

    // ── Watch exclude globs (Fix 3) ──
    const excludeRow = createSettingRow({
      label: 'Exclude Paths',
      description: 'File-change events are dropped if the path matches any of these globs (one per line). Exclude wins over include.',
      key: 'heartbeat.watchExcludeGlobs',
      onReset: () => this._updateHeartbeat({ watchExcludeGlobs: [...defaults.watchExcludeGlobs] }),
      scopePath: 'heartbeat.watchExcludeGlobs',
      unifiedService: this._unifiedService,
    });
    this._excludeTextarea = this._register(new Textarea(excludeRow.controlSlot, {
      rows: 4,
      placeholder: '**/node_modules/**\n**/.git/**\n**/dist/**',
      ariaLabel: 'Watch exclude globs',
    }));
    this._register(this._excludeTextarea.onDidChange((value) => {
      const globs = value.split('\n').map(l => l.trim()).filter(Boolean);
      this._updateHeartbeat({ watchExcludeGlobs: globs });
      this._notifySaved('heartbeat.watchExcludeGlobs');
    }));
    this._addRow(excludeRow.row);
  }

  private _updateHeartbeat(patch: Partial<IUnifiedAIConfig['heartbeat']>): void {
    if (this._unifiedService) {
      this._unifiedService.updateActivePreset({ heartbeat: patch });
    }
  }

  update(_profile: AISettingsProfile): void {
    const config = this._unifiedService
      ? this._unifiedService.getEffectiveConfig().heartbeat
      : DEFAULT_UNIFIED_CONFIG.heartbeat;

    if (this._enabledToggle.checked !== config.enabled) {
      this._enabledToggle.checked = config.enabled;
    }
    if (this._intervalSlider.value !== config.intervalMs) {
      this._intervalSlider.value = config.intervalMs;
      this._intervalValue.textContent = formatInterval(config.intervalMs);
    }
    if (this._coalesceSlider.value !== config.coalesceWindowMs) {
      this._coalesceSlider.value = config.coalesceWindowMs;
      this._coalesceValue.textContent = formatCoalesce(config.coalesceWindowMs);
    }
    const includeText = config.watchIncludeExtensions.join('\n');
    if (this._includeTextarea.value !== includeText) {
      this._includeTextarea.value = includeText;
    }
    const excludeText = config.watchExcludeGlobs.join('\n');
    if (this._excludeTextarea.value !== excludeText) {
      this._excludeTextarea.value = excludeText;
    }
  }
}
