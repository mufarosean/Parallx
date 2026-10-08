// chat-driver.mjs — the real Creations chat, headless, for the quality
// harnesses: a scratch workspace, the extension activated against a fake
// Parallx whose model calls all go through the cached gateway
// (harness-common.mjs), character cards written from Studio sheets, threads,
// and sending a turn. Every call is labelled `<label> <kind>[ n]`, the label
// set by the harness per turn, so a replay finds the same outputs.

import fsp from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { setupDom, makeFakeParallx, waitFor, openChat, readThreadMessages, writeThread } from './live-harness.mjs';
import { characterFromSheet, emptySheet } from '../studio-core.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT_DIR = 'text-generator';

/** Which of the chat's calls a request is, from its system prompt. */
export function kindOf(messages) {
  const sys = String(messages[0]?.role === 'system' ? messages[0].content : '');
  if (sys.startsWith('You extract durable memory')) return 'memory';
  if (sys.startsWith('You are a turn-order selector')) return 'order';
  if (sys.startsWith('You are the director')) return 'director';
  return 'turn';
}

export const slug = (name) => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export async function startChatDriver(gw, opts, { tag = 'chat', userName = 'Sam' } = {}) {
  const wsDir = path.join(__dirname, `.${tag}-ws-${Date.now()}`).replace(/\\/g, '/');
  await fsp.mkdir(wsDir, { recursive: true });
  setupDom();

  let label = 'setup';
  const perTurn = new Map();
  const replyFn = async (messages, options) => {
    const kind = kindOf(messages);
    const n = (perTurn.get(kind) || 0) + 1;
    perTurn.set(kind, n);
    return gw.call(`${label} ${kind}${n > 1 ? ` ${n}` : ''}`, messages, {
      temperature: options?.temperature ?? 0.8, maxTokens: options?.maxTokens || 0, stop: options?.stop, think: !!options?.think,
    });
  };
  const { parallx, captured, editorProviders } = makeFakeParallx({ workspaceDir: wsDir, model: opts.model, mock: true, replyFn, modelContextLength: opts.numCtx });
  const ext = await import(pathToFileURL(path.join(__dirname, '..', 'main.js')));
  ext.activate(parallx, { subscriptions: [] });

  const extRoot = path.join(wsDir, '.parallx', 'extensions', EXT_DIR);
  const charDir = path.join(extRoot, 'characters');
  const adaFile = path.join(charDir, 'ada-lovelace.json');
  await waitFor(() => fsp.access(adaFile).then(() => true, () => false), 10000, 'scaffolded character');
  const adaBase = JSON.parse(await fsp.readFile(adaFile, 'utf8'));
  // The sample card's shape without what belongs to Ada: her greeting and her studio data.
  const cardBase = Object.fromEntries(Object.entries(adaBase).filter(([k]) => k !== 'studio' && !/initial|greeting|first/i.test(k)));

  const d = {
    wsDir, extRoot, captured, editorProviders,
    get label() { return label; },
    /** The label of the calls that follow; per-kind counters start again. */
    setLabel(l) { label = l; perTurn.clear(); },
    /** The chat's settings (read on every chat open): context size and the player's name always set. */
    async writeSettings(extra = {}) {
      await fsp.writeFile(path.join(extRoot, 'settings.json'), JSON.stringify({ defaultContextWindow: opts.numCtx, userName, ...extra }, null, 2));
    },
    /** A character file from a Studio sheet; the card's own user name makes the player `userName` everywhere. */
    async writeCard(sheet, studio = {}, fileName = '', extra = {}) {
      const full = { ...emptySheet(), ...sheet };
      const file = fileName || `${slug(sheet.name)}.json`;
      // `extra`: card fields outside the sheet (temperature), applied last.
      await fsp.writeFile(path.join(charDir, file), JSON.stringify({ ...characterFromSheet(full, { ...cardBase, name: sheet.name, userName }, studio), ...extra }, null, 2));
      return file;
    },
    async startThread(meta, messages = []) {
      const now = Date.now();
      await writeThread(wsDir, { userName, createdAt: now, updatedAt: now, ...meta, characters: meta.files.map((file) => ({ file, addedAt: now })) }, messages);
      const { container } = await openChat(editorProviders, meta.id);
      return container;
    },
    readMessages: (threadId) => readThreadMessages(wsDir, threadId),
    async readMemory(threadId) {
      const dir = path.join(extRoot, 'threads', threadId);
      const lines = async (f) => { try { return (await fsp.readFile(path.join(dir, f), 'utf8')).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
      return { facts: await lines('memory.semantic.jsonl'), beats: await lines('memory.episodic.jsonl') };
    },
    /** Send one composer text and wait for the chat to go idle with a new reply. */
    async sendTurn(container, threadId, text) {
      const count = async () => (await readThreadMessages(wsDir, threadId)).filter((m) => m.author === 'ai').length;
      const before = await count();
      container.querySelector('.tg-input-textarea').value = text;
      container.querySelector('.tg-input-send').click();
      await waitFor(async () => {
        const btn = container.querySelector('.tg-input-send');
        if (!(btn && btn.title === 'Send (Enter)' && !container.querySelector('.tg-msg--streaming'))) return false;
        return (await count()) > before;
      }, 900000, `reply to ${JSON.stringify(String(text).slice(0, 40))}`);
    },
    async cleanup() { try { await fsp.rm(wsDir, { recursive: true, force: true }); } catch { /* locked */ } },
  };
  await d.writeSettings();
  return d;
}
