// buttonNode.ts — Button: one click runs a list of actions
//
// A labelled button. Its actions run in order when it is clicked:
//   Insert Content   Markdown inserted below (or above) the button, with
//                    {{date}} and {{time}} filled in (a daily log, a meeting
//                    template, a checklist).
//   Add Row          a new row in one of your databases, titled from a
//                    pattern, opened if you like.
//   Open Page        a page you pick.
//   Ask AI           a prompt sent to chat.
//   Run Command      any app command by id.
// Edit Button… sets the label and the actions. A failing action stops the
// run and says which one failed; earlier ones are not undone (an insert can
// be undone with Ctrl+Z as usual).

import { Node, mergeAttributes } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import { markdownToTiptapJson } from '../markdownImport.js';
import {
  type LiveBlockOptions, type LiveBlockServices, type LivePageSummary,
  openBlockPopover, popoverRow, selectControl, textControl, blockEditButton, setBlockAttrs, focusBlock,
} from './liveBlock.js';

export type ButtonAction =
  | { type: 'insert'; markdown: string; where: 'below' | 'above' }
  | { type: 'addRow'; databaseId: string; title: string; open: boolean }
  | { type: 'openPage'; pageId: string }
  | { type: 'askAI'; prompt: string }
  | { type: 'command'; commandId: string };

export const BUTTON_ACTION_LABELS: Record<ButtonAction['type'], string> = {
  insert: 'Insert Content',
  addRow: 'Add Row',
  openPage: 'Open Page',
  askAI: 'Ask AI',
  command: 'Run Command',
};

/** Actions from the stored attribute; anything malformed is left out. */
export function parseButtonActions(raw: unknown): ButtonAction[] {
  let list: unknown;
  try { list = typeof raw === 'string' ? JSON.parse(raw || '[]') : raw; } catch { return []; }
  if (!Array.isArray(list)) return [];
  const out: ButtonAction[] = [];
  for (const a of list) {
    if (!a || typeof a !== 'object') continue;
    const x = a as Record<string, unknown>;
    const str = (k: string) => (typeof x[k] === 'string' ? x[k] as string : '');
    switch (x.type) {
      case 'insert': out.push({ type: 'insert', markdown: str('markdown'), where: x.where === 'above' ? 'above' : 'below' }); break;
      case 'addRow': out.push({ type: 'addRow', databaseId: str('databaseId'), title: str('title'), open: x.open === true }); break;
      case 'openPage': out.push({ type: 'openPage', pageId: str('pageId') }); break;
      case 'askAI': out.push({ type: 'askAI', prompt: str('prompt') }); break;
      case 'command': out.push({ type: 'command', commandId: str('commandId') }); break;
    }
  }
  return out;
}

const pad = (n: number) => String(n).padStart(2, '0');
/** {{date}} → 2026-10-04, {{time}} → 14:05 (local). */
export function fillPlaceholders(text: string, now: Date = new Date()): string {
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  return text.replace(/\{\{\s*date\s*\}\}/gi, date).replace(/\{\{\s*time\s*\}\}/gi, time);
}

export interface ButtonRunContext {
  insert(content: unknown[], where: 'below' | 'above'): boolean;
  addRow(databaseId: string, title: string): Promise<string>;
  openPage(pageId: string): void;
  executeCommand(id: string, ...args: unknown[]): Promise<unknown>;
  now?: Date;
}

/** Run the actions in order; stops at the first that fails. */
export async function runButtonActions(actions: readonly ButtonAction[], ctx: ButtonRunContext): Promise<{ ok: true } | { ok: false; failed: number; error: string }> {
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i]!;
    try {
      switch (a.type) {
        case 'insert': {
          if (!a.markdown.trim()) break;
          const doc = markdownToTiptapJson(fillPlaceholders(a.markdown, ctx.now)) as { content?: unknown[] };
          const content = (doc.content ?? []).filter(Boolean);
          if (content.length && !ctx.insert(content, a.where)) throw new Error('This page cannot be edited.');
          break;
        }
        case 'addRow': {
          if (!a.databaseId) throw new Error('No database chosen.');
          const id = await ctx.addRow(a.databaseId, fillPlaceholders(a.title || 'Untitled', ctx.now));
          if (a.open) ctx.openPage(id);
          break;
        }
        case 'openPage':
          if (!a.pageId) throw new Error('No page chosen.');
          ctx.openPage(a.pageId);
          break;
        case 'askAI':
          if (!a.prompt.trim()) throw new Error('The prompt is empty.');
          await ctx.executeCommand('chat.submitPrompt', { text: fillPlaceholders(a.prompt, ctx.now) });
          break;
        case 'command':
          if (!a.commandId.trim()) throw new Error('No command given.');
          await ctx.executeCommand(a.commandId.trim());
          break;
      }
    } catch (err) {
      return { ok: false, failed: i, error: err instanceof Error ? err.message : String(err) };
    }
  }
  return { ok: true };
}

