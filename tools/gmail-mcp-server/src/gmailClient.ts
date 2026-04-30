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
    const queryParts: string[] = ['is:unread'];
    if (opts.query) queryParts.push(`(${opts.query})`);
    if (opts.since) {
      // Gmail accepts `after:<unix-seconds>`.
      const epoch = Math.floor(new Date(opts.since).getTime() / 1000);
      if (Number.isFinite(epoch)) queryParts.push(`after:${epoch}`);
    }
    const q = queryParts.join(' ');

    const listUrl = new URL(`${GMAIL_API_BASE}/users/me/messages`);
    listUrl.searchParams.set('q', q);
    listUrl.searchParams.set('maxResults', String(max));

    const listRes = await this.fetchAuthorized(listUrl.toString());
    const listJson = (await listRes.json()) as {
      messages?: Array<{ id: string }>;
    };
    const ids = (listJson.messages ?? []).map((m) => m.id).slice(0, max);
    if (ids.length === 0) return [];

    // Hydrate each message with metadata format (headers + snippet only).
    const hydrated = await Promise.all(ids.map((id) => this.getMessageMetadata(id)));
    return hydrated.filter((m): m is UnreadMessage => m !== null);
  }

  private async getMessageMetadata(id: string): Promise<UnreadMessage | null> {
    const url = new URL(`${GMAIL_API_BASE}/users/me/messages/${encodeURIComponent(id)}`);
    url.searchParams.set('format', 'metadata');
    url.searchParams.append('metadataHeaders', 'From');
    url.searchParams.append('metadataHeaders', 'Subject');

    const res = await this.fetchAuthorized(url.toString());
    const json = (await res.json()) as {
      id?: string;
      snippet?: string;
      internalDate?: string;
      labelIds?: string[];
      payload?: { headers?: Array<{ name: string; value: string }> };
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

    return {
      id: json.id,
      from: fromRaw,
      subject,
      snippet: json.snippet ?? '',
      receivedAt,
      labels: Object.freeze([...(json.labelIds ?? [])]),
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
