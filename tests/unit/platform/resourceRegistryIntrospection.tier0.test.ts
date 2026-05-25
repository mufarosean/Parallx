// resourceRegistryIntrospection.tier0.test.ts — Slice A13

import { describe, it, expect } from 'vitest';
import {
  ResourceRegistry,
  type ResourceRegistryChangeEvent,
  type ResourceResolver,
} from '../../../src/workbench/resources/resourceRegistry.js';
import type { ExternalResource, FileResource } from '../../../src/workbench/resources/resource.js';

const fileResolver: ResourceResolver<FileResource, { tag: 'file' }> = {
  type: 'file',
  async resolve(): Promise<{ tag: 'file' }> {
    return { tag: 'file' };
  },
};

const externalResolver: ResourceResolver<ExternalResource, { tag: 'ext' }> = {
  type: 'external',
  async resolve(): Promise<{ tag: 'ext' }> {
    return { tag: 'ext' };
  },
};

describe('ResourceRegistry introspection (Slice A13)', () => {
  it('types() is empty for fresh registry', () => {
    expect(new ResourceRegistry().types()).toEqual([]);
  });

  it('types() lists registered types in insertion order', () => {
    const r = new ResourceRegistry();
    r.register(fileResolver);
    r.register(externalResolver);
    expect(r.types()).toEqual(['file', 'external']);
  });

  it('types() reflects unregister', () => {
    const r = new ResourceRegistry();
    r.register(fileResolver);
    r.register(externalResolver);
    r.unregister('file');
    expect(r.types()).toEqual(['external']);
  });

  it('onDidChange fires on register with kind="register"', () => {
    const r = new ResourceRegistry();
    const events: ResourceRegistryChangeEvent[] = [];
    r.onDidChange(e => events.push(e));
    r.register(fileResolver);
    expect(events).toEqual([{ type: 'file', kind: 'register' }]);
  });

  it('onDidChange fires on override with kind="override" when type was present', () => {
    const r = new ResourceRegistry();
    const events: ResourceRegistryChangeEvent[] = [];
    r.register(fileResolver);
    r.onDidChange(e => events.push(e));
    r.override(fileResolver);
    expect(events).toEqual([{ type: 'file', kind: 'override' }]);
  });

  it('onDidChange fires on override with kind="register" when type was absent', () => {
    const r = new ResourceRegistry();
    const events: ResourceRegistryChangeEvent[] = [];
    r.onDidChange(e => events.push(e));
    r.override(fileResolver);
    expect(events).toEqual([{ type: 'file', kind: 'register' }]);
  });

  it('onDidChange fires on unregister with kind="unregister" only when removed', () => {
    const r = new ResourceRegistry();
    r.register(fileResolver);
    const events: ResourceRegistryChangeEvent[] = [];
    r.onDidChange(e => events.push(e));
    r.unregister('file');
    r.unregister('file'); // no-op
    expect(events).toEqual([{ type: 'file', kind: 'unregister' }]);
  });

  it('types() snapshot is independent of later mutations', () => {
    const r = new ResourceRegistry();
    r.register(fileResolver);
    const snapshot = r.types();
    r.register(externalResolver);
    expect(snapshot).toEqual(['file']);
  });
});
