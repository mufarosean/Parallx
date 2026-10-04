// linkedDatabaseNode.ts — Linked Database: one of your databases, in this page
//
// The database's own table or board, working as it does in its editor (add
// rows, edit cells, filter, sort, switch views), shown inside the page. The
// block remembers which database and which view; the data and the views are
// the database's, so a filter set here applies wherever that view is shown.
// The title opens the database itself.
//
// A database that was deleted or moved to the Trash shows a note instead,
// and the block can be pointed at another one.

import { Node, mergeAttributes } from '@tiptap/core';
import {
  type LiveBlockOptions, type LivePageSummary, openBlockPopover, popoverRow, selectControl,
  blockEditButton, setBlockAttrs, focusBlock, watchWorkspace,
} from './liveBlock.js';

/** Whether the linked database still exists among the live ones. */
export function findLinkedDatabase(databases: readonly LivePageSummary[], id: string): LivePageSummary | null {
  return databases.find((d) => d.id === id) ?? null;
}

export const LinkedDatabase = Node.create<LiveBlockOptions>({
  name: 'linkedDatabase',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addOptions() { return { live: undefined }; },

  addAttributes() {
    return {
      databaseId: { default: '' },
      viewId: { default: '' },
    };
  },

  parseHTML() { return [{ tag: 'div[data-type="linkedDatabase"]' }]; },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'linkedDatabase', class: 'canvas-linked-db' })];
  },

  addNodeView() {
    const live = this.options.live;
    return ({ node, editor, getPos }: any) => {
      let current = node;
      const dom = document.createElement('div');
      dom.className = 'canvas-linked-db';
      dom.setAttribute('data-type', 'linkedDatabase');
      dom.contentEditable = 'false';
      const bar = document.createElement('div');
      bar.className = 'canvas-linked-db__bar';
      const label = document.createElement('span');
      label.className = 'canvas-linked-db__label';
      label.textContent = 'Linked database';
      const change = blockEditButton('Change Database…');
      bar.append(label, change);
      const body = document.createElement('div');
      body.className = 'canvas-linked-db__body';
      dom.append(bar, body);

      let mounted: { dispose(): void } | null = null;
      let mountedFor = '';
      /** The view the pane is showing (a tab click), so storing it does not remount. */
      let shownView = '';

      const pick = (anchor: HTMLElement): void => {
        if (!editor.isEditable) return;
        void (live?.databases?.list() ?? Promise.resolve([])).then((databases) => {
          openBlockPopover(anchor, 'Linked database', (pop, close) => {
            const select = selectControl(
              [{ value: '', label: databases.length ? 'Choose a database' : 'No databases yet: type /database to make one' },
                ...databases.map((d) => ({ value: d.id, label: d.title }))],
              String(current.attrs.databaseId ?? ''),
            );
            select.setAttribute('aria-label', 'Database');
            popoverRow(pop, 'Database', select);
            const done = document.createElement('button');
            done.type = 'button';
            done.className = 'canvas-live-popover__primary';
            done.textContent = 'Show Database';
            done.addEventListener('click', () => {
              if (select.value) setBlockAttrs(editor, getPos, { databaseId: select.value, viewId: '' });
              close();
            });
            pop.appendChild(done);
          }, () => focusBlock(editor, getPos));
        });
      };
      change.addEventListener('click', () => pick(change));

      const unmount = (): void => { mounted?.dispose(); mounted = null; mountedFor = ''; };

      const showMessage = (text: string, withPicker: boolean): void => {
        unmount();
        body.innerHTML = '';
        const msg = document.createElement('div');
        msg.className = 'canvas-linked-db__empty';
        const t = document.createElement('span');
        t.textContent = text;
        msg.appendChild(t);
        if (withPicker) {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'canvas-live-popover__primary';
          b.textContent = 'Choose a Database…';
          b.addEventListener('mousedown', (e) => e.preventDefault());
          b.addEventListener('click', () => pick(b));
          msg.appendChild(b);
        }
        body.appendChild(msg);
      };

      const render = async (): Promise<void> => {
        const id = String(current.attrs.databaseId ?? '');
        const viewId = String(current.attrs.viewId ?? '');
        if (!id) { showMessage('Show one of your databases here.', true); return; }
        if (!live?.mountDatabaseView || !live.databases) { showMessage('Databases cannot be shown here.', false); return; }
        const found = findLinkedDatabase(await live.databases.list().catch(() => []), id);
        if (!found) { showMessage('This database was deleted or moved to the Trash.', true); return; }
        if (mounted && mountedFor === id && (viewId === shownView || !viewId)) return;
        unmount();
        body.innerHTML = '';
        shownView = viewId;
        mountedFor = id;
        mounted = live.mountDatabaseView(body, id, {
          viewId: viewId || undefined,
          onViewChange: (v) => { shownView = v; setBlockAttrs(editor, getPos, { viewId: v }); },
        });
      };
      void render();
      // A database deleted or trashed meanwhile shows the note at once.
      const stop = watchWorkspace(live, () => { void render(); });

      return {
        dom,
        update(updated: any) {
          if (updated.type.name !== 'linkedDatabase') return false;
          const changed = updated.attrs.databaseId !== current.attrs.databaseId || updated.attrs.viewId !== current.attrs.viewId;
          current = updated;
          if (changed) void render();
          return true;
        },
        // The table is its own editor: typing, clicks and drags inside it stay there.
        stopEvent: (e: Event) => body.contains(e.target as globalThis.Node) || !!(e.target as HTMLElement | null)?.closest?.('button'),
        ignoreMutation: () => true,
        destroy: () => { stop(); unmount(); },
      };
    };
  },
});
