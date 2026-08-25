// companionWidget.ts — a small creature that keeps you company while you work.
//
// The companion watches PRESENCE, nothing else: keystrokes and clicks
// anywhere in the app (document-level, capture, passive — never the
// content of anything) plus window focus. Working steadily keeps it
// happy; a quiet stretch makes it drowsy; a long one puts it to sleep,
// and coming back wakes it with a greeting. All state is in-memory and
// dies with the widget — this is a face, not a tracker.

import type {
  WidgetContext,
  WidgetHandle,
  WidgetTypeRegistration,
} from '../dashboardTypes.js';

interface CompanionConfig {
  readonly name: string;
  readonly voice: 'encouraging' | 'deadpan';
}

const DEFAULT_CONFIG: CompanionConfig = { name: 'Mochi', voice: 'encouraging' };

const ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="4" y="6" width="16" height="14" rx="5"/><circle cx="9.5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="14.5" cy="12" r="1" fill="currentColor" stroke="none"/><path d="M10.5 15.5c1 .8 2 .8 3 0"/><path d="M8 6l-1-2"/><path d="M16 6l1-2"/></svg>';

type Mood = 'happy' | 'content' | 'drowsy' | 'asleep' | 'greeting';

const DROWSY_AFTER_MS = 3 * 60_000;
const ASLEEP_AFTER_MS = 10 * 60_000;
const GREETING_HOLD_MS = 6_000;

/** Exported for tests: idle time + focus → mood. */
export function moodFor(idleMs: number, windowFocused: boolean): Mood {
  if (!windowFocused || idleMs >= ASLEEP_AFTER_MS) return 'asleep';
  if (idleMs >= DROWSY_AFTER_MS) return 'drowsy';
  if (idleMs < 30_000) return 'happy';
  return 'content';
}

const LINES: Record<CompanionConfig['voice'], Record<Mood, readonly string[]>> = {
  encouraging: {
    happy: ['is cheering you on', 'likes where this is going', 'is watching you cook'],
    content: ['is keeping you company', 'is here if you need a break', 'approves of the pace'],
    drowsy: ['is getting sleepy watching you think', 'suggests a stretch', 'yawns supportively'],
    asleep: ['is asleep. Working quietly for you.', 'is dreaming of your success.'],
    greeting: ['missed you! Back to it.', 'perks up. Welcome back!'],
  },
  deadpan: {
    happy: ['acknowledges the productivity', 'has seen worse', 'notes that you are, in fact, working'],
    content: ['is present', 'observes', 'has no complaints. Yet.'],
    drowsy: ['assumes you are thinking very hard', 'is bored. No pressure.', 'checks the time'],
    asleep: ['is asleep. It is nothing personal.', 'has given up waiting.'],
    greeting: ['notes your return', 'was not worried.'],
  },
};

/** The face, one SVG per mood — eyes and mouth do the acting. */
function faceSvg(mood: Mood): string {
  const eyes = mood === 'asleep'
    ? '<path d="M20 30c2 1.6 5 1.6 7 0" class="cmw__stroke"/><path d="M37 30c2 1.6 5 1.6 7 0" class="cmw__stroke"/>'
    : mood === 'drowsy'
      ? '<path d="M20 29h8" class="cmw__stroke"/><path d="M36 29h8" class="cmw__stroke"/>'
      : mood === 'happy' || mood === 'greeting'
        ? '<path d="M20 30c2-3 5-3 7 0" class="cmw__stroke"/><path d="M37 30c2-3 5-3 7 0" class="cmw__stroke"/>'
        : '<circle cx="24" cy="29" r="2.6" class="cmw__fill"/><circle cx="40" cy="29" r="2.6" class="cmw__fill"/>';
  const mouth = mood === 'asleep'
    ? '<ellipse cx="32" cy="40" rx="2.6" ry="3.4" class="cmw__fill" opacity="0.85"/>'
    : mood === 'drowsy'
      ? '<path d="M29 40h6" class="cmw__stroke"/>'
      : mood === 'happy' || mood === 'greeting'
        ? '<path d="M26 38c3 4 9 4 12 0" class="cmw__stroke"/>'
        : '<path d="M28 39c2 2 6 2 8 0" class="cmw__stroke"/>';
  const extras = mood === 'asleep'
    ? '<text x="50" y="16" class="cmw__zzz">z z</text>'
    : mood === 'greeting'
      ? '<path d="M54 26l4-4M56 32l5-1" class="cmw__stroke"/>'
      : '';
  return `<svg viewBox="0 0 64 56" xmlns="http://www.w3.org/2000/svg" class="cmw__svg">
    <path d="M18 12l-3-6M46 12l3-6" class="cmw__stroke"/>
    <rect x="10" y="10" width="44" height="38" rx="14" class="cmw__head"/>
    ${eyes}${mouth}${extras}
  </svg>`;
}

