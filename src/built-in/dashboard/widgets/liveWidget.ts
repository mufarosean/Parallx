// liveWidget.ts — an AI-backed widget the model fills with live HTML.
//
// Where the Custom AI widget asks the model for Markdown, this one asks for a
// self-contained HTML document and renders it as a real, interactive surface:
// charts, gauges, animated counters, SVG diagrams — whatever the model can
// express in HTML/CSS/JS. The user describes what they want; the model writes
// the UI.
//
// Same push model as the other AI widgets: refresh sends a prompt to the active
// chat session, the model researches/computes with its normal tools, then
// delivers the finished HTML back via the shared `dashboard_render_widget` tool.
//
// The crucial difference is the render path. Model-authored HTML never touches
// the app's DOM — it runs in a doubly-jailed iframe (opaque-origin sandbox +
// strict injected CSP) so it can be creative without being dangerous. See
// sandboxedHtml.ts for the security model.

import type {
  WidgetContext,
  WidgetHandle,
  WidgetRefreshContext,
  WidgetTypeRegistration,
} from '../dashboardTypes.js';
import { collectThemeVars, createSandboxFrame, buildSandboxDocument } from './sandboxedHtml.js';
import { getIcon } from '../../../ui/iconRegistry.js';

interface LiveWidgetConfig {
  readonly prompt: string;
  /**
   * Optional name of a skill (a `.parallx/skills/<name>/SKILL.md` the user
   * authored) the model should apply when building this widget — the place to
   * pin a consistent look so refreshes don't reinvent the layout each time.
   */
  readonly skill: string;
}

const DEFAULT_CONFIG: LiveWidgetConfig = {
  prompt: '',
  skill: '',
};

// AI widgets wear the mark (brandIcons px-ai-mark), like every AI surface.
const ICON_SVG = getIcon('px-ai-mark');

export const LIVE_WIDGET: WidgetTypeRegistration<LiveWidgetConfig> = {
  typeId: 'parallx.dashboard.ai-live',
  displayName: 'Live widget',
  description: 'Describe what you want and the AI builds it as a live HTML panel: charts, gauges, diagrams, animations. Runs sandboxed. Add a refresh schedule to keep it current.',
  icon: ICON_SVG,
  category: 'ai',
  defaultSize: { colSpan: 6, rowSpan: 5 },
  defaultConfig: DEFAULT_CONFIG,
  configSchema: {
    fields: {
      prompt: {
        type: 'textarea',
        label: 'Prompt',
        description: 'What should the AI build? It runs in your active chat session with all its tools, then renders the result as an interactive HTML panel.',
        placeholder: 'e.g. "A donut chart of my time tracked per project this week, with a legend."',
      },
      skill: {
        type: 'string',
        label: 'Skill (optional)',
        description: 'Name of a skill you authored under .parallx/skills/. The AI applies it when building this widget. Pin the look once, reuse it on every refresh.',
        placeholder: 'e.g. dashboard-charts',
      },
    },
  },
  defaultRefreshPolicy: { kind: 'manual' },

  async refresh(ctx: WidgetRefreshContext<LiveWidgetConfig>): Promise<string | null> {
    const api = ctx.api as { commands?: { executeCommand<T>(id: string, arg?: unknown): Promise<T> } };
    if (!api.commands?.executeCommand) {
      throw new Error('Chat tool not available. Ensure the Chat extension is enabled.');
    }
    const cfg = normalizeLiveConfig(ctx.config);
    if (!cfg.prompt.trim()) {
      return placeholderHtml('No prompt set', 'Open this widget’s settings and describe what you want the AI to build.');
    }

    const prompt = buildLivePrompt(cfg, ctx.instanceId);

    // Default (M86 C4): isolated background agent turn; the model delivers
    // the finished HTML via dashboard_render_widget mid-turn, so return null
    // to avoid clobbering it. Failures surface as real widget errors.
    if (ctx.mode !== 'chat') {
      const res = await api.commands.executeCommand<{ ok: boolean; error?: string }>(
        'chat.runBackgroundPrompt',
        { text: prompt, origin: 'dashboard', originLabel: `[dashboard · Live widget ${ctx.instanceId}]`, initiator: ctx.initiator },
      );
      if (!res?.ok) throw new Error(res?.error || 'Background refresh failed.');
      return null;
    }

    // Escape hatch ("Run in chat"): visible run through the active session.
    await api.commands.executeCommand('chat.submitPrompt', { text: prompt });

    // Keep the last good panel on screen while the new one is built — the
    // header status dot already signals "running", and we can't splice a banner
    // into arbitrary HTML the way the Markdown widgets do. dashboard_render_widget
    // overwrites the cache when the fresh panel lands. Only the very first run
    // (no prior content) shows a placeholder.
    const prior = (ctx.cachedOutput ?? '').trim();
    if (prior) return prior;
    return placeholderHtml('Building your widget…', 'The AI is working on it. This panel will fill in when it’s ready.');
  },

  createWidget(container: HTMLElement, ctx: WidgetContext<LiveWidgetConfig>): WidgetHandle {
    container.classList.add('dashboard-md', 'dashboard-live');

    const surface = document.createElement('div');
    surface.className = 'dashboard-md__surface';
    container.appendChild(surface);

    let revokeFrame: (() => void) | null = null;
    let rendered: string | null = null;

    function clearFrame(): void {
      if (revokeFrame) { revokeFrame(); revokeFrame = null; }
    }

    function paint(cached: string | null): void {
      // Skip a needless reload/flash when the content hasn't actually changed.
      if (cached === rendered && surface.firstChild) return;
      clearFrame();
      surface.innerHTML = '';
      rendered = cached;
      if (!cached) {
        const empty = document.createElement('div');
        empty.className = 'dashboard-md__empty';
        empty.innerHTML = `
          <strong>Nothing here yet</strong>
          <p>Open settings to describe what you want, then click the refresh icon above. The AI builds this panel.</p>
        `;
        surface.appendChild(empty);
        return;
      }
      const { frame, revoke } = createSandboxFrame(cached);
      revokeFrame = revoke;
      surface.appendChild(frame);
    }

    function paintError(message: string): void {
      clearFrame();
      surface.innerHTML = '';
      rendered = null;
      const err = document.createElement('div');
      err.className = 'dashboard-md__error';
      const title = document.createElement('strong');
      title.textContent = 'Couldn’t build this widget';
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
      dispose() { clearFrame(); sub.dispose(); },
    };
  },
};

