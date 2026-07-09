// blockClipboard.ts — Block-level copy / cut / paste
//
// Notion-parity clipboard for BLOCK selections: click a handle (or box-select
// N blocks) → Ctrl+C copies the blocks, Ctrl+X cuts them, Ctrl+V pastes them
// after the current block (or after the selected block when a block selection
// is active).
//
// Wired through the native `copy` / `cut` / `paste` DOM events (document
// capture) rather than keybindings: clipboard events fire regardless of
// whether the editor is focused — a handle-click or marquee selection blurs
// the editor, which is exactly when block copy must work — and the events
// allow synchronous clipboardData access with no async-permission dance.
//
// Payload: text/html carries a `data-parallx-blocks` attribute with the
// blocks' JSON (full fidelity — equations, colours, nested lists — because
// canvas content is stored as JSON, not HTML) plus a plaintext fallback for
// external apps.  On paste, the JSON marker wins; foreign clipboard content
// falls through to ProseMirror's normal paste.
//
// Gate: handles/ — imports only from handleRegistry.

import type { Editor } from '@tiptap/core';
import { Fragment } from '@tiptap/pm/model';
import type { BlockSelectionController } from './handleRegistry.js';
import { resolveMovableBlock, enumerateBlockUnits } from './handleRegistry.js';

const BLOCKS_ATTR = 'data-parallx-blocks';

export interface BlockClipboardHost {
  readonly editor: Editor | null;
  readonly editorContainer: HTMLElement | null;
  readonly blockSelection: BlockSelectionController;
}

interface ClipboardPayload {
  /** Top-level block JSON, list rows already wrapped in their list type. */
  readonly blocks: any[];
}

/**
 * In-app mirror of the last block copy/cut.  Chromium only fires `paste`
 * events at focused EDITABLE elements — after a marquee (which blurs the
 * editor) Ctrl+V produces no event at all, so the keydown fallback pastes
 * from this mirror.  Module-level on purpose: copying in one canvas pane and
 * pasting into another works.
 */
let _lastCopiedPayload: ClipboardPayload | null = null;

/** Strip `id` attrs recursively — UniqueID assigns fresh ones on insert,
 *  and duplicate ids from a copy would make it churn (or worse). */
function stripIds(json: any): any {
  if (Array.isArray(json)) return json.map(stripIds);
  if (!json || typeof json !== 'object') return json;
  const out: any = { ...json };
  if (out.attrs && typeof out.attrs === 'object' && 'id' in out.attrs) {
    const { id: _id, ...rest } = out.attrs;
    out.attrs = rest;
    if (Object.keys(out.attrs).length === 0) delete out.attrs;
  }
  if (Array.isArray(out.content)) out.content = out.content.map(stripIds);
  return out;
}

export class BlockClipboardController {
  constructor(private readonly _host: BlockClipboardHost) {}

  setup(): void {
    document.addEventListener('copy', this._onCopy, true);
    document.addEventListener('cut', this._onCut, true);
    document.addEventListener('paste', this._onPaste, true);
    // Keydown fallback for Ctrl/Cmd+V in the blurred-with-block-selection
    // state, where the browser fires NO paste event (see _lastCopiedPayload).
    // Narrow by construction: requires this pane's block selection AND a
    // non-editable focus target — when an editable is focused the native
    // paste event path above owns the gesture.
    document.addEventListener('keydown', this._onKeyDown, true);
  }

  dispose(): void {
    document.removeEventListener('copy', this._onCopy, true);
    document.removeEventListener('cut', this._onCut, true);
    document.removeEventListener('paste', this._onPaste, true);
    document.removeEventListener('keydown', this._onKeyDown, true);
  }

  // ── Copy / Cut ────────────────────────────────────────────────────────────

  private readonly _onCopy = (e: ClipboardEvent): void => {
    if (this._writeSelectedBlocks(e)) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  };

  private readonly _onCut = (e: ClipboardEvent): void => {
    if (this._writeSelectedBlocks(e)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      // Cut = the blocks travel; page-linked blocks keep their child pages
      // alive for the paste (deleting them would orphan the pasted copy).
      this._host.blockSelection.deleteSelected({ notifyLinkedPages: false });
    }
  };

  /**
   * Serialize the current block selection into the event's clipboardData.
   * Returns false (untouched event) when this pane has no block selection —
   * normal text copy proceeds.
   */
  private _writeSelectedBlocks(e: ClipboardEvent): boolean {
    const editor = this._host.editor;
    const sel = this._host.blockSelection;
    if (!editor || !sel.hasSelection || !e.clipboardData) return false;

    const doc = editor.state.doc;
    const blocks: any[] = [];
    const texts: string[] = [];
    let openList: { type: string; content: any[] } | null = null;
    let lastEnd = -1;

    for (const pos of sel.positions) {
      const node = doc.nodeAt(pos);
      if (!node) continue;
      texts.push(node.textContent);
      const typeName = node.type.name;
      if (typeName === 'listItem' || typeName === 'taskItem') {
        const listType = doc.resolve(pos).parent.type.name;
        // Consecutive rows from the same list stay one list in the payload.
        if (openList && openList.type === listType && pos === lastEnd) {
          openList.content.push(node.toJSON());
        } else {
          openList = { type: listType, content: [node.toJSON()] };
          blocks.push(openList);
        }
        lastEnd = pos + node.nodeSize;
      } else {
        openList = null;
        blocks.push(node.toJSON());
      }
    }
    if (blocks.length === 0) return false;

    const payload: ClipboardPayload = { blocks: stripIds(blocks) };
    _lastCopiedPayload = payload;
    const html = `<div ${BLOCKS_ATTR}="${encodeURIComponent(JSON.stringify(payload))}"></div>`;
    e.clipboardData.setData('text/html', html);
    e.clipboardData.setData('text/plain', texts.join('\n'));
    return true;
  }

