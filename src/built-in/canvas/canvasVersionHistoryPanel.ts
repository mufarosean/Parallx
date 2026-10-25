// canvasVersionHistoryPanel.ts — a page's saved versions: when each was
// saved and by whom, what it changed, and the page as it was, drawn by the
// page's own renderer with the changes marked. Restore puts it back.
//
// Checkpoints are captured automatically by CanvasDataService on an interval;
// this panel reads them (listPageRevisions / getPageRevision) and restores them
// (restorePageRevision — non-destructive: it snapshots the current state first).
// Each version is compared with the one saved before it (canvasVersionDiff).

import { Editor } from '@tiptap/core';
import { common, createLowlight } from 'lowlight';
import { createSectionLabel, createToggle, declareControl } from '../../ui/kit.js';
import { $ } from '../../ui/dom.js';
import { Overlay } from '../../ui/overlay.js';
import { appDateString, appTimeString, addAppDays, startOfAppDay } from '../../platform/localTime.js';
import { parseStoredTime } from '../../platform/storedTime.js';
import { formatRelativeTime } from '../../ui/relativeTime.js';
import { decodeCanvasContent } from './contentSchema.js';
import { createEditorExtensions } from './config/tiptapExtensions.js';
import { resolveFontStack } from './config/fontRegistry.js';
import { wrapUnknownContent } from './unknownContent.js';
import { diffBlocks, summarize, summaryChip, summarySentence, type DocNode } from './canvasVersionDiff.js';
import type { ICanvasDataService, IPageRevision, RevisionSource } from './canvasTypes.js';

const lowlight = createLowlight(common);

interface VersionHistoryDeps {
  readonly dataService: ICanvasDataService;
  readonly pageId: string;
}

const SOURCE_LABEL: Record<RevisionSource, string> = {
  user: 'You',
  ai: 'AI',
  restore: 'Restore',
};

/** The heading a version files under: Today, Yesterday, or its date. */
function dayHeading(ms: number, now = Date.now()): string {
  const today = startOfAppDay(now);
  if (ms >= today) return 'Today';
  if (ms >= addAppDays(today, -1)) return 'Yesterday';
  return appDateString(ms, { weekday: 'long', month: 'long', day: 'numeric' });
}

