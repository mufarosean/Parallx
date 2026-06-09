import { describe, expect, it, vi } from 'vitest';
import { createComposePageRuntime, FenceStripper } from '../../src/built-in/canvas/ai/composePageRuntime';
import type { ICancellationToken } from '../../src/services/chatTypes';

function makeToken(): ICancellationToken & { cancel(): void } {
  let cancelled = false;
  const listeners: (() => void)[] = [];
  return {
    get isCancellationRequested() { return cancelled; },
    onCancellationRequested(fn: () => void) { listeners.push(fn); return { dispose() {} }; },
    cancel() { cancelled = true; listeners.forEach((f) => f()); },
  } as never;
}

function makeSink(opts: { beginOk?: boolean; commitOk?: boolean } = {}) {
  const pushed: string[] = [];
  const sink = {
    pushed,
    began: false,
    ended: undefined as boolean | undefined,
    begin: vi.fn(() => { sink.began = true; return opts.beginOk !== false; }),
    push: vi.fn((d: string) => { pushed.push(d); }),
    end: vi.fn(async (commit: boolean) => { sink.ended = commit; return opts.commitOk !== false; }),
  };
  return sink;
}

async function* stream(...chunks: string[]) {
  for (const c of chunks) yield { content: c, done: false };
}

function makeDeps(sink: ReturnType<typeof makeSink> | undefined, chunks: string[], opts: { failStream?: boolean } = {}) {
  const writes: { pageId: string; markdown: string }[] = [];
  return {
    writes,
    deps: {
      getPage: async (id: string) => (id === 'p1' ? { title: 'Q3 Plan', bodyMarkdown: 'old body' } : null),
      getSink: () => sink as never,
      sendChatRequest: (_m: never, _s: AbortSignal) => {
        if (opts.failStream) throw new Error('model exploded');
        return stream(...chunks);
      },
      writeBody: async (pageId: string, markdown: string) => { writes.push({ pageId, markdown }); },
    },
  };
}

describe('canvas_compose_page runtime', () => {
  it('streams every delta into the open pane and COMMITS through it', async () => {
    const sink = makeSink();
    const { deps, writes } = makeDeps(sink, ['# Title\n', '\nBody para.']);
    const out = await createComposePageRuntime(deps as never)('p1', 'write it', makeToken());

    expect(out.ok).toBe(true);
    expect(sink.began).toBe(true);
    expect(sink.pushed.join('')).toBe('# Title\n\nBody para.');
    expect(sink.ended).toBe(true);           // committed via the pane
    expect(writes).toHaveLength(0);          // no direct write needed
    expect(out.summary).toContain('streamed live');
  });

  it('REVERTS the pane on cancellation and reports it', async () => {
    const sink = makeSink();
    const token = makeToken();
    const deps = {
      ...makeDeps(sink, []).deps,
      sendChatRequest: () => (async function* () {
        yield { content: 'partial...', done: false };
        token.cancel();
        yield { content: ' more', done: false };
      })(),
    };
    const out = await createComposePageRuntime(deps as never)('p1', 'write', token);
    expect(out.ok).toBe(false);
    expect(sink.ended).toBe(false); // revert
    expect(out.summary).toContain('cancelled');
  });

  it('falls back to a direct write when the pane dies mid-stream (content never lost)', async () => {
    const sink = makeSink({ commitOk: false }); // pane closed → commit fails
    const { deps, writes } = makeDeps(sink, ['saved content']);
    const out = await createComposePageRuntime(deps as never)('p1', 'write', makeToken());
    expect(out.ok).toBe(true);
    expect(writes).toEqual([{ pageId: 'p1', markdown: 'saved content' }]);
  });

  it('writes directly (no streaming) when the page is not open', async () => {
    const { deps, writes } = makeDeps(undefined, ['# Direct\n\nwrite.']);
    const out = await createComposePageRuntime(deps as never)('p1', 'write', makeToken());
    expect(out.ok).toBe(true);
    expect(writes).toHaveLength(1);
    expect(writes[0].markdown).toBe('# Direct\n\nwrite.');
    expect(out.summary).not.toContain('streamed live');
  });

  it('reverts and errors on an empty model result / unknown page / stream failure', async () => {
    const sink = makeSink();
    const empty = await createComposePageRuntime(makeDeps(sink, ['   ']).deps as never)('p1', 'write', makeToken());
    expect(empty.ok).toBe(false);
    expect(sink.ended).toBe(false);

    const missing = await createComposePageRuntime(makeDeps(undefined, ['x']).deps as never)('nope', 'write', makeToken());
    expect(missing.ok).toBe(false);
    expect(missing.summary).toContain('not found');

    const sink2 = makeSink();
    const failDeps = {
      ...makeDeps(sink2, []).deps,
      sendChatRequest: () => (async function* (): AsyncIterable<{ content: string; done: boolean }> {
        yield { content: 'a bit', done: false };
        throw new Error('connection lost');
      })(),
    };
    const failed = await createComposePageRuntime(failDeps as never)('p1', 'write', makeToken());
    expect(failed.ok).toBe(false);
    expect(failed.summary).toContain('connection lost');
    expect(sink2.ended).toBe(false); // reverted
  });
});

describe('FenceStripper', () => {
  function run(deltas: string[]): string {
    const f = new FenceStripper();
    let out = '';
    for (const d of deltas) out += f.push(d);
    return out + f.flush();
  }

  it('strips a leading ```markdown fence and the trailing fence', () => {
    expect(run(['```markdown\n# Hi\n\nBody.\n```'])).toBe('# Hi\n\nBody.');
  });

  it('passes clean markdown through unchanged (any chunking)', () => {
    const md = '# Hi\n\nNo fences here.\n\n- a\n- b';
    expect(run([md])).toBe(md);
    expect(run(md.split(/(?<=.{4})/s))).toBe(md); // 4-char chunks
  });

  it('does not eat a legitimate inline code fence in the middle', () => {
    const md = 'Para.\n\n```js\ncode();\n```\n\nAfter.';
    expect(run([md])).toBe(md);
  });
});
