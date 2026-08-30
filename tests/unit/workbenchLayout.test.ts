/**
 * Mounting step 1 — the body of the window is ONE grid.
 *
 * First execution coverage the workbench layout has ever had: the old
 * three-grid model was pinned only by e2e selectors. These tests drive the
 * real Layout class with fake parts and pin the behaviors the toggles have
 * always promised — hidden parts leave the tree, shown parts come back at
 * their remembered size and their OWN edge, zen mode round-trips, and reset
 * rebuilds the default shape from data.
 *
 * @vitest-environment jsdom
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  Layout,
  defaultLayoutState,
  DEFAULT_SIDEBAR_WIDTH,
  DEFAULT_PANEL_HEIGHT,
  DEFAULT_AUX_BAR_WIDTH,
  TITLE_HEIGHT,
  STATUS_HEIGHT,
  ACTIVITY_BAR_WIDTH,
} from '../../src/workbench/layout';
import type { Part } from '../../src/parts/part';
import type { TitlebarPart } from '../../src/parts/titlebarPart';
import type { ActivityBarPart } from '../../src/parts/activityBarPart';
import { Orientation } from '../../src/layout/layoutTypes';
import type { SerializedBranchNode, SerializedGridNode } from '../../src/layout/layoutModel';
import { Emitter } from '../../src/platform/events';

// ── Fakes ───────────────────────────────────────────────────────────────────

interface FakePart {
  readonly id: string;
  visible: boolean;
  readonly element: HTMLElement;
  setVisible(v: boolean): void;
  layout(): void;
  readonly minimumWidth: number;
  readonly maximumWidth: number;
  readonly minimumHeight: number;
  readonly maximumHeight: number;
  toJSON(): object;
  onDidChangeConstraints: Emitter<void>['event'];
  dispose(): void;
}

function fakePart(id: string, visible = true): FakePart {
  const constraints = new Emitter<void>();
  const part: FakePart = {
    id,
    visible,
    element: document.createElement('div'),
    setVisible(v: boolean) { part.visible = v; },
    layout() {},
    minimumWidth: 48,
    maximumWidth: Infinity,
    minimumHeight: 30,
    maximumHeight: Infinity,
    toJSON: () => ({ id }),
    onDidChangeConstraints: constraints.event,
    dispose: () => constraints.dispose(),
  };
  return part;
}

const WIDTH = 1400;
const HEIGHT = 852;
const BODY_W = WIDTH - ACTIVITY_BAR_WIDTH;      // 1352
const BODY_H = HEIGHT - TITLE_HEIGHT - STATUS_HEIGHT; // 800

class TestLayout extends Layout {
  containerLayouts = 0;

  constructor(
    container: HTMLElement,
    readonly parts: Record<'titlebar' | 'activityBar' | 'sidebar' | 'editor' | 'panel' | 'auxiliaryBar' | 'statusBar', FakePart>,
  ) {
    super(container);
    this._titlebar = parts.titlebar as unknown as TitlebarPart;
    this._activityBarPart = parts.activityBar as unknown as ActivityBarPart;
    this._sidebar = parts.sidebar as unknown as Part;
    this._editor = parts.editor as unknown as Part;
    this._panel = parts.panel as unknown as Part;
    this._auxiliaryBar = parts.auxiliaryBar as unknown as Part;
    this._statusBar = parts.statusBar as unknown as Part;
    this._mountBody(WIDTH, HEIGHT);
    this._wireGridHandlers();
  }

  get grid() { return this._grid; }
  get lastSidebarWidth() { return this._lastSidebarWidth; }
  get lastPanelHeight() { return this._lastPanelHeight; }
  get panelMaximized() { return this._panelMaximized; }

  protected override _layoutViewContainers(): void {
    this.containerLayouts++;
  }

  override dispose(): void {
    this._grid.dispose();
    super.dispose();
  }
}

/** [viewId | branch descriptor] per root child, for shape asserts. */
function rootShape(layout: TestLayout): string[] {
  const describeNode = (n: SerializedGridNode): string => n.type === 'leaf'
    ? (n as { viewId: string }).viewId
    : `${(n as SerializedBranchNode).orientation}[${(n as SerializedBranchNode).children.map(describeNode).join(', ')}]`;
  return layout.grid.serialize().root.children.map(describeNode);
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('Layout on one grid', () => {
  let container: HTMLElement;
  let layout: TestLayout;
  let parts: TestLayout['parts'];

  const sizeOf = (id: string) => layout.grid.getViewSize(id);

  beforeEach(() => {
    container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: WIDTH, configurable: true });
    Object.defineProperty(container, 'clientHeight', { value: HEIGHT, configurable: true });
    document.body.appendChild(container);
    parts = {
      titlebar: fakePart('workbench.parts.titlebar'),
      activityBar: fakePart('workbench.parts.activitybar'),
      sidebar: fakePart('workbench.parts.sidebar'),
      editor: fakePart('workbench.parts.editor'),
      panel: fakePart('workbench.parts.panel'),
      auxiliaryBar: fakePart('workbench.parts.auxiliarybar', false),
      statusBar: fakePart('workbench.parts.statusbar'),
    };
    layout = new TestLayout(container, parts);
  });

  afterEach(() => {
    layout.dispose();
    container.remove();
  });

  // Sidebar's hide path animates; finishing means dispatching its
  // transitionend (the code also has a 200ms safety fallback).
  const finishSidebarAnimation = (): void => {
    parts.sidebar.element.dispatchEvent(new Event('transitionend'));
  };

  it('boots into the default shape: H[ sidebar, V[editor, panel] ]', () => {
    expect(rootShape(layout)).toEqual([
      'workbench.parts.sidebar',
      'vertical[workbench.parts.editor, workbench.parts.panel]',
    ]);
    expect(sizeOf('workbench.parts.sidebar')).toBe(DEFAULT_SIDEBAR_WIDTH);
    expect(sizeOf('workbench.parts.panel')).toBe(DEFAULT_PANEL_HEIGHT);
    expect(sizeOf('workbench.parts.editor')).toBe(BODY_H - DEFAULT_PANEL_HEIGHT);
  });

  it('hides the panel by collapsing its branch, and the editor takes the slot', () => {
    layout.togglePanel();
    expect(parts.panel.visible).toBe(false);
    expect(rootShape(layout)).toEqual([
      'workbench.parts.sidebar',
      'workbench.parts.editor',
    ]);
  });

  it('re-shows the panel below the editor at its remembered height', () => {
    layout.grid.resizeView('workbench.parts.panel', 320);
    layout.togglePanel();
    layout.togglePanel();
    expect(rootShape(layout)[1]).toBe('vertical[workbench.parts.editor, workbench.parts.panel]');
    expect(sizeOf('workbench.parts.panel')).toBe(320);
  });

  it('re-shows the sidebar at the LEFT edge, not wherever addView appends', () => {
    // The old layout.reset re-added the sidebar at the end of the grid — on
    // the right. Edges are positions now, not indices.
    layout.toggleSidebar();
    finishSidebarAnimation();
    expect(layout.grid.hasView('workbench.parts.sidebar')).toBe(false);

    layout.toggleSidebar();
    expect(rootShape(layout)[0]).toBe('workbench.parts.sidebar');
    expect(sizeOf('workbench.parts.sidebar')).toBe(DEFAULT_SIDEBAR_WIDTH);
  });

  it('remembers a dragged sidebar width across hide and show', () => {
    layout.grid.resizeView('workbench.parts.sidebar', 300);
    layout.toggleSidebar();
    finishSidebarAnimation();
    layout.toggleSidebar();
    expect(sizeOf('workbench.parts.sidebar')).toBe(300);
  });

  it('shows the auxiliary bar at the right edge and hides it again', () => {
    layout.toggleAuxiliaryBar();
    const shape = rootShape(layout);
    expect(shape[shape.length - 1]).toBe('workbench.parts.auxiliarybar');
    expect(sizeOf('workbench.parts.auxiliarybar')).toBe(DEFAULT_AUX_BAR_WIDTH);

    layout.toggleAuxiliaryBar();
    expect(layout.grid.hasView('workbench.parts.auxiliarybar')).toBe(false);
    expect(parts.auxiliaryBar.visible).toBe(false);
  });

  it('maximizes the panel by shrinking the editor to a strip, zero-sum', () => {
    const before = sizeOf('workbench.parts.panel')!;
    layout.toggleMaximizedPanel();
    expect(layout.panelMaximized).toBe(true);
    expect(sizeOf('workbench.parts.editor')).toBeLessThanOrEqual(48);
    expect(sizeOf('workbench.parts.panel')!).toBeGreaterThan(BODY_H - 100);

    layout.toggleMaximizedPanel();
    expect(layout.panelMaximized).toBe(false);
    expect(sizeOf('workbench.parts.panel')).toBe(before);
  });

  it('round-trips zen mode: everything hides, everything comes back', () => {
    layout.toggleAuxiliaryBar();
    layout.toggleZenMode();

    expect(layout.grid.hasView('workbench.parts.sidebar')).toBe(false);
    expect(layout.grid.hasView('workbench.parts.panel')).toBe(false);
    expect(layout.grid.hasView('workbench.parts.auxiliarybar')).toBe(false);
    expect(layout.grid.hasView('workbench.parts.editor')).toBe(true);
    expect(parts.statusBar.visible).toBe(false);

    layout.toggleZenMode();
    expect(rootShape(layout)).toEqual([
      'workbench.parts.sidebar',
      'vertical[workbench.parts.editor, workbench.parts.panel]',
      'workbench.parts.auxiliarybar',
    ]);
    expect(parts.statusBar.visible).toBe(true);
  });

  it('resets to the default shape from any mutation', () => {
    layout.toggleSidebar();
    finishSidebarAnimation();
    layout.toggleAuxiliaryBar();
    layout.grid.resizeView('workbench.parts.panel', 400);

    layout.resetLayout();

    expect(rootShape(layout)).toEqual([
      'workbench.parts.sidebar',
      'vertical[workbench.parts.editor, workbench.parts.panel]',
    ]);
    expect(sizeOf('workbench.parts.sidebar')).toBe(DEFAULT_SIDEBAR_WIDTH);
    expect(sizeOf('workbench.parts.panel')).toBe(DEFAULT_PANEL_HEIGHT);
    expect(parts.auxiliaryBar.visible).toBe(false);
    expect(parts.sidebar.visible).toBe(true);
  });

  it('keeps the companion strips fixed on window resize; the editor absorbs it', () => {
    Object.defineProperty(container, 'clientWidth', { value: WIDTH + 200, configurable: true });
    layout._relayout();

    expect(sizeOf('workbench.parts.sidebar')).toBe(DEFAULT_SIDEBAR_WIDTH);
    expect(sizeOf('workbench.parts.panel')).toBe(DEFAULT_PANEL_HEIGHT);
    // The editor column (the V branch) absorbed the extra 200 horizontally.
    const column = layout.grid.serialize().root.children[1] as SerializedBranchNode;
    expect(column.size).toBe(BODY_W + 200 - DEFAULT_SIDEBAR_WIDTH);
  });

  it('reports part visibility through the LayoutHost protocol', () => {
    expect(layout.isPartVisible('workbench.parts.sidebar')).toBe(true);
    layout.setPartHidden(true, 'workbench.parts.sidebar');
    finishSidebarAnimation();
    expect(layout.isPartVisible('workbench.parts.sidebar')).toBe(false);
    expect(layout.isPartVisible('workbench.parts.editor')).toBe(true);
  });
});

