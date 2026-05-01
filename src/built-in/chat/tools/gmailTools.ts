// gmailTools.ts — M60 §T6.F4
//
// Built-in chat tool: `gmail.list_unread`.
//
// Shape and contracts
// ───────────────────
//   • Returns metadata only (id, from, subject, snippet, receivedAt,
//     labels[]) — never message bodies.
//   • Permission: `requires-approval` (3-tier middle). The tool
//     requires user confirmation by default; users may relax via the
//     standard chat-tool permission UI.
//   • Rate cap: 60 calls / rolling hour (M60 §3.6 — "External API
//     calls / hour | 60 (Gmail) | Per MCP | MCP client policy").
//     Enforced in-process. A trip refuses with a structured error.
//   • MCP lifecycle: spawn-per-call. The session-scoped lifecycle
//     reuse is documented as a future optimization — chat tools are
//     stateless functions today and threading a long-lived MCP client
//     through `registerBuiltInTools` is out of scope for F4.
//   • Token discipline: caller passes a `getAccessToken()` callback
//     that resolves to a fresh access token. The tool never sees the
//     refresh token. Access tokens leave this module only as a
//     `GMAIL_ACCESS_TOKEN` env var to the spawned MCP child.
//   • Telemetry: the tool returns a `recordToolCall` shape consumed
//     by autonomy turn runners. Args digests use sha256 over a
//     canonicalized JSON form; bodies are never recorded.
//
// What this module does NOT do
// ────────────────────────────
//   • Manage OAuth state — that is `gmailOAuthService.ts`.
//   • Persist tokens — that is `secretStorageService.ts`.
//   • Decide UI affordance — chat surface owns confirmation UX.

import type {
  IChatTool,
  IToolResult,
  ICancellationToken,
  ToolPermissionLevel,
} from '../../../services/chatTypes.js';
import { canonicalArgsDigest, type IAutonomyToolCallRecord } from '../../../services/autonomyEventLog.js';

// ─── External shape ─────────────────────────────────────────────────

export interface IGmailMessageMetadata {
  readonly id: string;
  readonly from: string;
  readonly subject: string;
  readonly snippet: string;
  readonly receivedAt: string; // ISO-8601
  readonly labels: readonly string[];
}

/**
 * Calls into the gmail-mcp-server's `list_unread` tool.
 *
 * Implementations are responsible for spawning, sending the request,
 * and parsing/validating the response. Used as a seam so unit tests
 * can mock the entire MCP transport away.
 */
export type GmailMcpInvoker = (
  accessToken: string,
  args: { readonly maxResults?: number },
  signal?: AbortSignal,
) => Promise<{ readonly messages: readonly IGmailMessageMetadata[] }>;

/**
 * Resolve a fresh access token. Callers (chat host) typically wire
 * this to a small wrapper that reads the in-memory cache, refreshes
 * via `gmailOAuthService.refreshAccessToken` if expired, and returns
 * the bare access-token string. May reject when:
 *   - mcp.gmail.enabled is false → 'gmail-disabled'
 *   - no refresh token persisted → 'gmail-not-connected'
 *   - refresh failed → 'refresh-failed: <reason>'
 */
export type GmailAccessTokenProvider = () => Promise<string>;

// ─── Rate limiter (rolling hour) ─────────────────────────────────────

/**
 * Tiny rolling-hour counter. Not exported as a service — it lives
 * inside the tool factory closure so every Gmail call shares the same
 * window without depending on module-level state across reloads.
 *
 * @internal exported for tests only.
 */
export class _RollingHourLimiter {
  private readonly _timestamps: number[] = [];

  constructor(
    private readonly _capPerHour: number,
    private readonly _now: () => number = Date.now,
  ) {}

  /** Returns true if the call is admitted; trims old timestamps. */
  tryConsume(): boolean {
    const now = this._now();
    const cutoff = now - 3_600_000;
    while (this._timestamps.length > 0 && this._timestamps[0] < cutoff) {
      this._timestamps.shift();
    }
    if (this._timestamps.length >= this._capPerHour) return false;
    this._timestamps.push(now);
    return true;
  }

  /** Number of calls remaining in the current rolling hour. */
  remaining(): number {
    const now = this._now();
    const cutoff = now - 3_600_000;
    while (this._timestamps.length > 0 && this._timestamps[0] < cutoff) {
      this._timestamps.shift();
    }
    return Math.max(0, this._capPerHour - this._timestamps.length);
  }
}

// ─── Tool factory ────────────────────────────────────────────────────

