// contextServiceActiveResourceType.tier0.test.ts — Slice A64

import { describe, it, expect } from 'vitest';
import { Emitter } from '../../../src/platform/events.js';
import { ContextService } from '../../../src/workbench/resources/contextService.js';
import type {
  ContextWorkspaceSource,
  ContextSurfaceSource,
  ContextSelectionSource,
} from '../../../src/workbench/resources/contextService.js';
import { fileResource, canvasPageResource, externalResource } from '../../../src/workbench/resources/resource.js';
import type { Surface } from '../../../src/workbench/resources/surface.js';

function makeSources() {
  const wsEmitter = new Emitter<void>();
  const surfEmitter = new Emitter<void>();
  const selEmitter = new Emitter<void>();
  let activeWorkspace: { id: string } | undefined;
  let activeSurface: Surface | undefined;
  let activeSelection: { resource?: unknown } | undefined;

  const workspace: ContextWorkspaceSource = {
    get activeWorkspace() {
      return activeWorkspace;
    },
    onDidChangeWorkspace: wsEmitter.event,
  };
  const surfaces: ContextSurfaceSource = {
    getActive: () => activeSurface,
    onDidChangeSurface: surfEmitter.event,
  };
  const selection: ContextSelectionSource = {
    getSelection: () => activeSelection,
    onDidChangeSelection: selEmitter.event,
  };

  return {
    workspace,
    surfaces,
    selection,
    setWorkspace(w: { id: string } | undefined) {
      activeWorkspace = w;
      wsEmitter.fire();
    },
    setSurface(s: Surface | undefined) {
      activeSurface = s;
      surfEmitter.fire();
    },
    setSelection(sel: { resource?: unknown } | undefined) {
      activeSelection = sel;
      selEmitter.fire();
    },
  };
}

describe('WorkbenchContext.activeResourceType (Slice A64)', () => {
  it('is undefined when there is no active selection', () => {
    const sources = makeSources();
    const cs = new ContextService(sources.workspace, sources.surfaces, sources.selection);
    expect(cs.getContext().activeResourceType).toBeUndefined();
    cs.dispose();
  });

  it('is undefined when active selection has no resource', () => {
    const sources = makeSources();
    sources.setSelection({});
    const cs = new ContextService(sources.workspace, sources.surfaces, sources.selection);
    expect(cs.getContext().activeResourceType).toBeUndefined();
    cs.dispose();
  });

  it('reflects active resource type for file', () => {
    const sources = makeSources();
    sources.setSelection({ resource: fileResource('/a', { workspaceId: 'w1' }) });
    const cs = new ContextService(sources.workspace, sources.surfaces, sources.selection);
    expect(cs.getContext().activeResourceType).toBe('file');
    cs.dispose();
  });

  it('reflects active resource type for canvas-page', () => {
    const sources = makeSources();
    sources.setSelection({ resource: canvasPageResource('p', { workspaceId: 'w1' }) });
    const cs = new ContextService(sources.workspace, sources.surfaces, sources.selection);
    expect(cs.getContext().activeResourceType).toBe('canvas-page');
    cs.dispose();
  });

  it('reflects active resource type for external', () => {
    const sources = makeSources();
    sources.setSelection({ resource: externalResource('https://example.com') });
    const cs = new ContextService(sources.workspace, sources.surfaces, sources.selection);
    expect(cs.getContext().activeResourceType).toBe('external');
    cs.dispose();
  });

  it('fires onDidChangeContext when activeResourceType changes', () => {
    const sources = makeSources();
    sources.setSelection({ resource: fileResource('/a', { workspaceId: 'w1' }) });
    const cs = new ContextService(sources.workspace, sources.surfaces, sources.selection);
    let fired = 0;
    cs.onDidChangeContext(() => fired++);
    sources.setSelection({ resource: canvasPageResource('p', { workspaceId: 'w1' }) });
    expect(fired).toBe(1);
    expect(cs.getContext().activeResourceType).toBe('canvas-page');
    cs.dispose();
  });

  it('included in dedup equality (no fire when type unchanged)', () => {
    const sources = makeSources();
    sources.setSelection({ resource: fileResource('/a', { workspaceId: 'w1' }) });
    const cs = new ContextService(sources.workspace, sources.surfaces, sources.selection);
    let fired = 0;
    cs.onDidChangeContext(() => fired++);
    // Identical selection (same reference) — no fire.
    const cur = sources.selection.getSelection();
    sources.setSelection(cur as { resource?: unknown });
    expect(fired).toBe(0);
    cs.dispose();
  });
});
