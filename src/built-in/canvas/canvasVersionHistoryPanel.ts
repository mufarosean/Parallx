// canvasVersionHistoryPanel.ts — page version-history browser (list + preview +
// restore). Opened from the page ⋯ menu. Standalone modal (like
// canvasShortcutsOverlay): backdrop + modal, Esc / click-outside to dismiss.
//
// Checkpoints are captured automatically by CanvasDataService on an interval;
// this panel reads them (listPageRevisions / getPageRevision) and restores them
// (restorePageRevision — non-destructive: it snapshots the current state first).

import { $ } from '../../ui/dom.js';
import { decodeCanvasContent } from './contentSchema.js';
import type { ICanvasDataService, IPageRevision, RevisionSource } from './canvasTypes.js';

interface VersionHistoryDeps {
  readonly dataService: ICanvasDataService;
  readonly pageId: string;
}

const SOURCE_LABEL: Record<RevisionSource, string> = {
  user: 'You',
  ai: 'AI',
  restore: 'Restore',
};

/** Open the version-history modal for a page. Resolves when dismissed. */
export function showVersionHistoryPanel(deps: VersionHistoryDeps): Promise<void> {
  const { dataService, pageId } = deps;
  return new Promise<void>((resolve) => {
    let resolved = false;

    const backdrop = $('div.canvas-vh-backdrop');
    const modal = $('div.canvas-vh-modal');
    backdrop.appendChild(modal);

    // Header
    const header = $('div.canvas-vh-header');
    const title = $('div.canvas-vh-title');
    title.textContent = 'Version history';
    header.appendChild(title);
    const closeBtn = $('button.canvas-vh-close') as HTMLButtonElement;
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => finish());
    header.appendChild(closeBtn);
    modal.appendChild(header);

    // Body: list (left) + preview (right)
    const body = $('div.canvas-vh-body');
    const listEl = $('div.canvas-vh-list');
    const previewWrap = $('div.canvas-vh-preview');
    const previewHint = $('div.canvas-vh-preview-hint');
    previewHint.textContent = 'Select a version to preview it.';
    previewWrap.appendChild(previewHint);
    body.appendChild(listEl);
    body.appendChild(previewWrap);
    modal.appendChild(body);

    let selectedId: string | null = null;

    const renderPreview = async (rev: IPageRevision): Promise<void> => {
      selectedId = rev.id;
      for (const row of listEl.querySelectorAll('.canvas-vh-item')) {
        row.classList.toggle('canvas-vh-item--active', (row as HTMLElement).dataset.id === rev.id);
      }
      previewWrap.innerHTML = '';
      const loading = $('div.canvas-vh-preview-hint');
      loading.textContent = 'Loading…';
      previewWrap.appendChild(loading);

      const full = await dataService.getPageRevision(rev.id);
      if (selectedId !== rev.id) return; // a newer selection won
      previewWrap.innerHTML = '';

      const meta = $('div.canvas-vh-preview-meta');
      meta.textContent = `${SOURCE_LABEL[rev.source] ?? rev.source} · ${formatTimestamp(rev.createdAt)}`;
      previewWrap.appendChild(meta);

      const text = $('div.canvas-vh-preview-text');
      text.textContent = full ? (extractPlainText(full.content) || '(empty page)') : '(could not load this version)';
      previewWrap.appendChild(text);

      const actions = $('div.canvas-vh-preview-actions');
      const restoreBtn = $('button.canvas-vh-restore') as HTMLButtonElement;
      restoreBtn.type = 'button';
      restoreBtn.textContent = 'Restore this version';
      const status = $('span.canvas-vh-status');
      restoreBtn.addEventListener('click', async () => {
        restoreBtn.disabled = true;
        status.textContent = 'Restoring…';
        try {
          await dataService.restorePageRevision(pageId, rev.id);
          status.textContent = 'Restored.';
          setTimeout(() => finish(), 600);
        } catch (err) {
          restoreBtn.disabled = false;
          status.classList.add('is-error');
          status.textContent = `Restore failed: ${err instanceof Error ? err.message : String(err)}`;
        }
      });
      actions.appendChild(restoreBtn);
      actions.appendChild(status);
      previewWrap.appendChild(actions);
    };

    const renderList = async (): Promise<void> => {
      const revisions = await dataService.listPageRevisions(pageId);
      listEl.innerHTML = '';
      if (revisions.length === 0) {
        const empty = $('div.canvas-vh-empty');
        empty.textContent = 'No versions yet. Checkpoints are saved automatically as you edit.';
        listEl.appendChild(empty);
        return;
      }
      for (const rev of revisions) {
        const item = $('button.canvas-vh-item') as HTMLButtonElement;
        item.type = 'button';
        item.dataset.id = rev.id;
        const when = $('div.canvas-vh-item-when');
        when.textContent = formatRelative(Date.now() - Date.parse(rev.createdAt));
        const badge = $('span.canvas-vh-badge');
        badge.dataset.source = rev.source;
        badge.textContent = SOURCE_LABEL[rev.source] ?? rev.source;
        when.appendChild(badge);
        const sub = $('div.canvas-vh-item-sub');
        sub.textContent = formatTimestamp(rev.createdAt);
        item.appendChild(when);
        item.appendChild(sub);
        item.addEventListener('click', () => void renderPreview(rev));
        listEl.appendChild(item);
      }
      // Auto-select the most recent for an immediate preview.
      void renderPreview(revisions[0]);
    };

    const finish = (): void => {
      if (resolved) return;
      resolved = true;
      backdrop.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve();
    };
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) finish(); });
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(); }
    };
    document.addEventListener('keydown', onKey, true);

    document.body.appendChild(backdrop);
    closeBtn.focus();
    void renderList();
  });
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Plain-text preview: one line per top-level block. */
function extractPlainText(rawContent: string): string {
  try {
    const decoded = decodeCanvasContent(rawContent);
    const blocks = Array.isArray(decoded.doc?.content) ? (decoded.doc.content as unknown[]) : [];
    const lineOf = (n: unknown): string => {
      if (!n || typeof n !== 'object') return '';
      const node = n as { type?: string; text?: string; content?: unknown[] };
      if (node.type === 'text' && typeof node.text === 'string') return node.text;
      if (Array.isArray(node.content)) return node.content.map(lineOf).join('');
      return '';
    };
    return blocks.map(lineOf).filter((l) => l.trim().length > 0).join('\n').trim();
  } catch {
    return '';
  }
}

/** Coarse "x ago". */
function formatRelative(deltaMs: number): string {
  const s = Math.max(0, Math.round(deltaMs / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

/** Absolute local timestamp ('YYYY-MM-DD HH:mm' from the SQLite UTC string). */
function formatTimestamp(iso: string): string {
  // SQLite datetime('now') yields 'YYYY-MM-DD HH:MM:SS' in UTC — normalise to a
  // parseable ISO before formatting locally.
  const ms = Date.parse(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  if (!Number.isFinite(ms)) return iso;
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
