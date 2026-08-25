// widgetBoxes.test.ts — widgets as the smallest citizen.
//
// Pins the standalone seat machinery against a fake widget system:
// place/move/remove, LATE SYSTEM CONNECTION (every box is born waiting
// and fills when the dashboard tool activates), late TYPE registration,
// adoption from a dashboard (pageId flip, stable id), appearance
// application, and the grip menu.
//
// @vitest-environment jsdom

import { describe, it, expect, beforeEach } from 'vitest';
import {
  WidgetBox,
  WidgetBoxManager,
  widgetBoxViewId,
  instanceIdFromWidgetViewId,
  type WidgetBoxHost,
} from '../../src/workbench/widgetBox';
import type { WorkbenchWidgetHost } from '../../src/built-in/dashboard/dashboardTypes';
import { CONTAINER_DRAG_TYPE } from '../../src/platform/dragTypes';
import type { PartDropZone } from '../../src/workbench/partDrag';
import { Orientation } from '../../src/layout/layoutTypes';
import { Emitter } from '../../src/platform/events';

interface FakeRow {
  id: string;
  pageId: string;
  widgetTypeId: string;
  config: Record<string, unknown>;
  refreshPolicy: { kind: string };
  appearance: Record<string, unknown>;
  cachedOutput: string | null;
  errorMessage: string | null;
}

