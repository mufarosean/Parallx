// boardConvert.test.ts — the translation layer under the whiteboard pivot.
//
// The board engine (Excalidraw) cannot run headless, so everything the app
// authors travels as SKELETON JSON and everything stored travels as the
// envelope. These pins hold the three translations and the migration:
// legacy card documents keep their geometry, AI outlines get the proven
// two-sided layout with arrows bound by id, and reads survive real
// engine-shaped elements.

import { describe, expect, it } from 'vitest';
import {
  boardLabels,
  boardOutlineText,
  legacyDocToSkeletons,
  outlineToSkeletons,
  parseBoardData,
  serializeBoardEnvelope,
  toBoardEnvelope,
} from '../../src/built-in/canvas/mindmap/boardConvert';
import { emptyBoardEnvelope, type BoardEnvelope } from '../../src/built-in/canvas/mindmap/boardTypes';
import { emptyMindmapDoc, serializeMindmapDoc, type MindmapDoc } from '../../src/built-in/canvas/mindmap/mindmapModel';

function legacyDoc(): MindmapDoc {
  return {
    version: 1,
    nodes: [
      { id: 'r', label: 'Reserving', x: 10, y: 20, w: 300, color: 'accent', kind: 'text', ref: null },
      { id: 'a', label: 'ODP', x: 400, y: -50, w: null, color: 'green', kind: 'text', ref: null },
    ],
    edges: [{ id: 'e1', from: 'r', to: 'a', label: 'family' }],
  };
}

describe('legacyDocToSkeletons — the one-time migration', () => {
  it('keeps positions and explicit widths, and binds arrows by id', () => {
    const skeletons = legacyDocToSkeletons(legacyDoc());
    const rect = skeletons.find((s) => s.id === 'mm-r')!;
    expect(rect).toMatchObject({ type: 'rectangle', x: 10, y: 20, width: 300 });
    expect(rect.label?.text).toBe('Reserving');

    const arrow = skeletons.find((s) => s.type === 'arrow')!;
    expect(arrow.start).toEqual({ id: 'mm-r' });
    expect(arrow.end).toEqual({ id: 'mm-a' });
    expect(arrow.label?.text).toBe('family');
  });
});

describe('outlineToSkeletons — the AI door', () => {
  it('lays out a parent tree with bound arrows and finite geometry', () => {
    const skeletons = outlineToSkeletons([
      { label: 'Bayesian MCMC Reserving' },
      { label: 'CCL', parent: 'Bayesian MCMC Reserving' },
      { label: 'CSR', parent: 'Bayesian MCMC Reserving' },
    ]);
    const rects = skeletons.filter((s) => s.type === 'rectangle');
    const arrows = skeletons.filter((s) => s.type === 'arrow');
    expect(rects).toHaveLength(3);
    expect(arrows).toHaveLength(2);
    for (const s of skeletons) {
      expect(Number.isFinite(s.x)).toBe(true);
      expect(Number.isFinite(s.y)).toBe(true);
    }
    for (const a of arrows) {
      expect(rects.some((r) => r.id === a.start?.id)).toBe(true);
      expect(rects.some((r) => r.id === a.end?.id)).toBe(true);
    }
  });

  it('drops labels that already exist on the board (case-insensitive)', () => {
    const skeletons = outlineToSkeletons(
      [{ label: 'ODP' }, { label: 'Fresh Idea' }],
      [],
      ['odp'],
    );
    const texts = skeletons.map((s) => s.label?.text);
    expect(texts).toContain('Fresh Idea');
    expect(texts).not.toContain('ODP');
  });

  it('returns nothing when everything is a duplicate', () => {
    expect(outlineToSkeletons([{ label: 'X' }], [], ['x'])).toEqual([]);
  });

  it('a pure-formula label becomes a math skeleton — arrows still bind to it', () => {
    const skeletons = outlineToSkeletons([
      { label: 'CCL Model' },
      { label: '$\\rho = corr(C_{i,d}, C_{i,d+1})$', parent: 'CCL Model' },
    ]);
    const math = skeletons.find((s) => s.type === 'math')!;
    expect(math.latex).toBe('\\rho = corr(C_{i,d}, C_{i,d+1})');
    expect(math.label?.text).toBe('$\\rho = corr(C_{i,d}, C_{i,d+1})$');
    expect(Number.isFinite(math.x) && Number.isFinite(math.y)).toBe(true);
    const arrow = skeletons.find((s) => s.type === 'arrow')!;
    expect([arrow.start?.id, arrow.end?.id]).toContain(math.id);
  });

  it('a mixed prose-and-math label stays a card', () => {
    const skeletons = outlineToSkeletons([{ label: 'Variance: $\\sigma^2$' }]);
    expect(skeletons[0].type).toBe('rectangle');
  });
});

