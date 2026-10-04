// inlineAIReplace.ts — the Replace action of the inline AI chat
//
// The chat stays open while the reply streams in, and the page can change
// meanwhile (typing, an AI edit, a collaborator's sync).  So the selected
// range is tracked through every transaction instead of kept as the numbers
// captured on open, and Replace refuses when the selected text itself was
// edited or deleted.  The selection goes to the AI as lossless markdown and
// the reply is read back as markdown, so `**bold**` becomes bold, not
// asterisks, and formatting the AI kept survives.

import type { Node as PMNode, Schema } from '@tiptap/pm/model';
import { Fragment, Slice } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import { tiptapJsonToMarkdown } from '../markdownExport.js';
import { markdownToTiptapJson, type TipTapNode } from '../markdownImport.js';

/** The selection as markdown, for the AI to read and rewrite. */
export function selectionToMarkdown(doc: PMNode, from: number, to: number): string {
  // Inside one paragraph or list, the slice is that node's children; wrap them
  // in their parents until they stand as page blocks.
  const $from = doc.resolve(from);
  let content = doc.slice(from, to).content;
  for (let d = $from.sharedDepth(to); d > 0 && !doc.type.validContent(content); d--) {
    content = Fragment.from($from.node(d).copy(content));
  }
  const json = { type: 'doc', content: content.toJSON() ?? [] };
  return tiptapJsonToMarkdown(json).trim();
}

function stripIds(node: TipTapNode): TipTapNode {
  const out: TipTapNode = { ...node };
  if (out.attrs && 'id' in out.attrs) {
    const { id: _id, ...rest } = out.attrs;
    out.attrs = rest;
  }
  if (out.content) out.content = out.content.map(stripIds);
  return out;
}

/**
 * The reply as content to put in place of the selection.  Opened as deep as
 * it goes, the way a paste is: a one-paragraph reply joins the surrounding
 * paragraph instead of splitting it.  Ids are left off; the editor gives new
 * blocks their own.
 */
export function replySlice(schema: Schema, markdown: string): Slice {
  const json = stripIds(markdownToTiptapJson(markdown.trim(), { assignBlockIds: false }));
  const doc = schema.nodeFromJSON(json);
  return Slice.maxOpen(doc.content);
}

/** A selected range kept in step with the document. */
export class TrackedRange {
  private _lost = false;

  constructor(
    private _from: number,
    private _to: number,
    readonly text: string,
  ) {}

  get from(): number { return this._from; }
  get to(): number { return this._to; }

  /** Map the range through a transaction applied to the document. */
  map(tr: Transaction): void {
    if (this._lost || !tr.docChanged) return;
    const from = tr.mapping.mapResult(this._from, 1);
    const to = tr.mapping.mapResult(this._to, -1);
    if (to.pos <= from.pos) { this._lost = true; return; }
    this._from = from.pos;
    this._to = to.pos;
  }

  /** Still the same text at the tracked place. */
  isIntact(doc: PMNode): boolean {
    if (this._lost || this._to > doc.content.size) return false;
    return doc.textBetween(this._from, this._to) === this.text;
  }
}
