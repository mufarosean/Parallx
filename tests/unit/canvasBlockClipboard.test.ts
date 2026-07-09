// @vitest-environment jsdom
//
// canvasBlockClipboard.test.ts — block-level copy / cut / paste.
//
// Drives the REAL BlockClipboardController + BlockSelectionController with
// synthetic clipboard events on a full-plugin-stack editor (UniqueID +
// AutoJoiner — the pair whose interaction killed batch turn-into), covering:
// payload shape (rows grouped into their list, ids stripped), paste targeting
// (after selected block), cut (ghost-free source, child pages NOT deleted),
// paste adjacent to a same-type list, and foreign-clipboard passthrough.

import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import AutoJoiner from 'tiptap-extension-auto-joiner';
import UniqueID from '@tiptap/extension-unique-id';
import { UNIQUE_ID_BLOCK_TYPES } from '../../src/built-in/canvas/config/tiptapExtensions';
import { BlockClipboardController } from '../../src/built-in/canvas/handles/blockClipboard';
import { BlockSelectionController } from '../../src/built-in/canvas/handles/blockSelection';
import { enumerateBlockUnits } from '../../src/built-in/canvas/config/blockStateRegistry/blockUnit';

function p(text: string) { return { type: 'paragraph', content: [{ type: 'text', text }] }; }
function li(text: string) { return { type: 'listItem', content: [p(text)] }; }

interface Rig {
  ed: Editor;
  sel: BlockSelectionController;
  clip: BlockClipboardController;
  container: HTMLElement;
}

const rigs: Rig[] = [];

function makeRig(content: any): Rig {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const ed = new Editor({
    element: container,
    extensions: [
      StarterKit, TaskList, TaskItem.configure({ nested: true }), AutoJoiner,
      UniqueID.configure({ types: UNIQUE_ID_BLOCK_TYPES }),
    ],
    content,
  });
  const host: any = { editor: ed, container, editorContainer: container, pageId: 't' };
  const sel = new BlockSelectionController(host);
  const clip = new BlockClipboardController({ editor: ed, editorContainer: container, blockSelection: sel });
  clip.setup();
  const rig = { ed, sel, clip, container };
  rigs.push(rig);
  return rig;
}

/** Tear down after each rig use so document-level listeners don't cross-talk. */
function teardown(rig: Rig): void {
  rig.clip.dispose();
  rig.container.remove();
}

function makeClipboardEvent(type: 'copy' | 'cut' | 'paste', seed?: Map<string, string>) {
  const store = seed ?? new Map<string, string>();
  const event = new Event(type, { cancelable: true }) as any;
  event.clipboardData = {
    setData: (t: string, v: string) => { store.set(t, v); },
    getData: (t: string) => store.get(t) ?? '',
  };
  return { event: event as ClipboardEvent, store };
}

function unitPos(ed: Editor, text: string): number {
  const u = enumerateBlockUnits(ed.state.doc).find(
    (x) => x.node.child?.(0)?.textContent === text || x.node.textContent === text,
  );
  if (!u) throw new Error(`unit not found: ${text}`);
  return u.pos;
}

function allText(ed: Editor): string[] {
  const out: string[] = [];
  ed.state.doc.descendants((n) => { if (n.isText && n.text) out.push(n.text); return true; });
  return out;
}

