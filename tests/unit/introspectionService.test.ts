// introspectionService.test.ts — the self-knowledge join (SYSTEM_INTEGRITY.md
// Phase C).
//
// Pins the contract that the app can describe itself: tools joined across
// registry × activator × errors × enablement, key conflicts found across
// sources, the layout narrated by area, settings compacted with secrets
// never read, and every answer degrading to empty (never throwing) when a
// service is absent.

import { describe, it, expect } from 'vitest';
import { IntrospectionService } from '../../src/services/introspectionService.js';
import { ServiceCollection } from '../../src/services/serviceCollection.js';
import {
  ICommandService,
  IContextKeyService,
  IEditorService,
  IKeybindingService,
  ISettingsRegistryService,
  IToolActivatorService,
  IToolEnablementService,
  IToolErrorService,
  IToolRegistryService,
} from '../../src/services/serviceTypes.js';

const HOST = {
  bodyLeafViewIds: () => ['workbench.parts.sidebar', 'workbench.parts.editor', 'workbench.parts.panel'],
  areaOf: (viewId: string) =>
    viewId.endsWith('sidebar') ? 'left' as const
    : viewId.endsWith('panel') ? 'bottom' as const
    : 'center' as const,
  railIconPlacements: () => [{ partId: 'workbench.parts.panel', rail: 'right' as const }],
};

function toolEntry(id: string, isBuiltin: boolean, state = 'activated') {
  return {
    description: {
      manifest: { id, name: id, version: '1.0.0', publisher: 'parallx', activationEvents: ['onStartupFinished'] },
      toolPath: `/tools/${id}`,
      isBuiltin,
    },
    state,
  };
}