describe('defaultLayoutState', () => {
  const ids = {
    sidebar: 's', editor: 'e', panel: 'p', auxiliaryBar: 'a',
  };

  it('drops hidden parts entirely rather than sizing them to zero', () => {
    const state = defaultLayoutState({
      width: 1000, height: 700,
      sidebarVisible: false, sidebarWidth: 202,
      panelVisible: false, panelHeight: 200,
      auxBarVisible: false, auxBarWidth: 480,
      ids,
    });
    expect(state.root.children).toHaveLength(1);
    expect((state.root.children[0] as { viewId: string }).viewId).toBe('e');
  });

  it('sums exactly to the body dimensions when everything is visible', () => {
    const state = defaultLayoutState({
      width: 1000, height: 700,
      sidebarVisible: true, sidebarWidth: 202,
      panelVisible: true, panelHeight: 200,
      auxBarVisible: true, auxBarWidth: 300,
      ids,
    });
    const [sidebar, column, aux] = state.root.children as [
      { size: number }, SerializedBranchNode, { size: number },
    ];
    expect(sidebar.size + column.size + aux.size).toBe(1000);
    expect(column.orientation).toBe(Orientation.Vertical);
    const [editor, panel] = column.children as [{ size: number }, { size: number }];
    expect(editor.size + panel.size).toBe(700);
    expect(panel.size).toBe(200);
  });
});

