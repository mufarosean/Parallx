// mindmapTools.test.ts — the grounding rail and both AI doors.
//
// Written from the 2026-08-30 field failure: "map my Meyers notes" produced a
// generic design map because the model never read the notes. What these pins
// hold: a sourced map is REFUSED until the session has read the source, the
// refusal names the recovery, a grounded root carries the click-through
// anchor, and the editor door puts the source text inside the prompt with
// grounding rules.

import { describe, expect, it, vi } from 'vitest';
import {
  createMindmapTools,
  draftMindmapOutline,
} from '../../src/built-in/canvas/ai/mindmapTools';
import { markResourceSeen, pageResourceKey } from '../../src/services/toolResourceRegistry';
import {
  parseMindmapDoc,
  serializeMindmapDoc,
  emptyMindmapDoc,
  rootOf,
  type MindmapDoc,
} from '../../src/built-in/canvas/mindmap/mindmapModel';

const CANCEL: any = { isCancellationRequested: false };

function makeDeps() {
  const saved = new Map<string, MindmapDoc>();
  let nextId = 0;
  const mindmaps: any = {
    createMindmap: vi.fn(async (opts: { title?: string; parentId?: string | null }) => ({
      id: `map-${++nextId}`,
      title: opts.title ?? 'Untitled Mindmap',
    })),
    saveDoc: vi.fn(async (id: string, doc: MindmapDoc) => { saved.set(id, doc); }),
    getDoc: vi.fn(async (id: string) => saved.get(id) ?? null),
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

  it('creates once the source was read, nests under it, and anchors the root to it', async () => {
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
    // A grounded map nests under its source by default.
    expect(mindmaps.createMindmap).toHaveBeenCalledWith({ title: 'Meyers Models', parentId: 'meyers-notes' });
    const doc = [...saved.values()][0];
    const root = doc.nodes.find((n) => n.id === rootOf(doc))!;
    expect(root.label).toBe('Bayesian MCMC Reserving');
    expect(root.ref).toEqual({ kind: 'page', id: 'meyers-notes' });
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

describe('mindmap_add grounding', () => {
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
  it('a grounded create survives serialize/parse with its ref intact', async () => {
    const { create, saved } = makeDeps();
    markResourceSeen('session-E', pageResourceKey('src-1'));
    await create.handler(
      { title: 'T', nodes: [{ label: 'Root' }], sourcePageId: 'src-1' },
      CANCEL,
      { sessionId: 'session-E' } as any,
    );
    const doc = [...saved.values()][0];
    const round = parseMindmapDoc(serializeMindmapDoc(doc));
    expect(round.nodes[0].ref).toEqual({ kind: 'page', id: 'src-1' });
  });

  it('emptyMindmapDoc remains the unsourced base', () => {
    expect(emptyMindmapDoc('X').nodes[0].ref).toBeNull();
  });
});