function defaultAction(type: ButtonAction['type']): ButtonAction {
  switch (type) {
    case 'insert': return { type, markdown: '- [ ] ', where: 'below' };
    case 'addRow': return { type, databaseId: '', title: 'New entry {{date}}', open: true };
    case 'openPage': return { type, pageId: '' };
    case 'askAI': return { type, prompt: '' };
    case 'command': return { type, commandId: '' };
  }
}

async function editButton(
  anchor: HTMLElement,
  label: string,
  actions: ButtonAction[],
  live: LiveBlockServices | undefined,
  onSave: (label: string, actions: ButtonAction[]) => void,
  returnFocus: () => void,
): Promise<void> {
  const [databases, pages] = await Promise.all([
    live?.databases?.list().catch(() => [] as LivePageSummary[]) ?? Promise.resolve([] as LivePageSummary[]),
    live?.pages?.listAll().catch(() => [] as LivePageSummary[]) ?? Promise.resolve([] as LivePageSummary[]),
  ]);
  openBlockPopover(anchor, 'Button', (body, close) => {
    const draft = actions.map((a) => ({ ...a })) as ButtonAction[];
    const labelInput = textControl(label, 'Button label');
    labelInput.setAttribute('aria-label', 'Label');
    popoverRow(body, 'Label', labelInput);
    const list = document.createElement('div');
    list.className = 'canvas-button-actions';
    body.appendChild(list);

    const draw = (): void => {
      list.innerHTML = '';
      draft.forEach((action, i) => {
        const box = document.createElement('div');
        box.className = 'canvas-button-action';
        const head = document.createElement('div');
        head.className = 'canvas-button-action__head';
        const name = document.createElement('span');
        name.textContent = `${i + 1}. ${BUTTON_ACTION_LABELS[action.type]}`;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'canvas-live-popover__icon-btn';
        remove.textContent = '×';
        remove.title = 'Remove action';
        remove.setAttribute('aria-label', 'Remove action');
        remove.addEventListener('click', () => { draft.splice(i, 1); draw(); });
        head.append(name, remove);
        box.appendChild(head);
        if (action.type === 'insert') {
          const area = document.createElement('textarea');
          area.className = 'canvas-live-popover__input canvas-button-action__text';
          area.value = action.markdown;
          area.placeholder = 'Markdown. {{date}} and {{time}} are filled in.';
          area.setAttribute('aria-label', 'Content to insert');
          area.addEventListener('input', () => { action.markdown = area.value; });
          box.appendChild(area);
          const where = selectControl([{ value: 'below', label: 'Below the button' }, { value: 'above', label: 'Above the button' }], action.where);
          where.addEventListener('change', () => { action.where = where.value === 'above' ? 'above' : 'below'; });
          popoverRow(box, 'Where', where);
        } else if (action.type === 'addRow') {
          const db = selectControl([{ value: '', label: databases.length ? 'Choose a database' : 'No databases yet' }, ...databases.map((d) => ({ value: d.id, label: d.title }))], action.databaseId);
          db.addEventListener('change', () => { action.databaseId = db.value; });
          popoverRow(box, 'Database', db);
          const title = textControl(action.title, 'Row title');
          title.addEventListener('input', () => { action.title = title.value; });
          popoverRow(box, 'Title', title);
          const open = selectControl([{ value: 'yes', label: 'Open the new row' }, { value: 'no', label: 'Stay here' }], action.open ? 'yes' : 'no');
          open.addEventListener('change', () => { action.open = open.value === 'yes'; });
          popoverRow(box, 'Then', open);
        } else if (action.type === 'openPage') {
          const page = selectControl([{ value: '', label: 'Choose a page' }, ...pages.map((p) => ({ value: p.id, label: p.title }))], action.pageId);
          page.addEventListener('change', () => { action.pageId = page.value; });
          popoverRow(box, 'Page', page);
        } else if (action.type === 'askAI') {
          const area = document.createElement('textarea');
          area.className = 'canvas-live-popover__input canvas-button-action__text';
          area.value = action.prompt;
          area.placeholder = 'What to ask. {{date}} is filled in.';
          area.setAttribute('aria-label', 'Prompt');
          area.addEventListener('input', () => { action.prompt = area.value; });
          box.appendChild(area);
        } else {
          const id = textControl(action.commandId, 'Command id, e.g. canvas.newPage');
          id.addEventListener('input', () => { action.commandId = id.value; });
          popoverRow(box, 'Command', id);
        }
        list.appendChild(box);
      });
      const add = selectControl([
        { value: '', label: 'Add Action…' },
        ...(Object.keys(BUTTON_ACTION_LABELS) as ButtonAction['type'][]).map((t) => ({ value: t, label: BUTTON_ACTION_LABELS[t] })),
      ], '');
      add.className += ' canvas-button-actions__add';
      add.setAttribute('aria-label', 'Add an action');
      add.addEventListener('change', () => {
        if (!add.value) return;
        draft.push(defaultAction(add.value as ButtonAction['type']));
        draw();
      });
      list.appendChild(add);
    };
    draw();

    const done = document.createElement('button');
    done.type = 'button';
    done.className = 'canvas-live-popover__primary';
    done.textContent = 'Done';
    done.addEventListener('click', () => {
      onSave(labelInput.value.trim() || 'Button', draft);
      close();
    });
    body.appendChild(done);
  }, returnFocus);
}

