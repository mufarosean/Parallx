/**
 * Unit tests for ChatParticipantContributionProcessor (M82 Slice B).
 *
 * Covers:
 *   1. Manifest with `contributes.chat.participants[]` registers a stub via IChatAgentService.
 *   2. Real-handler wiring through `wireRealHandler` causes invocations to route to it.
 *   3. Disposal via `removeContributions(toolId)` unregisters from the agent service.
 *   4. Duplicate participant id (same tool or different tools) is rejected with a warning.
 *   5. Invalid entries (missing id / missing name) are skipped with a warning.
 */

import { describe, expect, it, beforeEach, vi, type MockedFunction } from 'vitest';
import { ChatParticipantContributionProcessor } from '../../src/contributions/chatParticipantContribution';
import type { IToolDescription } from '../../src/tools/toolManifest';
import type {
  IChatAgentService,
  IChatParticipant,
  IChatParticipantHandler,
  IChatParticipantRequest,
  IChatParticipantContext,
  IChatParticipantResponseStream,
} from '../../src/services/chatTypes';
import type { ICancellationToken } from '../../src/services/chatTypes';

function createMockAgentService(): IChatAgentService & {
  getRegistered(): readonly IChatParticipant[];
} {
  const registered = new Map<string, IChatParticipant>();
  const fireDisposed: ((id: string) => void)[] = [];
  const svc = {
    registerAgent(participant: IChatParticipant) {
      if (registered.has(participant.id)) {
        throw new Error(`already registered: ${participant.id}`);
      }
      registered.set(participant.id, participant);
      return { dispose: () => { registered.delete(participant.id); fireDisposed.forEach((f) => f(participant.id)); } };
    },
    getAgent(id: string) { return registered.get(id); },
    getAgents() { return [...registered.values()]; },
    getRegistered() { return [...registered.values()]; },
    onDidChangeAgents: () => ({ dispose() { /* noop */ } }),
  };
  return svc as unknown as IChatAgentService & { getRegistered(): readonly IChatParticipant[] };
}

function createToolDescription(toolId: string, participants: any[]): IToolDescription {
  return {
    manifest: {
      id: toolId,
      displayName: toolId,
      version: '0.0.1',
      contributes: {
        chat: { participants },
      },
    },
  } as any;
}

function createStubResponse(): IChatParticipantResponseStream {
  const calls: any[] = [];
  return {
    markdown: (v: any) => { calls.push(['markdown', v]); },
    warning: (v: any) => { calls.push(['warning', v]); },
    progress: (v: any) => { calls.push(['progress', v]); },
    reference: (v: any) => { calls.push(['reference', v]); },
    button: (v: any) => { calls.push(['button', v]); },
    anchor: (v: any) => { calls.push(['anchor', v]); },
    filetree: (v: any) => { calls.push(['filetree', v]); },
    push: (v: any) => { calls.push(['push', v]); },
  } as any;
}

const NOOP_TOKEN: ICancellationToken = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() { /* noop */ } }) } as any;

describe('ChatParticipantContributionProcessor', () => {
  let agentService: ReturnType<typeof createMockAgentService>;
  let processor: ChatParticipantContributionProcessor;
  let warnSpy: MockedFunction<typeof console.warn>;
  let logSpy: MockedFunction<typeof console.log>;

  beforeEach(() => {
    agentService = createMockAgentService();
    processor = new ChatParticipantContributionProcessor(agentService);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { /* silence */ }) as MockedFunction<typeof console.warn>;
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => { /* silence */ }) as MockedFunction<typeof console.log>;
  });

  it('registers a stub participant via IChatAgentService for each manifest entry', () => {
    const desc = createToolDescription('com.example.tool', [
      { id: 'example.echo', name: 'echo', fullName: 'Echo', description: 'Echoes input' },
    ]);
    processor.processContributions(desc);
    const registered = agentService.getRegistered();
    expect(registered).toHaveLength(1);
    expect(registered[0].id).toBe('example.echo');
    expect(registered[0].displayName).toBe('Echo');
    expect(registered[0].description).toBe('Echoes input');
    expect(processor.hasContributed('example.echo')).toBe(true);
    expect(processor.getOwnerToolId('example.echo')).toBe('com.example.tool');
  });

  it('invokes the stub handler with a warning when no real handler is wired', async () => {
    processor.processContributions(createToolDescription('t1', [{ id: 'p.stub', name: 's' }]));
    const participant = agentService.getAgent('p.stub')!;
    const response = createStubResponse();
    const warnFn = response.warning as unknown as MockedFunction<(v: any) => void>;
    const warnCalls: string[] = [];
    (response as any).warning = (v: string) => warnCalls.push(v);
    const result = await participant.handler({} as IChatParticipantRequest, {} as IChatParticipantContext, response, NOOP_TOKEN);
    expect(warnCalls.length).toBe(1);
    expect(warnCalls[0]).toContain('not yet active');
    expect(result.errorDetails?.responseIsIncomplete).toBe(true);
  });

  it('routes invocations to the real handler after wireRealHandler is called', async () => {
    processor.processContributions(createToolDescription('t1', [{ id: 'p.live', name: 'l' }]));
    const real: IChatParticipantHandler = vi.fn(async () => ({ metadata: { ok: 1 } }));
    const wired = processor.wireRealHandler('p.live', real);
    expect(wired).toBe(true);
    const participant = agentService.getAgent('p.live')!;
    const response = createStubResponse();
    const result = await participant.handler({} as IChatParticipantRequest, {} as IChatParticipantContext, response, NOOP_TOKEN);
    expect(real).toHaveBeenCalledOnce();
    expect((result as any).metadata.ok).toBe(1);
  });

  it('wireRealHandler returns false when no stub exists for the id', () => {
    expect(processor.wireRealHandler('not.declared', async () => ({}))).toBe(false);
  });

  it('removeContributions disposes all participants for a tool and not others', () => {
    processor.processContributions(createToolDescription('t1', [{ id: 'a', name: 'a' }, { id: 'b', name: 'b' }]));
    processor.processContributions(createToolDescription('t2', [{ id: 'c', name: 'c' }]));
    expect(agentService.getRegistered()).toHaveLength(3);
    processor.removeContributions('t1');
    const after = agentService.getRegistered().map((p) => p.id).sort();
    expect(after).toEqual(['c']);
    expect(processor.getContributedIds().sort()).toEqual(['c']);
  });

  it('rejects duplicate participant ids from a different tool and warns', () => {
    processor.processContributions(createToolDescription('t1', [{ id: 'dup', name: 'd' }]));
    processor.processContributions(createToolDescription('t2', [{ id: 'dup', name: 'd' }]));
    expect(agentService.getRegistered()).toHaveLength(1);
    expect(processor.getOwnerToolId('dup')).toBe('t1');
    expect(warnSpy).toHaveBeenCalled();
  });

  it('skips entries missing required fields and warns', () => {
    processor.processContributions(createToolDescription('t1', [
      { id: '', name: 'bad' },
      { id: 'ok', name: '' },
      { id: 'fine', name: 'fine' },
    ] as any));
    expect(agentService.getRegistered().map((p) => p.id)).toEqual(['fine']);
    expect(warnSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('no-op when manifest has no chat.participants', () => {
    processor.processContributions({ manifest: { id: 't', displayName: 't', version: '0.0.0', contributes: {} } } as any);
    expect(agentService.getRegistered()).toHaveLength(0);
  });
});
