// customAiWidget.ts — a generic AI-backed widget.
//
// The user writes a free-form prompt ("brief me on my unread email", "give me
// a 3-bullet market snapshot", …) and a title via the appearance drawer. On
// refresh it routes that prompt through the active chat session using the same
// push model as the news brief: the AI does the work with its normal tools and
// delivers the finished Markdown back via the shared `renderToWidget` tool.
//
// One widget, any task — wire a cron policy and it becomes a self-updating
// panel for whatever the user can describe in a prompt.

import type {
  WidgetContext,
  WidgetHandle,
  WidgetRefreshContext,
  WidgetTypeRegistration,
} from '../dashboardTypes.js';
import { renderMarkdownToDom } from './markdownRenderer.js';

interface CustomAiConfig {
  readonly prompt: string;
  /**
   * Optional name of a skill (a `.parallx/skills/<name>/SKILL.md` the user
   * authored) that the AI should apply when filling this widget. This is the
   * "write a skill for a particular widget" affordance: the user packages all
   * the detailed, reusable guidance in a skill file, then points the widget at
   * it by name. Empty = no skill, just the raw prompt.
   */
  readonly skill: string;
}

const DEFAULT_CONFIG: CustomAiConfig = {
  prompt: '',
  skill: '',
};

const ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a3 3 0 0 0-3 3v.5A3 3 0 0 0 6 9v.5A3 3 0 0 0 4.5 12 3 3 0 0 0 6 14.5V15a3 3 0 0 0 3 3v.5a3 3 0 0 0 6 0V18a3 3 0 0 0 3-3v-.5A3 3 0 0 0 19.5 12 3 3 0 0 0 18 9.5V9a3 3 0 0 0-3-3v-.5A3 3 0 0 0 12 3z"/><path d="M12 3v18"/></svg>';

export const CUSTOM_AI_WIDGET: WidgetTypeRegistration<CustomAiConfig> = {
  typeId: 'parallx.dashboard.ai-custom',
  displayName: 'AI widget',
  description: 'Give the AI a prompt and it fills this widget with the result, rendered as Markdown. Set a title in the appearance menu; add a refresh schedule to keep it current.',
  icon: ICON_SVG,
  category: 'ai',
  defaultSize: { colSpan: 6, rowSpan: 4 },
  defaultConfig: DEFAULT_CONFIG,
  configSchema: {
    fields: {
      prompt: {
        type: 'textarea',
        label: 'Prompt',
        description: 'What should the AI gather or write? It runs in your active chat session with all its tools.',
        placeholder: 'e.g. "Summarize my unread email into a short bulleted list."',
      },
      skill: {
        type: 'string',
        label: 'Skill (optional)',
        description: 'Name of a skill you authored under .parallx/skills/. The AI applies it when filling this widget — write the skill once, reuse its full instructions here.',
        placeholder: 'e.g. morning-news',
      },
    },
  },
  defaultRefreshPolicy: { kind: 'manual' },

  async refresh(ctx: WidgetRefreshContext<CustomAiConfig>): Promise<string> {
    const api = ctx.api as { commands?: { executeCommand<T>(id: string, arg?: unknown): Promise<T> } };
    if (!api.commands?.executeCommand) {
      throw new Error('Chat tool not available. Ensure the Chat extension is enabled.');
    }
    const cfg = normalizeCustomAiConfig(ctx.config);
    if (!cfg.prompt.trim()) {
      return '_No prompt set. Open this widget\u2019s settings and describe what you want the AI to produce._';
    }

    // Push model: we don't compute anything here. We ask the active chat
    // session to do the work with its normal tools, then deliver the finished
    // Markdown back via the shared `renderToWidget` tool. It arrives
    // asynchronously and repaints the widget when it lands.
    const prompt = buildCustomAiPrompt(cfg, ctx.instanceId);
    await api.commands.executeCommand('chat.submitPrompt', { text: prompt });

    // Keep the last good output visible while the new one is produced — prepend
    // a subtle banner above it. renderToWidget overwrites the whole thing once
    // the fresh result lands, so a slow or failed turn never wipes good content.
    const prior = stripRefreshBanner((ctx.cachedOutput ?? '').trim());
    if (prior) return `_Refreshing\u2026_\n\n${prior}`;
    return '_Working on it\u2026 the result will appear here when ready._';
  },

  createWidget(container: HTMLElement, ctx: WidgetContext<CustomAiConfig>): WidgetHandle {
    container.classList.add('dashboard-md');

    const surface = document.createElement('div');
    surface.className = 'dashboard-md__surface';
    container.appendChild(surface);

    function paint(cached: string | null): void {
      surface.innerHTML = '';
      if (!cached) {
        const empty = document.createElement('div');
        empty.className = 'dashboard-md__empty';
        empty.innerHTML = `
          <strong>Nothing here yet</strong>
          <p>Open settings to write a prompt, then click the refresh icon above. The AI fills this widget with the result.</p>
        `;
        surface.appendChild(empty);
        return;
      }
      const body = document.createElement('div');
      body.className = 'dashboard-md__body';
      body.appendChild(renderMarkdownToDom(cached));
      surface.appendChild(body);
    }

    function paintError(message: string): void {
      surface.innerHTML = '';
      const err = document.createElement('div');
      err.className = 'dashboard-md__error';
      const title = document.createElement('strong');
      title.textContent = 'Couldn\u2019t generate this widget';
      const detail = document.createElement('p');
      detail.textContent = message;
      err.appendChild(title);
      err.appendChild(detail);
      surface.appendChild(err);
    }

    if (ctx.errorMessage && !ctx.cachedOutput) {
      paintError(ctx.errorMessage);
    } else {
      paint(ctx.cachedOutput);
    }

    const sub = ctx.onDidChangeConfig(() => {
      // Config changes only affect the next refresh — keep current render.
    });

    return {
      refreshFromCache(cached: string | null) { paint(cached); },
      renderError(message: string | null) {
        if (message) paintError(message);
        else paint(ctx.cachedOutput);
      },
      dispose() { sub.dispose(); },
    };
  },
};

export function normalizeCustomAiConfig(raw: unknown): CustomAiConfig {
  const cfg = (raw ?? {}) as Partial<CustomAiConfig>;
  return {
    prompt: typeof cfg.prompt === 'string' ? cfg.prompt : '',
    skill: typeof cfg.skill === 'string' ? cfg.skill : '',
  };
}

// Remove a leading "_Refreshing…_" / "_Working…_" banner left by a prior
// in-flight refresh, so banners never stack across repeated refreshes.
function stripRefreshBanner(text: string): string {
  return text.replace(/^_(?:Refreshing|Working)[^\n]*_\s*\n+/, '').trim();
}

export function buildCustomAiPrompt(cfg: CustomAiConfig, instanceId: string): string {
  const lines: string[] = [];
  const skill = cfg.skill.trim();
  if (skill) {
    lines.push(`Use the \`${skill}\` skill for this task.`, '');
  }
  lines.push(
    cfg.prompt.trim(),
    '',
    'Then deliver the result to my dashboard widget:',
    '- Format the result as clean Markdown (a short heading, then lists or short paragraphs). No preamble, no emojis. Use only information you can actually verify with your tools — never invent facts, numbers, or sources.',
    `- Call the renderToWidget tool with instanceId "${instanceId}" and the finished Markdown as content. This is how the result reaches the widget — do not skip it.`,
  );
  return lines.join('\n');
}