export interface IGmailListUnreadDeps {
  /** Returns the tool to a no-op disabled state when undefined. */
  readonly invoker?: GmailMcpInvoker;
  readonly getAccessToken?: GmailAccessTokenProvider;
  /** Default cap: 60 calls/hour per M60 §3.6. */
  readonly callsPerHourCap?: number;
  /** Optional sink for autonomy tool-call records. Body is never recorded. */
  readonly recordToolCall?: (record: IAutonomyToolCallRecord) => void;
  /** Test seam. */
  readonly now?: () => number;
}

/**
 * Build the `gmail.list_unread` chat tool.
 *
 * Returns a fully-formed `IChatTool` ready for
 * `ILanguageModelToolsService.registerTool`.
 */
export function createGmailListUnreadTool(deps: IGmailListUnreadDeps = {}): IChatTool {
  const cap = deps.callsPerHourCap ?? 60;
  const limiter = new _RollingHourLimiter(cap, deps.now);

  return {
    name: 'gmail.list_unread',
    description:
      'List unread Gmail messages (metadata only — id, from, subject, snippet, receivedAt, labels). ' +
      'Never returns message bodies. Requires user approval. ' +
      'Rate-limited to 60 calls per rolling hour per M60 §3.6.',
    parameters: {
      type: 'object',
      properties: {
        maxResults: {
          type: 'number',
          description: 'Maximum messages to return (1-50, default 10).',
        },
      },
    },
    requiresConfirmation: true,
    permissionLevel: 'requires-approval' as ToolPermissionLevel,
    source: 'built-in',

    async handler(args: Record<string, unknown>, token: ICancellationToken): Promise<IToolResult> {
      const startedAt = (deps.now ?? Date.now)();
      const argsForDigest: Record<string, unknown> = {};
      if (typeof args['maxResults'] === 'number') argsForDigest['maxResults'] = args['maxResults'];
      const digest = await canonicalArgsDigest(argsForDigest);

      const emit = (durationMs: number, error?: string): void => {
        if (!deps.recordToolCall) return;
        deps.recordToolCall({
          name: 'gmail.list_unread',
          argsDigest: digest,
          durationMs,
          ...(error ? { error } : {}),
        });
      };

      // Dependency gates ────────────────────────────────────────────
      if (!deps.invoker || !deps.getAccessToken) {
        emit(0, 'gmail-not-configured');
        return { content: 'Gmail integration is not configured for this session.', isError: true };
      }

      // Rate limit ──────────────────────────────────────────────────
      if (!limiter.tryConsume()) {
        emit(0, 'rate-limited');
        return {
          content:
            `Gmail rate cap reached (${cap}/hour). ` +
            'Try again later. The cap protects shared API quota and resets on a rolling 60-minute window.',
          isError: true,
        };
      }

      // Argument validation ─────────────────────────────────────────
      let maxResults = 10;
      const rawMax = args['maxResults'];
      if (typeof rawMax === 'number' && Number.isFinite(rawMax)) {
        maxResults = Math.min(50, Math.max(1, Math.floor(rawMax)));
      }

      // Cancellation pre-check.
      if (token.isCancellationRequested) {
        emit((deps.now ?? Date.now)() - startedAt, 'cancelled');
        return { content: 'Request cancelled.', isError: true };
      }

      // Token + invoke ─────────────────────────────────────────────
      let accessToken: string;
      try {
        accessToken = await deps.getAccessToken();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        emit((deps.now ?? Date.now)() - startedAt, `auth: ${message}`);
        return { content: `Gmail authentication failed: ${message}`, isError: true };
      }

      const ac = new AbortController();
      const cancelSub = token.onCancellationRequested?.(() => ac.abort());

      try {
        const result = await deps.invoker(accessToken, { maxResults }, ac.signal);
        const messages = Array.isArray(result?.messages) ? result.messages : [];
        const lines: string[] = [];
        if (messages.length === 0) {
          lines.push('No unread messages.');
        } else {
          lines.push(`Unread messages (${messages.length}):`);
          for (const m of messages) {
            // Body fields like `body`, `bodyText`, etc. are deliberately
            // not formatted even if a future server included them. We
            // only render the documented metadata fields.
            lines.push(
              `- [${m.id}] ${m.subject} — from ${m.from} (${m.receivedAt})\n  ${m.snippet}`,
            );
          }
        }
        emit((deps.now ?? Date.now)() - startedAt);
        return { content: lines.join('\n') };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        emit((deps.now ?? Date.now)() - startedAt, message);
        return { content: `gmail.list_unread failed: ${message}`, isError: true };
      } finally {
        cancelSub?.dispose();
      }
    },
  };
}

// ─── Helpers exported for tests ──────────────────────────────────────

export const _internals = {
  RollingHourLimiter: _RollingHourLimiter,
};