describe('body tree persistence and relocation', () => {
  let container: HTMLElement;
  let layout: TestLayout;
  let parts: TestLayout['parts'];

  const freshParts = (): TestLayout['parts'] => ({
    titlebar: fakePart('workbench.parts.titlebar'),
    activityBar: fakePart('workbench.parts.activitybar'),
    sidebar: fakePart('workbench.parts.sidebar'),
    editor: fakePart('workbench.parts.editor'),
    panel: fakePart('workbench.parts.panel'),
    auxiliaryBar: fakePart('workbench.parts.auxiliarybar', false),
    statusBar: fakePart('workbench.parts.statusbar'),
  });

  beforeEach(() => {
    container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: WIDTH, configurable: true });
    Object.defineProperty(container, 'clientHeight', { value: HEIGHT, configurable: true });
    document.body.appendChild(container);
    parts = freshParts();
    layout = new TestLayout(container, parts);
  });

  afterEach(() => {
    layout.dispose();
    container.remove();
  });

  it('moves the sidebar to the right edge, size intact', () => {
    layout.movePartToEdge('workbench.parts.sidebar', Orientation.Horizontal, false);
    const shape = rootShape(layout);
    expect(shape[shape.length - 1]).toBe('workbench.parts.sidebar');
    expect(layout.grid.getViewSize('workbench.parts.sidebar')).toBe(DEFAULT_SIDEBAR_WIDTH);
  });

  it('moves the panel to a side column', () => {
    layout.movePartToEdge('workbench.parts.panel', Orientation.Horizontal, true);
    const shape = rootShape(layout);
    expect(shape[0]).toBe('workbench.parts.panel');
    // The editor no longer shares a branch with it.
    expect(shape).toContain('workbench.parts.editor');
  });

  it('round-trips a relocated shape through serialize and restore', () => {
    layout.movePartToEdge('workbench.parts.sidebar', Orientation.Horizontal, false);
    layout.togglePanel(); // hidden at save time
    const saved = layout.serializeBodyTree();

    const container2 = document.createElement('div');
    Object.defineProperty(container2, 'clientWidth', { value: WIDTH, configurable: true });
    Object.defineProperty(container2, 'clientHeight', { value: HEIGHT, configurable: true });
    document.body.appendChild(container2);
    const parts2 = freshParts();
    const layout2 = new TestLayout(container2, parts2);

    try {
      expect(layout2.restoreBodyTree(saved)).toBe(true);
      const shape = rootShape(layout2);
      // Sidebar came back on the RIGHT — the position survived the restart.
      expect(shape[shape.length - 1]).toBe('workbench.parts.sidebar');
      // Presence is visibility: the hidden panel is not in the tree.
      expect(parts2.panel.visible).toBe(false);
      expect(layout2.grid.hasView('workbench.parts.panel')).toBe(false);
      expect(layout2.isPartVisible('workbench.parts.panel')).toBe(false);
    } finally {
      layout2.dispose();
      container2.remove();
    }
  });

  it('rejects a tree from the old model and reports it for the legacy path', () => {
    // Old saves carry the aspirational default state, titlebar and statusbar
    // leaves included. Restoring that would build a shape the app never had.
    const legacy = {
      orientation: Orientation.Vertical, width: 1000, height: 700,
      root: {
        type: 'branch', orientation: Orientation.Vertical, size: 700, sizingMode: 'pixel',
        children: [
          { type: 'leaf', viewId: 'workbench.parts.titlebar', size: 30, sizingMode: 'pixel' },
          { type: 'leaf', viewId: 'workbench.parts.editor', size: 648, sizingMode: 'pixel' },
          { type: 'leaf', viewId: 'workbench.parts.statusbar', size: 22, sizingMode: 'pixel' },
        ],
      },
    };
    expect(layout.restoreBodyTree(legacy as never)).toBe(false);
    // The live tree is untouched.
    expect(rootShape(layout)).toEqual([
      'workbench.parts.sidebar',
      'vertical[workbench.parts.editor, workbench.parts.panel]',
    ]);
  });

  it('rejects undefined, editor-less and duplicate-leaf trees', () => {
    expect(layout.restoreBodyTree(undefined)).toBe(false);

    const noEditor = layout.serializeBodyTree();
    const stripped = JSON.parse(JSON.stringify(noEditor).replace('workbench.parts.editor', 'workbench.parts.sidebar'));
    expect(layout.restoreBodyTree(stripped)).toBe(false);
  });
});

