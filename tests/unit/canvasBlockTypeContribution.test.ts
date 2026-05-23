/**
 * Unit tests for CanvasBlockTypeContributionProcessor and CanvasBlockTypeRegistry (M82 Slice A).
 *
 * Covers:
 *   1. Manifest with `contributes.canvas.blockTypes[]` reserves the id.
 *   2. Imperative `wireRealDefinition(id, def)` registers the full BlockDefinition in the runtime registry.
 *   3. Registry rejects ids that collide with built-ins.
 *   4. Registry rejects duplicate ids from different contributions.
 *   5. Disposal via `removeContributions(toolId)` removes both the reservation and the runtime registration.
 *   6. Imperative-only path (no manifest stub) registers directly with the runtime registry.
 *   7. `unwireRealDefinition` drops the runtime entry but keeps the manifest stub.
 *   8. Invalid manifest entries (missing id / name) are skipped with a warning.
 */

import { describe, expect, it, beforeEach, vi, type MockedFunction } from 'vitest';
import { CanvasBlockTypeContributionProcessor } from '../../src/contributions/canvasBlockTypeContribution';
import { CanvasBlockTypeRegistry } from '../../src/services/canvasBlockTypeRegistry';
import type { IToolDescription } from '../../src/tools/toolManifest';
import type { BlockDefinition } from '../../src/built-in/canvas/config/blockRegistry';
import { BLOCK_REGISTRY } from '../../src/built-in/canvas/config/blockRegistry';

function createToolDescription(toolId: string, blockTypes: any[]): IToolDescription {
  return {
    manifest: {
      id: toolId,
      displayName: toolId,
      version: '0.0.1',
      contributes: {
        canvas: { blockTypes },
      },
    },
  } as any;
}

function makeRealDefinition(id: string): BlockDefinition {
  return {
    id,
    name: id,
    label: id,
    icon: 'browser',
    source: 'custom',
    kind: 'atom',
    capabilities: {} as any,
    extension: () => ({ name: id } as any),
  } as BlockDefinition;
}

