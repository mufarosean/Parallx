// chatSurface.ts — ChatSurfacePlugin (M58 W6 → post-ship UX reshape)
//
// Receives agent deliveries and routes them to the AutonomyLogService.
// Earlier revisions appended directly into the user's active chat, but
// that polluted the transcript and made conversation hard to follow —
// autonomy now has its own dedicated log surface (AI Settings →
// Autonomy Log) and the agent can read it back via the `autonomy_log`
// tool.
//
// Back-compat: the bare-logger constructor still works for tests that
// just want a stub surface.

import {
  SURFACE_CHAT,
  type ISurfaceCapabilities,
  type ISurfaceDelivery,
  type ISurfacePlugin,
} from '../../../openclaw/openclawSurfacePlugin.js';
import type { IAutonomyLogAppender } from '../../../services/autonomyLogService.js';

const CAPABILITIES: ISurfaceCapabilities = {
  supportsText: true,
  supportsStructured: true,
  supportsBinary: false,
  supportsActions: false,
};

export type ChatSurfaceLogger = (delivery: ISurfaceDelivery) => void;

export interface IChatSurfacePluginOptions {
  /** Where autonomous cards are written. When absent, plugin is trace-only. */
  readonly autonomyLog?: IAutonomyLogAppender;
  /** Optional resolver — stamped onto the entry for attribution. */
  readonly getActiveSessionId?: () => string | undefined;
  /** Trace logger. Runs alongside log append. Never throws. */
  readonly logger?: ChatSurfaceLogger;
}

function deliveryToMarkdown(delivery: ISurfaceDelivery): string {
  const c = delivery.content;
  if (typeof c === 'string') return c;
  if (c == null) return '';
  try { return '```json\n' + JSON.stringify(c, null, 2) + '\n```'; }
  catch { return String(c); }
}

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
  if (origin === 'subagent') return '[subagent]';
  return `[${origin}]`;
}

function byteLengthOf(content: unknown): number {
  if (typeof content === 'string') return content.length;
  try { return JSON.stringify(content).length; } catch { return 0; }
}

export class ChatSurfacePlugin implements ISurfacePlugin {
  readonly id = SURFACE_CHAT;
  readonly capabilities = CAPABILITIES;

  private readonly _autonomyLog?: IAutonomyLogAppender;
  private readonly _getActiveSessionId?: () => string | undefined;
  private readonly _logger?: ChatSurfaceLogger;

  constructor(options?: IChatSurfacePluginOptions | ChatSurfaceLogger) {
    if (typeof options === 'function') {
      this._logger = options;
      return;
    }
    this._autonomyLog = options?.autonomyLog;
    this._getActiveSessionId = options?.getActiveSessionId;
    this._logger = options?.logger;
  }

  isAvailable(): boolean { return true; }

  async deliver(delivery: ISurfaceDelivery): Promise<boolean> {
    // Trace first so observability never depends on append succeeding.
    if (this._logger) {
      try { this._logger(delivery); } catch { /* swallow */ }
    }

    if (!this._autonomyLog) {
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

    const content = deliveryToMarkdown(delivery);
    if (!content) {
      console.debug('[ChatSurface] empty delivery content; skipping log append', delivery.id);
      return true;
    }

    const origin = resolveOrigin(delivery);
    const requestText = buildRequestText(origin, delivery);
    const sessionId = this._getActiveSessionId?.();

    this._autonomyLog.append({
      origin,
      requestText,
      content,
      metadata: delivery.metadata as Record<string, unknown> | undefined,
      sessionId,
    });
    return true;
  }

  dispose(): void { /* no owned resources */ }
}
