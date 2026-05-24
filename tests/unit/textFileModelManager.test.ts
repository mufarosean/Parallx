// textFileModelManager.test.ts — pin TextFileModel + TextFileModelManager.

import { describe, it, expect, vi } from 'vitest';
import { TextFileModelManager } from '../../src/services/textFileModelManager';
import { URI } from '../../src/platform/uri';
import { Emitter } from '../../src/platform/events';

function mkFileService(initial: Record<string, string> = {}) {
  const files = new Map<string, { content: string; mtime: number }>();
  for (const [k, v] of Object.entries(initial)) files.set(k, { content: v, mtime: 1 });
  const changeEmitter = new Emitter<any[]>();
  return {
    files,
    fireChanges: (events: any[]) => changeEmitter.fire(events),
    onDidFileChange: changeEmitter.event,
    readFile: vi.fn(async (uri: any) => {
      const k = uri.toString();
      const f = files.get(k);
      if (!f) throw new Error(`ENOENT: ${k}`);
      return { content: f.content, encoding: 'utf8', size: f.content.length, mtime: f.mtime };
    }),
    writeFile: vi.fn(async (uri: any, content: string) => {
      const k = uri.toString();
      const cur = files.get(k);
      const mtime = (cur?.mtime ?? 0) + 1;
      files.set(k, { content, mtime });
    }),
    stat: vi.fn(async (uri: any) => {
      const k = uri.toString();
      const f = files.get(k);
      if (!f) throw new Error('no file');
      return { mtime: f.mtime, size: f.content.length, type: 1, ctime: 0, isReadonly: false, uri };
    }),
  } as any;
}

describe('TextFileModelManager — resolve + sharing + ref count', () => {
  it('resolve creates a model, loads content, fires onDidCreate', async () => {
    const fs = mkFileService({ 'file:///a.txt': 'hello' });
    const mgr = new TextFileModelManager(fs);
    const created: any[] = [];
    mgr.onDidCreate(m => created.push(m));
    const m = await mgr.resolve(URI.parse('file:///a.txt'));
    expect(m.content).toBe('hello');
    expect(m.isDirty).toBe(false);
    expect(m.refCount).toBe(1);
    expect(created.length).toBe(1);
  });

  it('second resolve returns same instance and bumps ref count', async () => {
    const fs = mkFileService({ 'file:///a.txt': 'hi' });
    const mgr = new TextFileModelManager(fs);
    const m1 = await mgr.resolve(URI.parse('file:///a.txt'));
    const m2 = await mgr.resolve(URI.parse('file:///a.txt'));
    expect(m2).toBe(m1);
    expect(m1.refCount).toBe(2);
    expect(fs.readFile).toHaveBeenCalledTimes(1);
  });

  it('release decrements; final release disposes and removes from map', async () => {
    const fs = mkFileService({ 'file:///a.txt': 'hi' });
    const mgr = new TextFileModelManager(fs);
    const m1 = await mgr.resolve(URI.parse('file:///a.txt'));
    const m2 = await mgr.resolve(URI.parse('file:///a.txt'));
    m2.release();
    expect(m1.isDisposed).toBe(false);
    expect(mgr.get(URI.parse('file:///a.txt'))).toBe(m1);
    m1.release();
    expect(m1.isDisposed).toBe(true);
    expect(mgr.get(URI.parse('file:///a.txt'))).toBeUndefined();
  });

  it('resolve failure removes model from map and rethrows', async () => {
    const fs = mkFileService();
    const mgr = new TextFileModelManager(fs);
    await expect(mgr.resolve(URI.parse('file:///missing.txt'))).rejects.toThrow(/ENOENT/);
    expect(mgr.get(URI.parse('file:///missing.txt'))).toBeUndefined();
  });
});

describe('TextFileModel — dirty state + updateContent', () => {
  it('updateContent flips dirty on first divergence, clears on revert-to-saved', async () => {
    const fs = mkFileService({ 'file:///a.txt': 'hello' });
    const mgr = new TextFileModelManager(fs);
    const m = await mgr.resolve(URI.parse('file:///a.txt'));
    const dirtyEvents: boolean[] = [];
    m.onDidChangeDirty(v => dirtyEvents.push(v));
    m.updateContent('hello'); // no-op (same)
    expect(m.isDirty).toBe(false);
    m.updateContent('hello!');
    expect(m.isDirty).toBe(true);
    m.updateContent('hello'); // back to saved
    expect(m.isDirty).toBe(false);
    expect(dirtyEvents).toEqual([true, false]);
  });

  it('updateContent fires onDidChangeContent on real change', async () => {
    const fs = mkFileService({ 'file:///a.txt': 'x' });
    const mgr = new TextFileModelManager(fs);
    const m = await mgr.resolve(URI.parse('file:///a.txt'));
    let count = 0;
    m.onDidChangeContent(() => count++);
    m.updateContent('x'); // no change
    expect(count).toBe(0);
    m.updateContent('y');
    expect(count).toBe(1);
  });
});