describe('stacking and placement recall', () => {
  let container: HTMLElement;
  let layout: TestLayout;
  let parts: TestLayout['parts'];

  beforeEach(() => {
    container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: WIDTH, configurable: true });
    Object.defineProperty(container, 'clientHeight', { value: HEIGHT, configurable: true });
    document.body.appendChild(container);
    parts = {
      titlebar: fakePart('workbench.parts.titlebar'),
      activityBar: fakePart('workbench.parts.activitybar'),
      sidebar: fakePart('workbench.parts.sidebar'),
      editor: fakePart('workbench.parts.editor'),
      panel: fakePart('workbench.parts.panel'),
      auxiliaryBar: fakePart('workbench.parts.auxiliarybar', false),
      statusBar: fakePart('workbench.parts.statusbar'),
    };
    layout = new TestLayout(container, parts);
  });

  afterEach(() => {
    layout.dispose();
    container.remove();
  });

  it('stacks the panel under the sidebar', () => {
    // The ask, verbatim: "if I wanted to stack sidebar with something
    // underneath, I need to be able to do that easily."
    layout.movePartBeside(
      'workbench.parts.panel', 'workbench.parts.sidebar', Orientation.Vertical, false,
    );
    expect(rootShape(layout)).toEqual([
      'vertical[workbench.parts.sidebar, workbench.parts.panel]',
      'workbench.parts.editor',
    ]);
    // The stack FILLS the body height. The field bug: the cross-axis move
    // left half-of-width sizes as the stack's heights, only the editor path
    // was reconciled, and the column rendered mostly as void.
    const sidebarH = layout.grid.getViewSize('workbench.parts.sidebar')!;
    const panelH = layout.grid.getViewSize('workbench.parts.panel')!;
    expect(sidebarH + panelH).toBe(BODY_H);
  });

  it('brings a hidden part back to where the user put it, not the factory spot', () => {
    layout.movePartBeside(
      'workbench.parts.panel', 'workbench.parts.sidebar', Orientation.Vertical, false,
    );
    layout.togglePanel(); // hide
    expect(rootShape(layout)).toEqual([
      'workbench.parts.sidebar',
      'workbench.parts.editor',
    ]);

    layout.togglePanel(); // show
    expect(rootShape(layout)).toEqual([
      'vertical[workbench.parts.sidebar, workbench.parts.panel]',
      'workbench.parts.editor',
    ]);
  });

  it('falls back to the default spot when the recalled neighbour is gone', () => {
    layout.movePartBeside(
      'workbench.parts.panel', 'workbench.parts.sidebar', Orientation.Vertical, false,
    );
    layout.togglePanel(); // hide — recalls "under the sidebar"
    layout.toggleSidebar(); // and now the sidebar leaves too
    parts.sidebar.element.dispatchEvent(new Event('transitionend'));

    layout.togglePanel(); // show
    // Default: below the editor.
    expect(rootShape(layout)).toEqual([
      'vertical[workbench.parts.editor, workbench.parts.panel]',
    ]);
  });

  it('round-trips zen mode with a custom arrangement intact', () => {
    layout.movePartBeside(
      'workbench.parts.panel', 'workbench.parts.sidebar', Orientation.Vertical, false,
    );
    layout.toggleZenMode();
    expect(layout.grid.viewCount).toBe(1);

    layout.toggleZenMode();
    expect(rootShape(layout)).toEqual([
      'vertical[workbench.parts.sidebar, workbench.parts.panel]',
      'workbench.parts.editor',
    ]);
  });

  it('forgets recalled positions on reset', () => {
    layout.movePartBeside(
      'workbench.parts.panel', 'workbench.parts.sidebar', Orientation.Vertical, false,
    );
    layout.togglePanel(); // hide with recall
    layout.resetLayout();
    layout.togglePanel(); // hide again (reset showed it)
    layout.togglePanel(); // show — default spot, recall was cleared
    expect(rootShape(layout)).toEqual([
      'workbench.parts.sidebar',
      'vertical[workbench.parts.editor, workbench.parts.panel]',
    ]);
  });
});

