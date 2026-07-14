import { describe, it, expect } from 'vitest';
import { markdownToTiptapJson } from '../../src/built-in/canvas/markdownImport';
import { replaceWithMany, insertManyAfter, type DocNode } from '../../src/built-in/canvas/ai/blockApi';

// Mirrors what canvas_edit_block / canvas_insert_block_after now do: parse the
// content as markdown so blocks take the CORRECT type instead of flattening to
// a paragraph (the "AI uses the wrong blocks" bug).
function markdownToBlocks(md: string): DocNode[] {
  return (markdownToTiptapJson(md, { assignBlockIds: true }).content ?? []) as unknown as DocNode[];
}

const baseDoc = (): DocNode => ({
  type: 'doc',
  content: [{ type: 'paragraph', attrs: { id: 'b1' }, content: [{ type: 'text', text: 'old' }] }],
});

describe('markdown-aware canvas block edits', () => {
  it('edit: a heading replaces the paragraph and keeps the original blockId', () => {
    const blocks = markdownToBlocks('## Hello');
    blocks[0]!.attrs = { ...(blocks[0]!.attrs ?? {}), id: 'b1' };
    const out = replaceWithMany(baseDoc(), [0], blocks);
    expect(out.content![0]!.type).toBe('heading');
    expect(out.content![0]!.attrs!.id).toBe('b1');
  });

  it('edit: markdown that yields multiple blocks expands one block into several', () => {
    const blocks = markdownToBlocks('## Title\n\nbody text');
    expect(blocks.length).toBe(2);
    const out = replaceWithMany(baseDoc(), [0], blocks);
    expect(out.content!.length).toBe(2);
    expect(out.content![0]!.type).toBe('heading');
    expect(out.content![1]!.type).toBe('paragraph');
  });

  it('insert: a to-do becomes a taskList after the anchor (not a paragraph)', () => {
    const blocks = markdownToBlocks('- [ ] finish the audit');
    const out = insertManyAfter(baseDoc(), [0], blocks);
    expect(out.content!.length).toBe(2);
    expect(out.content![0]!.attrs!.id).toBe('b1'); // anchor untouched
    expect(out.content![1]!.type).toBe('taskList');
    expect(typeof out.content![1]!.attrs!.id).toBe('string'); // stamped id
  });

  it('insert: a bullet list becomes a bulletList', () => {
    const out = insertManyAfter(baseDoc(), [0], markdownToBlocks('- one\n- two'));
    expect(out.content![1]!.type).toBe('bulletList');
  });
});
