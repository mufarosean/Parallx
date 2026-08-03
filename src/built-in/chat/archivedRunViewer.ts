// archivedRunViewer.ts — M91 S3: read-only viewer for an archived autonomous run.
//
// Opens an archived heartbeat/cron/dashboard/subagent transcript as an
// editor tab you can scroll and read like a chat — but with no input and no
// send. Reuses the chat content-part renderer so tool calls, markdown, and
// reasoning render exactly as they did live.

import type { IChatSession } from '../../services/chatTypes.js';
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
  sub.textContent = `${label} · read-only transcript · ${new Date(run.createdAt).toLocaleString()}`;
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