describe('window-edge stamping for card seams', () => {
  let container: HTMLElement;
  let layout: TestLayout;
  let parts: TestLayout['parts'];

  const edges = (part: FakePart): string =>
    `top:${part.element.getAttribute('data-edge-top')} right:${part.element.getAttribute('data-edge-right')}`;

  beforeEach(() => {
    container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: WIDTH, configurable: true });
    Object.defineProperty(container, 'clientHeight', { value: HEIGHT, configurable: true });
    document.body.appendChild(container);
    parts = {
      titlebar: fakePart('workbench.parts.titlebar'),
      activityBar: fakePart('workbench.parts.activitybar'),
      sidebar: fakePart('workbench.parts.sidebar'),
      editor: fakePart('workbench.parts.editor'),
      panel: fakePart('workbench.parts.panel'),
      auxiliaryBar: fakePart('workbench.parts.auxiliarybar', false),
      statusBar: fakePart('workbench.parts.statusbar'),
    };
    layout = new TestLayout(container, parts);
  });

  afterEach(() => {
    layout.dispose();
    container.remove();
  });

  it('stamps the classic shape as the old fixed rules assumed it', () => {
    // Sidebar top-left, editor column rightmost (aux hidden), panel at the
    // bottom of that column: the stamps must reproduce what the per-part
    // CSS used to hardcode.
    expect(edges(parts.sidebar)).toBe('top:1 right:0');
    expect(edges(parts.editor)).toBe('top:1 right:1');
    expect(edges(parts.panel)).toBe('top:0 right:1');
  });

  it('re-stamps when a part is stacked into a column', () => {
    // The field report: chat stacked above the explorer. The upper card owns
    // the top seam; the lower one must NOT double it, and neither owns the
    // right seam while the editor sits beside them.
    layout.toggleAuxiliaryBar();
    layout.movePartBeside(
      'workbench.parts.auxiliarybar', 'workbench.parts.sidebar', Orientation.Vertical, true,
    );
    expect(edges(parts.auxiliaryBar)).toBe('top:1 right:0');
    expect(edges(parts.sidebar)).toBe('top:0 right:0');
    expect(edges(parts.editor)).toBe('top:1 right:1');
  });

  it('re-stamps when a part moves to the other edge', () => {
    layout.movePartToEdge('workbench.parts.sidebar', Orientation.Horizontal, false);
    expect(edges(parts.sidebar)).toBe('top:1 right:1');
    expect(edges(parts.editor)).toBe('top:1 right:0');
  });
});

describe('floating leaves in the saved tree', () => {
  let container: HTMLElement;
  let layout: TestLayout;
  let parts: TestLayout['parts'];

  class FloatingTestLayout extends TestLayout {
    resolved: string[] = [];
    constructor(c: HTMLElement, p: TestLayout['parts']) {
      super(c, p);
      this._floatingViewFactory = (viewId) => {
        this.resolved.push(viewId);
        const view = fakePart(viewId);
        return view as never;
      };
    }
    get floatingIds() { return this.floatingViewIds(); }
  }

  beforeEach(() => {
    container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: WIDTH, configurable: true });
    Object.defineProperty(container, 'clientHeight', { value: HEIGHT, configurable: true });
    document.body.appendChild(container);
    parts = {
      titlebar: fakePart('workbench.parts.titlebar'),
      activityBar: fakePart('workbench.parts.activitybar'),
      sidebar: fakePart('workbench.parts.sidebar'),
      editor: fakePart('workbench.parts.editor'),
      panel: fakePart('workbench.parts.panel'),
      auxiliaryBar: fakePart('workbench.parts.auxiliarybar', false),
      statusBar: fakePart('workbench.parts.statusbar'),
    };
  });

  afterEach(() => {
    layout.dispose();
    container.remove();
  });

  it('accepts container leaves when the factory is wired, building shells', () => {
    const source = new FloatingTestLayout(container, parts);
    source.addFloatingView(fakePart('container:chat-container') as never);
    const saved = source.serializeBodyTree();
    source.dispose();

    const c2 = document.createElement('div');
    Object.defineProperty(c2, 'clientWidth', { value: WIDTH, configurable: true });
    Object.defineProperty(c2, 'clientHeight', { value: HEIGHT, configurable: true });
    document.body.appendChild(c2);
    layout = new FloatingTestLayout(c2, {
      titlebar: fakePart('workbench.parts.titlebar'),
      activityBar: fakePart('workbench.parts.activitybar'),
      sidebar: fakePart('workbench.parts.sidebar'),
      editor: fakePart('workbench.parts.editor'),
      panel: fakePart('workbench.parts.panel'),
      auxiliaryBar: fakePart('workbench.parts.auxiliarybar', false),
      statusBar: fakePart('workbench.parts.statusbar'),
    });
    container.remove();
    container = c2;

    expect(layout.restoreBodyTree(saved)).toBe(true);
    expect((layout as FloatingTestLayout).resolved).toContain('container:chat-container');
    expect(layout.grid.hasView('container:chat-container')).toBe(true);
    expect((layout as FloatingTestLayout).floatingIds).toContain('container:chat-container');
  });

  it('rejects container leaves when no factory is wired', () => {
    const source = new FloatingTestLayout(container, parts);
    source.addFloatingView(fakePart('container:chat-container') as never);
    const saved = source.serializeBodyTree();
    source.dispose();

    const c2 = document.createElement('div');
    Object.defineProperty(c2, 'clientWidth', { value: WIDTH, configurable: true });
    Object.defineProperty(c2, 'clientHeight', { value: HEIGHT, configurable: true });
    document.body.appendChild(c2);
    layout = new TestLayout(c2, {
      titlebar: fakePart('workbench.parts.titlebar'),
      activityBar: fakePart('workbench.parts.activitybar'),
      sidebar: fakePart('workbench.parts.sidebar'),
      editor: fakePart('workbench.parts.editor'),
      panel: fakePart('workbench.parts.panel'),
      auxiliaryBar: fakePart('workbench.parts.auxiliarybar', false),
      statusBar: fakePart('workbench.parts.statusbar'),
    }) as FloatingTestLayout;
    container.remove();
    container = c2;

    expect(layout.restoreBodyTree(saved)).toBe(false);
  });
});

