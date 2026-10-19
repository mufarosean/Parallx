// @vitest-environment jsdom
// Apps using the person's tools (chat/rendering/appConnections.ts): the
// person decides, each grant is theirs to revoke, and the policy still rules.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerAppConnections, APP_PERMISSION_ANSWER_COMMAND, REVOKE_APP_PERMISSION_COMMAND } from '../../src/built-in/chat/rendering/appConnections';
import { callToolAsApp } from '../../src/services/appConnections';
import { ILanguageModelToolsService } from '../../src/services/chatTypes';
import { buildSandboxDocument, connectFrame } from '../../src/ui/sandboxedHtml';

function setup(opts: { outcome?: 'allow' | 'require-approval' | 'deny'; forceApproval?: boolean; enabled?: boolean } = {}) {
  const commands = new Map<string, (...a: unknown[]) => unknown>();
  const store = new Map<string, unknown>();
  const handler = vi.fn(async (args: Record<string, unknown>) => ({ content: JSON.stringify({ tasks: ['Read Mack'], args }) }));
  const tool = { name: 'planner_read', description: 'Read the Planner tasks. More text.', parameters: {}, handler, requiresConfirmation: false };
  const tools = {
    decideFor: (name: string) => (opts.enabled === false || name !== 'planner_read' ? undefined
      : { tool, decision: { outcome: opts.outcome ?? 'allow', reasons: [], autoApproved: true, permSource: 'default', willTaintOnSuccess: false, forceApproval: opts.forceApproval } }),
  };
  const api = {
    commands: { registerCommand: (id: string, h: (...a: unknown[]) => unknown) => { commands.set(id, h); return { dispose() {} }; } },
    services: { has: (id: { id: string }) => id.id === ILanguageModelToolsService.id, get: () => tools },
  };
  const state = { get: (k: string, d?: unknown) => (store.has(k) ? store.get(k) : d) as never, update: async (k: string, v: unknown) => { store.set(k, v); } };
  const subs = registerAppConnections(api as never, state);
  const dialog = () => document.querySelector('.px-app-permission');
  const answer = async (choice: 'once' | 'always' | 'never') => {
    for (let i = 0; i < 20 && !dialog(); i++) await new Promise((r) => setTimeout(r, 5));
    const ids = [...(dialog()?.querySelectorAll('[aria-labelledby]') ?? [])].map((e) => e.getAttribute('aria-labelledby')!.replace(/-q$/, ''));
    await commands.get(APP_PERMISSION_ANSWER_COMMAND)!(ids[0], choice);
  };
  return { commands, handler, dialog, answer, store, dispose: () => subs.forEach((d) => d.dispose()) };
}

const app = { id: 'app-1', title: 'Exam Countdown', kind: 'mini-app' as const };
let current: ReturnType<typeof setup> | null = null;
afterEach(() => { current?.dispose(); current = null; document.body.replaceChildren(); });

describe('the person decides', () => {
  it('first use asks; Always Allow is kept; the tool runs and its JSON comes back parsed', async () => {
    current = setup();
    const p = callToolAsApp(app, 'planner_read', { range: 'week' });
    await current.answer('always');
    expect(await p).toEqual({ content: expect.any(String), data: { tasks: ['Read Mack'], args: { range: 'week' } } });
    expect(current.dialog()).toBeNull();
    await callToolAsApp(app, 'planner_read', {});
    expect(current.dialog()).toBeNull();
    expect(current.handler).toHaveBeenCalledTimes(2);
  });

  it('the dialog names the app and the tool and says what it does', async () => {
    current = setup();
    const p = callToolAsApp(app, 'planner_read', {});
    for (let i = 0; i < 20 && !current.dialog(); i++) await new Promise((r) => setTimeout(r, 5));
    expect(current.dialog()?.textContent).toContain('Allow Exam Countdown to use planner_read?');
    expect(current.dialog()?.textContent).toContain('Read the Planner tasks.');
    expect([...current.dialog()!.querySelectorAll('button')].map((b) => b.textContent?.trim())).toEqual(["Don't Allow", 'Allow Once', 'Always Allow']);
    await current.answer('once');
    await p;
  });

  it("Don't Allow refuses and is kept; Revoke asks again", async () => {
    current = setup();
    const p = callToolAsApp(app, 'planner_read', {});
    await current.answer('never');
    await expect(p).rejects.toThrow('You did not allow Exam Countdown to use planner_read.');
    await expect(callToolAsApp(app, 'planner_read', {})).rejects.toThrow('did not allow');
    expect(current.handler).not.toHaveBeenCalled();
    await current.commands.get(REVOKE_APP_PERMISSION_COMMAND)!('app-1', 'planner_read');
    const again = callToolAsApp(app, 'planner_read', {});
    await current.answer('once');
    await again;
    expect(current.handler).toHaveBeenCalledOnce();
  });

  it('a tool the policy says to confirm every time has no Always Allow, and asks again', async () => {
    current = setup({ outcome: 'require-approval', forceApproval: true });
    const p = callToolAsApp(app, 'planner_read', {});
    for (let i = 0; i < 20 && !current.dialog(); i++) await new Promise((r) => setTimeout(r, 5));
    expect([...current.dialog()!.querySelectorAll('button')].map((b) => b.textContent?.trim())).toEqual(["Don't Allow", 'Allow Once']);
    await current.answer('once');
    await p;
    const q = callToolAsApp(app, 'planner_read', {});
    await current.answer('once');
    await q;
    expect(current.handler).toHaveBeenCalledTimes(2);
  });

  it('a tool that is off, unknown or denied by policy is never reached and never asked about', async () => {
    current = setup({ enabled: false });
    await expect(callToolAsApp(app, 'planner_read', {})).rejects.toThrow('No tool named planner_read is available');
    current.dispose();
    current = setup({ outcome: 'deny' });
    await expect(callToolAsApp(app, 'planner_read', {})).rejects.toThrow('cannot be used by apps');
    expect(current.dialog()).toBeNull();
  });
});

describe('the frame bridge', () => {
  it('the frame gets parallx.call; the host answers only its own frame', async () => {
    expect(buildSandboxDocument('<p>x</p>', '', { connect: true })).toContain('window.parallx=Object.freeze');
    expect(buildSandboxDocument('<p>x</p>', '')).not.toContain('window.parallx');
    const frame = document.body.appendChild(document.createRange().createContextualFragment('<iframe></iframe>').firstElementChild as HTMLIFrameElement);
    const handler = vi.fn(async () => 'ok');
    connectFrame(frame, handler);
    window.dispatchEvent(new MessageEvent('message', { data: { parallxCall: { id: 1, tool: 'planner_read', args: {} } }, source: window }));
    window.dispatchEvent(new MessageEvent('message', { data: { parallxCall: { id: 2, tool: 'planner_read', args: { a: 1 } } }, source: frame.contentWindow }));
    await new Promise((r) => setTimeout(r, 0));
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith('planner_read', { a: 1 });
    frame.remove();
  });
});

describe('asked once', () => {
  it('two calls at once ask one question; the second follows the answer', async () => {
    current = setup();
    const a = callToolAsApp(app, 'planner_read', {});
    const b = callToolAsApp(app, 'planner_read', {});
    await current.answer('always');
    await Promise.all([a, b]);
    expect(document.querySelectorAll('.px-app-permission')).toHaveLength(0);
    expect(current.handler).toHaveBeenCalledTimes(2);
  });
});
