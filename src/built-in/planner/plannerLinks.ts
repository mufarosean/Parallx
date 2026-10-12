// plannerLinks.ts — the links a task's or event's notes carry.
//
// Web links (http, https, www.) open the external browser; parallx:// links
// are the app's own and render as page chips. Pure.

/** Normalize a raw href to a safe http/https URL, or null if not web-openable. */
export function normalizeWebLink(rawHref: string): string | null {
  const trimmed = rawHref.trim();
  if (!trimmed) return null;
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed);
  const candidate = hasScheme ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Pull links out of free-form notes for the popover chip row.
 *  Recognizes internal `parallx://` URIs as well as web (http/https/www.)
 *  links. Internal links render as rich page chips; web links open the
 *  external browser. */
export function extractLinks(text: string): { label: string; href: string; kind: 'web' | 'internal' }[] {
  if (!text) return [];
  const out: { label: string; href: string; kind: 'web' | 'internal' }[] = [];
  const seen = new Set<string>();
  const re = /(?:parallx:\/\/[^\s<>]+|(?:https?:\/\/|www\.)[^\s<>()]+)/gi;
  for (const match of text.matchAll(re)) {
    const raw = match[0].replace(/[.,;:!?]+$/, '');
    if (/^parallx:\/\//i.test(raw)) {
      if (seen.has(raw)) continue;
      seen.add(raw);
      out.push({ label: raw, href: raw, kind: 'internal' });
      continue;
    }
    const url = normalizeWebLink(raw);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    let label = url;
    try { const u = new URL(url); label = u.hostname.replace(/^www\./, '') + (u.pathname !== '/' ? u.pathname : ''); } catch { /* keep url */ }
    if (label.length > 42) label = label.slice(0, 41) + '\u2026';
    out.push({ label, href: url, kind: 'web' });
  }
  return out;
}
