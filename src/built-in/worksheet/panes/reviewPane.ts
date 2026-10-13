// Worksheets: the Review pane, a walk over rated attempts.

import { createButton, createEmptyState, createIconButton } from '../../../ui/kit.js';
import { listItems } from '../worksheetData.js';
import { openWorksheet } from '../actions.js';
import { createSheetPane } from './sheetPane.js';
import { reviewListeners, state, type ReviewWalk } from '../state.js';
import { el } from '../widgets.js';

export function createReviewPane(container: HTMLElement) {
  const root = el('div', 'ws-pane');
  container.appendChild(root);
  let disposed = false;
  let player: { dispose(): void } | null = null;
  let serveSeq = 0;
  const bar = el('div', 'ws-sessionbar');
  const playerHost = el('div', 'ws-session__player');
  root.append(bar, playerHost);

  const renderIdle = () => {
    serveSeq++;
    player?.dispose();
    player = null;
    bar.style.display = 'none';
    bar.replaceChildren();
    playerHost.replaceChildren();
    createEmptyState(playerHost, {
      icon: 'eye',
      headline: 'Nothing to review.',
      hint: 'In the Problem Bank, filter down to the problems you want, then choose Review These.',
      action: { label: 'Problem Bank', onClick: () => void openWorksheet('bank', 'Problem Bank') },
    });
  };

  const paintBar = async (walk: ReviewWalk) => {
    const id = walk.ids[walk.index];
    const titles = await listItems().catch(() => []);
    if (disposed) return;
    const title = titles.find((it) => it.id === id)?.title ?? `Problem ${walk.index + 1}`;
    bar.replaceChildren();
    const prev = createIconButton(bar, { id: 'worksheet.review.previous', icon: 'chevron-left', title: 'Previous Problem', size: 'sm', onClick: () => goTo(walk.index - 1) });
    prev.disabled = walk.index === 0;
    const pos = el('span', 'ws-sessionbar__pos');
    pos.append(el('span', 'ws-sessionbar__name', 'Review'), el('span', 'ws-sessionbar__count', ` · ${walk.index + 1} of ${walk.ids.length} · ${title}`));
    bar.appendChild(pos);
    const next = createIconButton(bar, { id: 'worksheet.review.next', icon: 'chevron-right', title: 'Next Problem', size: 'sm', onClick: () => goTo(walk.index + 1) });
    next.disabled = walk.index === walk.ids.length - 1;
    const spacer = el('div'); spacer.style.flex = '1';
    bar.appendChild(spacer);
    createButton(bar, { id: 'worksheet.review.bank', label: 'Problem Bank', icon: 'library', kind: 'ghost', size: 'sm', title: 'Back to the bank and its filters. This review stays open.', onClick: () => void openWorksheet('bank', 'Problem Bank') });
  };

  const goTo = (index: number) => {
    const walk = state.review;
    if (!walk || index < 0 || index >= walk.ids.length) return;
    walk.index = index;
    serve();
  };

  const serve = () => {
    if (disposed) return;
    const walk = state.review;
    if (!walk || walk.ids.length === 0) { renderIdle(); return; }
    const seq = ++serveSeq;
    bar.style.display = '';
    void paintBar(walk);
    // Staged behind the sheet on screen and swapped in once painted, as the quiz does, so Next never flashes.
    const stage = el('div', 'ws-session__stage ws-session__stage--staging');
    playerHost.appendChild(stage);
    const nextPane = createSheetPane(stage, `item:${walk.ids[walk.index]}`, { revealed: true });
    void nextPane.ready.then(() => requestAnimationFrame(() => requestAnimationFrame(() => {
      if (disposed || seq !== serveSeq) { nextPane.dispose(); stage.remove(); return; }
      player?.dispose();
      player = null;
      for (const old of [...playerHost.children]) if (old !== stage) old.remove();
      stage.classList.remove('ws-session__stage--staging');
      player = nextPane;
    })));
  };

  const onReview = () => serve();
  reviewListeners.add(onReview);
  serve();

  return {
    dispose: () => {
      disposed = true;
      reviewListeners.delete(onReview);
      player?.dispose();
      player = null;
      root.remove();
    },
  };
}
