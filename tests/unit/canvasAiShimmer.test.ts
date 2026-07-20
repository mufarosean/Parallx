// @vitest-environment jsdom
// canvasAiShimmer.test.ts — M89 S3 presence: the AI-handoff shimmer.
// Decoration-only by construction — these tests pin that contract.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import { common, createLowlight } from 'lowlight';
import { createEditorExtensions } from '../../src/built-in/canvas/config/tiptapExtensions';

const lowlight = createLowlight(common);

const p = (t: string) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] });

function make(): Editor {
  return new Editor({
    element: document.createElement('div'),
    extensions: createEditorExtensions(lowlight, {}),
    content: { type: 'doc', content: [p('one'), p('two'), p('three')] },
  });
}

function shimmeredCount(ed: Editor): number {
  return ed.view.dom.querySelectorAll('.canvas-ai-shimmer').length;
}

describe('AI-handoff shimmer (M89 S3)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('external-apply transactions shimmer the touched blocks; user edits do not', () => {
    const ed = make();
    try {
      // A NORMAL edit: no shimmer.
      ed.commands.insertContentAt(2, 'x');
      expect(shimmeredCount(ed)).toBe(0);

      // An AI apply (same meta the doc-diff path stamps): shimmer appears.
      const tr = ed.state.tr;
      tr.insert(0, ed.state.schema.nodes.paragraph.create(null, ed.state.schema.text('ai wrote this')));
      tr.setMeta('addToHistory', false).setMeta('canvasExternalApply', true);
      ed.view.dispatch(tr);
      expect(shimmeredCount(ed)).toBeGreaterThan(0);
    } finally {
      ed.destroy();
    }
  });

  it('the shimmer clears itself after the timeout', () => {
    const ed = make();
    try {
      const tr = ed.state.tr;
      tr.insert(0, ed.state.schema.nodes.paragraph.create(null, ed.state.schema.text('ai')));
      tr.setMeta('canvasExternalApply', true);
      ed.view.dispatch(tr);
      expect(shimmeredCount(ed)).toBeGreaterThan(0);

      vi.advanceTimersByTime(1600);
      expect(shimmeredCount(ed)).toBe(0);
    } finally {
      ed.destroy();
    }
  });

  it('shimmer transactions never touch the document or history (undo-identity holds)', () => {
    const ed = make();
    try {
      const before = JSON.stringify(ed.getJSON());
      const tr = ed.state.tr;
      tr.insert(0, ed.state.schema.nodes.paragraph.create(null, ed.state.schema.text('ai')));
      tr.setMeta('addToHistory', false).setMeta('canvasExternalApply', true);
      ed.view.dispatch(tr);
      vi.advanceTimersByTime(1600); // clear transaction fires

      // The AI edit was addToHistory:false, and the shimmer-clear is too —
      // undo has NOTHING to do and the doc keeps the AI content.
      const withAi = JSON.stringify(ed.getJSON());
      ed.commands.undo();
      expect(JSON.stringify(ed.getJSON())).toBe(withAi);
      expect(withAi).not.toBe(before);
    } finally {
      ed.destroy();
    }
  });
});
