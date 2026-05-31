// settingsPanelRegistry.ts — the standard way to add a rich panel to Settings.
//
// The flat schema registry (settingsRegistryService) covers key→value settings.
// Some areas (Appearance, AI, Keyboard Shortcuts, and future extensions) need a
// *custom-rendered* panel inside the unified Settings hub instead of a list of
// rows. Any tool registers one here at activation; the Settings editor reads
// this registry to build its left-nav and mounts the panel on demand.
//
// Module singleton (same pattern as colorRegistry / designTokenRegistry) so it
// is available regardless of service-activation order — a tool can register its
// panel before or after the Settings tool loads.

import { Emitter } from '../platform/events.js';
import type { Event } from '../platform/events.js';
import type { IDisposable } from '../platform/lifecycle.js';

/** A custom panel contributed into the unified Settings hub. */
export interface ISettingsPanel {
  /** Stable id, e.g. 'appearance'. */
  readonly id: string;
  /** Nav label, e.g. 'Appearance'. */
  readonly label: string;
  /** Sort weight in the nav (lower = higher). Schema categories default to 50. */
  readonly order?: number;
  /** Optional one-line description shown under the panel heading. */
  readonly description?: string;
  /**
   * Render the panel body into `container`. Called each time the panel is
   * shown; return a disposable to tear down listeners/instances when the user
   * navigates away or closes Settings.
   */
  render(container: HTMLElement): IDisposable | void;
}

class SettingsPanelRegistry {
  private readonly _panels = new Map<string, ISettingsPanel>();
  private readonly _onDidChange = new Emitter<void>();
  readonly onDidChange: Event<void> = this._onDidChange.event;

  /** Register a panel. Re-registering the same id replaces it. */
  register(panel: ISettingsPanel): IDisposable {
    this._panels.set(panel.id, panel);
    this._onDidChange.fire();
    return {
      dispose: () => {
        if (this._panels.delete(panel.id)) this._onDidChange.fire();
      },
    };
  }

  get(id: string): ISettingsPanel | undefined {
    return this._panels.get(id);
  }

  /** All panels, sorted by order then label. */
  getPanels(): ISettingsPanel[] {
    return Array.from(this._panels.values()).sort(
      (a, b) => (a.order ?? 50) - (b.order ?? 50) || a.label.localeCompare(b.label),
    );
  }
}

/** Process-wide Settings panel registry. */
export const settingsPanelRegistry = new SettingsPanelRegistry();