export function normalizeLiveConfig(raw: unknown): LiveWidgetConfig {
  const cfg = (raw ?? {}) as Partial<LiveWidgetConfig>;
  return {
    prompt: typeof cfg.prompt === 'string' ? cfg.prompt : '',
    skill: typeof cfg.skill === 'string' ? cfg.skill : '',
  };
}

/** A small self-contained HTML card, rendered through the same sandbox path. */
function placeholderHtml(title: string, body: string): string {
  return buildSandboxDocument(
    `<div style="height:100%;display:flex;flex-direction:column;justify-content:center;gap:6px;padding:18px;">
       <strong style="font-size:var(--px-text-md);color:var(--px-text);">${escapeHtml(title)}</strong>
       <span style="color:var(--px-text-muted);line-height:1.5;">${escapeHtml(body)}</span>
     </div>`,
    collectThemeVars(),
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}

export function buildLivePrompt(cfg: LiveWidgetConfig, instanceId: string): string {
  const lines: string[] = [];
  const skill = cfg.skill.trim();
  if (skill) {
    lines.push(`Use the \`${skill}\` skill for this task.`, '');
  }
  lines.push(
    cfg.prompt.trim(),
    '',
    'Then deliver the result to my dashboard widget as a live HTML panel:',
    '- Gather or compute whatever the task needs with your tools first. Use only information you can actually verify — never invent facts, numbers, or sources.',
    '- Write a SINGLE self-contained HTML fragment for the panel body. Inline <style> and <script> only — NO external resources (no CDNs, <link>, web fonts, or remote images); they are blocked and will not load. Use inline SVG, CSS, <canvas>, and vanilla JS for any visuals.',
    '- It renders in a sandboxed, fixed-size box. Make it fill the space and scroll internally if needed. It cannot access the network or the rest of the app.',
    // The panel sits on a DARK card. The #1 failure mode is the model painting a
    // light "card" and dark text that vanishes — forbid it explicitly.
    '- DARK THEME, transparent background. The panel sits on a dark surface. Do NOT set a white or light background anywhere — leave it transparent (or use var(--px-bg)). All text must be light: use var(--px-text) for primary and var(--px-text-muted) for secondary. Never put dark text on a light fill.',
    '- Match the app theme with these CSS variables (already defined; do not hardcode colors): var(--px-bg), var(--px-text), var(--px-text-muted), var(--px-accent), var(--px-border), var(--px-danger), var(--px-success), var(--px-warning), var(--px-radius-lg), var(--px-space-3).',
    // Steer away from hand-computed SVG arc paths — the common cause of mangled
    // donut/pie charts. Robust techniques produce clean results first try.
    '- For charts, prefer robust techniques over hand-computed geometry: a pie is a CSS conic-gradient on a circular div (e.g. background: conic-gradient(var(--px-success) 0 60%, var(--px-warning) 60% 100%)); make a donut by overlaying a smaller centered circle filled with var(--px-bg). Bars: flexbox/grid divs with percentage heights. Lines/scatter: inline <svg> with <polyline>/<circle> using a viewBox. AVOID hand-written SVG arc "d" paths — they usually render wrong.',
    // The clip-to-a-semicircle bug: a circle in a flex row gets its width
    // collapsed or sliced by a container edge. Force explicit, uncut sizing.
    '- Size every chart explicitly so it is never clipped or squished into a half-shape: give a pie/donut a fixed SQUARE box (set BOTH width and height to the same value, or use aspect-ratio: 1) and center it; never let a flex row collapse its width (use flex-shrink: 0), and make sure no parent clips it (avoid overflow: hidden cutting the shape). Lay the chart and its legend out so both fit fully inside the panel without anything being cut off.',
    '- No Markdown, no code fences, no preamble — just the raw HTML.',
    `- Call the dashboard_render_widget tool with instanceId "${instanceId}" and the HTML as content. This is how it reaches the widget — do not skip it.`,
  );
  return lines.join('\n');
}