/** Open the version-history dialog for a page. Resolves when it closes. */
export function showVersionHistoryPanel(deps: VersionHistoryDeps): Promise<void> {
  const { dataService, pageId } = deps;
  return new Promise<void>((resolve) => {
    const overlay = new Overlay(document.body, { contentClass: 'canvas-vh-modal', label: 'Version History', centered: true });
    const modal = overlay.contentElement;

    const header = $('div.canvas-vh-header');
    const title = $('div.canvas-vh-title');
    title.textContent = 'Version History';
    const closeBtn = $('button.px-btn.px-btn--ghost.px-btn--icon.canvas-vh-close') as HTMLButtonElement;
    closeBtn.type = 'button';
    closeBtn.title = 'Close';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.textContent = '×';
    declareControl(closeBtn, { id: 'canvas.versionHistory.close', label: 'Close', kind: 'iconButton' });
    closeBtn.addEventListener('click', () => overlay.hide());
    header.append(title, closeBtn);

    const listEl = $('div.canvas-vh-list');
    listEl.setAttribute('role', 'listbox');
    listEl.setAttribute('aria-label', 'Saved versions');
    const preview = $('div.canvas-vh-preview');
    const body = $('div.canvas-vh-body');
    body.append(listEl, preview);
    modal.append(header, body);

    // The preview's fixed parts: what is shown, what it changed, the page, Restore.
    const meta = $('div.canvas-vh-meta');
    const when = $('div.canvas-vh-when');
    const sentence = $('div.canvas-vh-summary');
    const showChanges = createToggle(null, {
      id: 'canvas.versionHistory.showChanges', label: 'Show Changes', checked: true,
      onChange: () => { if (selected) void render(selected); },
    });
    const toggleRow = $('label.canvas-vh-toggle');
    toggleRow.append(showChanges.element, document.createTextNode('Show changes'));
    const metaText = $('div.canvas-vh-meta-text');
    metaText.append(when, sentence);
    meta.append(metaText, toggleRow);
    const pageHost = $('div.canvas-vh-page');
    const footer = $('div.canvas-vh-footer');
    const status = $('span.canvas-vh-status');
    const restoreBtn = $('button.px-btn.px-btn--primary.canvas-vh-restore') as HTMLButtonElement;
    restoreBtn.type = 'button';
    restoreBtn.textContent = 'Restore This Version';
    declareControl(restoreBtn, { id: 'canvas.versionHistory.restore', label: 'Restore This Version', hint: 'The page as it is now is saved as a version first.' });
    footer.append(status, restoreBtn);
    preview.append(meta, pageHost, footer);

    // Read-only page renderer: the same blocks the page uses, nothing saved.
    const editor = new Editor({
      element: pageHost,
      extensions: createEditorExtensions(lowlight, { dataService, pageId }),
      content: '',
      editable: false,
      editorProps: { attributes: { class: 'canvas-tiptap-editor canvas-vh-doc' } },
    });
    void dataService.getPage(pageId).then((p) => {
      if (p?.fontFamily) pageHost.style.setProperty('--canvas-page-font', resolveFontStack(p.fontFamily));
    }).catch(() => undefined);

    let revisions: IPageRevision[] = [];
    let selected: IPageRevision | null = null;
    const docs = new Map<string, DocNode | null>();
    const rowFor = new Map<string, HTMLElement>();

    const docOf = async (rev: IPageRevision | undefined): Promise<DocNode | undefined> => {
      if (!rev) return undefined;
      if (!docs.has(rev.id)) {
        const full = await dataService.getPageRevision(rev.id);
        docs.set(rev.id, full ? (decodeCanvasContent(full.content).doc as DocNode) : null);
      }
      return docs.get(rev.id) ?? undefined;
    };
    /** The version saved just before this one (the list is newest first). */
    const previousOf = (rev: IPageRevision): IPageRevision | undefined => revisions[revisions.indexOf(rev) + 1];

    const render = async (rev: IPageRevision): Promise<void> => {
      selected = rev;
      for (const [id, row] of rowFor) {
        const on = id === rev.id;
        row.classList.toggle('canvas-vh-item--active', on);
        row.setAttribute('aria-selected', String(on));
        row.tabIndex = on ? 0 : -1;
      }
      const [after, before] = await Promise.all([docOf(rev), docOf(previousOf(rev))]);
      if (selected !== rev) return; // a newer selection won
      const at = parseStoredTime(rev.createdAt);
      when.textContent = `${appDateString(at, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}, ${appTimeString(at, { hour: 'numeric', minute: '2-digit' })} · ${SOURCE_LABEL[rev.source] ?? rev.source}`;
      if (!after) {
        sentence.textContent = 'This version could not be read.';
        editor.commands.setContent('');
        restoreBtn.disabled = true;
        return;
      }
      restoreBtn.disabled = false;
      status.textContent = '';
      const first = !previousOf(rev);
      sentence.textContent = first ? 'The oldest version kept for this page.' : summarySentence(summarize(before, after));
      // With changes shown, blocks this version removed are drawn where they stood.
      const rows = showChanges.checked && !first ? diffBlocks(before, after) : (after.content ?? []).map((node) => ({ node, change: 'same' as const }));
      editor.commands.setContent(wrapUnknownContent({ type: 'doc', content: rows.map((r) => r.node) }, editor.schema));
      editor.state.doc.forEach((_node, offset, index) => {
        const dom = editor.view.nodeDOM(offset);
        if (dom instanceof HTMLElement && rows[index] && rows[index].change !== 'same') dom.dataset.vhChange = rows[index].change;
      });
      pageHost.scrollTop = 0;
      pageHost.querySelector('[data-vh-change]')?.scrollIntoView({ block: 'center' });
    };

    restoreBtn.addEventListener('click', async () => {
      if (!selected) return;
      restoreBtn.disabled = true;
      status.classList.remove('is-error');
      status.textContent = 'Restoring…';
      try {
        await dataService.restorePageRevision(pageId, selected.id);
        status.textContent = 'Restored. The page as it was is saved as a version too.';
        setTimeout(() => overlay.hide(), 900);
      } catch (err) {
        restoreBtn.disabled = false;
        status.classList.add('is-error');
        status.textContent = `Restore failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    });

    // Up and Down move through the versions, as in any list.
    listEl.addEventListener('keydown', (e) => {
      if (!selected || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
      e.preventDefault();
      const next = revisions[revisions.indexOf(selected) + (e.key === 'ArrowDown' ? 1 : -1)];
      if (next) { void render(next); rowFor.get(next.id)?.focus(); }
    });

    const fillChips = async (): Promise<void> => {
      for (const rev of revisions) {
        const chip = rowFor.get(rev.id)?.querySelector('.canvas-vh-item-sub');
        if (!chip) continue;
        const prev = previousOf(rev);
        const [after, before] = await Promise.all([docOf(rev), docOf(prev)]);
        chip.textContent = !prev ? 'Oldest kept' : after ? summaryChip(summarize(before, after)) : 'Could not be read';
        if (!overlay.visible) return;
      }
    };

    const renderList = async (): Promise<void> => {
      revisions = await dataService.listPageRevisions(pageId);
      listEl.replaceChildren();
      if (revisions.length === 0) {
        const empty = $('div.canvas-vh-empty');
        empty.textContent = 'No versions yet. A version is saved every few minutes while you edit.';
        listEl.appendChild(empty);
        meta.hidden = true;
        footer.hidden = true;
        return;
      }
      let day = '';
      for (const rev of revisions) {
        const at = parseStoredTime(rev.createdAt);
        const heading = dayHeading(at);
        if (heading !== day) {
          day = heading;
          createSectionLabel(listEl, heading).classList.add('canvas-vh-day');
        }
        const item = $('button.canvas-vh-item') as HTMLButtonElement;
        item.type = 'button';
        item.setAttribute('role', 'option');
        item.title = formatRelativeTime(rev.createdAt, 'long');
        const top = $('div.canvas-vh-item-when');
        top.textContent = appTimeString(at, { hour: 'numeric', minute: '2-digit' });
        const badge = $('span.canvas-vh-badge');
        badge.dataset.source = rev.source;
        badge.textContent = SOURCE_LABEL[rev.source] ?? rev.source;
        top.appendChild(badge);
        const sub = $('div.canvas-vh-item-sub');
        sub.textContent = '…';
        item.append(top, sub);
        item.addEventListener('click', () => void render(rev));
        rowFor.set(rev.id, item);
        listEl.appendChild(item);
      }
      await render(revisions[0]);
      rowFor.get(revisions[0].id)?.focus();
      void fillChips();
    };

    overlay.onDidClose(() => {
      editor.destroy();
      showChanges.dispose();
      overlay.dispose();
      resolve();
    });
    overlay.show();
    void renderList();
  });
}
