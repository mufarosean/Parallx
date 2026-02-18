import { describe, expect, it } from 'vitest';
import { createDefaultLayoutState } from '../../src/layout/layoutModel';
import { createDefaultEditorSnapshot, createDefaultContextSnapshot, type WorkspaceState } from '../../src/workspace/workspaceTypes';
import {
  createWorkspaceManifestFromState,
  manifestToWorkspaceState,
  parseWorkspaceManifest,
  validateWorkspaceManifest,
} from '../../src/workspace/workspaceManifest';

function createState(): WorkspaceState {
  return {
    version: 2,
    identity: {
      id: 'ws-1',
      name: 'Research Workspace',
      path: 'C:/workspace',
      iconOrColor: 'blue',
    },
    metadata: {
      createdAt: '2026-01-01T00:00:00.000Z',
      lastAccessedAt: '2026-01-02T00:00:00.000Z',
    },
    layout: createDefaultLayoutState(1600, 900),
    parts: [],
    viewContainers: [],
    views: [],
    editors: createDefaultEditorSnapshot(),
    context: createDefaultContextSnapshot(),
    folders: [
      {
        scheme: 'file',
        path: '/c:/workspace/root',
        name: 'root',
      },
    ],
  };
}

describe('workspaceManifest', () => {
  it('creates a full manifest envelope from workspace state', () => {
    const state = createState();
    const manifest = createWorkspaceManifestFromState(state, {
      exportedBy: 'Parallx Tests',
      notes: 'full-scope export',
    });

    expect(manifest.manifestVersion).toBe(1);
    expect(manifest.identity.id).toBe('ws-1');
    expect(manifest.identity.name).toBe('Research Workspace');
    expect(manifest.boundary.mode).toBe('strict');
    expect(manifest.storage.canvas.database.relativePath).toBe('.parallx/data.db');
    expect(manifest.state.workbench.identity.id).toBe('ws-1');
    expect(manifest.folders[0].uri.startsWith('file://')).toBe(true);
  });

  it('validates and parses serialized manifest JSON', () => {
    const state = createState();
    const manifest = createWorkspaceManifestFromState(state);

    const parsed = parseWorkspaceManifest(JSON.stringify(manifest));
    expect(parsed.identity.name).toBe('Research Workspace');

    const validation = validateWorkspaceManifest(parsed);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toEqual([]);
  });

  it('restores workspace state from manifest', () => {
    const state = createState();
    const manifest = createWorkspaceManifestFromState(state);

    const restored = manifestToWorkspaceState(manifest);
    expect(restored.identity.id).toBe('ws-1');
    expect(restored.identity.name).toBe('Research Workspace');
    expect(restored.folders?.length).toBe(1);
    expect(restored.folders?.[0].name).toBe('root');
  });

  it('rejects malformed manifests', () => {
    const validation = validateWorkspaceManifest({
      manifestVersion: 1,
      identity: { id: 'x' },
      folders: [],
    });

    expect(validation.valid).toBe(false);
    expect(validation.errors.length).toBeGreaterThan(0);
  });
});