describe('CanvasBlockTypeContributionProcessor + Registry', () => {
  let registry: CanvasBlockTypeRegistry;
  let processor: CanvasBlockTypeContributionProcessor;
  let warnSpy: MockedFunction<typeof console.warn>;
  let logSpy: MockedFunction<typeof console.log>;

  beforeEach(() => {
    registry = new CanvasBlockTypeRegistry();
    processor = new CanvasBlockTypeContributionProcessor(registry);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined) as any;
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined) as any;
  });

  it('reserves manifest-declared block-type ids and exposes them through hasContributed/getOwnerToolId', () => {
    processor.processContributions(createToolDescription('tool.a', [
      { id: 'a.iframe', name: 'aIframe', label: 'Iframe', icon: 'browser', kind: 'atom' },
    ]));

    expect(processor.hasContributed('a.iframe')).toBe(true);
    expect(processor.getOwnerToolId('a.iframe')).toBe('tool.a');
    expect(processor.getContributedIds()).toEqual(['a.iframe']);
    // No runtime entry yet — registry is empty until wireRealDefinition is called.
    expect(registry.getAll()).toHaveLength(0);
  });

  it('wires the full BlockDefinition into the registry on wireRealDefinition', () => {
    processor.processContributions(createToolDescription('tool.a', [
      { id: 'a.iframe', name: 'aIframe', label: 'Iframe', icon: 'browser', kind: 'atom' },
    ]));

    const def = makeRealDefinition('a.iframe');
    const wired = processor.wireRealDefinition('a.iframe', def);
    expect(wired).toBe(true);
    expect(registry.getAll()).toHaveLength(1);
    expect(registry.getAll()[0].id).toBe('a.iframe');
    expect(registry.has('a.iframe')).toBe(true);
  });

  it('returns false from wireRealDefinition when no manifest stub exists', () => {
    const def = makeRealDefinition('not-declared');
    const wired = processor.wireRealDefinition('not-declared', def);
    expect(wired).toBe(false);
    expect(registry.getAll()).toHaveLength(0);
  });

  it('rejects ids that collide with built-in BLOCK_REGISTRY at the manifest stage', () => {
    // Pick an actual built-in id to guarantee the conflict path is exercised.
    const builtIn = [...BLOCK_REGISTRY.keys()][0];
    expect(builtIn).toBeTruthy();
    processor.processContributions(createToolDescription('tool.a', [
      { id: builtIn, name: 'whatever', label: 'whatever', icon: 'browser', kind: 'atom' },
    ]));

    expect(processor.hasContributed(builtIn)).toBe(false);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('rejects duplicate ids from different contributing tools', () => {
    processor.processContributions(createToolDescription('tool.a', [
      { id: 'shared.id', name: 'A', label: 'A', icon: 'browser', kind: 'atom' },
    ]));
    processor.processContributions(createToolDescription('tool.b', [
      { id: 'shared.id', name: 'B', label: 'B', icon: 'browser', kind: 'atom' },
    ]));

    expect(processor.getOwnerToolId('shared.id')).toBe('tool.a');
    expect(processor.getContributedIds()).toEqual(['shared.id']);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('removes both the reservation and any runtime registration on removeContributions(toolId)', () => {
    processor.processContributions(createToolDescription('tool.a', [
      { id: 'a.iframe', name: 'aIframe', label: 'Iframe', icon: 'browser', kind: 'atom' },
    ]));
    processor.wireRealDefinition('a.iframe', makeRealDefinition('a.iframe'));
    expect(registry.has('a.iframe')).toBe(true);

    processor.removeContributions('tool.a');

    expect(processor.hasContributed('a.iframe')).toBe(false);
    expect(registry.has('a.iframe')).toBe(false);
  });

  it('imperative-only registration through the registry succeeds without a manifest stub', () => {
    const def = makeRealDefinition('imperative.only');
    const reg = registry.register(def);
    expect(registry.has('imperative.only')).toBe(true);
    reg.dispose();
    expect(registry.has('imperative.only')).toBe(false);
  });

  it('unwireRealDefinition drops the runtime entry but keeps the manifest stub', () => {
    processor.processContributions(createToolDescription('tool.a', [
      { id: 'a.iframe', name: 'aIframe', label: 'Iframe', icon: 'browser', kind: 'atom' },
    ]));
    processor.wireRealDefinition('a.iframe', makeRealDefinition('a.iframe'));
    expect(registry.has('a.iframe')).toBe(true);

    processor.unwireRealDefinition('a.iframe');

    expect(registry.has('a.iframe')).toBe(false);
    expect(processor.hasContributed('a.iframe')).toBe(true);
  });

  it('skips invalid manifest entries (missing id or name) with a warning', () => {
    processor.processContributions(createToolDescription('tool.a', [
      { name: 'noId' },
      { id: 'no.name' },
      { id: 'valid', name: 'valid', label: 'V', icon: 'browser', kind: 'atom' },
    ]));

    expect(processor.getContributedIds()).toEqual(['valid']);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('rejects a registry registration whose id is a built-in', () => {
    const builtIn = [...BLOCK_REGISTRY.keys()][0];
    expect(() => registry.register(makeRealDefinition(builtIn))).toThrow(/built-in/);
  });

  it('rejects a second registry registration for the same id', () => {
    registry.register(makeRealDefinition('dup'));
    expect(() => registry.register(makeRealDefinition('dup'))).toThrow(/already contributed/);
  });

  it('fires onDidChange when a contribution is added or removed', () => {
    let count = 0;
    registry.onDidChange(() => { count++; });
    const reg = registry.register(makeRealDefinition('evented'));
    expect(count).toBe(1);
    reg.dispose();
    expect(count).toBe(2);
  });
});
