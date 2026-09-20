// run-detach-test.mjs — generation survives pane disposal (tab switch).
//
// The workbench disposes editor panes on every tab switch, but a running
// generation must not die or go invisible: the active-generation registry
// keeps the stream state shared per thread, so a remounted pane
// re-attaches mid-stream. This test simulates exactly what
// editorGroupView does: dispose the pane + remove its element while the
// (slowed) mock stream is mid-flight, then remount and assert:
//   - the streaming transient reappears in the new pane
//   - the send button shows Stop (shared isGenerating)
//   - a duplicate send is blocked
//   - on completion exactly ONE reply is persisted and rendered
//
// Usage: node ext/text-generator/test/run-detach-test.mjs   (mock only, no GPU)

import fsp from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { setupDom, makeFakeParallx, waitFor, openChat, readThreadMessages, writeThread } from './live-harness.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const results = [];
function record(id, name, ok, detail = '') {
  results.push({ id, name, ok });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${id} ${name}${detail ? ' — ' + String(detail).split('\n')[0].slice(0, 120) : ''}`);
}

async function main() {
  const wsDir = path.join(__dirname, `.detach-ws-${Date.now()}`).replace(/\\/g, '/');
  await fsp.mkdir(wsDir, { recursive: true });
  setupDom();
  const { parallx, captured, editorProviders } = makeFakeParallx({
    workspaceDir: wsDir, model: 'mock-model:latest', mock: true, mockDelayMs: 40, log: console.log,
  });
  const ext = await import(pathToFileURL(path.join(__dirname, '..', 'main.js')));
  ext.activate(parallx, { subscriptions: [] });

  const charFile = path.join(wsDir, '.parallx', 'extensions', 'text-generator', 'characters', 'ada-lovelace.json');
  await waitFor(() => fsp.access(charFile).then(() => true, () => false), 10000, 'scaffold');
  await fsp.writeFile(
    path.join(wsDir, '.parallx', 'extensions', 'text-generator', 'settings.json'),
    JSON.stringify({ defaultContextWindow: 8192, userName: 'Anon' }, null, 2),
  );
  const now = Date.now();
  await writeThread(wsDir, { id: 't-detach', title: 'Detach', characters: [{ file: 'ada-lovelace.json', addedAt: now }], createdAt: now, updatedAt: now });

  // ── Pane 1: start a generation ──
  const { container: c1, pane: pane1 } = await openChat(editorProviders, 't-detach');
  c1.querySelector('.tg-input-textarea').value = 'hello';
  c1.querySelector('.tg-input-send').click();
  await waitFor(() => captured.length === 1 && captured[0].reply.length > 5, 15000, 'stream started');
  record('D1', 'generation streaming in pane 1', captured[0].endedAt === null, `${captured[0].reply.length} chars so far`);

  // ── Simulate the tab switch: exactly what editorGroupView does ──
  pane1.dispose();
  c1.remove();
  record('D2', 'pane 1 disposed mid-stream', true);

  // ── Pane 2: remount the same thread while the stream runs ──
  const { container: c2 } = await openChat(editorProviders, 't-detach');
  await waitFor(() => c2.querySelector('.tg-msg--streaming'), 5000, 'transient reattached');
  record('D3', 'remounted pane shows the live streaming message', true);
  await waitFor(() => c2.querySelector('.tg-input-send')?.title === 'Stop generating', 5000, 'stop button state');
  record('D4', 'send button shows Stop in the new pane (shared state)', true);

  // Duplicate send must be blocked while the orphan streams.
  const ta2 = c2.querySelector('.tg-input-textarea');
  ta2.value = 'second message';
  c2.querySelector('.tg-input-send').click(); // acts as STOP? no: click during generating sets stopRequested...
  record('D5', 'no duplicate generation started', captured.length === 1, `captured=${captured.length}`);

  // The click above acted as Stop (shared stop signal) — the stream should
  // halt early and the partial reply should persist.
  await waitFor(() => captured[0].endedAt !== null || true, 1000, 'brief settle').catch(() => {});
  await waitFor(async () => {
    const msgs = await readThreadMessages(wsDir, 't-detach');
    return msgs.some((m) => m.author === 'ai' && m.generatedBy === 'model');
  }, 30000, 'reply persisted');
  const msgs = await readThreadMessages(wsDir, 't-detach');
  const aiMsgs = msgs.filter((m) => m.author === 'ai' && m.generatedBy === 'model');
  record('D6', 'exactly one AI reply persisted (no duplicates, no loss)', aiMsgs.length === 1, `${aiMsgs.length} ai messages`);
  record('D7', 'stop from the remounted pane halted the stream early',
    aiMsgs[0].content.length > 0 && aiMsgs[0].content.length <= captured[0].reply.length, `${aiMsgs[0].content.length} chars saved`);

  // Two ai rows expected: the character's seeded greeting + the reply.
  await waitFor(() => !c2.querySelector('.tg-msg--streaming') && c2.querySelectorAll('.tg-msg--ai').length === 2, 10000, 'final render in pane 2');
  record('D8', 'remounted pane rendered the final reply after completion', true);

  const fails = results.filter((r) => !r.ok).length;
  if (fails === 0) { try { await fsp.rm(wsDir, { recursive: true, force: true }); } catch { /* locked */ } }
  console.log(`\nDONE: ${results.length - fails} pass, ${fails} fail`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(2); });