describe('block copy', () => {
  it('copies the selected block as JSON payload + plaintext; ids stripped', () => {
    const rig = makeRig({ type: 'doc', content: [p('alpha'), p('beta')] });
    try {
      rig.sel.select(unitPos(rig.ed, 'alpha'));
      const { event, store } = makeClipboardEvent('copy');
      document.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
      expect(store.get('text/plain')).toBe('alpha');
      const html = store.get('text/html')!;
      expect(html).toContain('data-parallx-blocks');
      expect(decodeURIComponent(html)).not.toContain('"id"');
    } finally { teardown(rig); }
  });

  it('groups consecutive selected rows into ONE list in the payload', () => {
    const rig = makeRig({ type: 'doc', content: [
      { type: 'bulletList', content: [li('r1'), li('r2'), li('r3')] },
    ]});
    try {
      rig.sel.selectMultiple([unitPos(rig.ed, 'r1'), unitPos(rig.ed, 'r2')]);
      const { event, store } = makeClipboardEvent('copy');
      document.dispatchEvent(event);

      // Extract the encoded attribute from RAW html, THEN decode (decoding
      // first would surface the JSON's own quotes and break the match).
      const html = store.get('text/html')!;
      const payload = JSON.parse(decodeURIComponent(html.match(/data-parallx-blocks="([^"]+)"/)![1]));
      expect(payload.blocks).toHaveLength(1);
      expect(payload.blocks[0].type).toBe('bulletList');
      expect(payload.blocks[0].content).toHaveLength(2);
    } finally { teardown(rig); }
  });

  it('does NOT intercept copy when no block selection is active', () => {
    const rig = makeRig({ type: 'doc', content: [p('alpha')] });
    try {
      const { event } = makeClipboardEvent('copy');
      document.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    } finally { teardown(rig); }
  });
});

describe('block paste', () => {
  it('pastes after the selected block and selects the pasted units', () => {
    const rig = makeRig({ type: 'doc', content: [p('alpha'), p('beta')] });
    try {
      // copy alpha
      rig.sel.select(unitPos(rig.ed, 'alpha'));
      const { event: copyEv, store } = makeClipboardEvent('copy');
      document.dispatchEvent(copyEv);

      // select beta, paste
      rig.sel.select(unitPos(rig.ed, 'beta'));
      const { event: pasteEv } = makeClipboardEvent('paste', store);
      document.dispatchEvent(pasteEv);

      expect(pasteEv.defaultPrevented).toBe(true);
      expect(allText(rig.ed)).toEqual(['alpha', 'beta', 'alpha']);
      // pasted block is selected
      expect(rig.sel.hasSelection).toBe(true);
      const selectedTexts = rig.sel.positions.map(
        (pos) => rig.ed.state.doc.nodeAt(pos)?.textContent,
      );
      expect(selectedTexts).toEqual(['alpha']);
    } finally { teardown(rig); }
  });

  it('pasting rows next to a SAME-TYPE list survives the full plugin stack', () => {
    const rig = makeRig({ type: 'doc', content: [
      { type: 'bulletList', content: [li('src1'), li('src2')] },
      { type: 'bulletList', content: [li('target')] },
    ]});
    try {
      rig.sel.selectMultiple([unitPos(rig.ed, 'src1'), unitPos(rig.ed, 'src2')]);
      const { event: copyEv, store } = makeClipboardEvent('copy');
      document.dispatchEvent(copyEv);

      rig.sel.select(unitPos(rig.ed, 'target'));
      const { event: pasteEv } = makeClipboardEvent('paste', store);
      document.dispatchEvent(pasteEv);

      expect(pasteEv.defaultPrevented).toBe(true);
      // No throw (AutoJoiner join + UniqueID combine survived), all text present.
      expect(allText(rig.ed)).toEqual(['src1', 'src2', 'target', 'src1', 'src2']);
    } finally { teardown(rig); }
  });

  it('foreign clipboard content (no marker) is left to the default paste', () => {
    const rig = makeRig({ type: 'doc', content: [p('alpha')] });
    try {
      rig.sel.select(unitPos(rig.ed, 'alpha'));
      const seed = new Map([['text/html', '<b>external</b>'], ['text/plain', 'external']]);
      const { event } = makeClipboardEvent('paste', seed);
      document.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
      expect(allText(rig.ed)).toEqual(['alpha']);
    } finally { teardown(rig); }
  });
});

describe('block cut', () => {
  it('cut removes the blocks (ghost-free) and paste restores them', () => {
    const rig = makeRig({ type: 'doc', content: [
      { type: 'bulletList', content: [li('only-row')] },
      p('landing'),
    ]});
    try {
      rig.sel.select(unitPos(rig.ed, 'only-row'));
      const { event: cutEv, store } = makeClipboardEvent('cut');
      document.dispatchEvent(cutEv);

      expect(cutEv.defaultPrevented).toBe(true);
      // Source removed with its emptied wrapper — no ghost bullet.
      expect(allText(rig.ed)).toEqual(['landing']);
      let bulletLists = 0;
      rig.ed.state.doc.descendants((n) => { if (n.type.name === 'bulletList') bulletLists++; return true; });
      expect(bulletLists).toBe(0);

      // Paste after 'landing' restores the row as a list again.
      rig.sel.select(unitPos(rig.ed, 'landing'));
      const { event: pasteEv } = makeClipboardEvent('paste', store);
      document.dispatchEvent(pasteEv);
      expect(allText(rig.ed)).toEqual(['landing', 'only-row']);
    } finally { teardown(rig); }
  });
});
