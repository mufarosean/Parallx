/**
 * The assistant's browser tools (src/services/browserAutomationService.ts) with
 * a fake main-process transport: the tools exist only while the Browser hosts
 * them, the call identity comes from the invocation and never from arguments,
 * the size budget reaches the broker, cancellation, workspace end and request
 * completion end the run, a capture runs only for a loop that delivers images,
 * a deleted chat takes its artifacts with it, and the host API is the
 * Browser's alone. docs/BROWSER_AGENT_IMPLEMENTATION_CONTRACT.md.
 */

import { describe, it, expect, vi } from 'vitest';
import { Emitter } from '../../src/platform/events';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { BrowserAutomationService } from '../../src/services/browserAutomationService';
import { BrowserAutomationBridge } from '../../src/api/bridges/browserAutomationBridge';
import { TOOL_NEEDS_A_CHAT_TURN, type IChatTool, type ICancellationToken, type IToolResult } from '../../src/services/chatTypes';
import type { IBrowserAutomationHost, IBrowserAutomationToolSpec } from '../../src/services/browserAutomationTypes';
import { isToolImageGone } from '../../src/services/toolImageLifetime';
// The Browser extension's own tool specs: the core holds none.
import { AUTOMATION_TOOLS } from '../../ext/browser/main.js';

const TOOLS = AUTOMATION_TOOLS as readonly IBrowserAutomationToolSpec[];
const TOOL_NAMES = TOOLS.map((t) => t.name);

type Call = { method: string; payload: any; budget: number | undefined };

function fakeTransport(reply: (c: Call) => unknown = () => JSON.stringify({ version: 1, status: 'ok', summary: 'Done.' })) {
  const listeners = new Set<(e: { type: string; payload: unknown }) => void>();
  const calls: Call[] = [];
  return {
    calls,
    of: (method: string) => calls.filter((c) => c.method === method),
    emit: (payload: unknown) => { for (const l of listeners) l({ type: 'automation:event', payload }); },
    call: vi.fn(async (method: string, payload?: unknown, budget?: number) => {
      const c = { method, payload, budget };
      calls.push(c);
      return reply(c);
    }),
    onEvent: (l: (e: { type: string; payload: unknown }) => void) => { listeners.add(l); return () => { listeners.delete(l); }; },
  };
}

function fakeSettings(sealed = false) {
  const changed = new Emitter<{ key: string }>();
  const schemas = new Map<string, unknown>();
  return {
    changed,
    register: (s: { key: string }) => { schemas.set(s.key, s); },
    getSchema: (k: string) => schemas.get(k),
    getValue: (k: string) => (k === 'workspace.sealed' ? sealed : undefined),
    onDidChange: changed.event,
  };
}

/** A turn's cancellation token; null means a token with no turn id. */
function token(turnId: string | null = 'turn-1') {
  const cancelled = new Emitter<void>();
  let isCancelled = false;
  const t = {
    get isCancellationRequested() { return isCancelled; },
    onCancellationRequested: cancelled.event,
    turnId: turnId ?? undefined,
    cancel() { isCancelled = true; cancelled.fire(); },
  };
  return t as ICancellationToken & { cancel(): void };
}

function fakeHost(): IBrowserAutomationHost & Record<string, ReturnType<typeof vi.fn>> {
  return { openTab: vi.fn(), closeTab: vi.fn(), revealTab: vi.fn(), setRunState: vi.fn() } as any;
}

function setup(opts: { reply?: (c: Call) => unknown; sealed?: boolean; noContext?: boolean; taken?: Set<string> } = {}) {
  const registered: IChatTool[] = [];
  const tools = {
    registerTool: (t: IChatTool) => {
      // Like the tools service: a name another tool holds is refused.
      if (opts.taken?.has(t.name)) throw new Error(`Tool "${t.name}" is already registered`);
      registered.push(t);
      return { dispose: () => { const i = registered.indexOf(t); if (i >= 0) registered.splice(i, 1); } };
    },
  };
  const completed = new Emitter<{ sessionId: string; turnId: string }>();
  const deleted = new Emitter<string>();
  const sessionChanged = new Emitter<unknown>();
  const settings = fakeSettings(opts.sealed);
  const transport = fakeTransport(opts.reply);
  const forgotten: string[][] = [];
  // The workspace session, as the session manager holds it: endSession aborts
  // its signal, drops it and then announces the change.
  const abort = new AbortController();
  let active: { workspaceId: string; sessionId: string; cancellationSignal: AbortSignal } | undefined = opts.noContext
    ? undefined
    : { workspaceId: 'ws-1', sessionId: 'wss-1', cancellationSignal: abort.signal };
  const endSession = () => { abort.abort(); active = undefined; sessionChanged.fire(undefined); };
  const service = new BrowserAutomationService({
    tools,
    chat: { onDidCompleteRequest: completed.event, onDidDeleteSession: deleted.event },
    sessions: () => ({ activeContext: active, onDidChangeSession: sessionChanged.event }),
    settings: () => settings as any,
    transport: () => transport,
    forgetChats: async (ids) => { forgotten.push(ids); return { ok: true }; },
  });
  const tool = (name: string) => {
    const t = registered.find((x) => x.name === name);
    if (!t) throw new Error(`no tool ${name}`);
    return t;
  };
  return { service, registered, transport, completed, deleted, sessionChanged, endSession, settings, tool, forgotten };
}

