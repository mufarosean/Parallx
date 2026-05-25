// chatSessionResolver.tier0.test.ts — Slice A8

import { describe, it, expect, vi } from 'vitest';
import { ResourceRegistry } from '../../../../../src/workbench/resources/resourceRegistry.js';
import { chatSessionResource } from '../../../../../src/workbench/resources/resource.js';
import {
  ChatSessionResourceResolver,
  chatSessionResourceResolver,
} from '../../../../../src/workbench/resources/resolvers/chatSessionResolver.js';

describe('ChatSessionResourceResolver', () => {
  it('has type "chat-session"', () => {
    expect(new ChatSessionResourceResolver({ getSession: () => null }).type).toBe('chat-session');
  });

  it('resolves a known session', async () => {
    const getSession = vi.fn(async (id: string) => ({ id, turns: [] }));
    const r = new ChatSessionResourceResolver({ getSession });
    const res = chatSessionResource('s1');
    const out = await r.resolve(res);
    expect(out.resource).toBe(res);
    expect(out.session).toEqual({ id: 's1', turns: [] });
    expect(getSession).toHaveBeenCalledWith('s1');
  });

  it('rejects on missing session', async () => {
    const r = new ChatSessionResourceResolver({ getSession: () => undefined });
    await expect(r.resolve(chatSessionResource('missing'))).rejects.toThrow(/not found/);
  });

  it('rejects on empty sessionId', async () => {
    const r = new ChatSessionResourceResolver({ getSession: () => null });
    await expect(r.resolve(chatSessionResource(''))).rejects.toThrow(/empty/);
  });

  it('integrates with ResourceRegistry.resolveUri', async () => {
    const reg = new ResourceRegistry();
    reg.register(chatSessionResourceResolver({ getSession: async id => ({ id }) }));
    const out = await reg.resolveUri<{ session: { id: string } }>('parallx://chat-session:s42');
    expect(out?.session.id).toBe('s42');
  });
});
