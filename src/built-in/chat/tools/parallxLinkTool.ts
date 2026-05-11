// parallxLinkTool.ts — M66 §4a — `parallx_link` chat tool.
//
// The system prompt's `## Linking` section lists every registered
// `parallx://` template; this tool is the safe minter the AI calls when it
// wants to cite one. It validates that:
//   1. The target parses as a `parallx://` URI.
//   2. The segment is registered by some extension (per
//      `LinkResolverService.allContracts()`).
//   3. The optional `anchor` query-string is well-formed.
//
// It does NOT open the target — opening is a renderer/click-time concern.
// The returned `{ uri }` is what the AI should embed in a markdown link.
//
// Strict M66 §6 guardrail: the tool MUST NOT contain any per-extension
// branches. Segment validity is decided entirely by the contract list
// passed in at construction time.

import type {
  IChatTool,
  ICancellationToken,
  IToolResult,
} from '../../../services/chatTypes.js';
import { parseParallxUri } from '../../../links/parallxUri.js';

/**
 * Lightweight view of the contract list this tool needs. Matches the
 * descriptor shape used by the system prompt builder — same getter can
 * feed both.
 */
export interface IParallxLinkToolContractView {
  readonly segment: string;
  readonly displayName: string;
  readonly kinds: readonly { readonly kind: string; readonly uriTemplate: string }[];
}

export type LinkContractSnapshot = () => readonly IParallxLinkToolContractView[];

function failure(message: string): IToolResult {
  return {
    content: JSON.stringify({ ok: false, error: message }),
    isError: true,
  };
}

function readString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/**
 * Build the tool. When `getContracts` returns an empty list, the tool still
 * registers but every call fails fast — the prompt section is also skipped
 * in that case, so the AI never sees the tool in the catalog with no
 * usable templates.
 */
export function createParallxLinkTool(getContracts: LinkContractSnapshot): IChatTool {
  return {
    name: 'parallx_link',
    displaySummary: 'Mint a validated parallx:// citation URI.',
    description:
      'Mint a `parallx://` URI for a Parallx resource (canvas page, file, ' +
      'pdf, media, budget item, graph node, web research result, chat ' +
      'session). The `target` argument must already be a parallx:// URI ' +
      'built from one of the templates in the ## Linking section of the ' +
      'system prompt — this tool validates it but does not construct one ' +
      'from scratch. Use the optional `anchor` argument to deep-link into ' +
      'the target (e.g. "page=3&quote=foo" for a pdf, "line=42" for a ' +
      'file, "block=<blockId>" for a canvas page, "t=42" for a video). ' +
      'Returns the validated URI plus the contract segment that owns it.',
    parameters: {
      type: 'object',
      required: ['target'],
      properties: {
        target: {
          type: 'string',
          description: 'A `parallx://<segment>/<kind>/<id>` URI matching one of the templates in the ## Linking section.',
        },
        anchor: {
          type: 'string',
          description: 'Optional deep-link query string appended to the URI (without leading `?`). Example: "page=3&quote=foo".',
        },
        note: {
          type: 'string',
          description: 'Optional one-line label/note describing what the link cites. Surfaced back to the caller for use as link text.',
        },
      },
    },
    requiresConfirmation: false,
    permissionLevel: 'always-allowed',
    source: 'built-in',
    handler: async (args: Record<string, unknown>, _token: ICancellationToken): Promise<IToolResult> => {
      const target = readString(args.target);
      if (!target) return failure('Missing required argument: target');
      const anchor = readString(args.anchor);
      const note = readString(args.note);

      const parsed = parseParallxUri(target);
      if (!parsed) {
        return failure('target is not a valid parallx:// URI');
      }

      const contracts = getContracts();
      const contract = contracts.find(c => c.segment === parsed.segment);
      if (!contract) {
        const known = contracts.map(c => c.segment).join(', ') || '(none registered)';
        return failure(`Unknown segment "${parsed.segment}". Registered segments: ${known}.`);
      }

      // Append anchor if supplied. Reject if caller already encoded a `?`
      // — anchor is meant to be a query string fragment.
      let finalUri = target;
      if (anchor) {
        if (anchor.startsWith('?') || anchor.startsWith('&')) {
          return failure('anchor must not start with `?` or `&` — pass the query string only.');
        }
        const sep = target.includes('?') ? '&' : '?';
        finalUri = `${target}${sep}${anchor}`;
      }

      return {
        content: JSON.stringify({
          ok: true,
          uri: finalUri,
          segment: parsed.segment,
          displayName: contract.displayName,
          note,
        }),
      };
    },
  };
}
