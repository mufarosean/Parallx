// chatSurface.ts — ChatSurfacePlugin (M58 W6)
//
// Routes agent deliveries back into the chat transcript.
//
// Upstream parity:
//   - ChannelPlugin.outbound for the chat (default) channel
//   - (github.com/openclaw/openclaw src/channels/)
//
// Parallx adaptation (M58 scope):
//   - IChatService does not today expose a "post assistant message without
//     running a turn" API. The active chat turn already delivers its
//     response via the participant pipeline, so a `surface_send({chat})`
//     in-turn is largely redundant.
//   - For M58 the plugin logs the delivery (for trace) and returns success.
//     W5 (Subagent) will build a quoted-card append path that will extend
//     this plugin (or an adjacent one) to land sub-agent results as a
//     bubble in the parent transcript.
//
// This is the honest desktop adaptation today. Tracked as a scope note in
// W6 TRACKER, Iteration 1.

import {
  SURFACE_CHAT,
  type ISurfaceCapabilities,
  type ISurfaceDelivery,
  type ISurfacePlugin,
} from '../../../openclaw/openclawSurfacePlugin.js';

const CAPABILITIES: ISurfaceCapabilities = {
  supportsText: true,
  supportsStructured: true,
  supportsBinary: false,
  supportsActions: false,
};

export type ChatSurfaceLogger = (delivery: ISurfaceDelivery) => void;

export class ChatSurfacePlugin implements ISurfacePlugin {
  readonly id = SURFACE_CHAT;
  readonly capabilities = CAPABILITIES;

  constructor(private readonly _logger?: ChatSurfaceLogger) {}

  isAvailable(): boolean {
    return true;
  }

  async deliver(delivery: ISurfaceDelivery): Promise<boolean> {
    if (this._logger) {
      try { this._logger(delivery); } catch { /* logger must never fail delivery */ }
    } else {
      // Default: structured console trace so agent runs are inspectable.
      console.log(
        '[ChatSurface] delivery %s (type=%s, bytes≈%d)',
        delivery.id,
        delivery.contentType,
        byteLengthOf(delivery.content),
      );
    }
    return true;
  }

  dispose(): void { /* no owned resources */ }
}

function byteLengthOf(content: unknown): number {
  if (typeof content === 'string') return content.length;
  try { return JSON.stringify(content).length; } catch { return 0; }
}
