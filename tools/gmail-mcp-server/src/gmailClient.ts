// gmailClient.ts — Minimal Gmail REST client.
//
// Scope minimization (M60 §9.5): read-only. We hit only the
// `users.messages.list` and `users.messages.get` endpoints under
// `https://gmail.googleapis.com/gmail/v1/`. No write operations.
//
// Network egress allowlist: gmail.googleapis.com only. No third-party
// code paths reach the network from this module.
//
// Privacy (§3.9): we expose snippet + headers (from/subject) to the
// caller. We never retain or log message bodies. Subject lines are
// metadata in Gmail's data model and are returned to the agent so it
// can route / digest.

import type { UnreadMessage } from './types.js';

const GMAIL_API_HOST = 'gmail.googleapis.com';
const GMAIL_API_BASE = `https://${GMAIL_API_HOST}/gmail/v1`;

export interface GmailListOptions {
  /** Max results to ask Gmail for. Capped at 100. */
  max: number;
  /** Optional search query. */
  query?: string;
  /** ISO 8601 — only mail after this time. */
  since?: string;
  /**
   * Read-state filter (M63 P0). `'unread'` is the default; matches the
   * legacy `is:unread` query.
   */
  readState?: 'unread' | 'read' | 'all';
  /** Include decoded text/plain body (M63 P0b). Default false. */
  includeBody?: boolean;
}

export class GmailClient {
  constructor(private readonly accessToken: string) {
    if (!accessToken) {
      throw new Error('GmailClient: accessToken is required');
    }
  }