function normalizeConfig(raw: unknown): CompanionConfig {
  const cfg = (raw ?? {}) as Partial<CompanionConfig>;
  return {
    name: typeof cfg.name === 'string' && cfg.name.trim() ? cfg.name.trim() : DEFAULT_CONFIG.name,
    voice: cfg.voice === 'deadpan' ? 'deadpan' : 'encouraging',
  };
}

export const COMPANION_WIDGET: WidgetTypeRegistration<CompanionConfig> = {
  typeId: 'parallx.dashboard.companion',
  displayName: 'Desk Companion',
  description: 'A small creature that keeps you company: happy while you work, drowsy when you drift, asleep when you leave, delighted when you come back.',
  icon: ICON_SVG,
  category: 'static',
  defaultSize: { colSpan: 3, rowSpan: 3 },
  chromeStyle: 'minimal',
  defaultConfig: DEFAULT_CONFIG,
  configSchema: {
    fields: {
      name: { type: 'string', label: 'Name', placeholder: 'Mochi' },
      voice: {
        type: 'enum',
        label: 'Personality',
        options: [
          { value: 'encouraging', label: 'Encouraging' },
          { value: 'deadpan', label: 'Deadpan' },
        ],
      },
    },
  },
  defaultRefreshPolicy: { kind: 'manual' },

  createWidget(container: HTMLElement, ctx: WidgetContext<CompanionConfig>): WidgetHandle {
    container.classList.add('cmw');
    let config = normalizeConfig(ctx.config);

    const stage = document.createElement('div');
    stage.className = 'cmw__stage';
    const status = document.createElement('div');
    status.className = 'cmw__status';
    container.appendChild(stage);
    container.appendChild(status);

    let lastActivity = Date.now();
    let focused = document.hasFocus();
    let mood: Mood | undefined;
    let greetUntil = 0;
    let lineIndex = 0;

    const onActivity = (): void => {
      const wasAway = moodFor(Date.now() - lastActivity, focused) === 'asleep';
      lastActivity = Date.now();
      if (wasAway) greetUntil = Date.now() + GREETING_HOLD_MS;
      update();
    };
    const onFocus = (): void => { focused = true; onActivity(); };
    const onBlur = (): void => { focused = false; update(); };

    document.addEventListener('keydown', onActivity, { capture: true, passive: true });
    document.addEventListener('pointerdown', onActivity, { capture: true, passive: true });
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);

    function update(): void {
      const next: Mood = Date.now() < greetUntil
        ? 'greeting'
        : moodFor(Date.now() - lastActivity, focused);
      if (next !== mood) {
        mood = next;
        stage.innerHTML = faceSvg(next);
        lineIndex = (lineIndex + 1) % 97;
      }
      const lines = LINES[config.voice][mood ?? 'content'];
      status.textContent = `${config.name} ${lines[lineIndex % lines.length]}`;
    }

    update();
    const interval = setInterval(update, 15_000);
    const sub = ctx.onDidChangeConfig((next) => { config = normalizeConfig(next); mood = undefined; update(); });

    return {
      dispose() {
        clearInterval(interval);
        sub.dispose();
        document.removeEventListener('keydown', onActivity, { capture: true });
        document.removeEventListener('pointerdown', onActivity, { capture: true });
        window.removeEventListener('focus', onFocus);
        window.removeEventListener('blur', onBlur);
      },
    };
  },
};