function fakeSystem() {
  const rows = new Map<string, FakeRow>();
  const typesChanged = new Emitter<void>();
  const dataChanged = new Emitter<{ kind: string; widgetId?: string; pageId?: string }>();
  const types = new Map<string, { typeId: string; displayName: string; createWidget?: (c: HTMLElement, ctx: unknown) => { dispose(): void; refreshFromCache?(o: string | null): void } }>();
  const calls: string[] = [];

  const system = {
    calls,
    rows,
    typesChanged,
    dataChanged,
    addType: (typeId: string, create?: boolean) => {
      types.set(typeId, {
        typeId,
        displayName: typeId,
        createWidget: create === false ? undefined : (c: HTMLElement) => {
          c.textContent = `LIVE:${typeId}`;
          return { dispose: () => {} };
        },
      });
      typesChanged.fire();
    },
    addRow: (row: Partial<FakeRow> & { id: string; widgetTypeId: string }) => {
      rows.set(row.id, {
        pageId: 'page-workbench-seats', config: {}, refreshPolicy: { kind: 'manual' },
        appearance: {}, cachedOutput: null, errorMessage: null, ...row,
      });
    },

    listWidgetTypes: () => [...types.values()],
    getWidgetType: (typeId: string) => types.get(typeId),
    onDidChangeTypes: (l: () => void) => typesChanged.event(l),
    onDidChangeData: (l: (e: { kind: string; widgetId?: string }) => void) => dataChanged.event(l as never),
    createInstance: async (typeId: string) => {
      const row: FakeRow = {
        id: `inst-${rows.size + 1}`, pageId: 'page-workbench-seats', widgetTypeId: typeId,
        config: {}, refreshPolicy: { kind: 'manual' }, appearance: {},
        cachedOutput: null, errorMessage: null,
      };
      rows.set(row.id, row);
      return row;
    },
    getInstance: async (id: string) => rows.get(id) ?? null,
    removeInstance: async (id: string) => { rows.delete(id); calls.push(`removeInstance:${id}`); },
    adoptInstance: async (id: string) => {
      const row = rows.get(id);
      if (!row) return null;
      row.pageId = 'page-workbench-seats';
      calls.push(`adopt:${id}`);
      return row;
    },
    setCachedOutput: async (id: string, o: string) => { calls.push(`cache:${id}:${o}`); },
    setError: async (id: string, m: string) => { calls.push(`error:${id}:${m}`); },
    clearError: async (id: string) => { calls.push(`clearError:${id}`); },
    updateAppearance: async (id: string, appearance: Record<string, unknown>) => {
      const row = rows.get(id);
      if (row) row.appearance = appearance;
      calls.push(`appearance:${id}:${JSON.stringify(appearance)}`);
      dataChanged.fire({ kind: 'widget-updated', widgetId: id });
    },
    refreshWidget: async (id: string) => { calls.push(`refresh:${id}`); },
    scheduleWidget: async (id: string) => { calls.push(`schedule:${id}`); },
    cancelSchedule: (id: string) => { calls.push(`cancel:${id}`); },
    api: {},
    applyAppearance: (card: HTMLElement) => { card.dataset.appearanceApplied = '1'; },
  };
  return system as typeof system & WorkbenchWidgetHost;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('WidgetBox basics', () => {
  it('maps view ids both ways', () => {
    expect(widgetBoxViewId('w1')).toBe('widget:w1');
    expect(instanceIdFromWidgetViewId('widget:w1')).toBe('w1');
    expect(instanceIdFromWidgetViewId('container:x')).toBeUndefined();
  });

  it('drags by its grip with the widget view id riding the container pipeline', () => {
    const box = new WidgetBox('w1');
    const grip = box.element.querySelector<HTMLElement>('.widget-box-grip')!;
    const store = new Map<string, string>();
    const ev = new Event('dragstart', { bubbles: true });
    Object.defineProperty(ev, 'dataTransfer', {
      value: { effectAllowed: '', setData: (t: string, v: string) => { store.set(t, v); } },
    });
    grip.dispatchEvent(ev);
    expect(JSON.parse(store.get(CONTAINER_DRAG_TYPE)!)).toEqual({ containerId: 'widget:w1' });
    box.dispose();
  });
});

describe('WidgetBoxManager', () => {
  let host: WidgetBoxHost;
  let calls: string[];
  let manager: WidgetBoxManager;
  let system: ReturnType<typeof fakeSystem>;

  beforeEach(() => {
    calls = [];
    host = {
      addFloatingView: (view, zone) => calls.push(`add:${view.id}:${zone?.kind ?? 'default'}`),
      removeFloatingView: (viewId) => calls.push(`remove:${viewId}`),
      moveFloating: (viewId, zone) => calls.push(`move:${viewId}:${zone.kind}`),
      moveFloatingToEdge: (viewId, o, b) => calls.push(`edge:${viewId}:${o}:${b}`),
      requestSave: () => calls.push('save'),
    };
    manager = new WidgetBoxManager(host);
    system = fakeSystem();
    system.addType('parallx.dashboard.clock-and-links');
    system.addRow({ id: 'w1', widgetTypeId: 'parallx.dashboard.clock-and-links' });
  });

  const zoneBeside: PartDropZone = {
    kind: 'beside', targetId: 'workbench.parts.sidebar',
    orientation: Orientation.Vertical, before: false,
  };

  it('a seat is born waiting and fills when the system connects', async () => {
    const shell = manager.resolveShell('widget:w1') as WidgetBox;
    expect(shell.isPending).toBe(true);

    manager.connectSystem(system);
    await flush();
    expect(shell.isPending).toBe(false);
    expect(shell.body.textContent).toContain('LIVE:');
    expect(shell.card.dataset.appearanceApplied).toBe('1');
    expect(system.calls).toContain('schedule:w1');
  });

  it('a seat whose TYPE registers late fills on the types-changed signal', async () => {
    system.addRow({ id: 'w2', widgetTypeId: 'late.type' });
    manager.connectSystem(system);
    const shell = manager.resolveShell('widget:w2') as WidgetBox;
    await flush();
    expect(shell.isPending).toBe(true);

    system.addType('late.type');
    await flush();
    expect(shell.isPending).toBe(false);
    expect(shell.body.textContent).toBe('LIVE:late.type');
  });

  it('places, moves on drop, and refuses nothing it should not', async () => {
    manager.connectSystem(system);
    manager.place('w1', zoneBeside);
    expect(calls).toContain('add:widget:w1:beside');
    calls.length = 0;
    manager.handleDrop('widget:w1', zoneBeside);
    expect(calls).toContain('move:widget:w1:beside');
  });

  it('removing a widget deletes the SEAT and the INSTANCE', async () => {
    manager.connectSystem(system);
    manager.place('w1');
    await flush();
    await manager.removeWidget('w1');
    expect(manager.has('w1')).toBe(false);
    expect(calls).toContain('remove:widget:w1');
    expect(system.calls).toContain('cancel:w1');
    expect(system.calls).toContain('removeInstance:w1');
  });

  it('adopts a dashboard widget: pageId flip, seat at the right edge', async () => {
    manager.connectSystem(system);
    system.addRow({ id: 'dash1', widgetTypeId: 'parallx.dashboard.clock-and-links', pageId: 'page-x' });
    expect(await manager.adopt('dash1')).toBe(true);
    expect(system.calls).toContain('adopt:dash1');
    expect(calls).toContain('add:widget:dash1:default');
    expect(calls.some((c) => c.startsWith('edge:widget:dash1:'))).toBe(true);
    expect(await manager.adopt('missing')).toBe(false);
  });

  it('a missing instance shows the missing note, never a broken render', async () => {
    manager.connectSystem(system);
    const shell = manager.resolveShell('widget:ghost') as WidgetBox;
    await flush();
    expect(shell.isPending).toBe(true);
    expect(shell.body.textContent).toContain('no longer exists');
  });

  it('prunes seats a restored tree dropped, keeping instances', async () => {
    manager.connectSystem(system);
    manager.place('w1');
    manager.pruneAbsent(new Set<string>());
    expect(manager.has('w1')).toBe(false);
    expect(system.rows.get('w1')).toBeDefined();
    expect(system.calls).not.toContain('removeInstance:w1');
  });

  it('the grip menu offers moves, alignment, and Remove Widget', async () => {
    manager.connectSystem(system);
    manager.place('w1');
    await flush();
    const box = manager.resolveShell('widget:w1') as WidgetBox;
    box.element.querySelector<HTMLElement>('.widget-box-menu-btn')!.click();
    try {
      const labels = [...document.querySelectorAll<HTMLElement>('.context-menu-item')]
        .map((i) => i.textContent ?? '');
      expect(labels.some((l) => l.includes('Edit Appearance…'))).toBe(true);
      expect(labels.some((l) => l.includes('Align Content'))).toBe(true);
      expect(labels.some((l) => l.includes('Move To Bottom Edge'))).toBe(true);
      expect(labels.some((l) => l.includes('Remove Widget'))).toBe(true);
    } finally {
      document.querySelectorAll('.context-menu').forEach((el) => el.remove());
    }
  });

  it('setContentAlign persists into appearance and the seat remounts with it', async () => {
    manager.connectSystem(system);
    manager.place('w1');
    await flush();

    await manager.setContentAlign('w1', 'center');
    await flush();
    expect(system.calls.some((c) => c.startsWith('appearance:w1:') && c.includes('"contentAlign":"center"'))).toBe(true);
    // The widget-updated event remounted the seat; the fake system's
    // applyAppearance ran again against the updated row.
    expect(system.rows.get('w1')?.appearance).toMatchObject({ contentAlign: 'center' });
  });
});

describe('applyWidgetAppearance content alignment', () => {
  it('stamps data-content-align for non-default modes and clears it for start', async () => {
    const { applyWidgetAppearance } = await import('../../src/built-in/dashboard/widgetAppearance');
    const card = document.createElement('div');
    const base = {
      background: 'default', backgroundColor: null,
      border: 'default', borderColor: null,
      title: null, titleHidden: false,
    } as const;

    applyWidgetAppearance(card, { ...base, contentAlign: 'center' });
    expect(card.dataset.contentAlign).toBe('center');

    applyWidgetAppearance(card, { ...base, contentAlign: 'start-padded' });
    expect(card.dataset.contentAlign).toBe('start-padded');

    applyWidgetAppearance(card, { ...base, contentAlign: 'start' });
    expect(card.dataset.contentAlign).toBeUndefined();

    applyWidgetAppearance(card, { ...base });
    expect(card.dataset.contentAlign).toBeUndefined();
  });
});
