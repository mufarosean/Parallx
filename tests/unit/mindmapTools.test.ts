// mindmapTools.test.ts — the grounding rail and both AI doors.
//
// Written from the 2026-08-30 field failure: "map my Meyers notes" produced a
// generic design map because the model never read the notes. What these pins
// hold: a sourced board is REFUSED until the session has read the source,
// the refusal names the recovery, headless writes queue as pending skeletons
// in the envelope, and the editor door puts the source text inside the
// prompt with grounding rules.

import { describe, expect, it, vi } from 'vitest';
import {
  createMindmapTools,
  draftMindmapOutline,
} from '../../src/built-in/canvas/ai/mindmapTools';
import { markResourceSeen, pageResourceKey } from '../../src/services/toolResourceRegistry';
import { toBoardEnvelope } from '../../src/built-in/canvas/mindmap/boardConvert';

const CANCEL: any = { isCancellationRequested: false };

function makeDeps() {
  const saved = new Map<string, string>();
  let nextId = 0;
  const mindmaps: any = {
    createMindmap: vi.fn(async (opts: { title?: string; parentId?: string | null }) => ({
      id: `map-${++nextId}`,
      title: opts.title ?? 'Untitled Mindmap',
    })),
    saveData: vi.fn(async (id: string, json: string) => { saved.set(id, json); }),
    getData: vi.fn(async (id: string) => saved.get(id) ?? null),
  };
  const openMindmap = vi.fn();
  const tools = createMindmapTools({ mindmaps, openMindmap });
  const byName = (n: string) => tools.find((t) => t.name === n)!;
  return { mindmaps, openMindmap, saved, create: byName('mindmap_create'), add: byName('mindmap_add'), read: byName('mindmap_read') };
}

describe('mindmap_create grounding', () => {
  it('refuses a sourced map the session has not read, and names the recovery', async () => {
    const { create, mindmaps } = makeDeps();
    const res = await create.handler(
      { title: 'Meyers', nodes: [{ label: 'ODP Models' }], sourcePageId: 'meyers-notes' },
      CANCEL,
      { sessionId: 'session-A' } as any,
    );
    expect(res.isError).toBe(true);
    expect(res.content).toContain('canvas_read_page');
    expect(mindmaps.createMindmap).not.toHaveBeenCalled();
  });

  it('creates once the source was read, nests under it, and queues the drawing', async () => {
    const { create, mindmaps, saved } = makeDeps();
    markResourceSeen('session-B', pageResourceKey('meyers-notes'));
    const res = await create.handler(
      {
        title: 'Meyers Models',
        nodes: [
          { label: 'Bayesian MCMC Reserving' },
          { label: 'CCL', parent: 'Bayesian MCMC Reserving' },
          { label: 'CSR', parent: 'Bayesian MCMC Reserving' },
        ],
        sourcePageId: 'meyers-notes',
      },
      CANCEL,
      { sessionId: 'session-B' } as any,
    );
    expect(res.isError).toBeFalsy();
    // A grounded board nests under its source by default.
    expect(mindmaps.createMindmap).toHaveBeenCalledWith({ title: 'Meyers Models', parentId: 'meyers-notes' });
    const env = toBoardEnvelope([...saved.values()][0]);
    expect(env.elements).toHaveLength(0); // headless author: nothing materialised yet
    const rects = env.pending.filter((p) => p.type === 'rectangle');
    const arrows = env.pending.filter((p) => p.type === 'arrow');
    expect(rects.map((r) => r.label?.text)).toContain('Bayesian MCMC Reserving');
    expect(rects).toHaveLength(3);
    expect(arrows).toHaveLength(2);
  });

  it('an unsourced map (brainstorm from scratch) needs no read', async () => {
    const { create } = makeDeps();
    const res = await create.handler(
      { title: 'Trip Ideas', nodes: [{ label: 'Trip Ideas' }, { label: 'Coast', parent: 'Trip Ideas' }] },
      CANCEL,
      { sessionId: 'session-C' } as any,
    );
    expect(res.isError).toBeFalsy();
  });
});

