// autonomyFiles.test.ts — routines, scheduled jobs and the event log read
// their files back. Against a bridge that answers exactly as the window's
// does (electron/main.cjs: exists is a boolean, readFile is { content },
// writes are { error: null }), which the stores had misread since they were
// written: every start began empty and saved over what had been saved.

import { describe, it, expect, vi } from 'vitest';
import { adaptFsBridge, jsonFileStore } from '../../src/services/autonomyFiles';
import { WorkflowService } from '../../src/services/workflows/workflowService';

/** The window's bridge, its shapes as electron/main.cjs returns them. */
function realShapedBridge(files = new Map<string, string>(), opts: { unreadable?: string } = {}) {
  return {
    files,
    exists: async (p: string) => files.has(p),
    readFile: async (p: string, enc?: string) => {
      if (p === opts.unreadable) return { error: { code: 'EACCES', message: 'denied' } };
      return files.has(p) ? { content: files.get(p)!, encoding: enc ?? 'utf-8' } : { error: { code: 'ENOENT', message: 'missing' } };
    },
    writeFile: async (p: string, c: string) => { files.set(p, c); return { error: null }; },
    rename: async (a: string, b: string) => { files.set(b, files.get(a)!); files.delete(a); return { error: null }; },
    mkdir: async () => ({ error: null }),
  };
}

describe('autonomy files', () => {
  it('a saved file is read back (the bridge\'s own shapes, adapted)', async () => {
    const raw = realShapedBridge();
    const store = jsonFileStore(adaptFsBridge(raw) as never, '/ws/.parallx', 'workflows.json');
    expect(await store.load()).toBeNull(); // nothing saved yet
    await store.save({ version: 1, docs: [{ id: 'wf-1' }] });
    expect(await store.load()).toEqual({ version: 1, docs: [{ id: 'wf-1' }] });
    expect([...raw.files.keys()]).toEqual(['/ws/.parallx/workflows.json']); // written beside, renamed over
  });

  it('a file that is not JSON is kept aside and read as none', async () => {
    const raw = realShapedBridge(new Map([['/ws/.parallx/cron.json', '{"jobs": [tru']]));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = jsonFileStore(adaptFsBridge(raw) as never, '/ws/.parallx', 'cron.json');
    expect(await store.load()).toBeNull();
    const aside = [...raw.files.keys()].find((k) => k.includes('cron.corrupt-'));
    expect(aside && raw.files.get(aside)).toBe('{"jobs": [tru');
    error.mockRestore();
  });

  it('a file that is there but cannot be read throws', async () => {
    const raw = realShapedBridge(new Map([['/ws/.parallx/workflows.json', '{}']]), { unreadable: '/ws/.parallx/workflows.json' });
    const store = jsonFileStore(adaptFsBridge(raw) as never, '/ws/.parallx', 'workflows.json');
    await expect(store.load()).rejects.toThrow(/cannot read/);
  });

  it('routines survive a restart, and an unreadable file is never saved over', async () => {
    const raw = realShapedBridge();
    const fs = adaptFsBridge(raw) as never;
    const first = new WorkflowService();
    first.setPersistence(jsonFileStore(fs, '/ws/.parallx', 'workflows.json') as never);
    await first.loadFromPersistence();
    (first as unknown as { _docs: Map<string, unknown> })._docs.set('wf-1', { id: 'wf-1', name: 'Daily quote' });
    await (first as unknown as { _save(): Promise<void> })._save();

    const second = new WorkflowService();
    second.setPersistence(jsonFileStore(fs, '/ws/.parallx', 'workflows.json') as never);
    await second.loadFromPersistence();
    expect((second as unknown as { _docs: Map<string, unknown> })._docs.has('wf-1')).toBe(true);

    const saved = raw.files.get('/ws/.parallx/workflows.json');
    const locked = realShapedBridge(new Map([['/ws/.parallx/workflows.json', saved!]]), { unreadable: '/ws/.parallx/workflows.json' });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const third = new WorkflowService();
    third.setPersistence(jsonFileStore(adaptFsBridge(locked) as never, '/ws/.parallx', 'workflows.json') as never);
    await third.loadFromPersistence();
    await (third as unknown as { _save(): Promise<void> })._save();
    expect(locked.files.get('/ws/.parallx/workflows.json')).toBe(saved);
    error.mockRestore();
  });

  it('saves run one after another; a burst writes the latest state', async () => {
    const writes: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const svc = new WorkflowService();
    svc.setPersistence({
      load: async () => null,
      save: async (snap) => { writes.push(JSON.stringify(snap.docs.map((d) => d.id))); if (writes.length === 1) await gate; },
    });
    const docs = (svc as unknown as { _docs: Map<string, { id: string }> })._docs;
    const save = () => (svc as unknown as { _save(): Promise<void> })._save();
    docs.set('wf-1', { id: 'wf-1' });
    const a = save();
    await Promise.resolve();
    docs.set('wf-2', { id: 'wf-2' });
    save(); save();
    docs.set('wf-3', { id: 'wf-3' });
    const last = save();
    release();
    await Promise.all([a, last]);
    expect(writes).toEqual(['["wf-1"]', '["wf-1","wf-2","wf-3"]']);
  });
});
