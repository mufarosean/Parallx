// toolBlockNode.ts — a block another tool brings to the page
//
// The canvas knows no tool's blocks. A tool registers its blocks through
// `api.canvas.registerBlock` while it runs (api/bridges/canvasBlocksBridge.ts)
// and they appear in the / menu ("From your tools"). In the page every such
// block is this one node, holding which block it is, its settings and the
// tool's name. The canvas draws the frame (title, the tool's buttons,
// Edit… from the block's settings); the tool draws the body.
//
// A tool turned off (or removed) takes its blocks out of the / menu; blocks
// already in pages keep their settings and say which tool they need, and
// come back as they were when it is turned on again.

import { Node, mergeAttributes } from '@tiptap/core';
import {
  getContributedBlock, onDidChangeContributedBlocks,
  type CanvasBlockAction, type CanvasBlockHandle, type ContributedCanvasBlock,
} from '../../../api/bridges/canvasBlocksBridge.js';
import { openBlockPopover, popoverRow, selectControl, textControl, blockEditButton, setBlockAttrs, focusBlock } from './liveBlock.js';

export const TOOL_BLOCK = 'toolBlock';

function parseConfig(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try { const v = JSON.parse(raw); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; }
}

/** The note a block shows while its tool is not running. */
export function missingToolNote(from: string): string {
  return from
    ? `This block comes from ${from}, which is turned off. Turn it on in Tools to see it.`
    : 'The tool this block comes from is turned off.';
}

/** What a reader (export, the AI) sees of a tool block. */
export function readableToolBlock(attrs: { blockType?: unknown; config?: unknown; from?: unknown }): string {
  const c = getContributedBlock(String(attrs.blockType ?? ''));
  const config = (attrs.config && typeof attrs.config === 'object' ? attrs.config : {}) as Record<string, unknown>;
  if (c?.registration.readable) {
    try { return c.registration.readable(config); } catch { /* fall through */ }
  }
  if (c) return `[${c.registration.label}]`;
  return `[Block from ${String(attrs.from || 'a tool that is turned off')}]`;
}

/** The node a contributed block is inserted as. */
export function toolBlockContent(c: ContributedCanvasBlock): { type: string; attrs: Record<string, unknown> } {
  return { type: TOOL_BLOCK, attrs: { blockType: c.registration.typeId, config: { ...c.registration.defaultConfig }, from: c.ownerName } };
}