describe('mindmap_add', () => {
  it('applies the same read-first rail as create', async () => {
    const { add } = makeDeps();
    const res = await add.handler(
      { pageId: 'map-1', nodes: [{ label: 'New Concept' }], sourcePageId: 'unread-page' },
      CANCEL,
      { sessionId: 'session-D' } as any,
    );
    expect(res.isError).toBe(true);
    expect(res.content).toContain('canvas_read_page');
  });

  it('appends to pending and refuses pure duplicates', async () => {
    const { create, add, saved } = makeDeps();
    await create.handler(
      { title: 'T', nodes: [{ label: 'Root' }, { label: 'Kid', parent: 'Root' }] },
      CANCEL,
      { sessionId: 'session-D2' } as any,
    );
    const mapId = [...saved.keys()][0];

    const grow = await add.handler(
      { pageId: mapId, nodes: [{ label: 'Fresh' }] },
      CANCEL,
      { sessionId: 'session-D2' } as any,
    );
    expect(grow.isError).toBeFalsy();
    expect(toBoardEnvelope(saved.get(mapId)!).pending.some((p) => p.label?.text === 'Fresh')).toBe(true);

    const dup = await add.handler(
      { pageId: mapId, nodes: [{ label: 'fresh' }] },
      CANCEL,
      { sessionId: 'session-D2' } as any,
    );
    expect(dup.isError).toBe(true);
    expect(dup.content).toContain('already exists');
  });

  it('mindmap_read lists what create queued', async () => {
    const { create, read, saved } = makeDeps();
    await create.handler(
      { title: 'T', nodes: [{ label: 'Root' }, { label: 'Kid', parent: 'Root' }] },
      CANCEL,
      { sessionId: 'session-D3' } as any,
    );
    const mapId = [...saved.keys()][0];
    const res = await read.handler({ pageId: mapId }, CANCEL, { sessionId: 'session-D3' } as any);
    expect(res.content).toContain('Root');
    expect(res.content).toContain('Kid');
  });
});

describe('draftMindmapOutline — the editor door', () => {
  function sendCapturing(reply: string) {
    const calls: any[] = [];
    const send = (messages: any[], _opts?: any) => {
      calls.push(messages);
      return (async function* () {
        yield { content: reply, done: true };
      })();
    };
    return { send: send as any, calls };
  }

  it('puts the source text and grounding rules inside the prompt', async () => {
    const { send, calls } = sendCapturing('{"nodes":[{"label":"ODP"},{"label":"Mack","parent":"ODP"}]}');
    const result = await draftMindmapOutline(send, {
      pageId: 'map-1',
      title: 'Meyers Models',
      outlineText: '',
      instruction: 'Map the models',
      sourceTitle: 'Meyers Notes',
      sourceText: 'The over-dispersed Poisson family includes the ODP and Mack variants…',
    });
    expect(result.nodes).toHaveLength(2);
    const [messages] = calls;
    const system = messages.find((m: any) => m.role === 'system').content;
    const user = messages.find((m: any) => m.role === 'user').content;
    expect(system).toContain('SOURCE MATERIAL');
    expect(system).toContain('no generic scaffold');
    expect(user).toContain('SOURCE MATERIAL — "Meyers Notes"');
    expect(user).toContain('over-dispersed Poisson');
  });

  it('clamps an oversized source to the budget', async () => {
    const { send, calls } = sendCapturing('{"nodes":[{"label":"Big"}]}');
    await draftMindmapOutline(send, {
      pageId: 'map-1',
      title: 'Big Doc',
      outlineText: '',
      instruction: 'Map it',
      sourceText: 'x'.repeat(50_000),
    });
    const user = calls[0].find((m: any) => m.role === 'user').content as string;
    expect(user.length).toBeLessThan(20_000);
    expect(user).toContain('[truncated]');
  });

  it('throws a usable error when the model returns prose', async () => {
    const { send } = sendCapturing('I would rather not.');
    await expect(draftMindmapOutline(send, {
      pageId: 'map-1', title: 'T', outlineText: '', instruction: 'Map it',
    })).rejects.toThrow(/outline/);
  });
});

describe('round-trip sanity', () => {
  it('what create stores parses back as an engine envelope', async () => {
    const { create, saved } = makeDeps();
    markResourceSeen('session-E', pageResourceKey('src-1'));
    await create.handler(
      { title: 'T', nodes: [{ label: 'Root' }], sourcePageId: 'src-1' },
      CANCEL,
      { sessionId: 'session-E' } as any,
    );
    const env = toBoardEnvelope([...saved.values()][0]);
    expect(env.engine).toBe('excalidraw');
    expect(env.pending[0].label?.text).toBe('Root');
  });
});
