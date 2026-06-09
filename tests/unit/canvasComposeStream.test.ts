import { describe, expect, it } from 'vitest';
import { ComposeStreamSession, type IComposeStreamPatch } from '../../src/built-in/canvas/composeStreamSession';
import { markdownToTiptapJson } from '../../src/built-in/canvas/markdownImport';

// Apply a patch the way the editor pane does (replace the index span). The
// ProseMirror-level replaceWith over an index span is proven with real PM in
// canvasBlockDiff.test.ts — here we verify the SESSION emits the right spans.
function applyPatch(blocks: unknown[], patch: IComposeStreamPatch): unknown[] {
  return [...blocks.slice(0, patch.start), ...patch.blocks, ...blocks.slice(patch.oldEnd)];
}

const FULL_MD = '# Q3 Plan\n\nFirst paragraph of the plan.\n\n## Goals\n\n- Ship the feature\n- Fix the bugs\n\nClosing summary.';

describe('ComposeStreamSession — token deltas → surgical block patches', () => {
  it('reconstructs the exact full-parse doc from arbitrary token-sized deltas', () => {
    const session = new ComposeStreamSession();
    let editorDoc: unknown[] = [];

    // Stream in awkward little chunks (mid-word, mid-line) like a real model.
    for (let i = 0; i < FULL_MD.length; i += 3) {
      const patch = session.push(FULL_MD.slice(i, i + 3));
      if (patch) editorDoc = applyPatch(editorDoc, patch);
    }

    // The patched editor doc equals what a one-shot parse of the full markdown
    // produces — streaming loses nothing.
    const oneShot = markdownToTiptapJson(FULL_MD, { assignBlockIds: false }).content;
    expect(editorDoc).toEqual(oneShot);
    expect(editorDoc).toEqual([...session.children]);
    expect(session.markdown).toBe(FULL_MD);
  });

  it('leaves completed blocks untouched — patches converge on the tail', () => {
    const session = new ComposeStreamSession();
    session.push('# Title\n\nFirst para complete.\n\n');
    // Once a later block starts, further deltas must not touch block 0/1.
    const patches: IComposeStreamPatch[] = [];
    for (const delta of ['Second para', ' is now', ' growing.']) {
      const p = session.push(delta);
      if (p) patches.push(p);
    }
    for (const p of patches) {
      expect(p.start).toBeGreaterThanOrEqual(1); // the title (block 0) is never re-replaced
    }
    // And the LAST patches only touch the growing tail block.
    expect(patches[patches.length - 1].start).toBe(2);
  });

  it('returns null for deltas that do not change the visible doc, and on empty starts', () => {
    const session = new ComposeStreamSession();
    expect(session.push('')).toBeNull();
    const first = session.push('Hello');
    expect(first).not.toBeNull();
    expect(session.push('')).toBeNull(); // no change → no patch
  });

  it('handles a multi-block burst in one delta (one span patch)', () => {
    const session = new ComposeStreamSession();
    session.push('Intro.\n\n');
    const p = session.push('## A\n\nbody A\n\n## B\n\nbody B');
    expect(p).not.toBeNull();
    let doc: unknown[] = [...markdownToTiptapJson('Intro.\n\n', { assignBlockIds: false }).content];
    doc = applyPatch(doc, p!);
    expect(doc).toEqual(markdownToTiptapJson('Intro.\n\n## A\n\nbody A\n\n## B\n\nbody B', { assignBlockIds: false }).content);
  });
});
