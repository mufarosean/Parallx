// companionWidget.ts — a small character that keeps you company while you work.
//
// v2, after the field verdict on v1 ("the design is bad; animated is
// better"): one PERSISTENT ink-line character in the Notion-character
// spirit — spiky hair, heavy brows, real pupils — that is alive on its
// own, not merely reactive. Its pupils follow your cursor (rAF-throttled,
// the one shared primitive), it blinks on a natural cycle, breathes with
// a slow bob, and glances around when nothing is happening. Moods mutate
// the SAME face (brows, lids, mouth) so transitions morph instead of the
// face being replaced.
//
// It still watches PRESENCE and nothing else: key/pointer events at the
// document level (capture, passive — never the content of anything) plus
// window focus. Steady work keeps it bright; a quiet stretch makes it
// drowsy; a long one puts it to sleep; coming back earns a greeting.
// All state is in-memory and dies with the widget — a face, not a tracker.

import type {
  WidgetContext,
  WidgetHandle,
  WidgetTypeRegistration,
} from '../dashboardTypes.js';
import { rafThrottle } from '../../../platform/rafThrottle.js';

interface CompanionConfig {
  readonly name: string;
  readonly voice: 'encouraging' | 'deadpan';
}

const DEFAULT_CONFIG: CompanionConfig = { name: 'Mochi', voice: 'encouraging' };

const ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="4" y="7" width="16" height="13" rx="5"/><path d="M7 7l-1.5-3M12 6V2.5M17 7l1.5-3"/><circle cx="9.5" cy="12.5" r="1" fill="currentColor" stroke="none"/><circle cx="14.5" cy="12.5" r="1" fill="currentColor" stroke="none"/><path d="M10.5 16c1 .8 2 .8 3 0"/></svg>';

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

// Mouth path per mood — the one geometry the CSS cannot morph, swapped in JS.
const MOUTH: Record<Mood, string> = {
  happy: 'M40 68 Q50 76 60 68',
  greeting: 'M41 66 Q50 78 59 66 Z',
  content: 'M42 69 Q50 73 58 69',
  drowsy: 'M44 70 L56 70',
  asleep: 'M45 70 Q50 74 55 70',
};

/**
 * The character, built ONCE: hair spikes, head, brows, eyes with real
 * pupils, lids that lower with the mood, a mouth, and a zzz. Everything
 * animates via CSS classes on the root + transforms set by JS.
 */
const CHARACTER_SVG = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" class="cmw__svg">
  <g class="cmw__char">
    <g class="cmw__hair">
      <path class="cmw__ink-fill" d="M28 34 Q24 20 31 12 Q33 22 38 26 Z"/>
      <path class="cmw__ink-fill" d="M39 27 Q40 12 50 7 Q49 18 54 24 Z"/>
      <path class="cmw__ink-fill" d="M55 25 Q60 12 69 12 Q64 22 66 28 Z"/>
      <path class="cmw__ink-fill" d="M67 30 Q75 24 79 28 Q73 32 72 36 Z"/>
    </g>
    <rect class="cmw__head" x="24" y="28" width="52" height="50" rx="17"/>
    <path class="cmw__ear" d="M24 56 q-5 0 -5 -5 q0 -4 5 -3"/>
    <path class="cmw__ear" d="M76 56 q5 0 5 -5 q0 -4 -5 -3"/>
    <g class="cmw__brows">
      <path class="cmw__brow cmw__brow--l" d="M33 45 Q39 41 45 44"/>
      <path class="cmw__brow cmw__brow--r" d="M55 44 Q61 41 67 45"/>
    </g>
    <g class="cmw__eyes">
      <g class="cmw__eye-open">
        <ellipse class="cmw__white" cx="40" cy="54" rx="6.5" ry="7"/>
        <ellipse class="cmw__white" cx="60" cy="54" rx="6.5" ry="7"/>
        <g class="cmw__pupils">
          <circle class="cmw__pupil" cx="40" cy="55" r="2.8"/>
          <circle class="cmw__pupil" cx="60" cy="55" r="2.8"/>
        </g>
        <path class="cmw__lid cmw__lid--l" d="M33.5 54 a6.5 7 0 0 1 13 0 l0 -8 l-13 0 Z"/>
        <path class="cmw__lid cmw__lid--r" d="M53.5 54 a6.5 7 0 0 1 13 0 l0 -8 l-13 0 Z"/>
      </g>
      <g class="cmw__eye-closed">
        <path class="cmw__ink" d="M34 56 Q40 60 46 56"/>
        <path class="cmw__ink" d="M54 56 Q60 60 66 56"/>
      </g>
    </g>
    <path class="cmw__nose cmw__ink" d="M49 58 Q47 62 50 63"/>
    <path class="cmw__mouth cmw__ink" d="${MOUTH.content}"/>
    <g class="cmw__blush">
      <path class="cmw__ink" d="M30 63 l4 2 M31 66 l4 2" opacity="0.5"/>
      <path class="cmw__ink" d="M70 63 l-4 2 M69 66 l-4 2" opacity="0.5"/>
    </g>
    <g class="cmw__zzz">
      <text x="76" y="24" class="cmw__zzz-t cmw__zzz-t1">z</text>
      <text x="84" y="16" class="cmw__zzz-t cmw__zzz-t2">z</text>
    </g>
  </g>
