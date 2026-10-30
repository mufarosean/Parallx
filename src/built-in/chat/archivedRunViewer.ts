// archivedRunViewer.ts — M91 S3: read-only viewer for an archived autonomous run.
//
// Opens an archived heartbeat/cron/dashboard/subagent transcript as an
// editor tab you can scroll and read like a chat — but with no input and no
// send. Reuses the chat content-part renderer so tool calls, markdown, and
// reasoning render exactly as they did live.

import type { IChatSession } from '../../services/chatTypes.js';
import { appDateTimeString } from '../../services/localTime.js';
import { renderContentPart } from './rendering/chatContentParts.js';

export const ARCHIVED_RUN_EDITOR_TYPE = 'chat-archived-run';

const ORIGIN_LABEL: Record<string, string> = {
  heartbeat: 'Heartbeat',
  cron: 'Scheduled (cron)',
  dashboard: 'Dashboard widget',
  subagent: 'Subagent',
};

/**
 * Render an archived run's full transcript into `container`, read-only.
 * Returns a disposable (nothing to tear down beyond clearing the DOM, but
 * the editor-pane contract expects one).
 */
export function renderArchivedRun(
  container: HTMLElement,
  run: IChatSession | null,
  origin?: string,
): { dispose(): void } {
  container.classList.add('archived-run-view');
  container.innerHTML = '';

  if (!run) {
    const empty = document.createElement('div');
    empty.className = 'archived-run-view__empty';
    empty.textContent = 'This run is no longer available. It may have been pruned by the retention limit.';
    container.appendChild(empty);
    return { dispose() { container.innerHTML = ''; } };
  }

  const header = document.createElement('div');
  header.className = 'archived-run-view__header';
  const title = document.createElement('div');
  title.className = 'archived-run-view__title';
  title.textContent = run.title || 'Autonomous run';
  header.appendChild(title);
  const sub = document.createElement('div');
  sub.className = 'archived-run-view__sub';
  const label = origin ? (ORIGIN_LABEL[origin] ?? origin) : 'Autonomous';
  sub.textContent = `${label} · read-only transcript · ${appDateTimeString(new Date(run.createdAt))}`;
  header.appendChild(sub);
  container.appendChild(header);

  const scroll = document.createElement('div');
  scroll.className = 'archived-run-view__scroll';
  container.appendChild(scroll);

  for (const pair of run.messages) {
    // User / seed message.
    if (pair.request?.text) {
      const u = document.createElement('div');
      u.className = 'archived-run-msg archived-run-msg--user';
      u.textContent = pair.request.text; // seed prompt — plain text
      scroll.appendChild(u);
    }
    // Assistant reply — render each content part (text, tool calls, …).
    const a = document.createElement('div');
    a.className = 'archived-run-msg archived-run-msg--assistant';
    for (const part of pair.response?.parts ?? []) {
      try { a.appendChild(renderContentPart(part)); }
      catch { /* skip a part that can't render rather than break the view */ }
    }
    scroll.appendChild(a);
  }

  return { dispose() { container.innerHTML = ''; } };
}

/**
 * A run's viewer, live while it runs: Watch on a running card in Agents
 * opens it. While the run's session is still in memory the transcript fills
 * in as it streams (redrawn at most once a frame, kept scrolled to the end
 * unless you scrolled up); once the run ends and is archived it shows the
 * archived transcript, the same as History's View Full Run.
 */
export function mountRunViewer(
  container: HTMLElement,
  source: {
    live(): IChatSession | undefined;
    onChange(listener: () => void): { dispose(): void };
    archived(): Promise<IChatSession | null>;
  },
  origin?: string,
): { dispose(): void } {
  let disposed = false;
  let handle: { dispose(): void } = { dispose() { /* nothing drawn yet */ } };
  let frame = 0;
  let sub: { dispose(): void } | undefined;
  const scroller = () => container.querySelector<HTMLElement>('.archived-run-view__scroll');
  const drawLive = (run: IChatSession) => {
    const el = scroller();
    const atEnd = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    handle.dispose();
    handle = renderArchivedRun(container, run, origin);
    container.querySelector('.archived-run-view__sub')?.append(' · running');
    const next = scroller();
    if (next && atEnd) next.scrollTop = next.scrollHeight;
  };
  // Kept listening: a run that has just ended may be archived a moment later.
  const showArchived = () => {
    void source.archived().catch(() => null).then((run) => { if (!disposed) { handle.dispose(); handle = renderArchivedRun(container, run, origin); } });
  };
  const live = source.live();
  if (live) {
    drawLive(live);
    sub = source.onChange(() => {
      if (frame || disposed) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const run = source.live();
        if (run) drawLive(run); else showArchived();
      });
    });
  } else {
    showArchived();
  }
  return { dispose() { disposed = true; if (frame) cancelAnimationFrame(frame); sub?.dispose(); handle.dispose(); } };
}
