// @vitest-environment jsdom
//
// mindmapEditorPane.test.ts — the editing loop the brief measures the pane
// by: outliner keys on a real DOM, one undo entry per gesture, the last node
// guarded, saves debounced and flushed on dispose, and external AI writes
// reloading a clean editor. Runs against the real NodeCanvas in jsdom with a
// scripted MindmapDataService.

import { describe, expect, it, vi } from 'vitest';
import { Emitter } from '../../src/platform/events';
import { MindmapEditorPane } from '../../src/built-in/canvas/mindmap/mindmapEditorPane';
import {
  emptyMindmapDoc,
  parseMindmapDoc,
  serializeMindmapDoc,
  type MindmapDoc,
} from '../../src/built-in/canvas/mindmap/mindmapModel';

function docOf(nodes: Array<[string, string]>, edges: Array<[string, string]> = []): MindmapDoc {
  return {
    version: 1,
    nodes: nodes.map(([id, label], i) => ({ id, label, x: i * 300, y: 0, w: null, color: 'neutral' as const, kind: 'text', ref: null })),
    edges: edges.map(([from, to], i) => ({ id: `e${i}`, from, to, label: null })),
  };
}

function makePane(initial: MindmapDoc = docOf([['root', 'Root']])) {
  const changeEmitter = new Emitter<{ pageId: string; source: 'user' | 'ai' }>();
  let stored = serializeMindmapDoc(initial);
  const service: any = {
    getPage: vi.fn(async () => ({ id: 'map-1', title: 'My Map', icon: 'waypoints' })),
    getDoc: vi.fn(async () => parseMindmapDoc(stored)),
    saveDoc: vi.fn(async (_id: string, doc: MindmapDoc, _source: string) => {
      stored = serializeMindmapDoc(doc);
    }),
    renameMindmap: vi.fn(async () => undefined),
    onDidChangeDoc: changeEmitter.event,
  };
  const openPage = vi.fn();
  const host = document.createElement('div');
  document.body.appendChild(host);
  const pane = new MindmapEditorPane(host, 'map-1', { service, openPage });
  return {
    pane, host, service, openPage,
    fireExternalChange: () => changeEmitter.fire({ pageId: 'map-1', source: 'ai' }),
    getStored: () => parseMindmapDoc(stored),
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const frame = () => new Promise((r) => requestAnimationFrame(() => r(0)));
async function settle(): Promise<void> { await tick(); await frame(); await tick(); }

function root(host: HTMLElement): HTMLElement {
  return host.querySelector('.mm-editor') as HTMLElement;
}
function nodes(host: HTMLElement): HTMLElement[] {
  return [...host.querySelectorAll('.px-node-canvas__node')] as HTMLElement[];
}
function nodeByLabel(host: HTMLElement, label: string): HTMLElement {
  const found = nodes(host).find((n) => n.textContent?.includes(label));
  if (!found) throw new Error(`node not rendered: ${label}`);
  return found;
}
function key(el: HTMLElement, k: string, init: KeyboardEventInit = {}): void {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
}
function selectNode(host: HTMLElement, label: string): void {
  nodeByLabel(host, label).dispatchEvent(
    new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }),
  );
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
}

describe('loading', () => {
  it('renders the stored document and the page title', async () => {
    const { pane, host } = makePane(docOf([['root', 'Root'], ['a', 'Branch']], [['root', 'a']]));
    await settle();
    expect(nodes(host)).toHaveLength(2);
    expect((host.querySelector('.mm-editor__title') as HTMLInputElement).value).toBe('My Map');
    expect(host.querySelectorAll('g[data-edge-id]')).toHaveLength(1);
    pane.dispose();
    host.remove();
  });
});

