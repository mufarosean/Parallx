// canvasSurface.ts — CanvasSurfacePlugin (M58 W6)
//
// Upstream parity:
//   - ChannelPlugin.outbound for the canvas/dashboard channel
//   - (github.com/openclaw/openclaw src/channels/)
//
// Parallx adaptation (M58 scope — READ-ONLY):
//   - The workspace canvas exposes `parallx.workspace.getCanvasPageTree`
//     (src/api/bridges/workspaceBridge.ts:295) for reading the page tree,
//     but no append / write hook exists today.
//   - This plugin registers with zero write capabilities so the router's
//     `isContentSupported` check rejects any outgoing delivery as a
//     permanent error (`isPermanentDeliveryError` matches "not supported").
//     That keeps the surface id addressable (for discovery / list)
//     without silently pretending to write.
//   - A real canvas write path — page append / create-child — is explicitly
//     deferred to M59 backlog per the M58 plan §10 ("Canvas surface write
//     upgrade").

import {
  SURFACE_CANVAS,
  type ISurfaceCapabilities,
  type ISurfaceDelivery,
  type ISurfacePlugin,
} from '../../../openclaw/openclawSurfacePlugin.js';

const CAPABILITIES: ISurfaceCapabilities = {
  supportsText: false,
  supportsStructured: false,
  supportsBinary: false,
  supportsActions: false,
};

export class CanvasSurfacePlugin implements ISurfacePlugin {
  readonly id = SURFACE_CANVAS;
  readonly capabilities = CAPABILITIES;

  isAvailable(): boolean {
    return true;
  }

  async deliver(_delivery: ISurfaceDelivery): Promise<boolean> {
    // All content types are gated by capabilities above — the router will
    // reject before ever calling deliver(). This path exists only as a
    // defensive fallback in case capabilities are bypassed.
    throw new Error('Canvas surface writes are not supported in M58 (deferred to M59)');
  }

  dispose(): void { /* no owned resources */ }
}
