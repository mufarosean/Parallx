// aiEditMarks.ts — margin marks for an AI edit to an open page.
//
// While Chat's edit streams into the page, and until you Keep or Undo it,
// each touched top-level block carries a mark in the left margin: green for
// added, blue for rewritten (its tooltip shows what it said before), red for
// a block on its way out. Marks are keyed by the block's stable id, so they
// survive any transaction that rebuilds a node, and a block someone adds
// next to a marked one is never caught up in it. Decoration-only: the doc
// and the undo history are never touched.

import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export type AiEditMarkKind = 'added' | 'changed' | 'removing';

export interface IAiEditMark {
  /** The block's stable id (attrs.id). */
  readonly id: string;
  readonly kind: AiEditMarkKind;
  /** For a rewritten block: its text before the edit. */
  readonly before?: string;
}

interface IAiEditMarksState {
  readonly marks: ReadonlyMap<string, IAiEditMark>;
  /** The whole edited span, kept mapped so Undo can put the old blocks back. */
  readonly span: { readonly from: number; readonly to: number } | null;
}

export const aiEditMarksKey = new PluginKey<IAiEditMarksState>('canvasAiEditMarks');

/** Meta payload: marks to add (and the span so far), or clear everything. */
export type AiEditMarksMeta =
  | { add: readonly IAiEditMark[]; span?: { from: number; to: number } }
  | { clear: true };

export function setAiEditMarks(tr: Transaction, meta: AiEditMarksMeta): Transaction {
  return tr.setMeta(aiEditMarksKey, meta);
}

export function getAiEditSpan(state: EditorState): { from: number; to: number } | null {
  return aiEditMarksKey.getState(state)?.span ?? null;
}

const EMPTY: IAiEditMarksState = { marks: new Map(), span: null };

export function aiEditMarksPlugin(): Plugin<IAiEditMarksState> {
  return new Plugin<IAiEditMarksState>({
    key: aiEditMarksKey,
    state: {
      init: () => EMPTY,
      apply: (tr, value) => {
        const meta = tr.getMeta(aiEditMarksKey) as AiEditMarksMeta | undefined;
        if (meta && 'clear' in meta) return EMPTY;
        let { marks, span } = value;
        if (tr.docChanged && span) span = { from: tr.mapping.map(span.from, -1), to: tr.mapping.map(span.to, 1) };
        if (meta && 'add' in meta) {
          const next = new Map(marks);
          for (const m of meta.add) next.set(m.id, m);
          marks = next;
          if (meta.span) span = meta.span;
        }
        return marks === value.marks && span === value.span ? value : { marks, span };
      },
    },
    props: {
      decorations(state) {
        const st = aiEditMarksKey.getState(state);
        if (!st || st.marks.size === 0) return null;
        const decos: Decoration[] = [];
        state.doc.forEach((child, offset) => {
          const id = (child.attrs as { id?: unknown }).id;
          const hit = typeof id === 'string' ? st.marks.get(id) : undefined;
          if (!hit) return;
          const attrs: Record<string, string> = { class: `canvas-ai-mark canvas-ai-mark--${hit.kind}` };
          if (hit.kind === 'changed' && hit.before) attrs['title'] = `Before: ${hit.before}`;
          decos.push(Decoration.node(offset, offset + child.nodeSize, attrs));
        });
        return decos.length ? DecorationSet.create(state.doc, decos) : null;
      },
    },
  });
}
