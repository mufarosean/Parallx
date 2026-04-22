// heartbeatSection.ts — Heartbeat (proactive tick) settings section (M58 W2)
//
// Fields:
//   - Enabled (Toggle) — default OFF
//   - Interval (Slider, 30s to 1h)
//
// Safety: ships disabled. User must opt in. Reasons allowlist defaults to
// all 5 reasons (interval, system-event, cron, wake, hook); per-reason UI
// controls are deferred — the settings store still reads the full array so
// advanced users can edit ai-config.json.

import { $ } from '../../../ui/dom.js';
import { Toggle } from '../../../ui/toggle.js';
import { Slider } from '../../../ui/slider.js';
import type { IUnifiedAIConfigService, IUnifiedAIConfig } from '../../unifiedConfigTypes.js';
import { DEFAULT_UNIFIED_CONFIG } from '../../unifiedConfigTypes.js';
import { SettingsSection, createSettingRow } from '../sectionBase.js';
import type { IAISettingsService, AISettingsProfile } from '../../aiSettingsTypes.js';

const MIN_MS = 30 * 1000;      // mirror MIN_HEARTBEAT_INTERVAL_MS
const MAX_MS = 60 * 60 * 1000; // mirror MAX_HEARTBEAT_INTERVAL_MS
const STEP_MS = 30 * 1000;

function formatInterval(ms: number): string {
  if (ms < 60 * 1000) return `${Math.round(ms / 1000)} s`;
  if (ms < 60 * 60 * 1000) return `${Math.round(ms / (60 * 1000))} min`;
  return `${(ms / (60 * 60 * 1000)).toFixed(1)} h`;
}

export class HeartbeatSection extends SettingsSection {

  private _enabledToggle!: Toggle;
  private _intervalSlider!: Slider;
  private _intervalValue!: HTMLElement;

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
  }
}