describe('edge-cycle degeneracy (field bug: 20px panel sliver)', () => {
  let container: HTMLElement;
  let layout: TestLayout;
  let parts: TestLayout['parts'];

  beforeEach(() => {
    container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: WIDTH, configurable: true });
    Object.defineProperty(container, 'clientHeight', { value: HEIGHT, configurable: true });
    document.body.appendChild(container);
    parts = {
      titlebar: fakePart('workbench.parts.titlebar'),
      activityBar: fakePart('workbench.parts.activitybar'),
      sidebar: fakePart('workbench.parts.sidebar'),
      editor: fakePart('workbench.parts.editor'),
      panel: fakePart('workbench.parts.panel'),
      auxiliaryBar: fakePart('workbench.parts.auxiliarybar', false),
      statusBar: fakePart('workbench.parts.statusbar'),
    };
    layout = new TestLayout(container, parts);
  });

  afterEach(() => {
    layout.dispose();
    container.remove();
  });

  const h = (id: string) => layout.grid.getViewSize(id)!;

  it('keeps the panel healthy through left → right → bottom, aux visible', () => {
    layout.toggleAuxiliaryBar();
    const sizes: Record<string, number> = {};

    layout.movePartToEdge('workbench.parts.panel', Orientation.Horizontal, true);
    sizes.afterLeft = h('workbench.parts.panel');
    layout.movePartToEdge('workbench.parts.panel', Orientation.Horizontal, false);
    sizes.afterRight = h('workbench.parts.panel');
    layout.movePartToEdge('workbench.parts.panel', Orientation.Vertical, false);
    sizes.afterBottom = h('workbench.parts.panel');

    expect(sizes.afterLeft, `sizes: ${JSON.stringify(sizes)}`).toBeGreaterThan(40);
    expect(sizes.afterRight, `sizes: ${JSON.stringify(sizes)}`).toBeGreaterThan(40);
    expect(sizes.afterBottom, `sizes: ${JSON.stringify(sizes)}`).toBeGreaterThan(40);
  });

  it('keeps the panel healthy from a beside-editor start', () => {
    layout.toggleAuxiliaryBar();
    layout.movePartBeside('workbench.parts.panel', 'workbench.parts.editor', Orientation.Horizontal, true);
    const besideW = h('workbench.parts.panel');
    layout.movePartToEdge('workbench.parts.panel', Orientation.Horizontal, true);
    const leftW = h('workbench.parts.panel');
    layout.movePartToEdge('workbench.parts.panel', Orientation.Horizontal, false);
    const rightW = h('workbench.parts.panel');
    layout.movePartToEdge('workbench.parts.panel', Orientation.Vertical, false);
    const bottomH = h('workbench.parts.panel');

    const all = JSON.stringify({ besideW, leftW, rightW, bottomH });
    expect(besideW, all).toBeGreaterThan(40);
    expect(leftW, all).toBeGreaterThan(40);
    expect(rightW, all).toBeGreaterThan(40);
    expect(bottomH, all).toBeGreaterThan(40);
  });
});

