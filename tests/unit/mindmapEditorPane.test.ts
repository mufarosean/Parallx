// @vitest-environment jsdom
//
// mindmapEditorPane.test.ts — the board pane under the whiteboard pivot.
//
// The engine cannot mount in jsdom, so the pane's `loadBoardHost` seam takes
// a RECORDER host; what these pins hold is everything the pane owns around
// the engine: migration into pending skeletons, debounced persistence with
// the change guard (scroll never writes), external-writer remounts, the
// grounded Draft door feeding addSkeletons, and flush-on-dispose.

import { describe, expect, it, vi } from 'vitest';
import { Emitter } from '../../src/platform/events';
import { MindmapEditorPane } from '../../src/built-in/canvas/mindmap/mindmapEditorPane';
import { serializeMindmapDoc, type MindmapDoc } from '../../src/built-in/canvas/mindmap/mindmapModel';
import { emptyBoardEnvelope } from '../../src/built-in/canvas/mindmap/boardTypes';
import { serializeBoardEnvelope } from '../../src/built-in/canvas/mindmap/boardConvert';
import type { BoardHostOptions, BoardSkeleton } from '../../src/built-in/canvas/mindmap/boardTypes';

function legacyDocJson(): string {
  const doc: MindmapDoc = {
    version: 1,
    nodes: [
      { id: 'r', label: 'Root', x: 0, y: 0, w: null, color: 'accent', kind: 'text', ref: null },
      { id: 'a', label: 'Branch', x: 300, y: 0, w: null, color: 'blue', kind: 'text', ref: null },
    ],
    edges: [{ id: 'e1', from: 'r', to: 'a', label: null }],
  };
  return serializeMindmapDoc(doc);
}

interface RecorderHost {
  mounts: BoardHostOptions[];
  added: BoardSkeleton[][];
  math: string[];
  previews: string[];
  scene: { elements: Record<string, unknown>[]; files: Record<string, unknown> };
  destroyed: number;
  fireChange(): void;
}

function makeRecorder(): { host: RecorderHost; loadBoardHost: () => Promise<any> } {
  const host: RecorderHost = {
    mounts: [],
    added: [],
    math: [],
    previews: [],
    scene: { elements: [], files: {} },
    destroyed: 0,
    fireChange: () => { /* replaced per mount */ },
  };
  const loadBoardHost = async () => ({
    createBoardHost(opts: BoardHostOptions) {
      host.mounts.push(opts);
      host.fireChange = () => opts.onChange();
      return {
        addSkeletons: (sk: readonly BoardSkeleton[]) => { host.added.push([...sk]); opts.onChange(); },
        addMath: (latex: string) => { host.math.push(latex); opts.onChange(); return true; },
        renderMathPreview: (latex: string) => { host.previews.push(latex); return { svg: '<svg data-preview="1"></svg>', error: null }; },
        getScene: () => host.scene,
        destroy: () => { host.destroyed++; },
      };
    },
  });
  return { host, loadBoardHost };
}