</svg>`;

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
  description: 'A small character that keeps you company: its eyes follow your cursor, it blinks and breathes, glances around, gets drowsy when you drift, sleeps when you leave, and lights up when you come back.',
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
    stage.innerHTML = CHARACTER_SVG;
    const status = document.createElement('div');
    status.className = 'cmw__status';
    container.appendChild(stage);
    container.appendChild(status);

    const svg = stage.querySelector('.cmw__svg') as SVGSVGElement;
    const pupils = svg.querySelector('.cmw__pupils') as SVGGElement;
    const mouth = svg.querySelector('.cmw__mouth') as SVGPathElement;

    // ── Presence ──
    let lastActivity = Date.now();
    let focused = document.hasFocus();
    let mood: Mood = 'happy';
    let greetUntil = 0;
    let lineIndex = 0;

    // ── Gaze: pupils chase a target; a CSS transition smooths every move ──
    let gaze = { x: 0, y: 0 };
    let glance: { x: number; y: number } | undefined;
    function applyGaze(): void {
      const g = mood === 'asleep' ? { x: 0, y: 0 } : (glance ?? gaze);
      pupils.style.transform = `translate(${g.x.toFixed(2)}px, ${g.y.toFixed(2)}px)`;
    }
    const onMouseMove = rafThrottle((e: MouseEvent) => {
      const r = stage.getBoundingClientRect();
      if (r.width === 0) return;
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height * 0.45);
      const len = Math.hypot(dx, dy) || 1;
      const reach = Math.min(1, len / 260);
      gaze = { x: (dx / len) * 3 * reach, y: (dy / len) * 2.4 * reach };
      applyGaze();
    });

    // ── Idle glances: with nothing to look at, look around anyway ──
    let glanceTimer: ReturnType<typeof setTimeout> | undefined;
    function scheduleGlance(): void {
      glanceTimer = setTimeout(() => {
        if (mood !== 'asleep') {
          glance = { x: (Math.random() * 6 - 3), y: (Math.random() * 3 - 1) };
          applyGaze();
          setTimeout(() => { glance = undefined; applyGaze(); }, 700 + Math.random() * 600);
        }
        scheduleGlance();
      }, 6_000 + Math.random() * 14_000);
    }
    scheduleGlance();

    // ── Presence handlers ──
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
    document.addEventListener('mousemove', onMouseMove, { passive: true });
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);

    // A poke wakes it and earns a quick delighted bounce.
    stage.addEventListener('click', () => {
      greetUntil = Date.now() + 2_500;
      lastActivity = Date.now();
      update();
    });

    function update(): void {
      const next: Mood = Date.now() < greetUntil
        ? 'greeting'
        : moodFor(Date.now() - lastActivity, focused);
      if (next !== mood) {
        svg.classList.remove(`cmw--${mood}`);
        mood = next;
        lineIndex = (lineIndex + 1) % 97;
      }
      svg.classList.add(`cmw--${mood}`);
      mouth.setAttribute('d', MOUTH[mood]);
      applyGaze();
      const lines = LINES[config.voice][mood];
      status.textContent = `${config.name} ${lines[lineIndex % lines.length]}`;
    }

    update();
    const interval = setInterval(update, 15_000);
    const sub = ctx.onDidChangeConfig((next) => { config = normalizeConfig(next); update(); });

    return {
      dispose() {
        clearInterval(interval);
        if (glanceTimer) clearTimeout(glanceTimer);
        onMouseMove.dispose();
        sub.dispose();
        document.removeEventListener('keydown', onActivity, { capture: true });
        document.removeEventListener('pointerdown', onActivity, { capture: true });
        document.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('focus', onFocus);
        window.removeEventListener('blur', onBlur);
      },
    };
  },
};