describe('per-part placement reset', () => {
  let container: HTMLElement;
  let layout: TestLayout;
  let parts: TestLayout['parts'];

  beforeEach(() => {
    container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: WIDTH, configurable: true });
    Object.defineProperty(container, 'clientHeight', { value: HEIGHT, configurable: true });
    document.body.appendChild(container);
    parts = {
      titlebar: fakePart('workbench.parts.titlebar'),
      activityBar: fakePart('workbench.parts.activitybar'),
      sidebar: fakePart('workbench.parts.sidebar'),
      editor: fakePart('workbench.parts.editor'),
      panel: fakePart('workbench.parts.panel'),
      auxiliaryBar: fakePart('workbench.parts.auxiliarybar', false),
      statusBar: fakePart('workbench.parts.statusbar'),
    };
    layout = new TestLayout(container, parts);
  });

  afterEach(() => {
    layout.dispose();
    container.remove();
  });

  it('sends a wandering panel home without touching anything else', () => {
    // Widen the sidebar, stack the panel under it, then reset just the
    // panel — the column width is the user's and must survive.
    layout.grid.resizeView('workbench.parts.sidebar', 300);
    layout.movePartBeside(
      'workbench.parts.panel', 'workbench.parts.sidebar', Orientation.Vertical, false,
    );

    layout.resetPartPlacement('workbench.parts.panel');

    expect(rootShape(layout)).toEqual([
      'workbench.parts.sidebar',
      'vertical[workbench.parts.editor, workbench.parts.panel]',
    ]);
    expect(layout.grid.getViewSize('workbench.parts.panel')).toBe(DEFAULT_PANEL_HEIGHT);
    // The sidebar kept the user's width — only the panel was reset.
    expect(layout.grid.getViewSize('workbench.parts.sidebar')).toBe(300);
  });

  it('clears the panel recall: hide and show after a reset stays default', () => {
    layout.movePartBeside(
      'workbench.parts.panel', 'workbench.parts.sidebar', Orientation.Vertical, false,
    );
    layout.resetPartPlacement('workbench.parts.panel');
    layout.togglePanel();
    layout.togglePanel();
    expect(rootShape(layout)[1]).toBe('vertical[workbench.parts.editor, workbench.parts.panel]');
  });

  it('sends the sidebar back to the left edge at its default width', () => {
    layout.movePartToEdge('workbench.parts.sidebar', Orientation.Horizontal, false);
    layout.resetPartPlacement('workbench.parts.sidebar');
    expect(rootShape(layout)[0]).toBe('workbench.parts.sidebar');
    expect(layout.grid.getViewSize('workbench.parts.sidebar')).toBe(DEFAULT_SIDEBAR_WIDTH);
  });

  it('revives a hidden part at its default place', () => {
    layout.togglePanel(); // hide
    expect(layout.grid.hasView('workbench.parts.panel')).toBe(false);
    layout.resetPartPlacement('workbench.parts.panel');
    expect(layout.grid.hasView('workbench.parts.panel')).toBe(true);
    expect(parts.panel.visible).toBe(true);
  });
});

describe('placement menu on the grips', () => {
  it('right-click on the panel strip offers reset, and reset works from there', () => {
    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: WIDTH, configurable: true });
    Object.defineProperty(container, 'clientHeight', { value: HEIGHT, configurable: true });
    document.body.appendChild(container);
    const parts = {
      titlebar: fakePart('workbench.parts.titlebar'),
      activityBar: fakePart('workbench.parts.activitybar'),
      sidebar: fakePart('workbench.parts.sidebar'),
      editor: fakePart('workbench.parts.editor'),
      panel: fakePart('workbench.parts.panel'),
      auxiliaryBar: fakePart('workbench.parts.auxiliarybar', false),
      statusBar: fakePart('workbench.parts.statusbar'),
    };
    // Give the fake panel a real strip so the grip machinery arms it.
    const strip = document.createElement('div');
    strip.classList.add('view-container-tabs');
    parts.panel.element.appendChild(strip);

    const layout = new TestLayout(container, parts);
    try {
      // Send the panel somewhere else entirely.
      layout.movePartToEdge('workbench.parts.panel', Orientation.Horizontal, false);
      expect(rootShape(layout)[rootShape(layout).length - 1]).toBe('workbench.parts.panel');

      // Right-click the strip; pick Reset from the menu that appears.
      strip.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      const items = [...document.querySelectorAll<HTMLElement>('.context-menu-item')];
      const reset = items.find((i) => i.textContent?.includes('Reset To Default Position'));
      expect(reset, `menu items: ${items.map((i) => i.textContent).join(', ')}`).toBeDefined();
      reset!.click();

      expect(rootShape(layout)).toEqual([
        'workbench.parts.sidebar',
        'vertical[workbench.parts.editor, workbench.parts.panel]',
      ]);
    } finally {
      layout.dispose();
      container.remove();
      document.querySelectorAll('.context-menu').forEach((el) => el.remove());
    }
  });
});

