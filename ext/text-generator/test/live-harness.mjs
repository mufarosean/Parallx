// live-harness.mjs — headless behavioral harness for the Text Generator extension.
//
// Drives the REAL ext/text-generator/main.js inside jsdom with a faithful
// fake of the parallx extension bridge. Model calls go to the local Ollama
// HTTP API (same option mapping as src/built-in/chat/providers/ollamaProvider.ts),
// so the full pipeline — context assembly → streaming → speaker-strip →
// persistence — runs exactly as in the app, without launching Electron.
// No window is ever shown (dev machine = study machine).
//
// Used by run-live-tests.mjs. `mock: true` replaces the model with a canned
// instruction-following reply so the harness itself can be validated in
// seconds without touching the GPU.

import { JSDOM } from 'jsdom';
import fsp from 'node:fs/promises';
import path from 'node:path';

export function setupDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true, // provides requestAnimationFrame
  });
  const { window } = dom;
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Event = window.Event;
  globalThis.KeyboardEvent = window.KeyboardEvent;
  globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
  // Regenerate/delete flows call confirm(); auto-accept in tests.
  globalThis.confirm = () => true;
  window.confirm = () => true;
  return dom;
}

export function makeFakeParallx({ workspaceDir, ollamaUrl = 'http://localhost:11434', model, mock = false, mockReplyFn = null, mockDelayMs = 0, modelContextLength = 32768, log = () => {} }) {
  /** Every lm request the extension makes, with the streamed reply. */
  const captured = [];
  const openedEditors = [];
  const editorProviders = new Map();
  const commands = new Map();

  const wfs = {
    async readFile(uri) { return { content: await fsp.readFile(uri, 'utf8') }; },
    async writeFile(uri, content) {
      await fsp.mkdir(path.dirname(uri), { recursive: true });
      await fsp.writeFile(uri, content ?? '');
    },
    async readdir(uri) {
      const entries = await fsp.readdir(uri, { withFileTypes: true });
      // 2 = directory, 1 = file (matches the shape listThreads expects)
      return entries.map((e) => ({ name: e.name, type: e.isDirectory() ? 2 : 1 }));
    },
    async exists(uri) { try { await fsp.access(uri); return true; } catch { return false; } },
    async mkdir(uri) { await fsp.mkdir(uri, { recursive: true }); },
    async delete(uri) { await fsp.rm(uri, { recursive: true, force: true }); },
  };

  function mockReply(messages) {
    const all = messages.map((m) => m.content).join('\n');
    let reply = '"Indeed," I say, setting down my pen with a soft click.';
    if (all.includes('vermilion')) reply += ' The vermilion light of the setting sun catches my eye.';
    if (all.includes('nightingale')) reply += ' I hum an old tune about a nightingale';
    reply += '.';
    if (!all.includes('EXACTLY ONE paragraph')) {
      reply += '\n\nA second paragraph follows, with further musings on the Engine.';
    }
    return reply;
  }

  async function getModels() {
    if (mock) {
      return [{ id: model, displayName: model, family: 'mock', parameterSize: '', quantization: '', contextLength: modelContextLength, capabilities: [] }];
    }
    const res = await fetch(`${ollamaUrl}/api/tags`);
    if (!res.ok) throw new Error(`Ollama /api/tags ${res.status}`);
    const j = await res.json();
    // Advertise a LARGE contextLength on purpose: the pre-fix pipeline
    // budgeted against this while clamping num_ctx elsewhere — the
    // truncation regression test relies on this mismatch being handled.
    return j.models.map((m) => ({
      id: m.name, displayName: m.name, family: m.details?.family || '',
      parameterSize: m.details?.parameter_size || '', quantization: m.details?.quantization_level || '',
      contextLength: modelContextLength, capabilities: [],
    }));
  }

  async function* sendChatRequest(modelId, messages, options) {
    const rec = { modelId, messages, options, reply: '', thinkingChars: 0, startedAt: Date.now(), endedAt: null };
    captured.push(rec);
    if (mock) {
      const text = (mockReplyFn || mockReply)(messages, options);
      if (mockDelayMs > 0) {
        // Slow streaming mode: word-by-word chunks so tests can act
        // mid-stream (e.g. dispose a pane while generation is running).
        for (const word of text.split(/(?<=\s)/)) {
          rec.reply += word;
          yield { content: word, done: false };
          await new Promise((r) => setTimeout(r, mockDelayMs));
        }
        rec.endedAt = Date.now();
        yield { content: '', done: true };
        return;
      }
      rec.reply = text;
      rec.endedAt = Date.now();
      yield { content: text, done: false };
      yield { content: '', done: true };
      return;
    }
    // Option mapping mirrors ollamaProvider.ts
    const ollamaOptions = {};
    if (options?.numCtx && options.numCtx > 0) ollamaOptions.num_ctx = options.numCtx;
    if (options?.temperature !== undefined) ollamaOptions.temperature = Math.max(0, Math.min(2, options.temperature));
    if (options?.maxTokens !== undefined && options.maxTokens > 0) ollamaOptions.num_predict = options.maxTokens;
    if (Array.isArray(options?.stop) && options.stop.length > 0) ollamaOptions.stop = options.stop;
    const body = { model: modelId, messages, stream: true, options: ollamaOptions };
    if (options?.think) body.think = true;
    else if (options?.think === false) body.think = false; // mirrors ollamaProvider: explicit off must be sent
    if (options?.format) body.format = options.format;

    let res = await fetch(`${ollamaUrl}/api/chat`, { method: 'POST', body: JSON.stringify(body) });
    if (!res.ok && res.status === 400 && 'think' in body) {
      const errText = await res.text();
      if (errText.includes('does not support thinking')) {
        log(`[harness] ${modelId} rejected think:true — retrying without`);
        delete body.think;
        res = await fetch(`${ollamaUrl}/api/chat`, { method: 'POST', body: JSON.stringify(body) });
      } else {
        throw new Error(`Ollama 400: ${errText}`);
      }
    }
    if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line) continue;
          const j = JSON.parse(line);
          const chunk = {
            content: j.message?.content || '',
            thinking: j.message?.thinking || undefined,
            done: !!j.done,
          };
          rec.reply += chunk.content;
          if (chunk.thinking) rec.thinkingChars += chunk.thinking.length;
          yield chunk;
          if (j.done) { rec.endedAt = Date.now(); return; }
        }
      }
    } finally {
      rec.endedAt = rec.endedAt || Date.now();
    }
  }

  const parallx = {
    workspace: {
      fs: wfs,
      workspaceFolders: [{ uri: workspaceDir }],
      // Never fires: keeps tests deterministic (no surprise thread reloads).
      onDidFilesChange: () => ({ dispose() {} }),
    },
    editors: {
      registerEditorProvider(typeId, provider) { editorProviders.set(typeId, provider); return { dispose() {} }; },
      openEditor: async (input) => { openedEditors.push(input); },
      openFileEditor: async (uri) => { openedEditors.push({ file: uri }); },
    },
    views: { registerViewProvider: () => ({ dispose() {} }) },
    commands: {
      registerCommand(id, fn) { commands.set(id, fn); return { dispose() {} }; },
      executeCommand: (id, ...a) => commands.get(id)?.(...a),
    },
    window: {
      showQuickPick: async () => undefined,
      showInformationMessage: async () => undefined,
      showErrorMessage: (m) => log('[harness] showErrorMessage: ' + m),
    },
    icons: { createIconHtml: () => '<span class="tg-icon"></span>' },
    lm: { getModels, sendChatRequest },
    workspaceGraph: { registerProvider: () => ({ dispose() {} }) },
  };

  return { parallx, captured, editorProviders, openedEditors };
}

