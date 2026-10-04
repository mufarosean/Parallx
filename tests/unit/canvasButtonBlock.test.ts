// canvasButtonBlock.test.ts — the Button block's actions.

import { describe, it, expect, vi } from 'vitest';
import { parseButtonActions, fillPlaceholders, runButtonActions, type ButtonAction } from '../../src/built-in/canvas/extensions/buttonNode';
import { tiptapJsonToMarkdown } from '../../src/built-in/canvas/markdownExport';
import { markdownToTiptapJson } from '../../src/built-in/canvas/markdownImport';

const now = new Date(2026, 9, 4, 9, 5);

function ctx() {
  return {
    inserted: [] as { content: any[]; where: string }[],
    insert: vi.fn(function (this: any, content: unknown[], where: 'below' | 'above') { (ctx as any)._last = { content, where }; return true; }),
    addRow: vi.fn(async (_db: string, title: string) => `row:${title}`),
    openPage: vi.fn(),
    executeCommand: vi.fn(async () => undefined),
    now,
  };
}

describe('stored actions', () => {
  it('reads valid actions and drops malformed ones', () => {
    const raw = JSON.stringify([
      { type: 'insert', markdown: '- [ ] a', where: 'above' },
      { type: 'nope' }, 'text', null,
      { type: 'addRow', databaseId: 'd1', title: 'T', open: true },
      { type: 'openPage', pageId: 'p1' },
    ]);
    expect(parseButtonActions(raw)).toEqual([
      { type: 'insert', markdown: '- [ ] a', where: 'above' },
      { type: 'addRow', databaseId: 'd1', title: 'T', open: true },
      { type: 'openPage', pageId: 'p1' },
    ]);
    expect(parseButtonActions('{broken')).toEqual([]);
    expect(parseButtonActions('')).toEqual([]);
  });
  it('fills {{date}} and {{time}}', () => {
    expect(fillPlaceholders('Log {{date}} at {{ time }}', now)).toBe('Log 2026-10-04 at 09:05');
  });
});

describe('running', () => {
  it('runs every action in order: insert, add row (opened), open page, ask AI, command', async () => {
    const c = ctx();
    const actions: ButtonAction[] = [
      { type: 'insert', markdown: '## {{date}}\n\n- [ ] Review', where: 'below' },
      { type: 'addRow', databaseId: 'db', title: 'Entry {{date}}', open: true },
      { type: 'openPage', pageId: 'p9' },
      { type: 'askAI', prompt: 'Plan {{date}}' },
      { type: 'command', commandId: 'canvas.newPage' },
    ];
    expect(await runButtonActions(actions, c)).toEqual({ ok: true });
    const [content, where] = c.insert.mock.calls[0]!;
    expect(where).toBe('below');
    expect((content as any[]).map((n) => n.type)).toEqual(['heading', 'taskList']);
    expect(tiptapJsonToMarkdown({ type: 'doc', content })).toContain('2026-10-04');
    expect(c.addRow).toHaveBeenCalledWith('db', 'Entry 2026-10-04');
    expect(c.openPage.mock.calls).toEqual([['row:Entry 2026-10-04'], ['p9']]);
    expect(c.executeCommand.mock.calls).toEqual([['chat.submitPrompt', { text: 'Plan 2026-10-04' }], ['canvas.newPage']]);
  });

  it('stops at the first failure and says which', async () => {
    const c = ctx();
    c.addRow.mockRejectedValueOnce(new Error('database is gone'));
    const result = await runButtonActions([
      { type: 'openPage', pageId: 'p1' },
      { type: 'addRow', databaseId: 'db', title: 'x', open: false },
      { type: 'openPage', pageId: 'p2' },
    ], c);
    expect(result).toEqual({ ok: false, failed: 1, error: 'database is gone' });
    expect(c.openPage.mock.calls).toEqual([['p1']]);
  });

  it('an unset choice is an error, a page that cannot be edited refuses inserts', async () => {
    const c = ctx();
    expect(await runButtonActions([{ type: 'openPage', pageId: '' }], c)).toMatchObject({ ok: false, error: 'No page chosen.' });
    c.insert.mockReturnValueOnce(false);
    expect(await runButtonActions([{ type: 'insert', markdown: 'x', where: 'below' }], c)).toMatchObject({ ok: false, error: 'This page cannot be edited.' });
  });
});

describe('Markdown', () => {
  it('a button keeps its label and actions', () => {
    const actions = JSON.stringify([{ type: 'openPage', pageId: 'p1' }]);
    const doc = { type: 'doc', content: [{ type: 'buttonBlock', attrs: { label: 'Go', actions } }] };
    const back = markdownToTiptapJson(tiptapJsonToMarkdown(doc)) as any;
    expect(back.content[0]).toMatchObject({ type: 'buttonBlock', attrs: { label: 'Go', actions } });
  });
});
