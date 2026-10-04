// @vitest-environment jsdom
//
// chatDropHandlers.test.ts — the chat input knows no tool's drag type.
//
// It attaches dropped files by itself. A tool whose views drag their own
// type registers a drop handler while it runs (api.chat.registerDropHandler):
// the input accepts that drag and, when the drop carried no file, the
// handler says what to attach or what to tell the user. Turned off, the
// input no longer accepts the type.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ChatInputPart } from '../../src/built-in/chat/input/chatInputPart';
import { registerChatDropHandler, getChatDropHandlers } from '../../src/services/chatContributions';
import { createToolApi, type ApiFactoryDependencies } from '../../src/api/apiFactory';
import { ServiceCollection } from '../../src/services/serviceCollection';
import type { IToolDescription } from '../../src/tools/toolManifest';
import { IChatAgentService } from '../../src/services/chatTypes';

const TYPE = 'application/x-acme-items';

function fakeTransfer(data: Record<string, string>, files: File[] = []): DataTransfer {
  return {
    types: Object.keys(data),
    files,
    getData: (t: string) => data[t] ?? '',
    dropEffect: 'none',
  } as unknown as DataTransfer;
}

function drag(target: Element, kind: 'dragover' | 'drop', dt: DataTransfer): Event {
  const ev = new Event(kind, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'dataTransfer', { value: dt });
  target.dispatchEvent(ev);
  return ev;
}

function mount() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const part = new ChatInputPart(container);
  const root = container.querySelector('.parallx-chat-input')!;
  const ribbon = (part as unknown as { _contextRibbon: { notifyWarning(m: string): void; addAttachment(f: unknown): Promise<void> } })._contextRibbon;
  const warn = vi.spyOn(ribbon, 'notifyWarning').mockImplementation(() => {});
  const attach = vi.spyOn(ribbon, 'addAttachment').mockImplementation(async () => {});
  return { part, root, warn, attach };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => { document.body.innerHTML = ''; });

describe('chat drop handler hub', () => {
  it('register → listed for its type; dispose → gone', () => {
    const d = registerChatDropHandler({ mimeType: TYPE, resolve: () => undefined, ownerToolId: 'acme' });
    expect(getChatDropHandlers([TYPE, 'text/plain']).map((h) => h.ownerToolId)).toEqual(['acme']);
    expect(getChatDropHandlers(['text/plain'])).toEqual([]);
    d.dispose();
    expect(getChatDropHandlers([TYPE])).toEqual([]);
  });

  it('a type that is not a media type is refused', () => {
    expect(() => registerChatDropHandler({ mimeType: 'not a type', resolve: () => undefined, ownerToolId: 'acme' })).toThrow();
  });

  it('api.chat.registerDropHandler registers for the tool and goes with it', () => {
    const deps: ApiFactoryDependencies = {
      services: new ServiceCollection(),
      viewManager: {} as never,
      toolRegistry: { getAll: () => [], getById: () => undefined } as never,
      notificationService: {} as never,
      workbenchContainer: undefined,
    };
    const desc = {
      manifest: { manifestVersion: 1, id: 'acme.tool', name: 'Acme', version: '1.0.0', publisher: 't', description: 't', main: './main.js', engines: { parallx: '^0.1.0' } },
      toolPath: '/tools/acme', isBuiltin: false,
    } as unknown as IToolDescription;
    deps.services.registerInstance(IChatAgentService, {} as never); // api.chat exists while chat runs
    const { api, dispose } = createToolApi(desc, deps);
    api.chat!.registerDropHandler({ mimeType: TYPE, resolve: () => undefined });
    expect(getChatDropHandlers([TYPE]).map((h) => h.ownerToolId)).toEqual(['acme.tool']);
    dispose();
    expect(getChatDropHandlers([TYPE])).toEqual([]);
  });
});

describe('chat input with a tool drop handler', () => {
  it('does not accept a tool drag type while no tool handles it', () => {
    const { root } = mount();
    expect(drag(root, 'dragover', fakeTransfer({ [TYPE]: '["a"]' })).defaultPrevented).toBe(false);
  });

  it('accepts it while registered, and shows the handler\'s message when nothing could be attached', async () => {
    const d = registerChatDropHandler({ mimeType: TYPE, resolve: () => ({ warning: 'That card had no file.' }), ownerToolId: 'acme' });
    const { root, warn, attach } = mount();
    expect(drag(root, 'dragover', fakeTransfer({ [TYPE]: '["a"]' })).defaultPrevented).toBe(true);
    drag(root, 'drop', fakeTransfer({ [TYPE]: '["a"]' }));
    await flush();
    expect(warn).toHaveBeenCalledWith('That card had no file.');
    expect(attach).not.toHaveBeenCalled();
    d.dispose();
    expect(drag(root, 'dragover', fakeTransfer({ [TYPE]: '["a"]' })).defaultPrevented).toBe(false);
  });

  it('attaches the paths a handler resolves, given the drag data of its type', async () => {
    const seen: string[] = [];
    const d = registerChatDropHandler({
      mimeType: TYPE,
      resolve: (data) => { seen.push(data); return { paths: ['/photos/cat.jpg'] }; },
      ownerToolId: 'acme',
    });
    const { root, attach } = mount();
    drag(root, 'drop', fakeTransfer({ [TYPE]: '["photo:1"]' }));
    await flush();
    expect(seen).toEqual(['["photo:1"]']);
    expect(attach).toHaveBeenCalledWith({ name: 'cat.jpg', fullPath: '/photos/cat.jpg' });
    d.dispose();
  });

  it('a drop that carried a file path attaches it without asking the handler', async () => {
    const resolveSpy = vi.fn(() => ({ warning: 'x' }));
    const d = registerChatDropHandler({ mimeType: TYPE, resolve: resolveSpy, ownerToolId: 'acme' });
    const { root, attach, warn } = mount();
    drag(root, 'drop', fakeTransfer({ [TYPE]: '["a"]', 'text/uri-list': 'file:///photos/dog.png' }));
    await flush();
    expect(attach).toHaveBeenCalledWith({ name: 'dog.png', fullPath: '/photos/dog.png' });
    expect(resolveSpy).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    d.dispose();
  });
});

describe('the core names no tool\'s drag type', () => {
  it('chat input has no tool special case; Atelier registers its own', () => {
    const root = resolve(__dirname, '../..');
    expect(readFileSync(resolve(root, 'src/built-in/chat/input/chatInputPart.ts'), 'utf8')).not.toMatch(/x-mo-items|media[- ]organizer/i);
    const ext = readFileSync(resolve(root, 'ext/media-organizer/main.js'), 'utf8');
    expect(ext).toMatch(/registerDropHandler\(\{\s*mimeType: 'application\/x-mo-items'/);
  });
});