describe('envelope parse / migration', () => {
  it('round-trips an engine envelope', () => {
    const env: BoardEnvelope = {
      ...emptyBoardEnvelope(),
      elements: [{ id: 'e1', type: 'rectangle' }],
      pending: [{ type: 'ellipse', label: { text: 'Queued' } }],
    };
    const parsed = parseBoardData(serializeBoardEnvelope(env));
    expect(parsed.kind).toBe('board');
    if (parsed.kind === 'board') {
      expect(parsed.envelope.elements).toHaveLength(1);
      expect(parsed.envelope.pending[0].label?.text).toBe('Queued');
    }
  });

  it('a v1 document migrates into pending skeletons', () => {
    const env = toBoardEnvelope(serializeMindmapDoc(legacyDoc()));
    expect(env.elements).toHaveLength(0);
    expect(env.pending.length).toBe(3); // two rects + one arrow
  });

  it('a fresh seed document opens as a BLANK board, not a lonely rectangle', () => {
    const env = toBoardEnvelope(serializeMindmapDoc(emptyMindmapDoc('Untitled Mindmap')));
    expect(env.pending).toHaveLength(0);
    expect(env.elements).toHaveLength(0);
  });

  it('garbage never throws', () => {
    const env = toBoardEnvelope('{{{nope');
    expect(env.engine).toBe('excalidraw');
  });
});

describe('reading the board back', () => {
  const sceneEnvelope = (): BoardEnvelope => ({
    ...emptyBoardEnvelope(),
    elements: [
      { id: 'r1', type: 'rectangle' },
      { id: 't1', type: 'text', text: 'ODP Models', containerId: 'r1' },
      { id: 'r2', type: 'rectangle' },
      { id: 't2', type: 'text', text: 'Mack', containerId: 'r2' },
      { id: 'free', type: 'text', text: 'A loose note' },
      { id: 'gone', type: 'text', text: 'Deleted', isDeleted: true },
      {
        id: 'a1', type: 'arrow',
        startBinding: { elementId: 'r1' },
        endBinding: { elementId: 'r2' },
      },
    ],
    pending: [{ type: 'rectangle', label: { text: 'Queued Concept' } }],
  });

  it('boardOutlineText lists labels, loose text, pending, and connections', () => {
    const text = boardOutlineText(sceneEnvelope());
    expect(text).toContain('- ODP Models');
    expect(text).toContain('- A loose note');
    expect(text).toContain('- Queued Concept (pending)');
    expect(text).toContain('ODP Models → Mack');
    expect(text).not.toContain('Deleted');
  });

  it('boardLabels is the dedupe set: live text + pending, never deleted', () => {
    const labels = boardLabels(sceneEnvelope());
    expect(labels).toContain('ODP Models');
    expect(labels).toContain('A loose note');
    expect(labels).toContain('Queued Concept');
    expect(labels).not.toContain('Deleted');
  });

  it('a materialised formula reads back as its LaTeX label, and arrows to it resolve', () => {
    const env: BoardEnvelope = {
      ...emptyBoardEnvelope(),
      elements: [
        { id: 'r1', type: 'rectangle' },
        { id: 't1', type: 'text', text: 'CCL Model', containerId: 'r1' },
        { id: 'img1', type: 'image', fileId: 'f', customData: { mmLatex: '\\rho', mmLabel: '$\\rho$' } },
        { id: 'a1', type: 'arrow', startBinding: { elementId: 'r1' }, endBinding: { elementId: 'img1' } },
      ],
      pending: [{ type: 'math', latex: '\\mu', label: { text: '$\\mu$' } }],
    };
    const text = boardOutlineText(env);
    expect(text).toContain('- $\\rho$');
    expect(text).toContain('- $\\mu$ (pending)');
    expect(text).toContain('CCL Model → $\\rho$');
    expect(boardLabels(env)).toContain('$\\rho$');
    expect(boardLabels(env)).toContain('$\\mu$');
  });
});
