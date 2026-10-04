// syncedBlockNode.ts — Synced Block: the same content in many places
//
// Every copy shows one shared content and edits it in place: type in any copy
// and the others change too (open ones at once, through the pane mirror).
// The content is kept as a hidden page (migration 018); the block holds its
// id. Copy and paste a synced block to place another copy; Unsync turns one
// copy back into ordinary blocks (the others stay synced).
//
// Node type `syncedRef` (not `syncedBlock`: stored blocks of that name from
// elsewhere hold their content inline and are kept as unknown blocks).
//
// A synced block cannot show itself inside itself: a copy placed inside its
// own content shows a note instead of an endless nest.

import { Node, mergeAttributes } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import { type LiveBlockOptions, watchWorkspace } from './liveBlock.js';

/** Whether showing `syncId` here would nest it inside itself. */
export function isSyncCycle(chain: readonly string[] | undefined, syncId: string): boolean {
  return !!chain && chain.includes(syncId);
}

export const SyncedBlock = Node.create<LiveBlockOptions>({
  name: 'syncedRef',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addOptions() { return { live: undefined }; },

  addAttributes() {
    return {
      syncId: {
        default: '',
        // Pasting a copied synced block gives another copy of the same one.
        parseHTML: (el: HTMLElement) => el.getAttribute('data-sync-id') ?? '',
        renderHTML: (attrs: Record<string, unknown>) => ({ 'data-sync-id': String(attrs.syncId ?? '') }),
      },
    };
  },

  parseHTML() { return [{ tag: 'div[data-type="syncedRef"]' }]; },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'syncedRef', class: 'canvas-synced' })];
  },

  addNodeView() {
    const live = this.options.live;
    return ({ node, editor, getPos }: any) => {
      let current = node;
      const dom = document.createElement('div');
      dom.className = 'canvas-synced';
      dom.setAttribute('data-type', 'syncedRef');
      dom.contentEditable = 'false';
      const bar = document.createElement('div');
      bar.className = 'canvas-synced__bar';
      const label = document.createElement('span');
      label.className = 'canvas-synced__label';
      label.textContent = 'Synced block';
      const unsync = document.createElement('button');
      unsync.type = 'button';
      unsync.className = 'canvas-live-edit';
      unsync.textContent = 'Unsync';
      unsync.title = 'Turn this copy into ordinary blocks; the other copies stay synced';
      unsync.addEventListener('mousedown', (e) => e.preventDefault());
      bar.append(label, unsync);
      const body = document.createElement('div');
      body.className = 'canvas-synced__body';
      dom.append(bar, body);

      let mounted: { dispose(): void } | null = null;
      let mountedId = '';

      const note = (text: string): void => {
        mounted?.dispose(); mounted = null; mountedId = '';
        body.innerHTML = '';
        const n = document.createElement('div');
        n.className = 'canvas-synced__note';
        n.textContent = text;
        body.appendChild(n);
      };

      const refreshCount = (): void => {
        const id = String(current.attrs.syncId ?? '');
        if (!id || !live?.synced) return;
        void live.synced.countCopies(id).then((n) => {
          label.textContent = n > 1 ? `Synced block · in ${n} pages` : 'Synced block';
        }).catch(() => {});
      };

      const render = (): void => {
        const id = String(current.attrs.syncId ?? '');
        // On the element too: a copy of the rendered block (not only
        // ProseMirror's own copy) must carry which content it shows.
        dom.setAttribute('data-sync-id', id);
        if (!id) return note('This synced block has no content to show.');
        if (!live?.synced) return note('Synced blocks cannot be shown here.');
        if (isSyncCycle(live.syncChain, id)) return note('A synced block cannot be placed inside itself.');
        if (mounted && mountedId === id) return;
        mounted?.dispose();
        body.innerHTML = '';
        mountedId = id;
        mounted = live.synced.mount(body, id);
        refreshCount();
      };
      render();
      // A copy pasted or removed elsewhere changes the count.
      const stop = watchWorkspace(live, refreshCount);

      unsync.addEventListener('click', async () => {
        if (!editor.isEditable || !live?.synced || typeof getPos !== 'function') return;
        const id = String(current.attrs.syncId ?? '');
        const doc = await live.synced.readDoc(id).catch(() => null);
        const pos = getPos();
        if (typeof pos !== 'number' || editor.state.doc.nodeAt(pos)?.attrs?.syncId !== id) return;
        const content = (doc?.content ?? []).length ? doc!.content! : [{ type: 'paragraph' }];
        editor.chain()
          .command(({ tr }: { tr: any }) => { closeHistory(tr); return true; })
          .insertContentAt({ from: pos, to: pos + current.nodeSize }, content)
          .run();
      });

      return {
        dom,
        update(updated: any) {
          if (updated.type.name !== 'syncedRef') return false;
          const changed = updated.attrs.syncId !== current.attrs.syncId;
          current = updated;
          if (changed) render();
          return true;
        },
        // The content is its own editor: keys, clicks and drags inside stay there.
        stopEvent: (e: Event) => body.contains(e.target as globalThis.Node) || !!(e.target as HTMLElement | null)?.closest?.('button'),
        ignoreMutation: () => true,
        destroy() { stop(); mounted?.dispose(); mounted = null; },
      };
    };
  },
});
