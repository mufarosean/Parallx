import { describe, expect, it } from 'vitest';
import { InMemoryStorage } from '../../src/platform/storage';
import { createToolMementos } from '../../src/configuration/toolMemento';

describe('ToolMemento workspace partitioning', () => {
  it('isolates workspaceState by active workspace id', async () => {
    const storage = new InMemoryStorage();

    let activeWorkspaceId = 'ws-a';
    const mementos = createToolMementos(
      storage,
      storage,
      'tool.canvas',
      () => activeWorkspaceId,
    );

    await mementos.workspaceState.load();
    await mementos.workspaceState.update('lastPage', 'page-1');

    activeWorkspaceId = 'ws-b';
    await mementos.workspaceState.load();

    expect(mementos.workspaceState.get('lastPage')).toBeUndefined();

    await mementos.workspaceState.update('lastPage', 'page-2');
    expect(mementos.workspaceState.get('lastPage')).toBe('page-2');

    activeWorkspaceId = 'ws-a';
    await mementos.workspaceState.load();
    expect(mementos.workspaceState.get('lastPage')).toBe('page-1');
  });
});
