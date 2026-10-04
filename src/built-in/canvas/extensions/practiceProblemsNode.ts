// practiceProblemsNode.ts — Practice Problems: a few problems from the bank
//
// Lists problems from Worksheets' Problem Bank, chosen by paper, tag and
// state (all, not tried yet, needs work, starred), each with where it stands.
// Click one to work it in its own tab. The list keeps up as problems are
// worked, so a study page shows what is left.
//
// Reads Worksheets through its worksheet.embed.* commands (the choosing is
// worksheet/worksheetEmbed.ts), so the page never touches its tables.

import { Node, mergeAttributes } from '@tiptap/core';
import {
  type LiveBlockOptions, openBlockPopover, popoverRow, selectControl, blockEditButton, setBlockAttrs,
  focusBlock, askTool, retrySoon,
} from './liveBlock.js';

export interface PracticeProblem { readonly id: number; readonly title: string; readonly paper: string; readonly state: string; readonly starred: boolean }

// Kept in step with worksheetEmbed.ts EMBED_SHOW (a canvas block does not
// import a tool); canvasToolBlocks.test.ts checks they match.
export const PRACTICE_SHOWS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'all', label: 'All problems' },
  { value: 'new', label: 'Not tried yet' },
  { value: 'needsWork', label: 'Needs work (Hard or Medium)' },
  { value: 'starred', label: 'Starred' },
];
export const PRACTICE_SIZES = [3, 5, 10, 25] as const;

