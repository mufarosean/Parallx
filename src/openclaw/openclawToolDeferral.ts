// openclawToolDeferral.ts — tools loaded when the model needs them.
//
// Every tool's full schema used to ride on every model call: 61 tools and
// about 15,000 tokens with the default tools on, about 25,000 with every
// tool on. A local model pays for that on each request, and picks worse from
// a long menu. Claude Code's answer, here too: a few tools are always loaded
// (a tool says so with `alwaysLoad`); the rest are named in one short
// catalog on a `tool_search` tool, and their schemas join the request once
// the model asks for them. What a chat has loaded stays loaded, so the
// request settles after the first load and the model server's cache holds.
//
// Nothing is deferred while the whole list is small, and dispatch still
// accepts any offered tool: a model that calls a deferred tool by name with
// valid arguments is not turned away (the call loads it).

import type { IToolDefinition } from '../services/chatTypes.js';

export const TOOL_SEARCH_NAME = 'tool_search';

/** Below this many (estimated) tokens of tool schemas, everything is sent. */
export const DEFER_ABOVE_TOKENS = 6_000;
/** At most this many tools come back from one search. */
const MAX_RESULTS = 5;
/** Sessions whose loaded tools are remembered (oldest forgotten first). */
const MAX_SESSIONS = 200;

/** The estimate the context budget uses elsewhere: characters / 3.6. */
export function toolTokens(defs: readonly IToolDefinition[]): number {
  let chars = 0;
  for (const d of defs) chars += d.name.length + d.description.length + JSON.stringify(d.parameters ?? {}).length + 40;
  return Math.round(chars / 3.6);
}

const loadedBySession = new Map<string, Set<string>>();

/** What a chat has loaded so far (kept for later turns of the same chat). */
export function loadedTools(sessionId: string | undefined): Set<string> {
  const key = sessionId ?? '';
  let set = loadedBySession.get(key);
  if (set) { loadedBySession.delete(key); loadedBySession.set(key, set); return set; }
  set = new Set();
  loadedBySession.set(key, set);
  if (loadedBySession.size > MAX_SESSIONS) loadedBySession.delete(loadedBySession.keys().next().value as string);
  return set;
}

export interface IToolSurface {
  /** What this model call carries, in the offered order, `tool_search` last. */
  readonly send: readonly IToolDefinition[];
  /** Offered but not yet loaded: named in the catalog only. */
  readonly deferred: readonly IToolDefinition[];
}

/** Whether some of these tools wait behind `tool_search` (fixed for a tool list, whatever the chat has loaded). */
export function defersTools(available: readonly IToolDefinition[], enabled = true): boolean {
  return enabled && available.some((d) => !d.alwaysLoad) && toolTokens(available) > DEFER_ABOVE_TOKENS;
}

/**
 * Which tools this model call carries. Everything, when the list is small or
 * deferral is off; otherwise the always-loaded ones, those the chat has
 * loaded, and `tool_search` naming the rest.
 */
export function planToolSurface(available: readonly IToolDefinition[], loaded: ReadonlySet<string>, enabled = true): IToolSurface {
  if (!defersTools(available, enabled)) return { send: available, deferred: [] };
  const send: IToolDefinition[] = [];
  const deferred: IToolDefinition[] = [];
  for (const d of available) (d.alwaysLoad || loaded.has(d.name) ? send : deferred).push(d);
  if (deferred.length === 0) return { send, deferred };
  return { send: [...send, buildToolSearchDefinition(deferred)], deferred };
}

/** One line for the catalog: the tool's own short summary, or its first sentence. */
export function catalogLine(d: IToolDefinition): string {
  const text = (d.displaySummary ?? d.description).replace(/\s+/g, ' ').trim();
  const first = /^(.{8,140}?[.!?])(\s|$)/.exec(text)?.[1] ?? text;
  return `${d.name}: ${first.length > 140 ? `${first.slice(0, 137)}...` : first}`;
}

export function buildToolSearchDefinition(deferred: readonly IToolDefinition[]): IToolDefinition {
  return {
    name: TOOL_SEARCH_NAME,
    description: [
      'Load more tools. These tools exist but are not loaded yet; call tool_search with their names (or describe what you need) and they become callable on your next step, with their full instructions.',
      'Load a tool before you say you cannot do something.',
      '',
      ...deferred.map(catalogLine),
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        names: { type: 'array', items: { type: 'string' }, description: 'Exact tool names from the list to load.' },
        query: { type: 'string', description: 'What you need to do, in a few words, when you do not know the name.' },
      },
    },
    alwaysLoad: true,
  };
}

// Words of a name or text: captureEvent and capture_event both give capture, event.
const words = (s: string): string[] => s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);

/**
 * Run a `tool_search` call: the named tools, or the best matches for the
 * query by the words of their names and descriptions. The result says what
 * loaded and what each does; the schemas ride on the next request.
 */
export function runToolSearch(args: Record<string, unknown>, deferred: readonly IToolDefinition[], loaded: Set<string>): { content: string; loaded: string[] } {
  const byName = new Map(deferred.map((d) => [d.name.toLowerCase(), d]));
  const names = Array.isArray(args.names) ? args.names.filter((n): n is string => typeof n === 'string') : [];
  const picked: IToolDefinition[] = [];
  const unknown: string[] = [];
  for (const n of names) {
    const d = byName.get(n.trim().toLowerCase());
    if (d) { if (!picked.includes(d)) picked.push(d); } else if (!loaded.has(n.trim())) unknown.push(n);
  }
  const query = typeof args.query === 'string' ? args.query : '';
  if (query.trim()) {
    const q = new Set(words(query));
    const scored = deferred
      .filter((d) => !picked.includes(d))
      .map((d) => {
        const nameWords = words(d.name);
        let score = 0;
        for (const w of nameWords) if (q.has(w)) score += 3;
        for (const w of new Set(words(`${d.displaySummary ?? ''} ${d.description}`))) if (q.has(w)) score += 1;
        return { d, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    for (const { d } of scored) { if (picked.length >= MAX_RESULTS) break; picked.push(d); }
  }
  for (const d of picked) loaded.add(d.name);
  const lines: string[] = [];
  if (picked.length) {
    lines.push(`Loaded ${picked.length} tool${picked.length === 1 ? '' : 's'}; call ${picked.length === 1 ? 'it' : 'them'} directly now:`);
    for (const d of picked) lines.push(`- ${catalogLine(d)}`);
  } else {
    lines.push('No tool matched. Use a name from the tool_search list, or describe the action differently.');
  }
  if (unknown.length) lines.push(`Not found: ${unknown.join(', ')}.`);
  return { content: lines.join('\n'), loaded: picked.map((d) => d.name) };
}
