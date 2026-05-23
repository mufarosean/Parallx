/**
 * Unit tests for ChatBridge.registerParticipant (M82 Slice B).
 *
 * Covers the two code paths:
 *   1. Manifest-declared: processor has a stub → wireRealHandler called, no
 *      duplicate registerAgent call.
 *   2. Imperative-only: no stub → falls back to createChatParticipant which
 *      calls registerAgent directly.
 */

import { describe, expect, it, vi } from 'vitest';
import { ChatBridge } from '../../src/api/bridges/chatBridge';
import { ChatParticipantContributionProcessor } from '../../src/contributions/chatParticipantContribution';
import type {
  IChatAgentService,
  IChatParticipant,
  IChatParticipantHandler,
  IChatParticipantRequest,
  IChatParticipantContext,
  IChatParticipantResponseStream,
  ICancellationToken,
} from '../../src/services/chatTypes';
import type { IDisposable } from '../../src/platform/lifecycle';

function createMockAgentService(): IChatAgentService & { count(): number; get(id: string): IChatParticipant | undefined } {
  const registered = new Map<string, IChatParticipant>();
  const svc = {
    registerAgent(p: IChatParticipant) {
      if (registered.has(p.id)) throw new Error(`dup: ${p.id}`);
      registered.set(p.id, p);
      return { dispose: () => { registered.delete(p.id); } };
    },
    getAgent(id: string) { return registered.get(id); },
    getAgents() { return [...registered.values()]; },
    onDidChangeAgents: () => ({ dispose() { /* noop */ } }),
    count: () => registered.size,
    get: (id: string) => registered.get(id),
  };
  return svc as unknown as IChatAgentService & { count(): number; get(id: string): IChatParticipant | undefined };
}

function noopResponseStream(): IChatParticipantResponseStream {
  return {
    markdown: () => { /* noop */ },
    warning: () => { /* noop */ },
    progress: () => { /* noop */ },
    reference: () => { /* noop */ },
    button: () => { /* noop */ },
    anchor: () => { /* noop */ },
    filetree: () => { /* noop */ },
    push: () => { /* noop */ },
  } as any;
}

const NOOP_TOKEN: ICancellationToken = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() { /* noop */ } }) } as any;

describe('ChatBridge.registerParticipant (M82 Slice B)', () => {
  it('wires real handler when manifest stub exists, no duplicate registerAgent', async () => {
    const agentService = createMockAgentService();
    const processor = new ChatParticipantContributionProcessor(agentService);
    const subs: IDisposable[] = [];
    const bridge = new ChatBridge('com.example.tool', agentService, undefined, subs, processor);

    // Manifest pre-registers the stub.
    processor.processContributions({
      manifest: {
        id: 'com.example.tool',
        displayName: 'Example',
        version: '0.0.1',
        contributes: { chat: { participants: [{ id: 'example.echo', name: 'echo', fullName: 'Echo', description: 'Echoes' }] } },
      },
    } as any);

    expect(agentService.count()).toBe(1);
    const stubBefore = agentService.get('example.echo')!;
    expect(stubBefore.displayName).toBe('Echo');

    // Bridge wires real handler.
    const real: IChatParticipantHandler = vi.fn(async (_r, _c, res) => { (res as any).markdown('hi'); return { metadata: { real: 1 } }; });
    bridge.registerParticipant({
      id: 'example.echo',
      name: 'echo',
      fullName: 'Echo',
      description: 'Echoes',
      handler: real,
    });

    // Still only one agent (no duplicate registration).
    expect(agentService.count()).toBe(1);

    // Invoking the agent's handler now reaches the real handler.
    const participant = agentService.get('example.echo')!;
    const result = await participant.handler({} as IChatParticipantRequest, {} as IChatParticipantContext, noopResponseStream(), NOOP_TOKEN);
    expect(real).toHaveBeenCalledOnce();
    expect((result as any).metadata.real).toBe(1);
  });

  it('falls back to direct registration when no manifest stub exists', async () => {
    const agentService = createMockAgentService();
    const processor = new ChatParticipantContributionProcessor(agentService);
    const subs: IDisposable[] = [];
    const bridge = new ChatBridge('com.example.imperative', agentService, undefined, subs, processor);

    expect(agentService.count()).toBe(0);
    const real: IChatParticipantHandler = vi.fn(async () => ({}));
    bridge.registerParticipant({
      id: 'example.imperative',
      name: 'imp',
      fullName: 'Imperative',
      description: 'No manifest entry',
      handler: real,
    });

    expect(agentService.count()).toBe(1);
    const participant = agentService.get('example.imperative')!;
    expect(participant.displayName).toBe('Imperative');
    expect(participant.description).toBe('No manifest entry');
    await participant.handler({ text: 'hi', command: undefined } as IChatParticipantRequest, {} as IChatParticipantContext, noopResponseStream(), NOOP_TOKEN);
    expect(real).toHaveBeenCalledOnce();
  });

  it('works without a processor (imperative-only mode)', async () => {
    const agentService = createMockAgentService();
    const subs: IDisposable[] = [];
    const bridge = new ChatBridge('com.example.bare', agentService, undefined, subs /* no processor */);
    const real: IChatParticipantHandler = vi.fn(async () => ({}));
    bridge.registerParticipant({ id: 'p.bare', name: 'bare', description: 'bare', handler: real });
    expect(agentService.count()).toBe(1);
  });
});