/** The block's one-line summary of what it lists. */
export function describePractice(attrs: { show?: string; paper?: string; tag?: string }, paperLabel?: string): string {
  const show = PRACTICE_SHOWS.find((s) => s.value === attrs.show) ?? PRACTICE_SHOWS[0];
  const parts = [show.value === 'all' ? 'Problems' : show.label.replace(/ \(.*\)$/, '')];
  if (attrs.paper) parts.push(paperLabel || attrs.paper);
  if (attrs.tag) parts.push(`#${attrs.tag}`);
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

export const PracticeProblems = Node.create<LiveBlockOptions>({
  name: 'practiceProblems',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addOptions() { return { live: undefined }; },

  addAttributes() {
    return {
      show: { default: 'needsWork' },
      paper: { default: '' },
      tag: { default: '' },
      limit: { default: 5 },
    };
  },

  parseHTML() { return [{ tag: 'div[data-type="practiceProblems"]' }]; },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'practiceProblems', class: 'canvas-practice' })];
  },

  addNodeView() {
    const live = this.options.live;
    return ({ node, editor, getPos }: any) => {
      let current = node;
      const dom = document.createElement('div');
      dom.className = 'canvas-practice';
      dom.setAttribute('data-type', 'practiceProblems');
      dom.contentEditable = 'false';
      const bar = document.createElement('div');
      bar.className = 'canvas-practice__bar';
      const title = document.createElement('span');
      title.className = 'canvas-practice__title';
      const bank = blockEditButton('Open Problem Bank');
      bank.addEventListener('click', () => void askTool(live, 'worksheet.bank'));
      const edit = blockEditButton('Edit…');
      bar.append(title, bank, edit);
      const list = document.createElement('div');
      list.className = 'canvas-practice__list';
      dom.append(bar, list);

      let seq = 0;
      let destroyed = false;
      let stopRetry = (): void => {};
      let changeSub: { dispose(): void } | null = null;
      let subscribing = false;
      let changeTimer: ReturnType<typeof setTimeout> | null = null;
      let papers: Array<{ value: string; label: string }> = [];

      const note = (text: string): void => {
        list.innerHTML = '';
        const n = document.createElement('div');
        n.className = 'canvas-practice__note';
        n.textContent = text;
        list.appendChild(n);
      };

      const attrs = () => ({
        show: String(current.attrs.show ?? 'all'),
        paper: String(current.attrs.paper ?? ''),
        tag: String(current.attrs.tag ?? ''),
        limit: Number(current.attrs.limit) || 5,
      });

      const render = async (attempt = 0): Promise<void> => {
        const mine = ++seq;
        stopRetry();
        const q = attrs();
        const [res, choices] = await Promise.all([
          askTool<PracticeProblem[]>(live, 'worksheet.embed.listProblems', q),
          papers.length ? Promise.resolve(null) : askTool<{ papers: typeof papers }>(live, 'worksheet.embed.filterChoices'),
        ]);
        if (destroyed || mine !== seq) return;
        if (choices?.ok && Array.isArray(choices.value?.papers)) papers = choices.value.papers;
        title.textContent = describePractice(q, papers.find((p) => p.value === q.paper)?.label);
        if (!res.ok || !Array.isArray(res.value)) {
          note('Worksheets is not available.');
          stopRetry = retrySoon(() => void render(attempt + 1), attempt);
          return;
        }
        if (!changeSub && !subscribing) {
          // Worksheets changes often while a sheet is worked: read once it settles.
          subscribing = true;
          const sub = await askTool<{ dispose(): void }>(live, 'worksheet.embed.onDidChange', () => {
            if (changeTimer) clearTimeout(changeTimer);
            changeTimer = setTimeout(() => void render(), 400);
          });
          subscribing = false;
          if (destroyed) { if (sub.ok) sub.value?.dispose?.(); return; }
          if (sub.ok && typeof sub.value?.dispose === 'function') changeSub = sub.value;
        }
        if (!res.value.length) {
          note(q.show === 'needsWork' ? 'Nothing needs work here. Well done.'
            : q.show === 'new' ? 'Every problem here has been tried.'
            : q.show === 'starred' ? 'No starred problems here.'
            : 'No problems match.');
          return;
        }
        list.innerHTML = '';
        for (const p of res.value) {
          const row = document.createElement('button');
          row.type = 'button';
          row.className = 'canvas-practice__row';
          row.title = 'Work this problem';
          const name = document.createElement('span');
          name.className = 'canvas-practice__name';
          name.textContent = `${p.starred ? '★ ' : ''}${p.title}`;
          const paper = document.createElement('span');
          paper.className = 'canvas-practice__paper';
          paper.textContent = p.paper;
          const state = document.createElement('span');
          state.className = `canvas-practice__state canvas-practice__state--${practiceTone(p.state)}`;
          state.textContent = p.state;
          row.append(name, paper, state);
          row.addEventListener('click', () => void askTool(live, 'worksheet.openProblem', p.id));
          list.appendChild(row);
        }
      };
      void render();

      edit.addEventListener('click', () => {
        if (!editor.isEditable) return;
        void askTool<{ papers: typeof papers; tags: string[] }>(live, 'worksheet.embed.filterChoices').then((res) => {
          const choices = res.ok && res.value ? res.value : { papers: [], tags: [] };
          const a = attrs();
          openBlockPopover(edit, 'Practice problems', (pop, close) => {
            const show = selectControl(PRACTICE_SHOWS, a.show);
            show.setAttribute('aria-label', 'Show');
            popoverRow(pop, 'Show', show);
            const paper = selectControl([{ value: '', label: 'Any paper' }, ...choices.papers], a.paper);
            paper.setAttribute('aria-label', 'Paper');
            popoverRow(pop, 'Paper', paper);
            const tag = selectControl([{ value: '', label: 'Any tag' }, ...choices.tags.map((t) => ({ value: t, label: t }))], a.tag);
            tag.setAttribute('aria-label', 'Tag');
            popoverRow(pop, 'Tag', tag);
            const size = selectControl(PRACTICE_SIZES.map((n) => ({ value: String(n), label: `Up to ${n}` })), String(a.limit));
            size.setAttribute('aria-label', 'How many');
            popoverRow(pop, 'How many', size);
            const done = document.createElement('button');
            done.type = 'button';
            done.className = 'canvas-live-popover__primary';
            done.textContent = 'Done';
            done.addEventListener('click', () => {
              setBlockAttrs(editor, getPos, { show: show.value, paper: paper.value, tag: tag.value, limit: Number(size.value) });
              close();
            });
            pop.appendChild(done);
          }, () => focusBlock(editor, getPos));
        });
      });

      return {
        dom,
        update(updated: any) {
          if (updated.type.name !== 'practiceProblems') return false;
          const before = current.attrs;
          current = updated;
          const a = updated.attrs;
          if (a.show !== before.show || a.paper !== before.paper || a.tag !== before.tag || a.limit !== before.limit) void render();
          return true;
        },
        stopEvent: (e: Event) => !!(e.target as HTMLElement | null)?.closest?.('button'),
        ignoreMutation: () => true,
        destroy() { destroyed = true; stopRetry(); changeSub?.dispose(); if (changeTimer) clearTimeout(changeTimer); },
      };
    };
  },
});