const parse = (r: IToolResult) => JSON.parse(r.content);

describe('BrowserAutomationService', () => {
  it('registers no tools until the Browser hosts them, then all nine owned by the Browser', () => {
    const s = setup();
    expect(s.registered).toHaveLength(0);
    s.service.registerHost(fakeHost(), 'parallx.browser', TOOLS);
    expect(s.registered.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    expect(s.registered).toHaveLength(9);
    for (const t of s.registered) {
      expect(t.source).toBe('bridge');
      expect(t.ownerToolId).toBe('parallx.browser');
      expect(t.reachesNetwork).toBe(true);
      expect(t.needsChatTurn).toBe(true);
    }
    const confirming = s.registered.filter((t) => t.requiresConfirmation).map((t) => t.name).sort();
    expect(confirming).toEqual(['browserAct', 'browserClick', 'browserType']);
    expect(s.transport.of('setContext')[0].payload).toEqual({ workspaceId: 'ws-1', workspaceSessionId: 'wss-1', sealed: false });
  });

  it('with no Browser host there are no browser tools, and the core names none of them', () => {
    const s = setup();
    expect(s.registered).toHaveLength(0);
    expect(s.service.hasHost).toBe(false);
    // The tool names and copy live in the Browser extension only.
    const core = [
      'src/services/browserAutomationService.ts',
      'src/services/browserAutomationTypes.ts',
      'src/api/bridges/browserAutomationBridge.ts',
      'src/built-in/chat/main.ts',
      'src/built-in/agents/main.ts',
    ].map((p) => readFileSync(resolve(__dirname, '../..', p), 'utf8'));
    for (const src of core) {
      for (const t of TOOLS) {
        expect(src).not.toContain(t.name);
        expect(src).not.toContain(t.description.slice(0, 40));
      }
    }
  });

  it('enforces confirmation for page actions whatever the host declares, and can only add more', () => {
    const s = setup();
    const lax = TOOLS.map((t) => ({ ...t, requiresConfirmation: false }));
    const strict = lax.map((t) => (t.op === 'read' ? { ...t, requiresConfirmation: true } : t));
    s.service.registerHost(fakeHost(), 'parallx.browser', strict);
    const confirming = s.registered.filter((t) => t.requiresConfirmation).map((t) => t.name).sort();
    expect(confirming).toEqual(['browserAct', 'browserClick', 'browserRead', 'browserType']);
  });

  it('refuses an invalid spec and registers nothing: unknown operation, bad or repeated name, no schema', () => {
    const bad: IBrowserAutomationToolSpec[][] = [
      [{ name: 'evil', op: 'evaluate', description: 'x', parameters: { type: 'object', properties: {} } }],
      [{ name: 'has space', op: 'read', description: 'x', parameters: { type: 'object', properties: {} } }],
      [TOOLS[0], { ...TOOLS[1], name: TOOLS[0].name }],
      [{ name: 'noSchema', op: 'read', description: 'x', parameters: undefined as any }],
      [{ name: 'noText', op: 'read', description: '', parameters: { type: 'object', properties: {} } }],
      [{ name: 'proto', op: 'toString', description: 'x', parameters: { type: 'object', properties: {} } }],
    ];
    for (const tools of bad) {
      const s = setup();
      expect(() => s.service.registerHost(fakeHost(), 'parallx.browser', tools)).toThrow();
      expect(s.registered).toHaveLength(0);
      expect(s.service.hasHost).toBe(false);
      expect(s.transport.calls).toHaveLength(0);
    }
  });

  it('a name another tool holds undoes the whole registration, and the host can register again', () => {
    const taken = new Set(['browserTabs']);
    const s = setup({ taken });
    expect(() => s.service.registerHost(fakeHost(), 'parallx.browser', TOOLS)).toThrow();
    expect(s.registered).toHaveLength(0);
    expect(s.service.hasHost).toBe(false);
    taken.clear();
    s.service.registerHost(fakeHost(), 'parallx.browser', TOOLS);
    expect(s.registered).toHaveLength(9);
  });

  it('copies the specs at registration: later changes to the host\'s objects reach nothing', async () => {
    const s = setup();
    const mine = TOOLS.map((t) => ({ ...t, parameters: JSON.parse(JSON.stringify(t.parameters)) }));
    s.service.registerHost(fakeHost(), 'parallx.browser', mine);
    const click = mine.find((t) => t.name === 'browserClick')!;
    (click as any).op = 'open';
    (click.parameters as any).properties.url = { type: 'string' };
    await s.tool('browserClick').handler({ ref: 'e1', url: 'https://evil.example' }, token(), { sessionId: 'chat-1' });
    expect(s.transport.of('run')[0].payload.action).toEqual({ op: 'click', ref: 'e1' });
  });

  it('passes declared arguments typed as declared: integers truncated, strings kept, odd values dropped', async () => {
    const s = setup();
    s.service.registerHost(fakeHost(), 'parallx.browser', TOOLS);
    await s.tool('browserType').handler({ index: '3.7', text: 123, submit: 'true', ref: { x: 1 } }, token(), { sessionId: 'chat-1' });
    expect(s.transport.of('run')[0].payload.action).toEqual({ op: 'type', index: 3, text: '123' });
    await s.tool('browserType').handler({ ref: 'e4', text: 'hi', submit: true }, token(), { sessionId: 'chat-1' });
    expect(s.transport.of('run')[1].payload.action).toEqual({ op: 'type', ref: 'e4', text: 'hi', submit: true });
  });

  it('disposing the registration removes the tools and ends every run, closing its tabs', () => {
    const s = setup();
    const reg = s.service.registerHost(fakeHost(), 'parallx.browser', TOOLS);
    reg.dispose();
    expect(s.registered).toHaveLength(0);
    expect(s.service.hasHost).toBe(false);
    expect(s.transport.of('revokeAll')[0].payload).toEqual({ reason: 'host-gone', closeViews: true });
  });

  it('refuses a second host', () => {
    const s = setup();
    s.service.registerHost(fakeHost(), 'parallx.browser', TOOLS);
    expect(() => s.service.registerHost(fakeHost(), 'parallx.browser', TOOLS)).toThrow();
  });

  it('takes the identity from the invocation, the turn and the workspace session, never from arguments', async () => {
    const s = setup();
    s.service.registerHost(fakeHost(), 'parallx.browser', TOOLS);
    await s.tool('browserClick').handler({ ref: 'e3', chatSessionId: 'someone-else', turnId: 'forged', op: 'type' }, token('turn-1'), { sessionId: 'chat-1' });
    const run = s.transport.of('run')[0];
    expect(run.payload.identity).toEqual({ chatSessionId: 'chat-1', turnId: 'turn-1', workspaceSessionId: 'wss-1' });
    expect(run.payload.action).toEqual({ op: 'click', ref: 'e3' });
    // browserOpen passes private through, and nothing it was not given.
    await s.tool('browserOpen').handler({ url: 'https://example.com', private: true, chatSessionId: 'x' }, token('turn-1'), { sessionId: 'chat-1' });
    expect(s.transport.of('run')[1].payload.action).toEqual({ op: 'open', url: 'https://example.com', private: true });
  });

  it('refuses without a chat session, a turn or a workspace, and never reaches the broker', async () => {
    for (const [inv, tok, noContext] of [[undefined, token(), false], [{ sessionId: 'c' }, token(null), false], [{ sessionId: 'c' }, token(), true]] as const) {
      const s = setup({ noContext });
      s.service.registerHost(fakeHost(), 'parallx.browser', TOOLS);
      const r = await s.tool('browserRead').handler({}, tok, inv);
      expect(r.isError).toBe(true);
      expect(parse(r).error.code).toBe('MISSING_CONTEXT');
      expect(s.transport.of('run')).toHaveLength(0);
    }
  });

  it('passes the chat\'s result budget to the broker', async () => {
    const s = setup();
    s.service.registerHost(fakeHost(), 'parallx.browser', TOOLS);
    await s.tool('browserOpen').handler({ url: 'https://example.com' }, token(), { sessionId: 'chat-1', resultCharBudget: 4321 });
    expect(s.transport.of('run')[0].budget).toBe(4321);
  });

  it('reads on from a text offset: browserRead offers textFrom and hands it to the broker', async () => {
    const s = setup();
    s.service.registerHost(fakeHost(), 'parallx.browser', TOOLS);
    const read = s.tool('browserRead');
    expect((read.parameters as any).properties.textFrom).toEqual(expect.objectContaining({ type: 'integer' }));
    expect(read.description).toContain('textFrom');
    await read.handler({ scope: 'text', textFrom: 12000, junk: 1 }, token(), { sessionId: 'chat-1' });
    expect(s.transport.of('run')[0].payload.action).toEqual({ op: 'read', scope: 'text', textFrom: 12000 });
  });

  it('reports anything but ok as an error and carries image artifacts', async () => {
    const ok = setup({ reply: () => JSON.stringify({ version: 1, status: 'ok', summary: 'Captured.', artifacts: [{ kind: 'image', id: 'cap-1', mimeType: 'image/jpeg', width: 800, height: 600 }, { kind: 'script', id: 'x' }] }) });
    ok.service.registerHost(fakeHost(), 'parallx.browser', TOOLS);
    const r = await ok.tool('browserCapture').handler({}, token(), { sessionId: 'chat-1', acceptsImages: true });
    expect(r.isError).toBe(false);
    expect(r.artifacts).toEqual([{ kind: 'image', id: 'cap-1', mimeType: 'image/jpeg', width: 800, height: 600 }]);

    const busy = setup({ reply: () => JSON.stringify({ version: 1, status: 'error', summary: 'Another chat is using the Assistant Browser.', error: { code: 'BROWSER_BUSY', retryable: true } }) });
    busy.service.registerHost(fakeHost(), 'parallx.browser', TOOLS);
    const b = await busy.tool('browserRead').handler({}, token(), { sessionId: 'chat-2' });
    expect(b.isError).toBe(true);
    expect(parse(b).error.code).toBe('BROWSER_BUSY');

    const odd = setup({ reply: () => ({ __error: 'Unknown automation method' }) });
    odd.service.registerHost(fakeHost(), 'parallx.browser', TOOLS);
    expect(parse(await odd.tool('browserRead').handler({}, token(), { sessionId: 'c' })).error.code).toBe('UNAVAILABLE');
  });

  it('refuses a capture unless the calling loop hands images to the model, and reads nothing', async () => {
    // @workspace, @canvas and workflows leave acceptsImages unset; the default
    // loop sets it only for a model that can see.
    for (const inv of [{ sessionId: 'chat-1' }, { sessionId: 'chat-1', acceptsImages: false }]) {
      const s = setup({ reply: () => JSON.stringify({ version: 1, status: 'ok', summary: 'Captured.', artifacts: [{ kind: 'image', id: 'browser:w:r:c1', mimeType: 'image/jpeg' }] }) });
      s.service.registerHost(fakeHost(), 'parallx.browser', TOOLS);
      const r = await s.tool('browserCapture').handler({}, token(), inv);
      expect(parse(r).error.code).toBe('NO_VISION');
      // It points at the host's own read tool.
      expect(parse(r).summary).toBe('The chat model cannot see images. Use browserRead instead.');
      expect(s.transport.of('run')).toHaveLength(0);
      expect(s.transport.of('readArtifact')).toHaveLength(0);
    }
  });

  it('cancelling the turn cancels the broker\'s run; a cancelled turn runs nothing', async () => {
    let release: (v: unknown) => void = () => {};
    const s = setup({ reply: (c) => (c.method === 'run' ? new Promise((r) => { release = r; }) : { ok: true }) });
    s.service.registerHost(fakeHost(), 'parallx.browser', TOOLS);
    const t = token('turn-9');
    const pending = s.tool('browserOpen').handler({ url: 'https://example.com' }, t, { sessionId: 'chat-1' });
    await Promise.resolve();
    t.cancel();
    expect(s.transport.of('cancel')[0].payload).toEqual({ chatSessionId: 'chat-1', turnId: 'turn-9' });
    release(JSON.stringify({ version: 1, status: 'cancelled', summary: 'Cancelled.' }));
    expect((await pending).isError).toBe(true);

    const pre = token();
    pre.cancel();
    const r = await s.tool('browserRead').handler({}, pre, { sessionId: 'chat-1' });
    expect(parse(r).status).toBe('cancelled');
    expect(s.transport.of('run')).toHaveLength(1);
  });

  it('ending the workspace session ends the run at once: revokeAll and the run\'s cancel before it answers', async () => {
    let release: (v: unknown) => void = () => {};
    const s = setup({ reply: (c) => (c.method === 'run' ? new Promise((r) => { release = r; }) : { ok: true }) });
    s.service.registerHost(fakeHost(), 'parallx.browser', TOOLS);
    let settled = false;
    const pending = s.tool('browserWait').handler({ for: 'text', value: 'Done' }, token('turn-4'), { sessionId: 'chat-1' }).then((r) => { settled = true; return r; });
    await Promise.resolve();
    const contextsBefore = s.transport.of('setContext').length;
    s.endSession();
    expect(settled).toBe(false);
    expect(s.transport.of('revokeAll')[0].payload).toEqual({ reason: 'workspace', closeViews: true });
    expect(s.transport.of('cancel')[0].payload).toEqual({ chatSessionId: 'chat-1', turnId: 'turn-4' });
    // No context to push: the broker is told to end, not handed a stale session.
    expect(s.transport.of('setContext')).toHaveLength(contextsBefore);
    release(JSON.stringify({ version: 1, status: 'cancelled', summary: 'Cancelled.' }));
    expect((await pending).isError).toBe(true);
    // A late call in the old workspace reaches nothing.
    const late = await s.tool('browserRead').handler({}, token('turn-5'), { sessionId: 'chat-1' });
    expect(parse(late).error.code).toBe('MISSING_CONTEXT');
    expect(s.transport.of('run')).toHaveLength(1);
  });

  it('a finished request releases its run', () => {
    const s = setup();
    s.service.registerHost(fakeHost(), 'parallx.browser', TOOLS);
    s.completed.fire({ sessionId: 'chat-1', turnId: 'turn-1' });
    expect(s.transport.of('release')[0].payload).toEqual({ chatSessionId: 'chat-1', turnId: 'turn-1' });
  });

  it('a deleted chat takes its artifacts with it, with or without the Browser running', () => {
    // Through the main process, which erases the files itself while the
    // Browser is off (nothing of the Browser starts for it).
    const s = setup();
    s.deleted.fire('chat-7');
    expect(s.forgotten).toEqual([['chat-7']]);
    s.service.registerHost(fakeHost(), 'parallx.browser', TOOLS);
    s.deleted.fire('chat-8');
    expect(s.forgotten).toEqual([['chat-7'], ['chat-8']]);
    expect(s.transport.of('clearArtifacts')).toHaveLength(0);
    s.service.dispose();
    s.deleted.fire('chat-9');
    expect(s.forgotten).toHaveLength(2);
  });

  it('tells the broker again when the workspace changes or is sealed', () => {
    const s = setup();
    s.service.registerHost(fakeHost(), 'parallx.browser', TOOLS);
    s.sessionChanged.fire(undefined);
    s.settings.changed.fire({ key: 'workspace.sealed' });
    s.settings.changed.fire({ key: 'something.else' });
    expect(s.transport.of('setContext')).toHaveLength(3);
    expect(s.transport.of('revokeAll')).toHaveLength(0);
  });

  it('hands tab and run-state events to the host, and the host\'s controls to the broker', async () => {
    const s = setup({ reply: (c) => (c.method === 'control' ? { ok: true } : 'x') });
    const host = fakeHost();
    const reg = s.service.registerHost(host, 'parallx.browser', TOOLS);
    s.transport.emit({ type: 'tab-open', tabId: 'agent:a:1', chatSessionId: 'chat-1', openerTabId: null, reveal: true });
    s.transport.emit({ type: 'run-state', chatSessionId: 'chat-1', tabId: 'agent:a:1', tabs: ['agent:a:1'], state: 'paused', note: 'You took over', by: 'user' });
    s.transport.emit({ type: 'tab-closed', tabId: 'agent:a:1' });
    expect(host.openTab).toHaveBeenCalledWith({ tabId: 'agent:a:1', chatSessionId: 'chat-1', openerTabId: null, reveal: true, private: false });
    // A private session's tab reaches the host marked, so it can say so.
    s.transport.emit({ type: 'tab-open', tabId: 'agent:a:2', chatSessionId: 'chat-1', openerTabId: null, reveal: true, private: true });
    expect(host.openTab).toHaveBeenCalledWith({ tabId: 'agent:a:2', chatSessionId: 'chat-1', openerTabId: null, reveal: true, private: true });
    expect(host.setRunState).toHaveBeenCalledWith({ chatSessionId: 'chat-1', tabId: 'agent:a:1', tabs: ['agent:a:1'], state: 'paused', note: 'You took over', by: 'user' });
    expect(host.closeTab).toHaveBeenCalledWith('agent:a:1');
    expect(await reg.control('pause')).toBe(true);
    expect(s.transport.of('control')[0].payload).toEqual({ action: 'pause' });
  });

  it('hands a capture\'s image to the running turn when its loop delivers images', async () => {
    const s = setup({
      reply: (c) => (c.method === 'readArtifact'
        ? { mimeType: 'image/jpeg', data: '/9j/abc', width: 10, height: 10 }
        : JSON.stringify({ version: 1, status: 'ok', summary: 'Captured.', artifacts: [{ kind: 'image', id: 'browser:w:r:c1', mimeType: 'image/jpeg' }] })),
    });
    s.service.registerHost(fakeHost(), 'parallx.browser', TOOLS);
    const r = await s.tool('browserCapture').handler({}, token(), { sessionId: 'chat-1', acceptsImages: true });
    expect(s.transport.of('readArtifact')[0].payload).toEqual({ id: 'browser:w:r:c1' });
    expect(r.images).toEqual([expect.objectContaining({ kind: 'image', id: 'browser:w:r:c1', mimeType: 'image/jpeg', data: '/9j/abc' })]);
    expect(r.artifacts).toEqual([{ kind: 'image', id: 'browser:w:r:c1', mimeType: 'image/jpeg', width: undefined, height: undefined }]);
  });

  it('an erased capture leaves any running turn, and a capture erased before it was read is not handed on', async () => {
    const s = setup({
      reply: (c) => (c.method === 'readArtifact'
        ? { mimeType: 'image/jpeg', data: '/9j/abc', width: 10, height: 10 }
        : JSON.stringify({ version: 1, status: 'ok', summary: 'Captured.', artifacts: [{ kind: 'image', id: 'browser:w:r:c9', mimeType: 'image/jpeg' }] })),
    });
    s.service.registerHost(fakeHost(), 'parallx.browser', TOOLS);
    expect(isToolImageGone('browser:w:r:c9')).toBe(false);
    s.transport.emit({ type: 'artifacts-cleared', chatSessionIds: ['chat-1'], artifactIds: ['browser:w:r:c9'], partial: true });
    expect(isToolImageGone('browser:w:r:c9')).toBe(true);
    const r = await s.tool('browserCapture').handler({}, token(), { sessionId: 'chat-1', acceptsImages: true });
    expect(r.images).toBeUndefined();
  });

  it('a workflow tool step gets a plain refusal naming the Agent Turn step', () => {
    // chat/main.ts runTool returns this for every tool that declares
    // needsChatTurn (the core sets it on every browser tool), before any call
    // reaches the tools service; the workflow editor does not list them.
    expect(TOOL_NEEDS_A_CHAT_TURN).toContain('Agent Turn');
    expect(TOOL_NEEDS_A_CHAT_TURN).not.toMatch(/—/);
    const chatMain = readFileSync(resolve(__dirname, '../../src/built-in/chat/main.ts'), 'utf8');
    expect(chatMain).toMatch(/getTool\(toolName\)\?\.needsChatTurn\) return \{ content: TOOL_NEEDS_A_CHAT_TURN/);
  });
});

describe('BrowserAutomationBridge', () => {
  it('is for the Browser only, and ties the registration to its lifetime', () => {
    const s = setup();
    expect(BrowserAutomationBridge.isHostTool('parallx.browser')).toBe(true);
    expect(BrowserAutomationBridge.isHostTool('parallx.web-research')).toBe(false);
    expect(() => new BrowserAutomationBridge('someone.else', s.service, []).registerAutomationHost(fakeHost(), TOOLS)).toThrow();
    const subs: { dispose(): void }[] = [];
    new BrowserAutomationBridge('parallx.browser', s.service, subs).registerAutomationHost(fakeHost(), TOOLS);
    expect(subs).toHaveLength(1);
    expect(s.registered).toHaveLength(9);
    subs[0].dispose();
    expect(s.registered).toHaveLength(0);
  });
});