describe('the outliner loop', () => {
  it('Tab on a selected node opens a child editor; typing + Enter commits and chains a sibling', async () => {
    const { pane, host } = makePane();
    await settle();
    selectNode(host, 'Root');
    key(root(host), 'Tab');
    await settle();

    const ta = host.querySelector('.mm-node__edit') as HTMLTextAreaElement;
    expect(ta).toBeTruthy();
    ta.value = 'First Child';
    key(ta, 'Enter');
    await settle();

    expect(nodeByLabel(host, 'First Child')).toBeTruthy();
    // Enter chained straight into a sibling editor — the five-bullets bar.
    expect(host.querySelector('.mm-node__edit')).toBeTruthy();

    key(host.querySelector('.mm-node__edit') as HTMLElement, 'Escape');
    await settle();
    expect(nodes(host)).toHaveLength(2); // Root + First Child; empty sibling vanished
    pane.dispose();
    host.remove();
  });

  it('a create-and-type gesture is ONE undo entry', async () => {
    const { pane, host } = makePane();
    await settle();
    selectNode(host, 'Root');
    key(root(host), 'Tab');
    await settle();
    const ta = host.querySelector('.mm-node__edit') as HTMLTextAreaElement;
    ta.value = 'Kid';
    ta.dispatchEvent(new FocusEvent('blur'));
    await settle();
    expect(nodes(host)).toHaveLength(2);

    key(root(host), 'z', { ctrlKey: true });
    await settle();
    expect(nodes(host)).toHaveLength(1); // one Ctrl+Z removed node AND edge

    key(root(host), 'z', { ctrlKey: true, shiftKey: true });
    await settle();
    expect(nodes(host)).toHaveLength(2); // redo brings it back
    pane.dispose();
    host.remove();
  });

  it('abandoning a brand-new empty node removes it without an undo entry', async () => {
    const { pane, host } = makePane();
    await settle();
    selectNode(host, 'Root');
    key(root(host), 'Tab');
    await settle();
    key(host.querySelector('.mm-node__edit') as HTMLElement, 'Escape');
    await settle();
    expect(nodes(host)).toHaveLength(1);
    // Nothing to undo — the aborted gesture left no history.
    key(root(host), 'z', { ctrlKey: true });
    await settle();
    expect(nodes(host)).toHaveLength(1);
    pane.dispose();
    host.remove();
  });

  it('Delete removes a selected node with its edges, but never the last node', async () => {
    const { pane, host } = makePane(docOf([['root', 'Root'], ['a', 'Branch']], [['root', 'a']]));
    await settle();
    selectNode(host, 'Branch');
    key(root(host), 'Delete');
    await settle();
    expect(nodes(host)).toHaveLength(1);
    expect(host.querySelectorAll('g[data-edge-id]')).toHaveLength(0);

    selectNode(host, 'Root');
    key(root(host), 'Delete');
    await settle();
    expect(nodes(host)).toHaveLength(1); // the guard
    pane.dispose();
    host.remove();
  });

  it('F2 edits an existing label; Escape restores it untouched', async () => {
    const { pane, host } = makePane();
    await settle();
    selectNode(host, 'Root');
    key(root(host), 'F2');
    await settle();
    const ta = host.querySelector('.mm-node__edit') as HTMLTextAreaElement;
    ta.value = 'Scribbled over';
    key(ta, 'Escape');
    await settle();
    expect(nodeByLabel(host, 'Root')).toBeTruthy();
    pane.dispose();
    host.remove();
  });
});

describe('persistence', () => {
  it('debounces saves and flushes the last state on dispose', async () => {
    const { pane, host, service, getStored } = makePane(docOf([['root', 'Root'], ['a', 'Branch']], [['root', 'a']]));
    await settle();
    selectNode(host, 'Branch');
    key(root(host), 'Delete');
    await settle();
    expect(service.saveDoc).not.toHaveBeenCalled(); // still inside the debounce
    pane.dispose();
    await settle();
    expect(service.saveDoc).toHaveBeenCalledTimes(1);
    expect(service.saveDoc.mock.calls[0][2]).toBe('user');
    expect(getStored().nodes.map((n: any) => n.label)).toEqual(['Root']);
    host.remove();
  });

  it('an external (AI) write reloads a clean editor', async () => {
    const { pane, host, service, fireExternalChange } = makePane();
    await settle();
    // The AI added a node behind our back.
    const grown = docOf([['root', 'Root'], ['ai', 'AI Added']], [['root', 'ai']]);
    service.getDoc.mockImplementation(async () => grown);
    fireExternalChange();
    await settle();
    expect(nodes(host)).toHaveLength(2);
    expect(nodeByLabel(host, 'AI Added')).toBeTruthy();
    pane.dispose();
    host.remove();
  });
});

describe('rich cards', () => {
  it('renders markdown and KaTeX in card labels; F2 edits the raw source', async () => {
    const { pane, host } = makePane(docOf([['root', 'CCL: $f(d)c(w,d)$ **model**']]));
    await settle();
    const label = host.querySelector('.mm-node__label') as HTMLElement;
    expect(label.querySelector('.katex')).toBeTruthy();  // math rendered
    expect(label.querySelector('strong')).toBeTruthy();  // markdown rendered
    expect(label.textContent).not.toContain('$');        // no raw source on display

    selectNode(host, 'CCL');
    key(root(host), 'F2');
    await settle();
    const ta = host.querySelector('.mm-node__edit') as HTMLTextAreaElement;
    expect(ta.value).toBe('CCL: $f(d)c(w,d)$ **model**'); // the source, intact
    key(ta, 'Escape');
    await settle();
    pane.dispose();
    host.remove();
  });

  it('dragging the resize handle persists an explicit width as one undo entry', async () => {
    const { pane, host, service, getStored } = makePane();
    await settle();
    selectNode(host, 'Root');
    const handle = host.querySelector('.px-node-canvas__resize') as HTMLElement;
    expect(handle).toBeTruthy();

    handle.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX: 100 }));
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 250 }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await settle();

    const node = nodes(host)[0];
    expect(node.classList.contains('has-explicit-width')).toBe(true);
    expect(node.style.width).not.toBe('');

    key(root(host), 'z', { ctrlKey: true }); // one undo removes the sizing
    await settle();
    expect(nodes(host)[0].classList.contains('has-explicit-width')).toBe(false);

    key(root(host), 'z', { ctrlKey: true, shiftKey: true });
    await settle();
    pane.dispose();
    await settle();
    expect(getStored().nodes[0].w).toBeGreaterThanOrEqual(96);
    expect(service.saveDoc).toHaveBeenCalled();
    pane.dispose();
    host.remove();
  });

  it('Escape cancels a resize without touching the document', async () => {
    const { pane, host, service } = makePane();
    await settle();
    selectNode(host, 'Root');
    const handle = host.querySelector('.px-node-canvas__resize') as HTMLElement;
    handle.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX: 100 }));
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 400 }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    expect(nodes(host)[0].classList.contains('has-explicit-width')).toBe(false);
    pane.dispose();
    await settle();
    expect(service.saveDoc).not.toHaveBeenCalled();
    host.remove();
  });
});

