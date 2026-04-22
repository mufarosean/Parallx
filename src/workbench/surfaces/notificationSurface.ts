// notificationSurface.ts — NotificationsSurfacePlugin (M58 W6)
//
// Routes agent output to the workbench toast system.
//
// Upstream parity:
//   - ChannelPlugin.outbound(message) → channel-native delivery
//     (github.com/openclaw/openclaw src/channels/)
//   - Maps channel.notify / toast to the "notifications" surface
//
// Parallx adaptation:
//   - Backed by INotificationService.info/warn/error (src/api/notificationService.ts)
//   - Delivery severity drawn from metadata.severity ∈ {info|warn|error}, default info
//   - Text-only surface; structured/binary/actions rejected (permanent error → upstream
//     delivery short-circuit)

import type { INotificationService } from '../../services/serviceTypes.js';
import {
  SURFACE_NOTIFICATIONS,
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

export class NotificationsSurfacePlugin implements ISurfacePlugin {
  readonly id = SURFACE_NOTIFICATIONS;
  readonly capabilities = CAPABILITIES;

  constructor(private readonly _notificationService: INotificationService) {}

  isAvailable(): boolean {
    return true;
  }

  async deliver(delivery: ISurfaceDelivery): Promise<boolean> {
    const text = coerceToText(delivery.content);
    if (!text) {
      return false;
    }

    const severity = readSeverity(delivery.metadata.severity);
    const source = readString(delivery.metadata.source) ?? 'agent';

    switch (severity) {
      case 'warn':
        await this._notificationService.warn(text);
        break;
      case 'error':
        await this._notificationService.error(text);
        break;
      default:
        // Use the full notify() for source attribution; info() omits source.
        void this._notificationService.notify(
          // NotificationSeverity.Information — string literal to avoid the
          // enum-type import round-trip; the service accepts the string form.
          'information' as unknown as import('../../api/notificationService.js').NotificationSeverity,
          text,
          [],
          source,
        );
        break;
    }

    return true;
  }

  dispose(): void {
    // Notification service is owned by the workbench; nothing to release here.
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function coerceToText(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (content == null) return null;
  try {
    return String(content);
  } catch {
    return null;
  }
}

function readSeverity(raw: unknown): 'info' | 'warn' | 'error' {
  if (raw === 'warn' || raw === 'warning') return 'warn';
  if (raw === 'error') return 'error';
  return 'info';
}

function readString(raw: unknown): string | undefined {
  return typeof raw === 'string' ? raw : undefined;
}