describe('area toggles — regions, not hardcoded parts', () => {
  let container: HTMLElement;
  let layout: TestLayout;
  let parts: TestLayout['parts'];

  const build = () => {
    container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: WIDTH, configurable: true });
    Object.defineProperty(container, 'clientHeight', { value: HEIGHT, configurable: true });
    document.body.appendChild(container);
    parts = {
      titlebar: fakePart('workbench.parts.titlebar'),
      activityBar: fakePart('workbench.parts.activitybar'),
      sidebar: fakePart('workbench.parts.sidebar'),
      editor: fakePart('workbench.parts.editor'),
      panel: fakePart('workbench.parts.panel'),
      auxiliaryBar: fakePart('workbench.parts.auxiliarybar', false),
      statusBar: fakePart('workbench.parts.statusbar'),
    };
    layout = new TestLayout(container, parts);
  };

  afterEach(() => {
    layout.dispose();
    container.remove();
  });

  it('classifies the default layout by geometry: sidebar left, panel bottom', () => {
    build();
    expect(layout.areaOf('workbench.parts.sidebar')).toBe('left');
    expect(layout.areaOf('workbench.parts.panel')).toBe('bottom');
    expect(layout.areaOf('workbench.parts.editor')).toBe('center');
    expect(layout.isAreaOccupied('left')).toBe(true);
    expect(layout.isAreaOccupied('bottom')).toBe(true);
    expect(layout.isAreaOccupied('right')).toBe(false);
  });

  it('a part moved to another area is classified by WHERE IT IS, not what it is', () => {
    build();
    layout.movePartToEdge('workbench.parts.panel', Orientation.Horizontal, true);
    expect(layout.areaOf('workbench.parts.panel')).toBe('left');
    expect(layout.isAreaOccupied('bottom')).toBe(false);
  });

  it('toggling an area hides its occupant and brings it back', () => {
    build();
    layout.toggleArea('bottom');
    expect(layout.grid.hasView('workbench.parts.panel')).toBe(false);
    layout.toggleArea('bottom');
    expect(layout.grid.hasView('workbench.parts.panel')).toBe(true);
    expect(layout.areaOf('workbench.parts.panel')).toBe('bottom');
  });

  it('the bottom toggle takes the bottom OCCUPANT, leaving an exiled panel alone', () => {
    build();
    // Panel lives on the left now; a floating box occupies the bottom.
    layout.movePartToEdge('workbench.parts.panel', Orientation.Horizontal, true);
    const box = fakePart('container:bottom-box');
    layout.addFloatingView(box as never);
    layout.movePartToEdge('container:bottom-box', Orientation.Vertical, false);
    expect(layout.areaOf('container:bottom-box')).toBe('bottom');

    layout.toggleArea('bottom');
    expect(layout.grid.hasView('container:bottom-box')).toBe(false);
    expect(layout.grid.hasView('workbench.parts.panel')).toBe(true);

    layout.toggleArea('bottom');
    expect(layout.grid.hasView('container:bottom-box')).toBe(true);
    expect(layout.areaOf('container:bottom-box')).toBe('bottom');
  });

  it('a stacked area hides and restores as a set', () => {
    build();
    const box = fakePart('container:left-box');
    layout.addFloatingView(box as never);
    layout.grid.moveView('container:left-box', 'workbench.parts.sidebar', Orientation.Vertical, false);
    expect(layout.areaOf('container:left-box')).toBe('left');

    layout.toggleArea('left');
    // The sidebar's hide path animates out; finish it like the toggle tests do.
    parts.sidebar.element.dispatchEvent(new Event('transitionend'));
    expect(layout.grid.hasView('workbench.parts.sidebar')).toBe(false);
    expect(layout.grid.hasView('container:left-box')).toBe(false);

    layout.toggleArea('left');
    expect(layout.grid.hasView('workbench.parts.sidebar')).toBe(true);
    expect(layout.grid.hasView('container:left-box')).toBe(true);
    expect(layout.areaOf('workbench.parts.sidebar')).toBe('left');
    expect(layout.areaOf('container:left-box')).toBe('left');
  });

  it('toggling an empty area with no memory shows its default part', () => {
    build();
    expect(layout.isAreaOccupied('right')).toBe(false);
    layout.toggleArea('right');
    expect(layout.grid.hasView('workbench.parts.auxiliarybar')).toBe(true);
    expect(layout.areaOf('workbench.parts.auxiliarybar')).toBe('right');
  });
});

describe('rail icons for wandering parts', () => {
  let container: HTMLElement;
  let layout: TestLayout;
  let parts: TestLayout['parts'];

  const build = () => {
    container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: WIDTH, configurable: true });
    Object.defineProperty(container, 'clientHeight', { value: HEIGHT, configurable: true });
    document.body.appendChild(container);
    parts = {
      titlebar: fakePart('workbench.parts.titlebar'),
      activityBar: fakePart('workbench.parts.activitybar'),
      sidebar: fakePart('workbench.parts.sidebar'),
      editor: fakePart('workbench.parts.editor'),
      panel: fakePart('workbench.parts.panel'),
      auxiliaryBar: fakePart('workbench.parts.auxiliarybar', false),
      statusBar: fakePart('workbench.parts.statusbar'),
    };
    layout = new TestLayout(container, parts);
  };

  afterEach(() => {
    layout.dispose();
    container.remove();
  });

  it('parts at home earn no icon', () => {
    build();
    expect(layout.railIconPlacements()).toEqual([]);
  });

  it('a panel stacked into a rail area earns that rail’s icon, keyed off geometry', () => {
    build();
    layout.movePartToEdge('workbench.parts.panel', Orientation.Horizontal, false);
    expect(layout.railIconPlacements()).toEqual([
      { partId: 'workbench.parts.panel', rail: 'right' },
    ]);

    layout.movePartToEdge('workbench.parts.panel', Orientation.Horizontal, true);
    expect(layout.railIconPlacements()).toEqual([
      { partId: 'workbench.parts.panel', rail: 'left' },
    ]);

    layout.resetPartPlacement('workbench.parts.panel');
    expect(layout.railIconPlacements()).toEqual([]);
  });

  it('a HIDDEN wandering part keeps its icon — the way back survives the hide', () => {
    build();
    layout.movePartToEdge('workbench.parts.panel', Orientation.Horizontal, false);
    layout.railIconPlacements(); // record the live area
    layout.togglePanel(); // hide it in place
    expect(layout.grid.hasView('workbench.parts.panel')).toBe(false);
    expect(layout.railIconPlacements()).toEqual([
      { partId: 'workbench.parts.panel', rail: 'right' },
    ]);
    layout.togglePanel(); // and the way back still lands in that rail
    expect(layout.areaOf('workbench.parts.panel')).toBe('right');
  });
});