describe('IntrospectionService — the self-knowledge join', () => {
  it('describeTools joins registry, activator, errors, and enablement', () => {
    const services = new ServiceCollection();
    services.registerInstance(IToolRegistryService, {
      getAll: () => [toolEntry('parallx.canvas', true), toolEntry('community.budget', false, 'registered')],
    } as never);
    services.registerInstance(IToolActivatorService, {
      getActivated: (id: string) =>
        id === 'parallx.canvas' ? { activatedAt: 1000, activationDurationMs: 42 } : undefined,
    } as never);
    services.registerInstance(IToolErrorService, {
      getToolErrors: (id: string) =>
        id === 'community.budget'
          ? [{ toolId: id, message: 'boom', context: 'activation', timestamp: 5 }]
          : [],
    } as never);
    services.registerInstance(IToolEnablementService, {
      isEnabled: (id: string) => id !== 'community.budget',
      canChangeEnablement: (id: string) => id === 'community.budget',
    } as never);

    const svc = new IntrospectionService(services, HOST);
    const tools = svc.describeTools();

    const canvas = tools.find((t) => t.id === 'parallx.canvas')!;
    expect(canvas.builtin).toBe(true);
    expect(canvas.state).toBe('activated');
    expect(canvas.enabled).toBe(true);
    expect(canvas.activatedAt).toBe(1000);
    expect(canvas.activationDurationMs).toBe(42);
    expect(canvas.errorCount).toBe(0);
    expect(canvas.lastError).toBeUndefined();

    const budget = tools.find((t) => t.id === 'community.budget')!;
    expect(budget.enabled).toBe(false);
    expect(budget.canChangeEnablement).toBe(true);
    expect(budget.errorCount).toBe(1);
    expect(budget.lastError?.message).toBe('boom');
    expect(budget.lastError?.context).toBe('activation');
  });

  it('findKeyConflicts reports keys bound to more than one distinct command', () => {
    const services = new ServiceCollection();
    services.registerInstance(IKeybindingService, {
      getAllKeybindings: () => [
        { key: 'ctrl+b', commandId: 'workbench.action.toggleSidebar', source: 'builtin' },
        { key: 'ctrl+b', commandId: 'canvas.bold', when: "activeEditor == 'canvas'", source: 'tool:canvas' },
        { key: 'ctrl+j', commandId: 'workbench.action.togglePanel', source: 'builtin' },
        { key: 'f2', commandId: 'explorer.rename', source: 'tool:explorer' },
        { key: 'f2', commandId: 'explorer.rename', source: 'user' }, // same command twice: not a conflict
      ],
    } as never);

    const svc = new IntrospectionService(services, HOST);
    const conflicts = svc.findKeyConflicts();

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].key).toBe('ctrl+b');
    expect(conflicts[0].bindings.map((b) => b.commandId).sort()).toEqual([
      'canvas.bold', 'workbench.action.toggleSidebar',
    ]);
  });

  it('describeLayout narrates areas and relocated rail icons', () => {
    const svc = new IntrospectionService(new ServiceCollection(), HOST);
    const layout = svc.describeLayout();

    expect(layout.areas.left).toEqual(['workbench.parts.sidebar']);
    expect(layout.areas.bottom).toEqual(['workbench.parts.panel']);
    expect(layout.areas.center).toEqual(['workbench.parts.editor']);
    expect(layout.areas.right).toEqual([]);
    expect(layout.prose).toContain('Left of the editor: workbench.parts.sidebar');
    expect(layout.prose).toContain('Right: nothing');
    expect(layout.prose).toContain('workbench.parts.panel on the right rail');
  });

  it('describeSettings compacts values and never reads secrets', () => {
    const services = new ServiceCollection();
    const reads: string[] = [];
    services.registerInstance(ISettingsRegistryService, {
      getAllSchemas: () => [
        { key: 'ui.fontSize', type: 'number', scope: 'user', default: 14 },
        { key: 'ai.apiKey', type: 'string', scope: 'user', default: '', secret: true },
        { key: 'ui.theme', type: 'string', scope: 'workspace', default: 'dark' },
      ],
      getValue: (key: string) => {
        reads.push(key);
        return key === 'ui.theme' ? 'light' : 14;
      },
    } as never);

    const svc = new IntrospectionService(services, HOST);
    const settings = svc.describeSettings();

    expect(settings.find((s) => s.key === 'ui.fontSize')).toMatchObject({ value: '14', isDefault: true });
    expect(settings.find((s) => s.key === 'ui.theme')).toMatchObject({ value: 'light', isDefault: false });
    expect(settings.find((s) => s.key === 'ai.apiKey')).toMatchObject({ value: '[secret]' });
    expect(reads).not.toContain('ai.apiKey');
  });

  it('describeContext exposes the live context map through the DI interface', () => {
    const services = new ServiceCollection();
    services.registerInstance(IContextKeyService, {
      getAllContext: () => new Map<string, unknown>([['sidebarVisible', true], ['activeEditor', 'canvas']]),
    } as never);

    const svc = new IntrospectionService(services, HOST);
    expect(svc.describeContext()).toEqual({ sidebarVisible: true, activeEditor: 'canvas' });
  });

  it('every answer degrades to empty when services are absent — never throws', () => {
    const svc = new IntrospectionService(new ServiceCollection(), HOST);
    expect(svc.describeTools()).toEqual([]);
    expect(svc.describeCommands()).toEqual([]);
    expect(svc.describeKeybindings()).toEqual([]);
    expect(svc.findKeyConflicts()).toEqual([]);
    expect(svc.describeEditors()).toEqual([]);
    expect(svc.describeSettings()).toEqual([]);
    expect(svc.describeContext()).toEqual({});
    const snap = svc.snapshot();
    expect(snap.layout.areas.center).toEqual(['workbench.parts.editor']);
    expect(snap.services).toEqual([]);
  });

  it('snapshot joins everything, and describeServices enumerates the collection', () => {
    const services = new ServiceCollection();
    services.registerInstance(ICommandService, {
      getCommands: () => new Map([
        ['b.cmd', { id: 'b.cmd', title: 'B' }],
        ['a.cmd', { id: 'a.cmd', title: 'A', category: 'Test', aiInvocable: true }],
      ]),
    } as never);
    services.registerInstance(IEditorService, {
      getOpenEditors: () => [{ id: 'e1', name: 'notes.md', isDirty: false, isActive: true, groupId: 'g1' }],
    } as never);

    const svc = new IntrospectionService(services, HOST);
    const snap = svc.snapshot();

    expect(snap.commands.map((c) => c.id)).toEqual(['a.cmd', 'b.cmd']); // sorted
    expect(snap.editors[0].name).toBe('notes.md');
    expect(snap.services).toEqual(['ICommandService', 'IEditorService']); // sorted keys()
  });
});