export const ButtonBlock = Node.create<LiveBlockOptions>({
  name: 'buttonBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addOptions() { return { live: undefined }; },

  addAttributes() {
    return {
      label: { default: 'Button' },
      actions: { default: '[]' },
    };
  },

  parseHTML() { return [{ tag: 'div[data-type="buttonBlock"]' }]; },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'buttonBlock', class: 'canvas-button-block' })];
  },

  addNodeView() {
    const live = this.options.live;
    return ({ node, editor, getPos }: any) => {
      let current = node;
      const dom = document.createElement('div');
      dom.className = 'canvas-button-block';
      dom.setAttribute('data-type', 'buttonBlock');
      dom.contentEditable = 'false';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'canvas-button-block__button';
      const edit = blockEditButton('Edit Button…');
      const status = document.createElement('span');
      status.className = 'canvas-button-block__status';
      status.setAttribute('role', 'status');
      dom.append(button, edit, status);

      const render = (): void => {
        button.textContent = String(current.attrs.label || 'Button');
        const n = parseButtonActions(current.attrs.actions).length;
        button.title = n ? `Runs ${n} action${n === 1 ? '' : 's'}` : 'No actions yet: Edit Button… to add some';
      };
      render();

      const openEditor = (): void => {
        if (!editor.isEditable) return;
        void editButton(edit, String(current.attrs.label || 'Button'), parseButtonActions(current.attrs.actions), live,
          (label, actions) => setBlockAttrs(editor, getPos, { label, actions: JSON.stringify(actions) }),
          () => focusBlock(editor, getPos));
      };
      edit.addEventListener('click', openEditor);

      let clearTimer: ReturnType<typeof setTimeout> | null = null;
      button.addEventListener('mousedown', (e) => e.preventDefault());
      button.addEventListener('click', async () => {
        const actions = parseButtonActions(current.attrs.actions);
        if (actions.length === 0) { openEditor(); return; }
        button.disabled = true;
        status.textContent = 'Running…';
        const result = await runButtonActions(actions, {
          insert: (content, where) => {
            if (!editor.isEditable || typeof getPos !== 'function') return false;
            const pos = getPos();
            if (typeof pos !== 'number') return false;
            const at = where === 'above' ? pos : pos + current.nodeSize;
            // Its own undo step, even right after editing the button.
            return editor.chain()
              .command(({ tr }: { tr: any }) => { closeHistory(tr); return true; })
              .insertContentAt(at, content)
              .run();
          },
          addRow: (dbId, title) => {
            if (!live?.databases) return Promise.reject(new Error('Databases are not available here.'));
            return live.databases.addRow(dbId, title);
          },
          openPage: (id) => live?.openPage(id),
          executeCommand: (id, ...args) => live ? live.executeCommand(id, ...args) : Promise.reject(new Error('Commands are not available here.')),
        });
        button.disabled = false;
        status.textContent = result.ok ? 'Done' : `Action ${result.failed + 1} failed: ${result.error}`;
        status.classList.toggle('canvas-button-block__status--error', !result.ok);
        if (clearTimer) clearTimeout(clearTimer);
        clearTimer = setTimeout(() => { status.textContent = ''; }, result.ok ? 1500 : 6000);
      });

      return {
        dom,
        update(updated: any) {
          if (updated.type.name !== 'buttonBlock') return false;
          current = updated;
          render();
          return true;
        },
        stopEvent: (e: Event) => !!(e.target as HTMLElement | null)?.closest?.('button'),
        ignoreMutation: () => true,
        destroy() { if (clearTimer) clearTimeout(clearTimer); },
      };
    };
  },
});
