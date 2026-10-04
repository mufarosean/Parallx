// worksheetPracticeBlock.ts — Worksheets' Practice Problems block for pages
//
// Lists problems from the Problem Bank, chosen by paper, tag and state (all,
// not tried yet, needs work, starred), each with where it stands. Click one
// to work it in its own tab. The list keeps up as problems are worked, so a
// study page shows what is left.
//
// Worksheets brings this block to the canvas while it runs
// (api.canvas.registerBlock); with Worksheets turned off the block is not
// offered, and pages that have one say Worksheets is needed. The choosing
// is worksheetEmbed.ts (pure, tested alone).

import type { IDisposable } from '../../platform/lifecycle.js';
import type { CanvasBlockRegistration } from '../../api/bridges/canvasBlocksBridge.js';
import {
  selectEmbedProblems, embedFilterChoices, EMBED_SHOW,
  type EmbedItemLike, type EmbedProblem,
} from './worksheetEmbed.js';

export const PRACTICE_SIZES = [3, 5, 10, 25] as const;

/** The block's one-line summary of what it lists. */
export function describePractice(config: { show?: unknown; paper?: unknown; tag?: unknown }, paperLabel?: string): string {
  const show = EMBED_SHOW.find((s) => s.value === config.show) ?? EMBED_SHOW[0];
  const parts = [show.value === 'all' ? 'Problems' : show.label.replace(/ \(.*\)$/, '')];
  if (config.paper) parts.push(paperLabel || String(config.paper));
  if (config.tag) parts.push(`#${String(config.tag)}`);
  return parts.join(' · ');
}

/** State → chip tone, so Hard reads as needing work at a glance. */
export function practiceTone(state: string): 'hard' | 'medium' | 'easy' | 'open' | 'new' {
  if (state === 'Hard') return 'hard';
  if (state === 'Medium') return 'medium';
  if (state === 'Easy') return 'easy';
  if (state === 'In progress') return 'open';
  return 'new';
}

export interface PracticeData {
  listItems(): Promise<readonly EmbedItemLike[]>;
  onDidChange(listener: () => void): IDisposable;
  openProblem(id: number, title: string): void;
  openBank(): void;
}

/** The registration Worksheets hands to `api.canvas.registerBlock`. */
export function practiceBlock(data: PracticeData): CanvasBlockRegistration {
  const choices = async () => embedFilterChoices(await data.listItems().catch(() => []));
  return {
    typeId: 'parallx.worksheet.practice',
    label: 'Practice Problems',
    description: 'Problems to work from your Problem Bank',
    icon: 'graduation-cap',
    defaultConfig: { show: 'needsWork', paper: '', tag: '', limit: 5 },
    settings: {
      title: 'Practice problems',
      fields: {
        show: { type: 'enum', label: 'Show', options: EMBED_SHOW },
        paper: { type: 'enum', label: 'Paper', options: async () => [{ value: '', label: 'Any paper' }, ...(await choices()).papers] },
        tag: { type: 'enum', label: 'Tag', options: async () => [{ value: '', label: 'Any tag' }, ...(await choices()).tags.map((t) => ({ value: t, label: t }))] },
        limit: { type: 'enum', label: 'How many', options: PRACTICE_SIZES.map((n) => ({ value: String(n), label: `Up to ${n}` })) },
      },
    },
    readable: (config) => `[Practice problems: ${describePractice(config)}]`,
    render(body, ctx) {
      body.classList.add('ws-practice');
      ctx.setActions([{ label: 'Open Problem Bank', run: () => data.openBank() }]);
      let config = ctx.config;
      let seq = 0;
      let disposed = false;
      let changeTimer: ReturnType<typeof setTimeout> | null = null;

      const paint = (problems: readonly EmbedProblem[], show: string): void => {
        if (!problems.length) {
          ctx.showNote(show === 'needsWork' ? 'Nothing needs work here. Well done.'
            : show === 'new' ? 'Every problem here has been tried.'
            : show === 'starred' ? 'No starred problems here.'
            : 'No problems match.');
          return;
        }
        body.innerHTML = '';
        for (const p of problems) {
          const row = document.createElement('button');
          row.type = 'button';
          row.className = 'ws-practice__row';
          row.title = 'Work this problem';
          const name = document.createElement('span');
          name.className = 'ws-practice__name';
          name.textContent = `${p.starred ? '★ ' : ''}${p.title}`;
          const paper = document.createElement('span');
          paper.className = 'ws-practice__paper';
          paper.textContent = p.paper;
          const state = document.createElement('span');
          state.className = `ws-practice__state ws-practice__state--${practiceTone(p.state)}`;
          state.textContent = p.state;
          row.append(name, paper, state);
          row.addEventListener('click', () => data.openProblem(p.id, p.title));
          body.appendChild(row);
        }
      };

      const render = async (): Promise<void> => {
        const mine = ++seq;
        const items = await data.listItems().catch(() => [] as EmbedItemLike[]);
        if (disposed || mine !== seq) return;
        const show = String(config.show ?? 'all');
        const query = { show, paper: String(config.paper ?? ''), tag: String(config.tag ?? ''), limit: Number(config.limit) || 5 };
        const paperLabel = embedFilterChoices(items).papers.find((p) => p.value === query.paper)?.label;
        ctx.setTitle(describePractice(query, paperLabel));
        paint(selectEmbedProblems(items, query), show);
      };

      // Worksheets changes often while a sheet is worked: read once it settles.
      const sub = data.onDidChange(() => {
        if (changeTimer) clearTimeout(changeTimer);
        changeTimer = setTimeout(() => void render(), 400);
      });
      void render();

      return {
        update(next) { config = next; void render(); },
        dispose() { disposed = true; sub.dispose(); if (changeTimer) clearTimeout(changeTimer); },
      };
    },
  };
}