describe('TextFileModel — save + revert', () => {
  it('save writes content, updates mtime, clears dirty', async () => {
    const fs = mkFileService({ 'file:///a.txt': 'old' });
    const mgr = new TextFileModelManager(fs);
    const m = await mgr.resolve(URI.parse('file:///a.txt'));
    m.updateContent('new');
    expect(m.isDirty).toBe(true);
    const oldMtime = m.mtime;
    await m.save();
    expect(fs.writeFile).toHaveBeenCalledWith(expect.anything(), 'new');
    expect(m.isDirty).toBe(false);
    expect(m.mtime).toBeGreaterThan(oldMtime);
  });

  it('revert reloads from disk and clears dirty', async () => {
    const fs = mkFileService({ 'file:///a.txt': 'disk' });
    const mgr = new TextFileModelManager(fs);
    const m = await mgr.resolve(URI.parse('file:///a.txt'));
    m.updateContent('edits');
    await m.revert();
    expect(m.content).toBe('disk');
    expect(m.isDirty).toBe(false);
  });
});

describe('TextFileModel — external change + conflict', () => {
  it('external change while dirty marks conflict; clean reloads silently', async () => {
    const fs = mkFileService({ 'file:///a.txt': 'orig' });
    const mgr = new TextFileModelManager(fs);
    const m = await mgr.resolve(URI.parse('file:///a.txt'));

    // Dirty path
    m.updateContent('local');
    fs.files.set('file:///a.txt', { content: 'remote', mtime: 99 });
    fs.fireChanges([{ uri: URI.parse('file:///a.txt'), type: 2 /* Changed */ }]);
    expect(m.isConflicted).toBe(true);
    expect(m.content).toBe('local'); // not overwritten while dirty

    // Save clears conflict
    await m.save();
    expect(m.isConflicted).toBe(false);
  });

  it('external change when clean silently re-resolves', async () => {
    const fs = mkFileService({ 'file:///a.txt': 'one' });
    const mgr = new TextFileModelManager(fs);
    const m = await mgr.resolve(URI.parse('file:///a.txt'));
    fs.files.set('file:///a.txt', { content: 'two', mtime: 5 });
    fs.fireChanges([{ uri: URI.parse('file:///a.txt'), type: 2 }]);
    await new Promise(r => setTimeout(r, 0));
    expect(m.content).toBe('two');
    expect(m.isConflicted).toBe(false);
  });

  it('deleted event disposes clean model; conflicts a dirty one', async () => {
    const fs = mkFileService({ 'file:///a.txt': 'x', 'file:///b.txt': 'y' });
    const mgr = new TextFileModelManager(fs);
    const a = await mgr.resolve(URI.parse('file:///a.txt'));
    const b = await mgr.resolve(URI.parse('file:///b.txt'));
    b.updateContent('dirty');
    fs.fireChanges([
      { uri: URI.parse('file:///a.txt'), type: 3 /* Deleted */ },
      { uri: URI.parse('file:///b.txt'), type: 3 },
    ]);
    expect(a.isDisposed).toBe(true);
    expect(b.isDisposed).toBe(false);
    expect(b.isConflicted).toBe(true);
  });
});

describe('TextFileModelManager — saveAll + dispose', () => {
  it('saveAll persists every dirty model and skips clean ones', async () => {
    const fs = mkFileService({ 'file:///a.txt': 'A', 'file:///b.txt': 'B' });
    const mgr = new TextFileModelManager(fs);
    const a = await mgr.resolve(URI.parse('file:///a.txt'));
    const b = await mgr.resolve(URI.parse('file:///b.txt'));
    a.updateContent('A2');
    // b stays clean
    await mgr.saveAll();
    expect(fs.writeFile).toHaveBeenCalledTimes(1);
    expect(fs.writeFile).toHaveBeenCalledWith(expect.anything(), 'A2');
    expect(a.isDirty).toBe(false);
    expect(b.isDirty).toBe(false);
  });

  it('models getter returns non-disposed only', async () => {
    const fs = mkFileService({ 'file:///a.txt': 'a', 'file:///b.txt': 'b' });
    const mgr = new TextFileModelManager(fs);
    const a = await mgr.resolve(URI.parse('file:///a.txt'));
    await mgr.resolve(URI.parse('file:///b.txt'));
    expect(mgr.models.length).toBe(2);
    a.release();
    expect(mgr.models.length).toBe(1);
  });

  it('manager.dispose disposes all models', async () => {
    const fs = mkFileService({ 'file:///a.txt': 'a' });
    const mgr = new TextFileModelManager(fs);
    const a = await mgr.resolve(URI.parse('file:///a.txt'));
    mgr.dispose();
    expect(a.isDisposed).toBe(true);
  });
});
