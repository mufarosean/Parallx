// canvasSearchText.test.ts — page text for search and the index: a word split
// by formatting stays one word, and the stored JSON is never searched.

import { describe, it, expect } from 'vitest';
import { extractTextFromBlock } from '../../src/services/chunkingService';
import { extractTextContent } from '../../src/built-in/chat/tools/builtInTools';
import { createFindPagesTool } from '../../src/built-in/canvas/ai/pageTools';
import { realSqlite } from './realSqlite';

const para = (...pieces: unknown[]) => ({ type: 'paragraph', attrs: { id: 'p' }, content: pieces });
const t = (text: string, bold = false) => (bold ? { type: 'text', text, marks: [{ type: 'bold' }] } : { type: 'text', text });
const stored = (...blocks: unknown[]) => JSON.stringify({ schemaVersion: 2, doc: { type: 'doc', content: blocks } });

describe('page text keeps words whole', () => {
  it('the index text joins a line\'s pieces and puts blocks on their own lines', () => {
    const doc = { type: 'doc', content: [para(t('Para'), t('llx', true), t(' is here')), para(t('next'))] };
    expect(extractTextFromBlock(doc as never)).toBe('Parallx is here\nnext');
  });

  it('search and snippet text joins a line\'s pieces too', () => {
    expect(extractTextContent(stored(para(t('Para'), t('llx', true)), para(t('two'))))).toBe('Parallx two');
  });
});

describe('canvas_find_pages matches the page text, not its JSON', () => {
  it('finds a word split by formatting and not words that are only JSON keys', async () => {
    const env = realSqlite();
    const add = (id: string, title: string, content: string) =>
      env.db.prepare('INSERT INTO pages (id, title, content) VALUES (?, ?, ?)').run(id, title, content);
    add('a', 'Notes', stored(para(t('About Para'), t('llx', true))));
    add('b', 'Other', stored(para(t('Unrelated text'))));
    const tool = createFindPagesTool(env.toolDb as never);
    const run = (query: string) => tool.handler({ query }, { isCancellationRequested: false } as never);

    expect((await run('Parallx')).content).toContain('Notes');
    const keys = await run('paragraph');
    expect(keys.content).not.toContain('Notes');
    expect(keys.content).not.toContain('Other');
    expect((await run('attrs')).content).toMatch(/No pages found/);
    expect((await run('other')).content).toContain('Other'); // the title still counts
  });
});