export const ToolBlock = Node.create({
  name: TOOL_BLOCK,
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      blockType: {
        default: '',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-block-type') ?? '',
        renderHTML: (a: Record<string, unknown>) => ({ 'data-block-type': String(a.blockType ?? '') }),
      },
      config: {
        default: {},
        parseHTML: (el: HTMLElement) => parseConfig(el.getAttribute('data-config')),
        renderHTML: (a: Record<string, unknown>) => ({ 'data-config': JSON.stringify(a.config ?? {}) }),
      },
      from: {
        default: '',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-from') ?? '',
        renderHTML: (a: Record<string, unknown>) => ({ 'data-from': String(a.from ?? '') }),
      },
    };
  },

  parseHTML() { return [{ tag: `div[data-type="${TOOL_BLOCK}"]` }]; },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': TOOL_BLOCK, class: 'canvas-toolblock' })];
  },

  addNodeView() {
    return ({ node, editor, getPos }: any) => {
      let current = node;
      const dom = document.createElement('div');
      dom.className = 'canvas-toolblock';
      dom.setAttribute('data-type', TOOL_BLOCK);
      dom.contentEditable = 'false';
      const bar = document.createElement('div');
      bar.className = 'canvas-toolblock__bar';
      const title = document.createElement('span');
      title.className = 'canvas-toolblock__title';
      const actions = document.createElement('span');
      actions.className = 'canvas-toolblock__actions';
      const edit = blockEditButton('Edit…');
      bar.append(title, actions, edit);
      const body = document.createElement('div');
      body.className = 'canvas-toolblock__body';
      dom.append(bar, body);

      let mounted: { entry: ContributedCanvasBlock; handle: CanvasBlockHandle | void } | null = null;

      const config = (): Record<string, unknown> => ({ ...(current.attrs.config ?? {}) });
      // Copies of the rendered block (not only ProseMirror's own) carry it whole.
      const stamp = (): void => {
        dom.setAttribute('data-block-type', String(current.attrs.blockType ?? ''));
        dom.setAttribute('data-config', JSON.stringify(current.attrs.config ?? {}));
        dom.setAttribute('data-from', String(current.attrs.from ?? ''));
      };

      const note = (text: string): void => {
        body.innerHTML = '';
        const n = document.createElement('div');
        n.className = 'canvas-toolblock__note';
        n.textContent = text;
        body.appendChild(n);
      };

      const setActions = (list: readonly CanvasBlockAction[]): void => {
        actions.innerHTML = '';
        for (const a of list) {
          const b = blockEditButton(a.label);
          b.addEventListener('click', () => { try { a.run(); } catch (err) { console.error('[Canvas] Block action failed:', err); } });
          actions.appendChild(b);
        }
      };

      const unmount = (): void => {
        if (!mounted) return;
        try { mounted.handle?.dispose?.(); } catch (err) { console.error('[Canvas] Block dispose failed:', err); }
        mounted = null;
        setActions([]);
        body.innerHTML = '';
      };

      const mount = (): void => {
        const entry = getContributedBlock(String(current.attrs.blockType ?? '')) ?? null;
        if (mounted && mounted.entry === entry) return;
        unmount();
        edit.hidden = true;
        if (!entry) {
          title.textContent = String(current.attrs.from || 'Block');
          note(missingToolNote(String(current.attrs.from ?? '')));
          return;
        }
        const reg = entry.registration;
        title.textContent = reg.label;
        edit.hidden = !reg.settings;
        // The tool's name may have changed (a rename): keep the note right.
        if (current.attrs.from !== entry.ownerName && editor.isEditable) {
          queueMicrotask(() => setBlockAttrs(editor, getPos, { from: entry.ownerName }));
        }
        try {
          const handle = reg.render(body, {
            get config() { return config(); },
            get editable() { return editor.isEditable; },
            setConfig: (patch) => { if (editor.isEditable) setBlockAttrs(editor, getPos, { config: { ...config(), ...patch } }); },
            setTitle: (text) => { title.textContent = text; },
            setActions,
            showNote: note,
          });
          mounted = { entry, handle };
        } catch (err) {
          console.error(`[Canvas] Block "${reg.typeId}" failed to draw:`, err);
          mounted = { entry, handle: undefined };
          note(`${entry.ownerName} could not show this block.`);
        }
      };

      stamp();
      mount();
      const sub = onDidChangeContributedBlocks(() => mount());

      edit.addEventListener('click', () => {
        const reg = mounted?.entry.registration;
        if (!reg?.settings || !editor.isEditable) return;
        const fields = Object.entries(reg.settings.fields);
        void Promise.all(fields.map(async ([, f]) => (typeof f.options === 'function' ? f.options().catch(() => []) : f.options ?? []))).then((opts) => {
          openBlockPopover(edit, reg.settings!.title, (pop, close) => {
            const now = config();
            const controls = fields.map(([key, f], i) => {
              let control: HTMLSelectElement | HTMLInputElement;
              if (f.type === 'enum') {
                control = selectControl(opts[i], String(now[key] ?? ''));
              } else {
                control = textControl(String(now[key] ?? ''), f.placeholder ?? '');
                if (f.type === 'number') control.type = 'number';
              }
              control.setAttribute('aria-label', f.label);
              popoverRow(pop, f.label, control);
              return [key, f, control] as const;
            });
            const done = document.createElement('button');
            done.type = 'button';
            done.className = 'canvas-live-popover__primary';
            done.textContent = 'Done';
            done.addEventListener('click', () => {
              const patch: Record<string, unknown> = {};
              for (const [key, f, control] of controls) patch[key] = f.type === 'number' ? Number(control.value) : control.value;
              setBlockAttrs(editor, getPos, { config: { ...config(), ...patch } });
              close();
            });
            pop.appendChild(done);
          }, () => focusBlock(editor, getPos));
        });
      });

      return {
        dom,
        update(updated: any) {
          if (updated.type.name !== TOOL_BLOCK) return false;
          const before = current;
          current = updated;
          stamp();
          if (updated.attrs.blockType !== before.attrs.blockType) { mount(); return true; }
          if (JSON.stringify(updated.attrs.config) !== JSON.stringify(before.attrs.config) && mounted) {
            if (mounted.handle?.update) {
              try { mounted.handle.update(config()); } catch (err) { console.error('[Canvas] Block update failed:', err); }
            } else { unmount(); mount(); }
          }
          return true;
        },
        // The tool's content is its own: keys, clicks and fields inside stay there.
        stopEvent: (e: Event) => {
          const t = e.target as HTMLElement | null;
          return !!t && (body.contains(t) || !!t.closest?.('button'));
        },
        ignoreMutation: () => true,
        destroy() { sub.dispose(); unmount(); },
      };
    };
  },
});