  /**
   * List unread messages. Combines `is:unread` with optional caller
   * query and `since` filter. Returns hydrated message metadata.
   */
  async listUnread(opts: GmailListOptions): Promise<UnreadMessage[]> {
    const max = Math.max(1, Math.min(100, Math.floor(opts.max)));
    const queryParts: string[] = [];
    const readState = opts.readState ?? 'unread';
    if (readState === 'unread') queryParts.push('is:unread');
    else if (readState === 'read') queryParts.push('-is:unread');
    // 'all' contributes no read-state constraint.
    if (opts.query) queryParts.push(`(${opts.query})`);
    if (opts.since) {
      // Gmail accepts `after:<unix-seconds>`.
      const epoch = Math.floor(new Date(opts.since).getTime() / 1000);
      if (Number.isFinite(epoch)) queryParts.push(`after:${epoch}`);
    }
    const q = queryParts.join(' ').trim();

    const listUrl = new URL(`${GMAIL_API_BASE}/users/me/messages`);
    if (q) listUrl.searchParams.set('q', q);
    listUrl.searchParams.set('maxResults', String(max));

    const listRes = await this.fetchAuthorized(listUrl.toString());
    const listJson = (await listRes.json()) as {
      messages?: Array<{ id: string }>;
    };
    const ids = (listJson.messages ?? []).map((m) => m.id).slice(0, max);
    if (ids.length === 0) return [];

    // Hydrate each message with metadata format (headers + snippet only).
    // Bounded concurrency: firing all ids in parallel via Promise.all
    // saturates undici's connection pool and triggers UND_ERR_CONNECT_TIMEOUT
    // on larger batches (e.g. max=100). 6 in flight is a safe ceiling.
    const CONCURRENCY = 6;
    const includeBody = opts.includeBody === true;
    const hydrated: Array<UnreadMessage | null> = new Array(ids.length);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(CONCURRENCY, ids.length) }, async () => {
      while (true) {
        const i = cursor++;
        if (i >= ids.length) return;
        hydrated[i] = await this.getMessageMetadata(ids[i], includeBody);
      }
    });
    await Promise.all(workers);
    const messages = hydrated.filter((m): m is UnreadMessage => m !== null);
    // Sort oldest-first so callers can process chronologically (M63 P0).
    messages.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
    return messages;
  }

  private async getMessageMetadata(id: string, includeBody = false): Promise<UnreadMessage | null> {
    const url = new URL(`${GMAIL_API_BASE}/users/me/messages/${encodeURIComponent(id)}`);
    if (includeBody) {
      url.searchParams.set('format', 'full');
    } else {
      url.searchParams.set('format', 'metadata');
      url.searchParams.append('metadataHeaders', 'From');
      url.searchParams.append('metadataHeaders', 'Subject');
    }

    const res = await this.fetchAuthorized(url.toString());
    type GmailPart = {
      mimeType?: string;
      filename?: string;
      body?: { data?: string; size?: number };
      parts?: GmailPart[];
      headers?: Array<{ name: string; value: string }>;
    };
    const json = (await res.json()) as {
      id?: string;
      threadId?: string;
      snippet?: string;
      internalDate?: string;
      labelIds?: string[];
      payload?: GmailPart;
    };
    if (!json.id) return null;

    const headers = json.payload?.headers ?? [];
    const findHeader = (name: string): string => {
      const h = headers.find((x) => x.name.toLowerCase() === name.toLowerCase());
      return h?.value ?? '';
    };
    const fromRaw = findHeader('From');
    const subject = findHeader('Subject');

    const internalDateMs = Number(json.internalDate ?? '0');
    const receivedAt = Number.isFinite(internalDateMs) && internalDateMs > 0
      ? new Date(internalDateMs).toISOString()
      : new Date(0).toISOString();

    let body: string | undefined;
    if (includeBody && json.payload) {
      body = extractPlainBody(json.payload);
    }

    return {
      id: json.id,
      threadId: json.threadId ?? '',
      from: fromRaw,
      subject,
      snippet: json.snippet ?? '',
      receivedAt,
      labels: Object.freeze([...(json.labelIds ?? [])]),
      ...(body !== undefined ? { body } : {}),
    };
  }

  private async fetchAuthorized(url: string): Promise<Response> {
    // Defense in depth: refuse non-Gmail hosts even if a caller crafts
    // a relative URL upstream.
    const parsed = new URL(url);
    if (parsed.host !== GMAIL_API_HOST) {
      throw new Error(`GmailClient: refused egress to non-Gmail host: ${parsed.host}`);
    }
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        Accept: 'application/json',
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Gmail API error ${res.status}: ${body.slice(0, 256)}`);
    }
    return res;
  }
}

// ── Body extraction (M63 P0b) ─────────────────────────────────────────
//
// Walk the Gmail payload tree to find the first text/plain part. Fall back
// to text/html stripped of tags if no plain part exists. Output truncated
// to 8 KB so a single email never blows up downstream prompts.

const MAX_BODY_BYTES = 8 * 1024;

interface GmailPartLike {
  mimeType?: string;
  filename?: string;
  body?: { data?: string; size?: number };
  parts?: GmailPartLike[];
}

function decodeBase64Url(data: string): string {
  // Gmail uses URL-safe base64 without padding. Buffer handles base64url natively in Node 16+.
  try {
    return Buffer.from(data, 'base64url').toString('utf8');
  } catch {
    // Older runtimes: pad and translate manually.
    const std = data.replace(/-/g, '+').replace(/_/g, '/');
    const pad = std.length % 4 === 0 ? '' : '='.repeat(4 - (std.length % 4));
    try { return Buffer.from(std + pad, 'base64').toString('utf8'); } catch { return ''; }
  }
}

function findPart(part: GmailPartLike | undefined, mime: string): string | undefined {
  if (!part) return undefined;
  if (part.mimeType === mime && part.body?.data && !part.filename) {
    return decodeBase64Url(part.body.data);
  }
  if (Array.isArray(part.parts)) {
    for (const child of part.parts) {
      const found = findPart(child, mime);
      if (found) return found;
    }
  }
  return undefined;
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function extractPlainBody(payload: GmailPartLike): string {
  let text = findPart(payload, 'text/plain');
  if (!text) {
    const html = findPart(payload, 'text/html');
    if (html) text = stripHtml(html);
  }
  if (!text) return '';
  // Byte-truncate (not char-truncate) so we honor the 8 KB ceiling deterministically.
  const buf = Buffer.from(text, 'utf8');
  if (buf.byteLength <= MAX_BODY_BYTES) return text;
  return buf.subarray(0, MAX_BODY_BYTES).toString('utf8');
}
