// chatSurface.ts — ChatSurfacePlugin (M58 W6 + M58-real post-fix)
//
// Routes agent deliveries back into the chat transcript as autonomous
// assistant messages.
//
// Upstream parity:
//   - ChannelPlugin.outbound for the chat (default) channel
//   - (github.com/openclaw/openclaw src/channels/)
//
// Parallx adaptation (M58-real, after the post-ship autonomy gap
// diagnosis):
//   - Original M58 scope shipped this as a trace-only logger because the
//     ChatService lacked an "append assistant message without running a
//     turn" API. After the M58-real retrofit wired heartbeat/cron to run
//     real isolated turns, that limitation became the final visibility
//     blocker: ephemeral turns ran, deliveries routed here, and dropped
//     into console-only.
//   - `ChatService.appendAutonomousMessage(sessionId, { content, origin })`
//     is now the supported append API. This plugin uses it to inject
//     heartbeat / cron / subagent result cards into the active chat
//     session.
//
// The target session is resolved via an injected `getActiveSessionId`
// callback. If no active session exists at delivery time, the delivery
// degrades to a trace log (same behavior as the original stub) — this
// keeps autonomous turns safe when the user has no chat open.

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

/**
 * Narrow view of ChatService needed for autonomous message append.
 * Kept minimal so tests can pass a plain object without recreating the
 * whole ChatService.
 */
export interface IChatSurfaceHost {
  appendAutonomousMessage(
    sessionId: string,
    opts: {
      readonly content: string;
      readonly origin: string;
      readonly requestText?: string;
      readonly metadata?: Readonly<Record<string, unknown>>;
    },
  ): boolean;
}

export type ChatSurfaceLogger = (delivery: ISurfaceDelivery) => void;

export interface IChatSurfacePluginOptions {
  /**
   * Resolver for the chat session that should receive autonomous cards.
   * Typically `() => activeWidget?.getSession()?.id`.
   */
  readonly getActiveSessionId?: () => string | undefined;
  /**
   * ChatService (narrow view) used to append autonomous messages.
   * When omitted, the plugin falls back to trace-only behavior.
   */
  readonly chatService?: IChatSurfaceHost;
  /**
   * Optional delivery logger — runs alongside real append (or replaces
   * it when the plugin has no chat service wired). Never throws.
   */
  readonly logger?: ChatSurfaceLogger;
}

function deliveryToMarkdown(delivery: ISurfaceDelivery): string {
  const c = delivery.content;
  if (typeof c === 'string') return c;
  if (c == null) return '';
  try { return '```json\n' + JSON.stringify(c, null, 2) + '\n```'; }
  catch { return String(c); }
}

/**
 * Derive the origin label used on the synthetic request for autonomous
 * messages. Executors stamp the router-level origin via
 * `sendWithOrigin`, but that origin rides as metadata on the delivery
 * envelope (key `_origin`) so the plugin reads it back for labeling.
 */
function resolveOrigin(delivery: ISurfaceDelivery): string {
  const md = (delivery.metadata ?? {}) as Record<string, unknown>;
  const originRaw = md._origin;
  if (typeof originRaw === 'string' && originRaw.length > 0) return originRaw;
  if (md.heartbeatResult) return 'heartbeat';
  if (md.cronResult) return 'cron';
  if (md.subagentResult) return 'subagent';
  return 'agent';
}

function buildRequestText(origin: string, delivery: ISurfaceDelivery): string {
  const md = (delivery.metadata ?? {}) as Record<string, unknown>;
  if (origin === 'heartbeat') {
    const reason = typeof md.reason === 'string' ? md.reason : undefined;
    const systemEvent = md.systemEvent as { readonly reason?: unknown } | undefined;
    const sysReason = typeof systemEvent?.reason === 'string' ? systemEvent.reason : undefined;
    const label = reason ?? sysReason;
    return `[heartbeat${label ? ` · ${label}` : ''}]`;
  }
  if (origin === 'cron') {
    const jobName = typeof md.jobName === 'string' ? md.jobName : undefined;
    return `[cron${jobName ? ` · ${jobName}` : ''}]`;
  }
  if (origin === 'subagent') {
    return '[subagent]';
  }
  return `[${origin}]`;
}

function byteLengthOf(content: unknown): number {
  if (typeof content === 'string') return content.length;
  try { return JSON.stringify(content).length; } catch { return 0; }
}

export class ChatSurfacePlugin implements ISurfacePlugin {
  readonly id = SURFACE_CHAT;
  readonly capabilities = CAPABILITIES;

  private readonly _getActiveSessionId?: () => string | undefined;
  private readonly _chatService?: IChatSurfaceHost;
  private readonly _logger?: ChatSurfaceLogger;

  constructor(options?: IChatSurfacePluginOptions | ChatSurfaceLogger) {
    // Back-compat: the original signature accepted a bare logger callback.
    if (typeof options === 'function') {
      this._logger = options;
      return;
    }
    this._getActiveSessionId = options?.getActiveSessionId;
    this._chatService = options?.chatService;
    this._logger = options?.logger;
  }

  isAvailable(): boolean {
    return true;
  }

  async deliver(delivery: ISurfaceDelivery): Promise<boolean> {
    // Always run the trace logger (tests/diagnostics) before attempting
    // the real append — so a broken append doesn't swallow observability.
    if (this._logger) {
      try { this._logger(delivery); } catch { /* logger must never fail delivery */ }
    }

    // Fast path when no append capability wired: preserve original
    // trace-only behavior so legacy tests keep passing.
    if (!this._chatService || !this._getActiveSessionId) {
      if (!this._logger) {
        console.log(
          '[ChatSurface] delivery %s (type=%s, bytes≈%d) [trace-only]',
          delivery.id,
          delivery.contentType,
          byteLengthOf(delivery.content),
        );
      }
      return true;
    }

    const sessionId = this._getActiveSessionId();
    if (!sessionId) {
      // No active chat — degrade to trace-only for this delivery. An
      // autonomous message with no destination is dropped rather than
      // creating a fresh session (that would surprise the user).
      console.debug('[ChatSurface] no active session; dropping autonomous delivery', delivery.id);
      return true;
    }

    const origin = resolveOrigin(delivery);
    const requestText = buildRequestText(origin, delivery);
    const content = deliveryToMarkdown(delivery);
    if (!content) {
      console.debug('[ChatSurface] empty delivery content; skipping append', delivery.id);
      return true;
    }

    const appended = this._chatService.appendAutonomousMessage(sessionId, {
      content,
      origin,
      requestText,
      metadata: delivery.metadata as Record<string, unknown> | undefined,
    });

    if (!appended) {
      console.debug(
        '[ChatSurface] appendAutonomousMessage returned false (ephemeral or missing session)',
        sessionId,
      );
    }
    return true;
  }

  dispose(): void { /* no owned resources */ }
}