  // ── Paste ─────────────────────────────────────────────────────────────────

  private readonly _onPaste = (e: ClipboardEvent): void => {
    const editor = this._host.editor;
    if (!editor || !e.clipboardData) return;

    const payload = this._readPayload(e.clipboardData);
    if (!payload) return; // foreign content — ProseMirror's paste handles it

    // This pane is the paste target when its blocks are selected or its
    // editor holds the caret.
    const sel = this._host.blockSelection;
    const active = document.activeElement;
    const inEditor = !!active && !!this._host.editorContainer?.contains(active);
    if (!sel.hasSelection && !inEditor) return;

    e.preventDefault();
    e.stopImmediatePropagation();
    this._pasteBlocks(payload);
  };

  private readonly _onKeyDown = (e: KeyboardEvent): void => {
    if (e.key.toLowerCase() !== 'v' || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
    const sel = this._host.blockSelection;
    if (!sel.hasSelection || !_lastCopiedPayload) return;
    // An editable focus target means the native paste event will fire —
    // that path owns the gesture (and can carry foreign clipboard content).
    const active = document.activeElement as HTMLElement | null;
    if (active && (active.isContentEditable
      || active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;

    e.preventDefault();
    e.stopImmediatePropagation();
    this._pasteBlocks(_lastCopiedPayload);
  };

  private _pasteBlocks(payload: ClipboardPayload): void {
    const editor = this._host.editor;
    if (!editor) return;
    const sel = this._host.blockSelection;

    // Insert after the LAST selected block, or after the caret's block unit.
    let insertPos: number | null = null;
    let targetListType: string | null = null;
    if (sel.hasSelection) {
      const last = sel.positions[sel.positions.length - 1];
      const node = editor.state.doc.nodeAt(last);
      if (node) {
        insertPos = last + node.nodeSize;
        if (node.type.name === 'listItem' || node.type.name === 'taskItem') {
          targetListType = editor.state.doc.resolve(last).parent.type.name;
        }
      }
    } else {
      const unit = resolveMovableBlock(editor.state.selection.$head);
      if (unit) {
        insertPos = unit.pos + unit.node.nodeSize;
        if (unit.isListItem) targetListType = unit.listType;
      }
    }
    if (insertPos === null) return;

    // Raw tr.insert — the same primitive the drop path uses (ProseMirror's
    // replace-fitting splits the target list around foreign blocks).  Same
    // strategy as drop for a row-boundary target: a payload list of the SAME
    // type contributes its ROWS raw — items into a list need no join, so
    // AutoJoiner never has to (its tr.join throws on the shapes fitting
    // produces at row boundaries).
    let totalSize = 0;
    try {
      const nodes: any[] = [];
      for (const json of payload.blocks) {
        const node = editor.state.schema.nodeFromJSON(json);
        if (targetListType !== null && node.type.name === targetListType) {
          node.forEach((row: any) => nodes.push(row));
        } else {
          nodes.push(node);
        }
      }
      for (const n of nodes) totalSize += n.nodeSize;
      const { tr } = editor.state;
      tr.insert(insertPos, Fragment.from(nodes));
      editor.view.dispatch(tr);
    } catch (err) {
      console.warn('[BlockClipboard] paste insert failed:', err);
      return;
    }

    // Select what was pasted (Notion parity) so a follow-up move/delete/copy
    // acts on it — as canonical UNITS (list rows, not wrappers), the same
    // model everything else speaks. Best-effort: fitting/AutoJoiner can
    // shift the bounds when merging into neighbours.
    try {
      const endPos = insertPos + totalSize;
      const positions = enumerateBlockUnits(editor.state.doc)
        .filter((u) => u.pos >= insertPos && u.pos < endPos)
        .map((u) => u.pos);
      if (positions.length > 0) sel.selectMultiple(positions);
    } catch { /* selection is a nicety — paste already landed */ }
  }

  private _readPayload(data: DataTransfer): ClipboardPayload | null {
    const html = data.getData('text/html');
    if (!html || !html.includes(BLOCKS_ATTR)) return null;
    const match = html.match(new RegExp(`${BLOCKS_ATTR}="([^"]+)"`));
    if (!match) return null;
    try {
      const payload = JSON.parse(decodeURIComponent(match[1]));
      if (!payload || !Array.isArray(payload.blocks) || payload.blocks.length === 0) return null;
      return payload as ClipboardPayload;
    } catch {
      return null;
    }
  }
}
