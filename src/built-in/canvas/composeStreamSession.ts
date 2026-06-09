// composeStreamSession.ts — the pure core of live page composition.
//
// As the model streams markdown for a page body (canvas_compose_page), each
// delta re-parses the accumulated markdown and is reduced to an INDEX-BASED
// patch over the previous parse: "replace blocks [start, oldEnd) with these new
// blocks". The open editor applies each patch as one surgical ProseMirror
// replaceWith — so completed blocks sit still while the tail block visibly
// grows, which is what makes the stream read as "the AI is typing".
//
// Diffing parse-N against parse-N-1 (instead of against the live editor doc) is
// load-bearing: the editor assigns UniqueIDs to inserted blocks, so its JSON
// never deep-equals the id-less parsed markdown. Indices stay aligned because
// during a stream only these patches mutate the doc.
//
// Pure + DOM-free by design; the editor pane owns the ProseMirror application.

import { markdownToTiptapJson } from './markdownImport.js';
import { diffTopLevel } from './canvasDocDiff.js';

export interface IComposeStreamPatch {
  /** First changed top-level block index. */
  readonly start: number;
  /** End (exclusive) of the replaced span in the CURRENT editor doc. */
  readonly oldEnd: number;
  /** Replacement block JSON for the span. */
  readonly blocks: readonly unknown[];
}

export class ComposeStreamSession {
  private _markdown = '';
  private _prevChildren: unknown[] = [];

  /** The full markdown accumulated so far. */
  get markdown(): string { return this._markdown; }

  /** Top-level block JSON of the latest parse (the doc the editor should show). */
  get children(): readonly unknown[] { return this._prevChildren; }

  /**
   * Ingest a content delta. Returns the minimal patch to apply to the editor,
   * or null when the visible doc doesn't change yet (e.g. mid-token whitespace).
   */
  push(delta: string): IComposeStreamPatch | null {
    this._markdown += delta;
    if (!this._markdown.trim()) return null; // nothing visible yet
    let children: unknown[];
    try {
      // assignBlockIds:false is load-bearing: the default stamps a fresh random
      // id per block PER PARSE, which would make every re-parse deep-unequal and
      // degrade each patch to a whole-doc replace. Id-less blocks are stamped by
      // the editor's unique-id extension when inserted.
      const doc = markdownToTiptapJson(this._markdown, { assignBlockIds: false });
      children = Array.isArray(doc.content) ? doc.content : [];
    } catch {
      return null; // partial markdown can transiently fail to parse — wait for more
    }
    if (children.length === 0) return null;

    const diff = diffTopLevel(this._prevChildren, children);
    if (!diff) return null;
    const patch: IComposeStreamPatch = {
      start: diff.start,
      oldEnd: diff.oldEnd,
      blocks: children.slice(diff.start, diff.newEnd),
    };
    this._prevChildren = children;
    return patch;
  }
}
