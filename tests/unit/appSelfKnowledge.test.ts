// appSelfKnowledge.test.ts — the AI-facing and doctor-facing doors onto
// introspection (SYSTEM_INTEGRITY.md Phase C Tier 4).
//
// Pins the app__describe tool contract (summary by default, full lists by
// topic, graceful degradation) and the workbench diagnostics checks (tool
// health, keybinding conflicts distinguishing guarded from unguarded
// collisions, layout integrity, enablement).

import { describe, it, expect } from 'vitest';
import { createAppDescribeTool } from '../../src/built-in/chat/tools/appDescribeTool.js';
import { createWorkbenchDiagnosticChecks } from '../../src/services/workbenchDiagnosticChecks.js';
import type { IIntrospectionService } from '../../src/services/introspectionService.js';

const NO_TOKEN = { isCancellationRequested: false } as never;

function fakeIntrospection(overrides: Partial<IIntrospectionService> = {}): IIntrospectionService {
  const base: IIntrospectionService = {
    describeTools: () => [
      { id: 'parallx.canvas', name: 'Canvas', version: '1.0.0', publisher: 'parallx', builtin: true, state: 'activated', enabled: true, canChangeEnablement: false, activationEvents: [], activatedAt: 100, activationDurationMs: 12, errorCount: 0 },
      { id: 'community.budget', name: 'Budget', version: '1.0.0', publisher: 'x', builtin: false, state: 'registered', enabled: false, canChangeEnablement: true, activationEvents: [], errorCount: 2, lastError: { message: 'boom', context: 'activation', timestamp: 5 } },
    ],
    describeCommands: () => [{ id: 'a.cmd', title: 'A' }],
    describeKeybindings: () => [{ key: 'ctrl+b', commandId: 'a.cmd', source: 'builtin' }],
    findKeyConflicts: () => [],
    describeLayout: () => ({
      areas: { left: ['sidebar'], right: [], bottom: [], center: ['workbench.parts.editor'] },
      railIcons: [],
      prose: 'Left of the editor: sidebar.',
    }),
    describeEditors: () => [{ id: 'e', name: 'notes.md', isDirty: false, isActive: true, groupId: 'g' }],
    describeSettings: () => [{ key: 'k', type: 'string', scope: 'user', value: 'v', isDefault: true }],
    describeContext: () => ({ sidebarVisible: true }),
    describeServices: () => ['ICommandService'],
    snapshot: () => { throw new Error('unused'); },
  };
  return { ...base, ...overrides };
}

describe('app__describe — the system diagnosing itself', () => {
  it('defaults to a compact summary with counts, health, and the layout prose', async () => {
    const tool = createAppDescribeTool(() => fakeIntrospection());
    const result = await tool.handler({}, NO_TOKEN);
    const parsed = JSON.parse(result.content);

    expect(parsed.ok).toBe(true);
    expect(parsed.topic).toBe('summary');
    expect(parsed.summary.tools.total).toBe(2);
    expect(parsed.summary.tools.activated).toBe(1);
    expect(parsed.summary.tools.disabled).toEqual(['community.budget']);
    expect(parsed.summary.tools.withErrors[0]).toMatchObject({ id: 'community.budget', errorCount: 2 });
    expect(parsed.summary.layout).toContain('Left of the editor');
    expect(parsed.summary.editors).toEqual(['notes.md']);
  });

  it('returns the full list for a specific topic', async () => {
    const tool = createAppDescribeTool(() => fakeIntrospection());
    const result = await tool.handler({ topic: 'tools' }, NO_TOKEN);
    const parsed = JSON.parse(result.content);

    expect(parsed.topic).toBe('tools');
    expect(parsed.tools).toHaveLength(2);
    expect(parsed.tools[0].activationDurationMs).toBe(12);
  });

  it('an unknown topic falls back to summary; a missing service degrades to an error result', async () => {
    const tool = createAppDescribeTool(() => fakeIntrospection());
    const fallback = JSON.parse((await tool.handler({ topic: 'nonsense' }, NO_TOKEN)).content);
    expect(fallback.topic).toBe('summary');

    const absent = createAppDescribeTool(() => undefined);
    const errored = await absent.handler({}, NO_TOKEN);
    expect(errored.isError).toBe(true);
    expect(JSON.parse(errored.content).ok).toBe(false);
  });
});

describe('workbench diagnostics — the workbench as a category', () => {
  const DEPS = { getWorkspaceName: () => 'test' };

  it('tool health passes when clean and warns naming the failing tools', async () => {
    const [toolHealth] = createWorkbenchDiagnosticChecks(fakeIntrospection());
    const warned = await toolHealth(DEPS);
    expect(warned.category).toBe('workbench');
    expect(warned.status).toBe('warn');
    expect(warned.detail).toContain('community.budget (2)');

    const clean = fakeIntrospection({
      describeTools: () => [
        { id: 'a', name: 'a', version: '1', publisher: 'p', builtin: true, state: 'activated', enabled: true, canChangeEnablement: false, activationEvents: [], errorCount: 0 },
      ],
    });
    const passed = await createWorkbenchDiagnosticChecks(clean)[0](DEPS);
    expect(passed.status).toBe('pass');
    expect(passed.detail).toContain('1 of 1 tools activated');
  });

  it('keybinding conflicts distinguish when-guarded sharing from unguarded collisions', async () => {
    const guarded = fakeIntrospection({
      findKeyConflicts: () => [{
        key: 'ctrl+b',
        bindings: [
          { key: 'ctrl+b', commandId: 'x', when: 'a' },
          { key: 'ctrl+b', commandId: 'y', when: 'b' },
        ],
      }],
    });
    const guardedResult = await createWorkbenchDiagnosticChecks(guarded)[1](DEPS);
    expect(guardedResult.status).toBe('pass');
    expect(guardedResult.detail).toContain('partitioned by when-clauses');

    const unguarded = fakeIntrospection({
      findKeyConflicts: () => [{
        key: 'ctrl+b',
        bindings: [
          { key: 'ctrl+b', commandId: 'x' },
          { key: 'ctrl+b', commandId: 'y' },
        ],
      }],
    });
    const unguardedResult = await createWorkbenchDiagnosticChecks(unguarded)[1](DEPS);
    expect(unguardedResult.status).toBe('warn');
    expect(unguardedResult.detail).toContain('ctrl+b');
  });

  it('layout integrity fails when the editor leaves the center', async () => {
    const broken = fakeIntrospection({
      describeLayout: () => ({
        areas: { left: [], right: [], bottom: [], center: [] }, railIcons: [], prose: '',
      }),
    });
    const result = await createWorkbenchDiagnosticChecks(broken)[2](DEPS);
    expect(result.status).toBe('fail');

    const healthy = await createWorkbenchDiagnosticChecks(fakeIntrospection())[2](DEPS);
    expect(healthy.status).toBe('pass');
  });

  it('enablement reports disabled-by-choice as pass with detail', async () => {
    const result = await createWorkbenchDiagnosticChecks(fakeIntrospection())[3](DEPS);
    expect(result.status).toBe('pass');
    expect(result.detail).toContain('community.budget');
  });
});
