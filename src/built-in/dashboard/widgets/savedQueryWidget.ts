// savedQueryWidget.ts — a pinned question over the workspace (M86 C3).
//
// The water-leak loop, made persistent: organize information into a
// workspace, then keep the answer to a standing question on the dashboard.
// Two modes:
//   - 'retrieval': hybrid search over the workspace index (vector + FTS).
//     No LLM, instant, free — the widget renders the top passages with
//     their sources. Great for "where is X" / "what do we have about Y".
//   - 'ai': a background agent turn researches the question with tools and
//     delivers a synthesized answer (dashboard_render_widget).
//
// renderMode 'markdown': the dashboard renders the output; this file has no
// DOM code. Instantiations: "who do I call for plumbing" over closing
// documents; "what's expiring in the next 30 days" over policy files;
// "summarize what I know about Clark" over study notes.

import type {
  WidgetRefreshContext,
  WidgetTypeRegistration,
} from '../dashboardTypes.js';
import { IRetrievalService } from '../../../services/serviceTypes.js';

interface SavedQueryConfig {
  readonly query: string;
  readonly mode: 'retrieval' | 'ai';
  readonly topK: number;
}

const DEFAULT_CONFIG: SavedQueryConfig = { query: '', mode: 'retrieval', topK: 5 };

const ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><path d="M11 8v3l2 2"/></svg>';

function normalize(raw: unknown): SavedQueryConfig {
  const cfg = (raw ?? {}) as Partial<SavedQueryConfig>;
  const topK = Math.floor(Number(cfg.topK));
  return {
    query: typeof cfg.query === 'string' ? cfg.query : '',
    mode: cfg.mode === 'ai' ? 'ai' : 'retrieval',
    topK: Number.isFinite(topK) ? Math.max(1, Math.min(15, topK)) : DEFAULT_CONFIG.topK,
  };
}

interface ServicesApi {
  services?: { get<T>(id: { readonly id: string }): T; has(id: { readonly id: string }): boolean };
  commands?: { executeCommand<T>(id: string, arg?: unknown): Promise<T> };
}

function buildAiPrompt(cfg: SavedQueryConfig, instanceId: string): string {
  return [
    `Answer this standing question from my workspace: ${cfg.query.trim()}`,
    '',
    'Use your workspace retrieval/search tools to ground the answer in my actual files and pages — cite where each fact came from. If the workspace has nothing relevant, say so plainly.',
    `Deliver the finished Markdown answer by calling the dashboard_render_widget tool with instanceId "${instanceId}". Keep it compact — this renders in a dashboard card.`,
  ].join('\n');
}

export const SAVED_QUERY_WIDGET: WidgetTypeRegistration<SavedQueryConfig> = {
  typeId: 'parallx.dashboard.saved-query',
  displayName: 'Saved query',
  description: 'A standing question over your workspace, kept answered. "Who do I call for plumbing" over home documents; "what expires soon" over policies; "what do my notes say about X".',
  icon: ICON_SVG,
  category: 'ai',
  renderMode: 'markdown',
  defaultSize: { colSpan: 5, rowSpan: 4 },
  defaultConfig: DEFAULT_CONFIG,
  configSchema: {
    fields: {
      query: {
        type: 'textarea',
        label: 'Question',
        description: 'What should stay answered on this dashboard?',
        placeholder: 'e.g. "Who do I call about plumbing issues?"',
      },
      mode: {
        type: 'enum',
        label: 'Mode',
        description: 'Retrieval shows the top matching passages instantly (no AI). AI has an agent research and synthesize an answer.',
        options: [
          { value: 'retrieval', label: 'Retrieval (instant, shows passages)' },
          { value: 'ai', label: 'AI (background agent, synthesized answer)' },
        ],
      },
      topK: {
        type: 'number',
        label: 'Passages to show (retrieval mode)',
        description: '1-15.',
      },
    },
  },
  defaultRefreshPolicy: { kind: 'manual' },

  async refresh(ctx: WidgetRefreshContext<SavedQueryConfig>): Promise<string | null> {
    const cfg = normalize(ctx.config);
    if (!cfg.query.trim()) {
      return '_No question set. Open this widget’s settings and write the question this card should keep answered._';
    }
    const api = ctx.api as ServicesApi;

    if (cfg.mode === 'ai') {
      if (!api.commands?.executeCommand) {
        throw new Error('Chat tool not available. Ensure the Chat extension is enabled.');
      }
      const prompt = buildAiPrompt(cfg, ctx.instanceId);
      if (ctx.mode !== 'chat') {
        const res = await api.commands.executeCommand<{ ok: boolean; error?: string }>(
          'chat.runBackgroundPrompt',
          { text: prompt, origin: 'dashboard', originLabel: `[dashboard · Saved query] ${cfg.query.slice(0, 60)}`, initiator: ctx.initiator },
        );
        if (!res?.ok) throw new Error(res?.error || 'Background refresh failed.');
        return null;
      }
      await api.commands.executeCommand('chat.submitPrompt', { text: prompt });
      return ctx.cachedOutput ?? '_Working on it… the answer will appear here when ready._';
    }

    // Retrieval mode — hybrid search over the workspace index, no LLM.
    if (!api.services?.has || !api.services.has(IRetrievalService)) {
      throw new Error('Workspace retrieval is not available (indexing may still be starting up).');
    }
    const retrieval = api.services.get<IRetrievalService>(IRetrievalService);
    const chunks = await retrieval.retrieve(cfg.query, { topK: cfg.topK });
    if (chunks.length === 0) {
      return `_Nothing in the workspace index matches “${cfg.query.trim()}” yet. Try rephrasing, or index more content._`;
    }
    const lines: string[] = [];
    for (const c of chunks.slice(0, cfg.topK)) {
      const source = (c.contextPrefix || c.sourceId || 'unknown source').trim();
      const text = c.text.trim().replace(/\s+/g, ' ');
      const excerpt = text.length > 320 ? `${text.slice(0, 320)}…` : text;
      lines.push(`- ${excerpt}\n  · _${source}_`);
    }
    return lines.join('\n');
  },
};
