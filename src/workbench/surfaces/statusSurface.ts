// statusSurface.ts — StatusSurfacePlugin (M58 W6)
//
// Routes short-lived status messages (heartbeat ticks, background job state,
// index progress) to a single persistent status-bar entry.
//
// Upstream parity:
//   - ChannelPlugin.outbound for "status" channel — short-form ephemeral
//     state broadcast
//   - (github.com/openclaw/openclaw src/channels/)
//
// Parallx adaptation:
//   - Single StatusBarEntry registered at plugin construction, updated on
//     each delivery via StatusBarEntryAccessor.update()
//   - Entry cleared (text reset to idle) on dispose
//   - Heartbeat runner (W2) will push ticks through here; until then the
//     plugin is available but idle

import type {
  IStatusBarPart,
  StatusBarEntry,
  StatusBarEntryAccessor,
} from '../../services/serviceTypes.js';
import { StatusBarAlignment } from '../../services/serviceTypes.js';
import {
  SURFACE_STATUS,
  type ISurfaceCapabilities,
  type ISurfaceDelivery,
  type ISurfacePlugin,
} from '../../openclaw/openclawSurfacePlugin.js';

const CAPABILITIES: ISurfaceCapabilities = {
  supportsText: true,
  supportsStructured: false,
  supportsBinary: false,
  supportsActions: false,
};

const ENTRY_ID = 'parallx.surface.status';
const ENTRY_NAME = 'Agent Status';
const IDLE_TEXT = ''; // empty by default so the status bar doesn't show a dead indicator

export class StatusSurfacePlugin implements ISurfacePlugin {
  readonly id = SURFACE_STATUS;
  readonly capabilities = CAPABILITIES;

  private readonly _accessor: StatusBarEntryAccessor;
  private _disposed = false;

  constructor(statusBar: IStatusBarPart) {
    const initial: StatusBarEntry = {
      id: ENTRY_ID,
      text: IDLE_TEXT,
      alignment: StatusBarAlignment.Right,
      priority: 50,
      tooltip: 'Parallx agent status',
      name: ENTRY_NAME,
    };
    this._accessor = statusBar.addEntry(initial);
  }

  isAvailable(): boolean {
    return !this._disposed;
  }

  async deliver(delivery: ISurfaceDelivery): Promise<boolean> {
    if (this._disposed) return false;
    const text = coerceToText(delivery.content);
    if (text === null) return false;

    const tooltip = typeof delivery.metadata.tooltip === 'string'
      ? (delivery.metadata.tooltip as string)
      : undefined;

    this._accessor.update({ text, ...(tooltip !== undefined ? { tooltip } : {}) });
    return true;
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._accessor.dispose();
  }
}

function coerceToText(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (content == null) return null;
  try { return String(content); } catch { return null; }
}
