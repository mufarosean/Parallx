// answerFormApp.ts — the mini-app answer form (```app).
//
// When a reader would understand something best by playing with it, the
// model writes a small self-contained HTML app. It runs in the same jail
// as the dashboard's Live widget (ui/sandboxedHtml.ts): no files, no
// internet, no reach into the app, which the bar says in words. Under it:
// Open In Tab, Save To Page, Pin To Dashboard. The commands those run
// and the block, tab and widget they make are chat's
// (built-in/chat/rendering/miniApps.ts).

import { escapeHtml } from './format.js';
import { createButton } from './kit.js';
import { getIcon } from './iconRegistry.js';
import { createSandboxFrame, followHostTheme, hostColorScheme, watchFrameHeight } from './sandboxedHtml.js';
import type { AnswerForm, AnswerFormContext, AnswerFormHydration } from './answerForms.js';

export const MINI_APP_BLOCK = 'parallx.chat.app';
export const OPEN_MINI_APP_COMMAND = 'chat.openMiniApp';
export const PIN_MINI_APP_COMMAND = 'chat.pinMiniApp';
export const LOCKED_NOTE = 'This app cannot reach your files, the rest of the app, or the internet';

export interface MiniApp { readonly title: string; readonly height: number; readonly html: string }

/** `title:` and `height:` lines first (both optional), then the app's HTML. */
export function parseMiniApp(src: string): MiniApp | null {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  let title = '';
  let height = 0;
  let i = 0;
  for (; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const m = /^(title|height)\s*:\s*(.+)$/i.exec(line);
    if (!m) break;
    if (m[1].toLowerCase() === 'title') title = m[2].trim();
    else height = Number.parseInt(m[2], 10) || 0;
  }
  const html = lines.slice(i).join('\n').trim();
  if (!/<[a-z][\s\S]*>/i.test(html)) return null;
  return { title: title || 'Mini-App', height: Math.min(900, Math.max(120, height || 320)), html };
}

/** The jailed frame for an app, seated in `stage`: sized by what it reports, or filling it (a tab, a widget). */
export function mountMiniApp(stage: HTMLElement, app: MiniApp, opts: { fill?: boolean } = {}): void {
  const { frame, revoke } = createSandboxFrame(app.html, stage.ownerDocument, {
    scheme: hostColorScheme(stage.ownerDocument), reportHeight: !opts.fill, followTheme: true, appStyle: true, className: 'px-af-app__frame', title: app.title,
  });
  frame.style.height = opts.fill ? '100%' : `${app.height}px`;
  // The document is parsed once loaded; the URL is no longer needed.
  frame.addEventListener('load', revoke, { once: true });
  stage.replaceChildren(frame);
  if (!opts.fill) watchFrameHeight(frame);
  followHostTheme(frame);
}

function renderApp(src: string, _info: string, ctx: AnswerFormContext): string | null {
  // While the answer is still being written the app's code is half there:
  // show where it will be, and start nothing until the block is closed.
  if (ctx.complete === false) {
    const title = /^\s*title\s*:\s*(.+)$/im.exec(src)?.[1]?.trim() || 'Mini-App';
    return `<div class="px-af-app"><div class="px-af-app__bar"><span class="px-af-app__icon" aria-hidden="true">${getIcon('app-window')}</span>`
      + `<span class="px-af-app__title">${escapeHtml(title)}</span></div><p class="px-af-app__pending">Writing the app…</p></div>`;
  }
  const app = parseMiniApp(src);
  if (!app) return null;
  return '<div class="px-af-app">'
    + `<div class="px-af-app__bar"><span class="px-af-app__icon" aria-hidden="true">${getIcon('app-window')}</span>`
    + `<span class="px-af-app__title">${escapeHtml(app.title)}</span>`
    + `<span class="px-af-app__lock" title="${LOCKED_NOTE}"><span aria-hidden="true">${getIcon('lock')}</span>Locked down: no files, no internet</span></div>`
    + `<div class="px-af-app__stage" style="min-height: ${app.height}px"></div>`
    + '<div class="px-af-app__actions"><span class="px-af-app__open"></span><span class="px-af-save"></span><span class="px-af-app__pin"></span></div>'
    + '</div>';
}

function hydrateApp(root: HTMLElement, h: AnswerFormHydration): void {
  const app = parseMiniApp(h.src);
  const stage = root.querySelector<HTMLElement>('.px-af-app__stage');
  if (!app || !stage) return;
  mountMiniApp(stage, app);
  stage.style.minHeight = '';
  const open = root.querySelector<HTMLElement>('.px-af-app__open');
  const pin = root.querySelector<HTMLElement>('.px-af-app__pin');
  if (open) createButton(open, { id: null, label: 'Open In Tab', icon: 'external-link', kind: 'ghost', size: 'sm', command: OPEN_MINI_APP_COMMAND, args: [app.title, h.src] });
  if (pin) createButton(pin, { id: null, label: 'Pin To Dashboard', icon: 'layout-dashboard', kind: 'ghost', size: 'sm', command: PIN_MINI_APP_COMMAND, args: [app.title, h.src] });
}

const FENCE = '```';

export const MINI_APP_FORM: Omit<AnswerForm, 'ownerToolId'> = {
  name: 'app',
  aliases: ['mini-app', 'html-app'],
  hint: [
    `### ${FENCE}app: a small interactive tool`,
    'Read the build-mini-app skill before writing one: it has the look, the words and a starter to build from.',
    'Only when the reader would understand something best by playing with it: a simulator with sliders, an',
    'interactive diagram, a tool with several steps. Prefer ```live for a plain calculation. Write one self-contained',
    'HTML app: markup, a <style> and a <script>, nothing loaded from outside. It runs locked down (no internet, no files,',
    'no reach into the app). First `title: Name` and, if it needs more than 320 pixels, `height: 480`; then the HTML.',
    'Colour it with the theme\'s CSS variables so it matches: var(--px-text), var(--px-text-muted), var(--px-accent),',
    'var(--px-bg-elevated), var(--px-border). Label every control.',
    `${FENCE}app`, 'title: Compound Growth', '<label>Rate <input id="r" type="range" min="0" max="12" value="5"></label> <output id="o"></output>',
    '<script>const r = document.getElementById(\'r\'), o = document.getElementById(\'o\');',
    'const show = () => { o.textContent = (1000 * Math.pow(1 + r.value / 100, 10)).toFixed(0); }; r.oninput = show; show();</script>', FENCE,
  ].join('\n'),
  render: renderApp,
  hydrate: hydrateApp,
  saveAs: { blockType: MINI_APP_BLOCK, title: (src) => parseMiniApp(src)?.title ?? 'Mini-App' },
};
