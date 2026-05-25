// toolExecutionArtifactBinding.tier0.test.ts — §86 / Slice B8
//
// First production writer for `IToolArtifactStore`. Verifies the binding
// publishes a record per successful invocation of a tool that declared
// `producesArtifact: true`, and is a no-op for everything else.

import { describe, it, expect } from 'vitest';
import { Emitter } from '../../../src/platform/events.js';
import { InMemoryToolArtifactStore } from '../../../src/workbench/toolArtifactStore.js';
import { bindToolExecutionToArtifactStore } from '../../../src/workbench/toolExecutionArtifactBinding.js';
import type { IToolExecutedEvent, ILanguageModelToolsService } from '../../../src/services/chatTypes.js';

class ToolsServiceStub {
  private readonly _exec = new Emitter<IToolExecutedEvent>();
  private readonly _change = new Emitter<void>();
  readonly onDidExecuteTool = this._exec.event;
  readonly onDidChangeTools = this._change.event;
  fire(event: IToolExecutedEvent): void { this._exec.fire(event); }
  dispose(): void { this._exec.dispose(); this._change.dispose(); }
  // Stubbed (unused) members so the structural type matches.
  registerTool(): { dispose(): void } { return { dispose() {} }; }
  getTools(): readonly never[] { return []; }
  getTool(): undefined { return undefined; }
  getToolDefinitions(): readonly never[] { return []; }
  getReadOnlyToolDefinitions(): readonly never[] { return []; }
  invokeTool(): never { throw new Error('not implemented'); }
  isToolEnabled(): boolean { return true; }
  setToolEnabled(): void { /* noop */ }
  getEnabledCount(): number { return 0; }
}

function makeService(): ToolsServiceStub & ILanguageModelToolsService {
  return new ToolsServiceStub() as unknown as ToolsServiceStub & ILanguageModelToolsService;
}

describe('bindToolExecutionToArtifactStore (Slice B8)', () => {
  it('publishes one artifact per successful event', () => {
    const svc = makeService();
    const store = new InMemoryToolArtifactStore();
    const binding = bindToolExecutionToArtifactStore(svc, store, {
      generateArtifactId: (_e, seq) => `id-${seq}`,
    });
    svc.fire({ toolName: 'echo', args: { x: 1 }, result: { content: 'hello' } });
    expect(binding.publishedCount).toBe(1);
    expect(store.size).toBe(1);
    const rec = store.get('echo', 'id-1');
    expect(rec?.data).toBe('hello');
    expect(rec?.mimeType).toBe('text/plain');
    binding.dispose();
  });

  it('does not publish for error results', () => {
    const svc = makeService();
    const store = new InMemoryToolArtifactStore();
    const binding = bindToolExecutionToArtifactStore(svc, store);
    svc.fire({ toolName: 'echo', args: {}, result: { content: 'oops', isError: true } });
    expect(binding.publishedCount).toBe(0);
    expect(store.size).toBe(0);
    binding.dispose();
  });

  it('attaches workspaceId from options', () => {
    const svc = makeService();
    const store = new InMemoryToolArtifactStore();
    const binding = bindToolExecutionToArtifactStore(svc, store, {
      generateArtifactId: () => 'fixed',
      workspaceId: () => 'ws-7',
    });
    svc.fire({ toolName: 'search', args: {}, result: { content: 'r' } });
    const rec = store.get('search', 'fixed');
    expect(rec?.workspaceId).toBe('ws-7');
    binding.dispose();
  });

  it('uses a monotonic sequence in the default id generator', () => {
    const svc = makeService();
    const store = new InMemoryToolArtifactStore();
    const binding = bindToolExecutionToArtifactStore(svc, store);
    svc.fire({ toolName: 't', args: {}, result: { content: 'a' } });
    svc.fire({ toolName: 't', args: {}, result: { content: 'b' } });
    expect(binding.publishedCount).toBe(2);
    expect(store.size).toBe(2);
    binding.dispose();
  });

  it('dispose() detaches the subscriber', () => {
    const svc = makeService();
    const store = new InMemoryToolArtifactStore();
    const binding = bindToolExecutionToArtifactStore(svc, store);
    svc.fire({ toolName: 't', args: {}, result: { content: 'a' } });
    expect(binding.publishedCount).toBe(1);
    binding.dispose();
    svc.fire({ toolName: 't', args: {}, result: { content: 'b' } });
    expect(binding.publishedCount).toBe(1);
  });

  it('subscriber errors do not surface to the emitter', () => {
    const svc = makeService();
    const store = new InMemoryToolArtifactStore();
    const binding = bindToolExecutionToArtifactStore(svc, store, {
      generateArtifactId: () => { throw new Error('id-gen-failed'); },
    });
    expect(() => {
      svc.fire({ toolName: 't', args: {}, result: { content: 'a' } });
    }).not.toThrow();
    expect(binding.publishedCount).toBe(0);
    binding.dispose();
  });
});