function makePane(storedJson: string | null, extraDeps: Record<string, unknown> = {}) {
  const changeEmitter = new Emitter<{ pageId: string; source: 'user' | 'ai' }>();
  let stored = storedJson;
  const service: any = {
    getPage: vi.fn(async () => ({ id: 'map-1', title: 'My Board', icon: 'waypoints' })),
    getData: vi.fn(async () => stored),
    saveData: vi.fn(async (_id: string, json: string) => { stored = json; }),
    renameMindmap: vi.fn(async () => undefined),
    onDidChangeDoc: changeEmitter.event,
  };
  const { host, loadBoardHost } = makeRecorder();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const pane = new MindmapEditorPane(container, 'map-1', {
    service,
    loadBoardHost,
    ...extraDeps,
  } as any);
  return {
    pane, container, service, host,
    fireExternal: () => changeEmitter.fire({ pageId: 'map-1', source: 'ai' }),
    getStored: () => stored,
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
async function settle(): Promise<void> { await tick(); await tick(); }
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function toolButton(container: HTMLElement, label: string): HTMLButtonElement {
  return [...container.querySelectorAll('.mm-btn')].find((b) => b.textContent === label) as HTMLButtonElement;
}

describe('mounting & migration', () => {
  it('mounts the engine with stored elements and files', async () => {
    const env = { ...emptyBoardEnvelope(), elements: [{ id: 'x', type: 'rectangle' }] };
    const { pane, host, container } = makePane(serializeBoardEnvelope(env));
    await settle();
    expect(host.mounts).toHaveLength(1);
    expect(host.mounts[0].initialElements).toHaveLength(1);
    expect(host.mounts[0].pending).toHaveLength(0);
    expect((container.querySelector('.mm-editor__title') as HTMLInputElement).value).toBe('My Board');
    pane.dispose();
    container.remove();
  });

  it('a v1 card document arrives as pending skeletons — geometry intact', async () => {
    const { pane, host, container } = makePane(legacyDocJson());
    await settle();
    const pending = host.mounts[0].pending;
    expect(pending.length).toBe(3); // 2 rects + 1 bound arrow
    const rect = pending.find((p) => p.id === 'mm-a')!;
    expect(rect).toMatchObject({ x: 300, y: 0 });
    pane.dispose();
    container.remove();
  });

  it('a failed engine load shows a PERSISTENT error with the real message and a working Retry', async () => {
    // A fading hint over a dead pane hid the 2026-08-31 MathJax CSP failure
    // for a whole day — the error state must stay visible and be retryable.
    const changeEmitter = new Emitter<{ pageId: string; source: 'user' | 'ai' }>();
    const service: any = {
      getPage: vi.fn(async () => ({ id: 'map-1', title: 'T' })),
      getData: vi.fn(async () => null),
      saveData: vi.fn(),
      renameMindmap: vi.fn(),
      onDidChangeDoc: changeEmitter.event,
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    let attempts = 0;
    const { host, loadBoardHost } = makeRecorder();
    const pane = new MindmapEditorPane(container, 'map-1', {
      service,
      loadBoardHost: async () => {
        attempts++;
        if (attempts === 1) throw new EvalError('CSP violated: unsafe-eval');
        return loadBoardHost();
      },
    } as any);
    await settle();
    const box = container.querySelector('.mm-editor__error')!;
    expect(box).toBeTruthy();
    expect(box.querySelector('.mm-editor__error-detail')?.textContent).toContain('unsafe-eval');

    (box.querySelector('.mm-btn--primary') as HTMLButtonElement).click();
    await settle();
    expect(container.querySelector('.mm-editor__error')).toBeNull();
    expect(host.mounts).toHaveLength(1); // Retry actually mounted the engine
    pane.dispose();
    container.remove();
  });
});

describe('persistence', () => {
  it('debounces engine changes into one envelope save', async () => {
    const { pane, host, service, container, getStored } = makePane(null);
    await settle();
    host.scene.elements = [{ id: 'n1', type: 'rectangle' }];
    host.fireChange();
    host.fireChange();
    host.fireChange();
    expect(service.saveData).not.toHaveBeenCalled(); // inside the debounce
    await wait(1100);
    expect(service.saveData).toHaveBeenCalledTimes(1);
    const saved = JSON.parse(getStored()!);
    expect(saved.engine).toBe('excalidraw');
    expect(saved.elements).toHaveLength(1);
    expect(saved.pending).toHaveLength(0);
    pane.dispose();
    container.remove();
  });

  it('the change guard: identical content (scroll/zoom noise) never writes', async () => {
    const env = { ...emptyBoardEnvelope(), elements: [{ id: 'x', type: 'rectangle' }] };
    const json = serializeBoardEnvelope(env);
    const { pane, host, service, container } = makePane(json);
    await settle();
    host.scene.elements = env.elements as Record<string, unknown>[];
    host.fireChange();
    await wait(1100);
    expect(service.saveData).not.toHaveBeenCalled();
    pane.dispose();
    container.remove();
  });

  it('dispose flushes a pending save', async () => {
    const { pane, host, service, container } = makePane(null);
    await settle();
    host.scene.elements = [{ id: 'n1', type: 'ellipse' }];
    host.fireChange();
    pane.dispose();
    await settle();
    expect(service.saveData).toHaveBeenCalledTimes(1);
    container.remove();
  });
});

describe('external writers', () => {
  it('a clean pane remounts when the chat AI writes to the same board', async () => {
    const { pane, host, container, fireExternal } = makePane(null);
    await settle();
    expect(host.mounts).toHaveLength(1);
    fireExternal();
    await settle();
    expect(host.destroyed).toBe(1);
    expect(host.mounts).toHaveLength(2);
    pane.dispose();
    container.remove();
  });
});

describe('the AI door', () => {
  it('a grounded draft becomes addSkeletons on the live board', async () => {
    const draftWithAI = vi.fn(async () => ({
      nodes: [{ label: 'ODP' }, { label: 'Mack', parent: 'ODP' }],
    }));
    const searchPages = vi.fn(async () => [{ id: 'notes-1', title: 'Meyers Notes' }]);
    const getPageText = vi.fn(async () => 'The over-dispersed Poisson family…');
    const { pane, host, container } = makePane(null, { draftWithAI, searchPages, getPageText });
    await settle();

    toolButton(container, 'Draft With AI').click();
    const ta = container.querySelector('.mm-draft-popover__input') as HTMLTextAreaElement;
    ta.value = 'Map the models';
    const src = container.querySelector('.mm-draft-popover__source-input') as HTMLInputElement;
    src.value = 'meyers';
    src.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(200);
    (container.querySelector('.mm-draft-popover__result') as HTMLButtonElement).click();
    const go = [...container.querySelectorAll('.mm-btn--primary')].find((b) => b.textContent === 'Draft') as HTMLButtonElement;
    go.click();
    await settle();

    expect(getPageText).toHaveBeenCalledWith('notes-1');
    expect(draftWithAI.mock.calls[0][0]).toMatchObject({
      sourceTitle: 'Meyers Notes',
      sourceText: 'The over-dispersed Poisson family…',
    });
    expect(host.added).toHaveLength(1);
    const skeletons = host.added[0];
    expect(skeletons.filter((s) => s.type === 'rectangle')).toHaveLength(2);
    expect(skeletons.filter((s) => s.type === 'arrow')).toHaveLength(1);
    pane.dispose();
    container.remove();
  });

  it('labels already on the board are not drawn twice', async () => {
    const draftWithAI = vi.fn(async () => ({ nodes: [{ label: 'Existing Label' }] }));
    const { pane, host, container } = makePane(null, { draftWithAI });
    await settle();
    host.scene.elements = [
      { id: 'r1', type: 'rectangle' },
      { id: 't1', type: 'text', text: 'Existing Label', containerId: 'r1' },
    ];

    toolButton(container, 'Draft With AI').click();
    const ta = container.querySelector('.mm-draft-popover__input') as HTMLTextAreaElement;
    ta.value = 'Add things';
    const go = [...container.querySelectorAll('.mm-btn--primary')].find((b) => b.textContent === 'Draft') as HTMLButtonElement;
    go.click();
    await settle();

    expect(host.added).toHaveLength(0);
    expect(container.querySelector('.mm-editor__hint')?.textContent).toContain('added nothing new');
    pane.dispose();
    container.remove();
  });

  it('without a provider the button explains instead of opening a popover', async () => {
    const { pane, container } = makePane(null);
    await settle();
    toolButton(container, 'Draft With AI').click();
    expect(container.querySelector('.mm-draft-popover')).toBeNull();
    expect(container.querySelector('.mm-editor__hint')?.textContent).toContain('chat tool');
    pane.dispose();
    container.remove();
  });
});

describe('the math door', () => {
  it('Insert Math previews live and places the formula through the host', async () => {
    const { pane, host, container } = makePane(null);
    await settle();

    toolButton(container, 'Insert Math').click();
    const ta = container.querySelector('.mm-math-popover__input') as HTMLTextAreaElement;
    expect(ta).toBeTruthy();
    const tex = String.raw`\frac{dC}{dt} = \mu C`;
    ta.value = tex;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(200);
    expect(host.previews).toContain(tex);
    expect(container.querySelector('.mm-math-popover__preview svg')).toBeTruthy();

    const go = [...container.querySelectorAll('.mm-btn--primary')].find((b) => b.textContent === 'Insert') as HTMLButtonElement;
    go.click();
    expect(host.math).toEqual([tex]);
    expect(container.querySelector('.mm-math-popover')).toBeNull();
    pane.dispose();
    container.remove();
  });

  it('while the engine is loading the button explains instead of opening', async () => {
    const changeEmitter = new Emitter<{ pageId: string; source: 'user' | 'ai' }>();
    const service: any = {
      getPage: vi.fn(async () => ({ id: 'map-1', title: 'T' })),
      getData: vi.fn(async () => null),
      saveData: vi.fn(),
      renameMindmap: vi.fn(),
      onDidChangeDoc: changeEmitter.event,
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    const pane = new MindmapEditorPane(container, 'map-1', {
      service,
      loadBoardHost: () => new Promise(() => { /* never resolves */ }),
    } as any);
    await settle();
    toolButton(container, 'Insert Math').click();
    expect(container.querySelector('.mm-math-popover')).toBeNull();
    expect(container.querySelector('.mm-editor__hint')?.textContent).toContain('loading');
    pane.dispose();
    container.remove();
  });
});
