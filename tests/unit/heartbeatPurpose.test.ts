// heartbeatPurpose.test.ts — M87 S2: the HEARTBEAT.md purpose file (parse /
// add / remove / prompt block) and the heartbeat_watch tool over injected
// file access. Pure + fakes; fully headless.

import { describe, expect, it } from 'vitest';
import {
  HEARTBEAT_PURPOSE_PATH,
  HEARTBEAT_PURPOSE_TEMPLATE,
  addWatch,
  formatWatchesBlock,
  parseHeartbeatPurpose,
  removeWatch,
} from '../../src/openclaw/heartbeatPurpose';
import { createHeartbeatWatchTool } from '../../src/built-in/chat/tools/heartbeatWatchTool';

const CANCEL = { isCancellationRequested: false, isYieldRequested: false, onCancellationRequested: () => ({ dispose() {} }) };

describe('parseHeartbeatPurpose', () => {
  it('reads bullets under ## Watch and ignores other sections', () => {
    const md = [
      '# HEARTBEAT.md',
      '',
      '## Notes',
      '- not a watch',
      '',
      '## Watch',
      '- Warn me if the Exam 7 page goes a week without edits.',
      '- Tell me when more than 3 pages are unlinked.',
      '',
      '## Other',
      '- also not a watch',
    ].join('\n');
    expect(parseHeartbeatPurpose(md).watches).toEqual([
      'Warn me if the Exam 7 page goes a week without edits.',
      'Tell me when more than 3 pages are unlinked.',
    ]);
  });

  it('the scaffold template parses to ZERO watches (example line is inert)', () => {
    expect(parseHeartbeatPurpose(HEARTBEAT_PURPOSE_TEMPLATE).watches).toEqual([]);
  });

  it('empty/missing content parses to zero watches', () => {
    expect(parseHeartbeatPurpose('').watches).toEqual([]);
    expect(parseHeartbeatPurpose('# Nothing here').watches).toEqual([]);
  });
});

describe('addWatch / removeWatch', () => {
  it('add appends under ## Watch and round-trips through parse', () => {
    const next = addWatch(HEARTBEAT_PURPOSE_TEMPLATE, 'Warn me if sync fails twice in a row.');
    expect(parseHeartbeatPurpose(next).watches).toEqual(['Warn me if sync fails twice in a row.']);
  });

  it('add is idempotent for duplicate watches (case-insensitive)', () => {
    const once = addWatch(HEARTBEAT_PURPOSE_TEMPLATE, 'Watch the leak.');
    const twice = addWatch(once, 'watch the LEAK.');
    expect(twice).toBe(once);
  });

  it('add creates the ## Watch section when missing', () => {
    const next = addWatch('# Custom file\n\nSome prose.\n', 'A new watch.');
    expect(parseHeartbeatPurpose(next).watches).toEqual(['A new watch.']);
  });

  it('remove deletes matching watches and reports the count', () => {
    let md = addWatch(HEARTBEAT_PURPOSE_TEMPLATE, 'Warn me about the leak.');
    md = addWatch(md, 'Warn me about the exam.');
    const { content, removed } = removeWatch(md, 'leak');
    expect(removed).toBe(1);
    expect(parseHeartbeatPurpose(content).watches).toEqual(['Warn me about the exam.']);
  });

  it('remove never touches non-watch sections', () => {
    const md = '## Notes\n- leak in the notes\n\n## Watch\n- Warn me about the leak.\n';
    const { content, removed } = removeWatch(md, 'leak');
    expect(removed).toBe(1);
    expect(content).toContain('- leak in the notes');
  });
});

describe('formatWatchesBlock (UC6 prompt inclusion)', () => {
  it('renders each watch verbatim with the evaluation instruction', () => {
    const block = formatWatchesBlock(['Warn me if X.', 'Tell me when Y.']);
    expect(block).toContain('STANDING WATCHES');
    expect(block).toContain(HEARTBEAT_PURPOSE_PATH);
    expect(block).toContain('- Warn me if X.');
    expect(block).toContain('- Tell me when Y.');
  });

  it('renders NOTHING for zero watches (clean seed on fresh workspaces)', () => {
    expect(formatWatchesBlock([])).toBe('');
  });
});

describe('heartbeat_watch tool', () => {
  function makeFiles(initial?: string) {
    const store = new Map<string, string>();
    if (initial !== undefined) store.set(HEARTBEAT_PURPOSE_PATH, initial);
    return {
      store,
      access: {
        readFile: async (p: string) => store.get(p) ?? null,
        writeFile: async (p: string, c: string) => { store.set(p, c); },
      },
    };
  }

  it('add on a MISSING file scaffolds from the template and persists the watch', async () => {
    const { store, access } = makeFiles();
    const tool = createHeartbeatWatchTool(access);
    const res = await tool.handler({ action: 'add', watch: 'Warn me if the review queue explodes.' }, CANCEL as never);
    expect(res.isError).toBeUndefined();
    expect(JSON.parse(res.content)).toMatchObject({ added: true, watches: ['Warn me if the review queue explodes.'] });
    const written = store.get(HEARTBEAT_PURPOSE_PATH)!;
    expect(written).toContain('## Watch');
    expect(parseHeartbeatPurpose(written).watches).toHaveLength(1);
  });

  it('list returns current watches', async () => {
    const { access } = makeFiles(addWatch(HEARTBEAT_PURPOSE_TEMPLATE, 'Watch A.'));
    const tool = createHeartbeatWatchTool(access);
    const res = await tool.handler({ action: 'list' }, CANCEL as never);
    expect(JSON.parse(res.content).watches).toEqual(['Watch A.']);
  });

  it('remove deletes by substring and reports zero on no match', async () => {
    const { access } = makeFiles(addWatch(HEARTBEAT_PURPOSE_TEMPLATE, 'Watch the exam page.'));
    const tool = createHeartbeatWatchTool(access);

    const hit = await tool.handler({ action: 'remove', match: 'exam' }, CANCEL as never);
    expect(JSON.parse(hit.content)).toMatchObject({ removed: 1, watches: [] });

    const miss = await tool.handler({ action: 'remove', match: 'nothing' }, CANCEL as never);
    expect(JSON.parse(miss.content).removed).toBe(0);
  });

  it('validates arguments', async () => {
    const { access } = makeFiles();
    const tool = createHeartbeatWatchTool(access);
    expect((await tool.handler({ action: 'add' }, CANCEL as never)).isError).toBe(true);
    expect((await tool.handler({ action: 'remove' }, CANCEL as never)).isError).toBe(true);
    expect((await tool.handler({ action: 'explode' }, CANCEL as never)).isError).toBe(true);
  });
});
