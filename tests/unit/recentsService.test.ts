// recentsService.test.ts — pins the ONE recency owner (Retirement 3.7).

import { describe, it, expect } from 'vitest';
import { RecentsService } from '../../src/services/recentsService.js';
import { InMemoryStorage } from '../../src/platform/storage.js';

function openItem(n: number, kind: 'file' | 'page' = 'file') {
  return { key: `${kind}:t${n}`, kind, title: `Item ${n}`, target: `t${n}` };
}

describe('RecentsService', () => {
  it('starts empty and works without storage (no workspace open)', () => {
    const svc = new RecentsService(undefined);
    expect(svc.getRecentOpens()).toEqual([]);
    expect(svc.getRecentCommandIds()).toEqual([]);
    svc.recordOpen(openItem(1));
    svc.recordCommand('a');
    expect(svc.getRecentOpens()).toHaveLength(1);
    expect(svc.getRecentCommandIds()).toEqual(['a']);
  });

  it('MRU-dedups opens by key and stamps ts', () => {
    const svc = new RecentsService(new InMemoryStorage());
    svc.recordOpen(openItem(1));
    svc.recordOpen(openItem(2));
    svc.recordOpen(openItem(1));
    const opens = svc.getRecentOpens();
    expect(opens.map(o => o.key)).toEqual(['file:t1', 'file:t2']);
    expect(typeof opens[0].ts).toBe('number');
  });

  it('caps opens at 30', () => {
    const svc = new RecentsService(new InMemoryStorage());
    for (let i = 0; i < 40; i++) svc.recordOpen(openItem(i));
    expect(svc.getRecentOpens()).toHaveLength(30);
    expect(svc.getRecentOpens()[0].key).toBe('file:t39');
  });

  it('derives file URIs only, most recent first, capped at 20', () => {
    const svc = new RecentsService(new InMemoryStorage());
    svc.recordOpen(openItem(1, 'file'));
    svc.recordOpen(openItem(2, 'page'));
    svc.recordOpen(openItem(3, 'file'));
    expect(svc.getRecentFileUris()).toEqual(['t3', 't1']);
    for (let i = 10; i < 40; i++) svc.recordOpen(openItem(i, 'file'));
    expect(svc.getRecentFileUris()).toHaveLength(20);
  });

  it('caps the command MRU at 5 and dedups', () => {
    const svc = new RecentsService(new InMemoryStorage());
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'a']) svc.recordCommand(id);
    expect(svc.getRecentCommandIds()).toEqual(['a', 'f', 'e', 'd', 'c']);
  });

  it('persists across instances on the same storage (hydration via whenReady)', async () => {
    const storage = new InMemoryStorage();
    const first = new RecentsService(storage);
    await first.whenReady;
    first.recordOpen(openItem(7, 'page'));
    first.recordCommand('cmd.x');
    // Writes are fire-and-forget promises against the same storage; let them settle.
    await new Promise(r => setTimeout(r, 0));

    const second = new RecentsService(storage);
    await second.whenReady;
    expect(second.getRecentOpens().map(o => o.key)).toEqual(['page:t7']);
    expect(second.getRecentCommandIds()).toEqual(['cmd.x']);
  });

  it('discards malformed persisted entries instead of throwing', async () => {
    const storage = new InMemoryStorage();
    await storage.set('recents.opens', JSON.stringify([{ key: 'file:ok', kind: 'file', title: 'Ok', target: 'ok', ts: 1 }, { bad: true }, 42]));
    await storage.set('recents.commands', JSON.stringify(['good', 5, null]));
    const svc = new RecentsService(storage);
    await svc.whenReady;
    expect(svc.getRecentOpens().map(o => o.key)).toEqual(['file:ok']);
    expect(svc.getRecentCommandIds()).toEqual(['good']);
  });
});
