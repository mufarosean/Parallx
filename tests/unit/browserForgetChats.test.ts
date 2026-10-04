// browserForgetChats.test.ts — deleting a chat erases the captures and
// downloads its Browser runs kept, also while the Browser is turned off
// (nothing of the Browser runs then; the main process erases the files).

import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { forgetChatsOnDisk } = require('../../electron/browserAutomationBroker.cjs');

function fixture() {
  const userData = mkdtempSync(join(tmpdir(), 'px-forget-'));
  const ws = join(userData, 'browser', 'artifacts', 'ws1');
  for (const run of ['runA', 'runB']) { mkdirSync(join(ws, run), { recursive: true }); writeFileSync(join(ws, run, 'capture.png'), 'pixels'); }
  writeFileSync(join(ws, 'runs.json'), JSON.stringify({ version: 1, runs: { runA: { chatSessionId: 'chat-1' }, runB: { chatSessionId: 'chat-2' } } }));
  return { userData, ws };
}

describe('forgetChatsOnDisk', () => {
  it("erases the deleted chat's runs and only those", async () => {
    const { userData, ws } = fixture();
    expect(await forgetChatsOnDisk(userData, ['chat-1'])).toEqual({ ok: true, removed: 1 });
    expect(existsSync(join(ws, 'runA'))).toBe(false);
    expect(readdirSync(ws).some((n) => n.startsWith('runA'))).toBe(false); // the retired copy is gone too
    expect(existsSync(join(ws, 'runB', 'capture.png'))).toBe(true);
    expect(JSON.parse(readFileSync(join(ws, 'runs.json'), 'utf8')).runs).toEqual({ runB: { chatSessionId: 'chat-2' } });
  });
  it('hands the folder to Eraser when it takes it', async () => {
    const { userData } = fixture();
    const handed: string[] = [];
    await forgetChatsOnDisk(userData, ['chat-2'], async (p: string) => { handed.push(p); return true; });
    expect(handed).toHaveLength(1);
    expect(handed[0]).toMatch(/runB\.erase-/);
  });
  it('a user who never used the Browser: nothing to do, nothing created', async () => {
    const userData = mkdtempSync(join(tmpdir(), 'px-forget-'));
    expect(await forgetChatsOnDisk(userData, ['chat-1'])).toEqual({ ok: true, removed: 0 });
    expect(existsSync(join(userData, 'browser'))).toBe(false);
  });
});
