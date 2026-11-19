// workspaceFiles.test.ts — every file of the workspace for a picker
// (src/services/workspaceFiles.ts): folders walked level by level, each file
// with its path from its workspace folder, machinery and hidden folders left
// out, a folder that cannot be read passed over, and a cap.

import { describe, it, expect } from 'vitest';
import { listWorkspaceFiles, isSkippedFolder } from '../../src/services/workspaceFiles.js';

const TREE: Record<string, { name: string; type: number }[]> = {
  'file:///ws': [{ name: 'Readings', type: 2 }, { name: 'Clark.md', type: 1 }, { name: '.parallx', type: 2 }, { name: 'node_modules', type: 2 }, { name: 'locked', type: 2 }],
  'file:///ws/Readings': [{ name: 'Week 1', type: 2 }, { name: 'Siewert.png', type: 1 }],
  'file:///ws/Readings/Week 1': [{ name: 'Mack 1993.pdf', type: 1 }],
  'file:///ws/.parallx': [{ name: 'data.db', type: 1 }],
  'file:///ws/node_modules': [{ name: 'x.js', type: 1 }],
};
const readdir = async (uri: string) => {
  if (uri.endsWith('/locked')) throw new Error('EACCES');
  return (TREE[uri] ?? []).map((e) => ({ ...e, uri: `${uri}/${e.name}` }));
};

describe('the workspace files', () => {
  it('lists every file with its path from its folder, level by level, machinery and hidden folders aside', async () => {
    const files = await listWorkspaceFiles([{ uri: 'file:///ws', name: 'ws' }], readdir);
    expect(files.map((f) => f.relativePath)).toEqual(['Clark.md', 'Readings/Siewert.png', 'Readings/Week 1/Mack 1993.pdf']);
    expect(files[2]).toEqual({ uri: 'file:///ws/Readings/Week 1/Mack 1993.pdf', name: 'Mack 1993.pdf', relativePath: 'Readings/Week 1/Mack 1993.pdf', folder: 'ws' });
  });

  it('stops at the cap', async () => {
    expect((await listWorkspaceFiles([{ uri: 'file:///ws', name: 'ws' }], readdir, 2)).map((f) => f.name)).toEqual(['Clark.md', 'Siewert.png']);
  });

  it('skips hidden and machinery folders only', () => {
    expect(['.git', '.parallx', 'node_modules', 'venv', '__pycache__'].every(isSkippedFolder)).toBe(true);
    expect(['Readings', 'notes', 'Build Notes'].some(isSkippedFolder)).toBe(false);
  });
});