export async function waitFor(cond, timeoutMs, label) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const v = await cond();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`waitFor timed out (${timeoutMs}ms): ${label}`);
}

/** Mount the chat editor for a thread and wait until it is interactive. */
export async function openChat(editorProviders, threadId) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const pane = editorProviders.get('text-generator-chat').createEditorPane(container, { instanceId: threadId });
  await waitFor(() => container.querySelector('.tg-input-textarea'), 10000, 'chat mount');
  await waitFor(() => {
    const modelSel = container.querySelector('.tg-chat-toolbar-select');
    const loaded = modelSel && modelSel.options.length > 0 && modelSel.value;
    const rendered = container.querySelector('.tg-msg, .tg-welcome');
    return loaded && rendered;
  }, 20000, 'thread + models loaded');
  return { container, pane };
}

/** Type a message, click send, and wait for the generation round-trip. */
export async function sendAndWait(container, captured, text, { timeoutMs = 420000 } = {}) {
  const before = captured.length;
  const ta = container.querySelector('.tg-input-textarea');
  ta.value = text;
  container.querySelector('.tg-input-send').click();
  await waitFor(() => captured.length > before, timeoutMs, `model request after send: ${JSON.stringify(text.slice(0, 40))}`);
  const rec = captured[captured.length - 1];
  // Generation done = stream ended AND UI left generating state.
  await waitFor(() => rec.endedAt !== null, timeoutMs, 'stream end');
  await waitFor(() => {
    const btn = container.querySelector('.tg-input-send');
    return btn && btn.title === 'Send (Enter)' && !container.querySelector('.tg-msg--streaming');
  }, 30000, 'UI back to idle');
  return rec;
}

/** Read messages.jsonl for a thread from disk. */
export async function readThreadMessages(workspaceDir, threadId) {
  const file = path.join(workspaceDir, '.parallx', 'extensions', 'text-generator', 'threads', threadId, 'messages.jsonl');
  try {
    const raw = await fsp.readFile(file, 'utf8');
    return raw.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

export async function readThreadMeta(workspaceDir, threadId) {
  const file = path.join(workspaceDir, '.parallx', 'extensions', 'text-generator', 'threads', threadId, 'thread.json');
  return JSON.parse(await fsp.readFile(file, 'utf8'));
}

/** Create a thread directory directly (same file shapes createThread writes). */
export async function writeThread(workspaceDir, meta, messages = []) {
  const dir = path.join(workspaceDir, '.parallx', 'extensions', 'text-generator', 'threads', meta.id);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, 'thread.json'), JSON.stringify(meta, null, 2));
  const jsonl = messages.map((m) => JSON.stringify(m)).join('\n') + (messages.length ? '\n' : '');
  await fsp.writeFile(path.join(dir, 'messages.jsonl'), jsonl);
  return dir;
}

/** Rough token estimate (chars/3.4) for overflow sanity checks. */
export function roughTokens(text) {
  return Math.ceil((text || '').length / 3.4);
}
