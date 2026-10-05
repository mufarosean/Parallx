// parallxLinkTool.ts — M66 §4a — `link_create` chat tool.
//
// The system prompt's `## Linking` section lists every registered
// `parallx://` template; this tool is how the AI makes a citation link. It:
//   1. Parses the target as a `parallx://` URI and adds any `params` /
//      `anchor` query parameters (encoded here, so the AI never encodes).
//   2. Checks the segment is registered (`LinkResolverService.allContracts()`).
//   3. Asks the link's own kind to check it (`LinkResolverService.verify`
//      with `thorough`): the target exists, and anchors such as a quote are
//      found in it. The kind returns the canonical link and where it lands.
//
// "ok: true" therefore means the target was checked, and the result says in
// one sentence what was checked. A kind that cannot check its targets says
// so; the tool never claims more than the kind confirmed.
//
// It does NOT open the target — opening is a click-time concern.
//
// Strict M66 §6 guardrail: the tool MUST NOT contain any per-extension
// branches. Segment validity comes from the contract list, and checking is
// the contract's own `verify`.

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

/** What checking a link found (the shape of `LinkResolverService.verify`). */
export type LinkToolCheck =
  | { readonly ok: true; readonly uri: string; readonly checked: string; readonly location?: string }
  | { readonly ok: false; readonly error: string };

/** Thorough check of a link by its own kind. */
export type LinkVerifier = (uri: string) => Promise<LinkToolCheck>;

function failure(message: string): IToolResult {
  return {
    content: JSON.stringify({ ok: false, error: message }),
    isError: true,
  };
}

function readString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** Query parameters given as an object: string, number or boolean values only. */
function readParams(v: unknown): Record<string, string> | string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'object' || Array.isArray(v)) return 'params must be an object of query parameters, e.g. {"path": "Papers/Clark.pdf", "quote": "…"}.';
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (val === undefined || val === null || val === '') continue;
    if (typeof val !== 'string' && typeof val !== 'number' && typeof val !== 'boolean') {
      return `params.${k} must be a string or number.`;
    }
    out[k] = String(val);
  }
  return out;
}

/**
 * Build the tool. When `getContracts` returns an empty list, the tool still
 * registers but every call fails fast — the prompt section is also skipped
 * in that case, so the AI never sees the tool in the catalog with no
 * usable templates. Without `verify`, links are checked for shape only and
 * the result says so.
 */
export function createParallxLinkTool(getContracts: LinkContractSnapshot, verify?: LinkVerifier): IChatTool {
  return {
    name: 'link_create',
    displaySummary: 'Make a checked parallx:// citation link.',
    description:
      'Make a citation link and check it. target follows a template from the ## Linking section; put query parameters in params (values are encoded for you). ' +
      'The link\'s target is checked: ok:true comes with `checked` (what was confirmed) and `location` (where it lands, e.g. "page 13 of 30"); use the returned uri and cite that location. ' +
      'ok:false means the link would not work: fix it or say the source could not be linked.',
    parameters: {
      type: 'object',
      required: ['target'],
      properties: {
        target: {
          type: 'string',
          description: 'parallx:// URI from a ## Linking template, e.g. parallx://explorer/file. Parameters may be in it or in params.',
        },
        params: {
          type: 'object',
          description: 'Query parameters as an object, e.g. {"path": "Papers/Clark.pdf", "quote": "the exact words"}. Encoded for you; they override the same names in target.',
        },
        anchor: {
          type: 'string',
          description: 'Deep-link query string (no leading ?). Prefer params.',
        },
        note: {
          type: 'string',
          description: 'Optional one-line label/note describing what the link cites. Surfaced back to the caller for use as link text.',
        },
      },
    },
    requiresConfirmation: false,
    permissionLevel: 'always-allowed',
    category: 'linking',
    source: 'built-in',
    handler: async (args: Record<string, unknown>, _token: ICancellationToken): Promise<IToolResult> => {
      const target = readString(args.target);
      if (!target) return failure('Missing required argument: target');
      const anchor = readString(args.anchor);
      const note = readString(args.note);
      const params = readParams(args.params);
      if (typeof params === 'string') return failure(params);

      if (anchor && (anchor.startsWith('?') || anchor.startsWith('&'))) {
        return failure('anchor must not start with `?` or `&` — pass the query string only.');
      }

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

      // One URI from target + anchor + params, encoded here.
      let uri: string;
      try {
        const url = new URL(target.trim());
        if (anchor) {
          new URLSearchParams(anchor).forEach((v, k) => url.searchParams.set(k, v));
        }
        for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v);
        uri = url.toString();
      } catch {
        return failure('target is not a valid parallx:// URI');
      }

      if (!verify) {
        return {
          content: JSON.stringify({
            ok: true,
            uri,
            segment: parsed.segment,
            displayName: contract.displayName,
            checked: 'The link is well formed; its target was not checked.',
            note,
          }),
        };
      }

      const check = await verify(uri);
      if (!check.ok) return failure(check.error);
      return {
        content: JSON.stringify({
          ok: true,
          uri: check.uri,
          segment: parsed.segment,
          displayName: contract.displayName,
          checked: check.checked,
          ...(check.location ? { location: check.location } : {}),
          note,
        }),
      };
    },
  };
}
