// apiServicesGate.test.ts — api.services is read-only for external tools
// (Phase D Decision 1, PHASE_D_BRIEF.md, decided 2026-08-29).
//
// Reads are how the sandbox composes; writes are how a core service gets
// silently overwritten. Built-ins keep registerInstance; an external tool
// calling it gets a loud, named error — and its reads keep working.

import { describe, it, expect } from 'vitest';
import { createToolApi } from '../../src/api/apiFactory.js';
import type { ApiFactoryDependencies } from '../../src/api/apiFactory.js';
import { ServiceCollection } from '../../src/services/serviceCollection.js';
import { createServiceIdentifier } from '../../src/platform/types.js';
import type { IToolDescription } from '../../src/tools/toolManifest.js';

function description(id: string, isBuiltin: boolean): IToolDescription {
  return {
    manifest: {
      manifestVersion: 1,
      id,
      name: id,
      version: '1.0.0',
      publisher: 'test',
      description: 'test tool',
      main: './main.js',
      engines: { parallx: '^0.1.0' },
    } as IToolDescription['manifest'],
    toolPath: `/tools/${id}`,
    isBuiltin,
  };
}

function makeDeps(): ApiFactoryDependencies {
  return {
    services: new ServiceCollection(),
    viewManager: {} as never,
    toolRegistry: { getAll: () => [], getById: () => undefined } as never,
    notificationService: {} as never,
    workbenchContainer: undefined,
  };
}

const ITestService = createServiceIdentifier<{ ping(): string }>('ITestGateService');

describe('api.services gate — read-only for externals', () => {
  it('a built-in registers and reads services as before', () => {
    const deps = makeDeps();
    const { api, dispose } = createToolApi(description('parallx.test', true), deps);

    api.services.registerInstance(ITestService, { ping: () => 'ok' });
    expect(api.services.has(ITestService)).toBe(true);
    expect(api.services.get<{ ping(): string }>(ITestService).ping()).toBe('ok');
    dispose();
  });

  it('an external tool may read but a register attempt throws a named error', () => {
    const deps = makeDeps();
    deps.services.registerInstance(ITestService, { ping: () => 'core' });
    const { api, dispose } = createToolApi(description('community.rogue', false), deps);

    // Reads compose the sandbox — untouched.
    expect(api.services.has(ITestService)).toBe(true);
    expect(api.services.get<{ ping(): string }>(ITestService).ping()).toBe('core');

    // The write is refused loudly, naming the tool and the identifier —
    // and the core service is NOT overwritten.
    expect(() => api.services.registerInstance(ITestService, { ping: () => 'evil' }))
      .toThrow(/community\.rogue.*built-in privilege/s);
    expect(deps.services.get(ITestService).ping()).toBe('core');
    dispose();
  });
});