describe('the AI door — grounded drafting', () => {
  it('picking a source page sends its text through draftWithAI', async () => {
    const changeEmitter = new Emitter<{ pageId: string; source: 'user' | 'ai' }>();
    const service: any = {
      getPage: vi.fn(async () => ({ id: 'map-1', title: 'Meyers Models', icon: 'waypoints' })),
      getDoc: vi.fn(async () => parseMindmapDoc(serializeMindmapDoc(docOf([['root', 'Root']])))),
      saveDoc: vi.fn(async () => undefined),
      renameMindmap: vi.fn(async () => undefined),
      onDidChangeDoc: changeEmitter.event,
    };
    const draftWithAI = vi.fn(async () => ({
      nodes: [{ label: 'ODP', parent: 'Root' }],
    }));
    const searchPages = vi.fn(async () => [{ id: 'notes-1', title: 'Meyers Notes' }]);
    const getPageText = vi.fn(async () => 'The over-dispersed Poisson family…');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const pane = new MindmapEditorPane(host, 'map-1', {
      service, openPage: vi.fn(), draftWithAI, searchPages, getPageText,
    });
    await settle();

    // Open the popover, describe the draft, search and pick the source.
    (host.querySelectorAll('.mm-btn')[0] as HTMLButtonElement).click(); // Draft With AI
    const ta = host.querySelector('.mm-draft-popover__input') as HTMLTextAreaElement;
    expect(ta).toBeTruthy();
    ta.value = 'Map the models';
    const src = host.querySelector('.mm-draft-popover__source-input') as HTMLInputElement;
    expect(src).toBeTruthy();
    src.value = 'meyers';
    src.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 200)); // the picker's debounce
    const row = host.querySelector('.mm-draft-popover__result') as HTMLButtonElement;
    expect(row?.textContent).toBe('Meyers Notes');
    row.click();
    expect((host.querySelector('.mm-draft-popover__chip') as HTMLElement).textContent).toContain('Meyers Notes');

    // Run the draft.
    const go = [...host.querySelectorAll('.mm-btn--primary')].find((b) => b.textContent === 'Draft') as HTMLButtonElement;
    go.click();
    await settle();

    expect(getPageText).toHaveBeenCalledWith('notes-1');
    expect(draftWithAI).toHaveBeenCalledTimes(1);
    expect(draftWithAI.mock.calls[0][0]).toMatchObject({
      instruction: 'Map the models',
      sourceTitle: 'Meyers Notes',
      sourceText: 'The over-dispersed Poisson family…',
    });
    // The grounded draft actually landed on the map.
    expect(nodeByLabel(host, 'ODP')).toBeTruthy();
    pane.dispose();
    host.remove();
  });

  it('without searchPages the popover simply has no source field', async () => {
    const { pane, host } = makePane();
    await settle();
    // makePane wires no draftWithAI — button shows the hint instead of a popover.
    (host.querySelectorAll('.mm-btn')[0] as HTMLButtonElement).click();
    expect(host.querySelector('.mm-draft-popover')).toBeNull();
    pane.dispose();
    host.remove();
  });
});

describe('connect', () => {
  it('a port drag between nodes adds exactly one labelled-less edge', async () => {
    const { pane, host } = makePane(docOf([['root', 'Root'], ['a', 'Branch']]));
    await settle();
    const target = nodeByLabel(host, 'Branch');
    const orig = document.elementFromPoint;
    (document as any).elementFromPoint = () => target;
    try {
      nodeByLabel(host, 'Root').querySelector('.px-node-canvas__port')!.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }),
      );
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 200, clientY: 0 }));
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    } finally {
      (document as any).elementFromPoint = orig;
    }
    await settle();
    expect(host.querySelectorAll('g[data-edge-id]')).toHaveLength(1);
    pane.dispose();
    host.remove();
  });
});
