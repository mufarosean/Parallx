// surfaceTools.ts — `surface_send` + `surface_list` chat tools (M58 W6)
//
// Upstream parity:
//   - message-tool (src/tools/message-tool) — "send content to a named
//     channel"; `surface_list` maps to the upstream channel-registry view
//   - (github.com/openclaw/openclaw)
//
// Parallx adaptation:
//   - Tools operate over the workbench-owned ISurfaceRouterService
//   - Approval posture is conservative: `surface_send` is
//     `requires-approval` uniformly this milestone (M58 plan §5 W6.6).
//     Per-surface free list (chat/notifications/status) is scheduled for
//     M59 once the AI-settings permission-map editor can expose it.
//   - Every tool-initiated send is stamped with `origin: 'agent'` so the
//     feedback-loop guard can identify agent-authored writes (the W2
//     heartbeat will consult the same tag when it comes online).

import type {
  IChatTool,
  ICancellationToken,
  IToolResult,
} from '../../../services/chatTypes.js';
import type { ISurfaceRouterService } from '../../../services/surfaceRouterService.js';
import { ORIGIN_AGENT } from '../../../services/surfaceRouterService.js';
import type { SurfaceContentType } from '../../../openclaw/openclawSurfacePlugin.js';
import { surfaceSendRequiresApproval } from '../../../openclaw/openclawToolPolicy.js';

const VALID_CONTENT_TYPES: readonly SurfaceContentType[] = [
  'text',
  'structured',
  'binary',
  'action',
];

// ---------------------------------------------------------------------------
// surface_send
// ---------------------------------------------------------------------------

export function createSurfaceSendTool(
  router: ISurfaceRouterService | undefined,
): IChatTool {
  return {
    name: 'surface_send',
    description:
      'Send content to a named output surface (chat, canvas, filesystem, ' +
      'notifications, status). Writes to filesystem or canvas require user ' +
      'approval.',
    parameters: {
      type: 'object',
      required: ['surfaceId', 'content'],
      properties: {
        surfaceId: {
          type: 'string',
          description: 'Target surface id (e.g. "notifications", "status").',
        },
        contentType: {
          type: 'string',
          enum: ['text', 'structured', 'binary', 'action'],
          description: 'Content type (default: "text").',
        },
        content: {
          description: 'The content to deliver. Strings for "text", any JSON value for "structured".',
        },
        metadata: {
          type: 'object',
          description: 'Optional surface-specific metadata (e.g. path for filesystem, severity for notifications).',
        },
      },
    },
    // Permission posture: uniform requires-approval in M58. Per-surface
    // loosening (chat/notifications/status free) scheduled for M59.
    requiresConfirmation: true,
    permissionLevel: 'requires-approval',
    source: 'built-in',
    handler: async (args: Record<string, unknown>, _token: ICancellationToken): Promise<IToolResult> => {
      if (!router) {
        return failure('Surface router service not available');
      }
      const surfaceId = readString(args.surfaceId);
      if (!surfaceId) return failure('Missing required argument: surfaceId');
      const contentType = readContentType(args.contentType) ?? 'text';
      if (args.content === undefined) return failure('Missing required argument: content');
      const metadata = readMetadata(args.metadata);

      // Surface-specific approval marker (documentation-only in M58 — the
      // tool-level `requires-approval` already gates every call).
      const approvalNeeded = surfaceSendRequiresApproval(surfaceId);

      const result = await router.sendWithOrigin(
        { surfaceId, contentType, content: args.content, metadata },
        ORIGIN_AGENT,
      );

      if (result.status === 'delivered') {
        return {
          content: JSON.stringify({
            ok: true,
            deliveryId: result.deliveryId,
            surfaceId: result.surfaceId,
            approvalRequiredForSurface: approvalNeeded,
          }),
        };
      }
      return failure(result.error ?? 'Delivery failed');
    },
  };
}

// ---------------------------------------------------------------------------
// surface_list
// ---------------------------------------------------------------------------

export function createSurfaceListTool(
  router: ISurfaceRouterService | undefined,
): IChatTool {
  return {
    name: 'surface_list',
    description: 'List all registered output surfaces and their capabilities. Read-only.',
    parameters: {
      type: 'object',
      properties: {},
    },
    requiresConfirmation: false,
    permissionLevel: 'always-allowed',
    source: 'built-in',
    handler: async (_args, _token): Promise<IToolResult> => {
      if (!router) {
        return failure('Surface router service not available');
      }
      const surfaces = router.surfaceIds.map((id) => {
        const plugin = router.getSurface(id);
        return {
          id,
          available: plugin?.isAvailable() ?? false,
          capabilities: plugin?.capabilities,
          requiresApproval: surfaceSendRequiresApproval(id),
        };
      });
      return { content: JSON.stringify({ ok: true, surfaces }) };
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function readContentType(v: unknown): SurfaceContentType | undefined {
  if (typeof v !== 'string') return undefined;
  return (VALID_CONTENT_TYPES as readonly string[]).includes(v)
    ? (v as SurfaceContentType)
    : undefined;
}

function readMetadata(v: unknown): Record<string, unknown> | undefined {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return undefined;
}

function failure(message: string): IToolResult {
  return {
    content: JSON.stringify({ ok: false, error: message }),
    isError: true,
  };
}
