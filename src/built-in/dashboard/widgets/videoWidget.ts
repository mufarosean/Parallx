// videoWidget.ts — play a video from (almost) any link.
//
// The user pastes a URL in settings; the widget resolves it three ways:
//   1. a direct video file (.mp4/.webm/…)  → native <video>
//   2. a known provider (YouTube, Vimeo, …) → the provider's <iframe> embed
//   3. anything else                        → an Electron <webview> that loads
//      the page (so arbitrary sites that block plain iframes still play)
//
// First-party widget code rendering into the main DOM, so the main-window CSP
// (img/media/frame-src allow https:) lets embeds and direct media load. The
// <webview> is hardened in electron/main.cjs (will-attach-webview).

import type {
  WidgetContext,
  WidgetHandle,
  WidgetTypeRegistration,
} from '../dashboardTypes.js';

interface VideoConfig {
  readonly url: string;
  readonly autoplay: boolean;
  readonly muted: boolean;
}

const DEFAULT_CONFIG: VideoConfig = { url: '', autoplay: false, muted: true };

const ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2.5"/><path d="m10 9 5 3-5 3z" fill="currentColor" stroke="none"/></svg>';

const VIDEO_FILE_RE = /\.(mp4|webm|ogg|ogv|m4v|mov)(?:[?#]|$)/i;

type VideoSource =
  | { kind: 'video' | 'embed' | 'page'; src: string }
  | { kind: 'none' };

/** Map a known provider watch/share URL to its embeddable player URL. */
function providerEmbed(host: string, u: URL): string | null {
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
    const id = u.searchParams.get('v') || (u.pathname.match(/^\/(?:shorts|embed|v)\/([\w-]{6,})/)?.[1] ?? '');
    if (id) return `https://www.youtube.com/embed/${id}`;
  }
  if (host === 'youtu.be') {
    const id = u.pathname.slice(1).split('/')[0];
    if (id) return `https://www.youtube.com/embed/${id}`;
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const id = u.pathname.match(/(\d{6,})/)?.[1];
    if (id) return `https://player.vimeo.com/video/${id}`;
  }
  if (host === 'dailymotion.com') {
    const id = u.pathname.match(/\/video\/(\w+)/)?.[1];
    if (id) return `https://www.dailymotion.com/embed/video/${id}`;
  }
  if (host === 'dai.ly') {
    const id = u.pathname.slice(1);
    if (id) return `https://www.dailymotion.com/embed/video/${id}`;
  }
  if (host === 'streamable.com') {
    const id = u.pathname.slice(1).split('/')[0];
    if (id) return `https://streamable.com/e/${id}`;
  }
  if (host === 'loom.com') {
    const id = u.pathname.match(/\/(?:share|embed)\/(\w+)/)?.[1];
    if (id) return `https://www.loom.com/embed/${id}`;
  }
  return null;
}

export function resolveVideoSource(rawUrl: string): VideoSource {
  const url = (rawUrl || '').trim();
  if (!url) return { kind: 'none' };
  let u: URL;
  try { u = new URL(url); } catch { return { kind: 'none' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { kind: 'none' };

  if (VIDEO_FILE_RE.test(u.pathname)) return { kind: 'video', src: url };

  const host = u.hostname.replace(/^www\./, '').toLowerCase();
  const embed = providerEmbed(host, u);
  if (embed) return { kind: 'embed', src: embed };

  return { kind: 'page', src: url };
}

function normalizeConfig(raw: unknown): VideoConfig {
  const cfg = (raw ?? {}) as Partial<VideoConfig>;
  return {
    url: typeof cfg.url === 'string' ? cfg.url : '',
    autoplay: cfg.autoplay === true,
    muted: cfg.muted !== false,
  };
}

export const VIDEO_WIDGET: WidgetTypeRegistration<VideoConfig> = {
  typeId: 'parallx.dashboard.video',
  displayName: 'Video',
  description: 'Play a video from a link: YouTube, Vimeo, a direct .mp4, or any video page. Paste the URL in settings.',
  icon: ICON_SVG,
  category: 'static',
  defaultSize: { colSpan: 6, rowSpan: 4 },
  chromeStyle: 'bare',
  defaultConfig: DEFAULT_CONFIG,
  configSchema: {
    fields: {
      url: {
        type: 'string',
        label: 'Video URL',
        description: 'YouTube / Vimeo / a direct video file, or any page with a video.',
        placeholder: 'https://youtube.com/watch?v=… or https://…/clip.mp4',
      },
      autoplay: { type: 'boolean', label: 'Autoplay (starts muted)' },
      muted: { type: 'boolean', label: 'Muted' },
    },
  },
  defaultRefreshPolicy: { kind: 'manual' },

  createWidget(container: HTMLElement, ctx: WidgetContext<VideoConfig>): WidgetHandle {
    container.classList.add('vw');
    let config = normalizeConfig(ctx.config);

    const surface = document.createElement('div');
    surface.className = 'vw__surface';
    container.appendChild(surface);

    function render(): void {
      surface.textContent = '';
      const source = resolveVideoSource(config.url);
      container.classList.toggle('vw--empty', source.kind === 'none');

      if (source.kind === 'none') {
        const empty = document.createElement('div');
        empty.className = 'vw__empty';
        empty.innerHTML = `${ICON_SVG}<div class="vw__empty-text"><strong>No video yet</strong><span>Open settings and paste a video URL: YouTube, Vimeo, an .mp4 link, or any video page.</span></div>`;
        surface.appendChild(empty);
        return;
      }

      if (source.kind === 'video') {
        const v = document.createElement('video');
        v.className = 'vw__fill';
        v.src = source.src;
        v.controls = true;
        v.playsInline = true;
        v.autoplay = config.autoplay;
        v.muted = config.muted || config.autoplay; // autoplay requires muted
        surface.appendChild(v);
        return;
      }

      if (source.kind === 'embed') {
        const iframe = document.createElement('iframe');
        iframe.className = 'vw__fill';
        const sep = source.src.includes('?') ? '&' : '?';
        iframe.src = config.autoplay ? `${source.src}${sep}autoplay=1&muted=1` : source.src;
        iframe.setAttribute('allow', 'autoplay; fullscreen; picture-in-picture; encrypted-media; clipboard-write');
        iframe.setAttribute('allowfullscreen', 'true');
        iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
        surface.appendChild(iframe);
        return;
      }

      // page → <webview> (hardened in main.cjs will-attach-webview)
      const webview = document.createElement('webview');
      webview.className = 'vw__fill';
      webview.setAttribute('src', source.src);
      surface.appendChild(webview);
    }

    const sub = ctx.onDidChangeConfig((next) => {
      config = normalizeConfig(next);
      render();
    });

    render();

    return {
      renderError(message: string | null) {
        if (!message) { render(); return; }
        surface.textContent = '';
        const err = document.createElement('div');
        err.className = 'vw__empty';
        err.textContent = message;
        surface.appendChild(err);
      },
      dispose() { sub.dispose(); surface.textContent = ''; },
    };
  },
};
