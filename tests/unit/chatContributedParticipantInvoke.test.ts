/**
 * M82 Slice B characterization: contributed chat participant invoke path.
 *
 * Closes the §22 characterization gate promised in
 * `docs/Parallx_Milestone_82.md` (`chatContributedParticipantInvoke.test.ts`).
 *
 * The Manifest §22 row asks the test to:
 *   1. Register an example participant from a manifest contribution.
 *   2. Detect the registration through `onDidChangeAgents` event subscription
 *      (no `getRegisteredParticipants()` method exists today per M82 audit Q3).
 *   3. Wire a real handler.
 *   4. Dispatch an invoke through `IChatAgentService.getAgent(id).handler(...)`.
 *   5. Assert the real handler runs and its response flows back through the
 *      standard agent invoke path.
 *
 * Sister file `chatParticipantContribution.test.ts` covers the processor's
 * lifecycle in isolation; THIS file is the cross-cut that wires processor +
 * agent-service + event observer + invoke path together to characterize the
 * end-to-end behaviour an extension author depends on.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { ChatParticipantContributionProcessor } from '../../src/contributions/chatParticipantContribution';
import type { IToolDescription } from '../../src/tools/toolManifest';
import type {
  IChatAgentService,
  IChatParticipant,
  IChatParticipantHandler,
  IChatParticipantRequest,
  IChatParticipantContext,
  IChatParticipantResponseStream,
  ICancellationToken,
} from '../../src/services/chatTypes';

interface MockAgentService extends IChatAgentService {
  getRegistered(): readonly IChatParticipant[];
}

function createMockAgentService(): MockAgentService {
  const registered = new Map<string, IChatParticipant>();
  const listeners = new Set<() => void>();
  const fire = (): void => { for (const l of listeners) l(); };
  const svc = {
    registerAgent(participant: IChatParticipant) {
      if (registered.has(participant.id)) {
        throw new Error(`already registered: ${participant.id}`);
      }
      registered.set(participant.id, participant);
      fire();
      return {
        dispose: () => {
          if (registered.delete(participant.id)) fire();
        },
      };
    },
    getAgent(id: string) {
      return registered.get(id);
    },
    getAgents() {
      return [...registered.values()];
    },
    getRegistered() {
      return [...registered.values()];
    },
    onDidChangeAgents: (cb: () => void) => {
      listeners.add(cb);
      return { dispose: () => { listeners.delete(cb); } };
    },
    dispose: () => {
      registered.clear();
      listeners.clear();
    },
  };
  return svc as unknown as MockAgentService;
}

function createToolDescription(toolId: string, participants: any[]): IToolDescription {
  return {
    manifest: {
      id: toolId,
      displayName: toolId,
      version: '0.0.1',
      contributes: { chat: { participants } },
    },
  } as any;
}

function createCapturingStream(): { stream: IChatParticipantResponseStream; calls: any[][] } {
  const calls: any[][] = [];
  const stream = {
    markdown: (v: any) => { calls.push(['markdown', v]); },
    warning: (v: any) => { calls.push(['warning', v]); },
    progress: (v: any) => { calls.push(['progress', v]); },
    reference: (v: any) => { calls.push(['reference', v]); },
    button: (v: any) => { calls.push(['button', v]); },
    anchor: (v: any) => { calls.push(['anchor', v]); },
    filetree: (v: any) => { calls.push(['filetree', v]); },
    push: (v: any) => { calls.push(['push', v]); },
  } as unknown as IChatParticipantResponseStream;
  return { stream, calls };
}

const NOOP_TOKEN: ICancellationToken = {
  isCancellationRequested: false,
  onCancellationRequested: () => ({ dispose() { /* noop */ } }),
} as any;

describe('chat contributed participant invoke path (M82)', () => {
  let agentService: MockAgentService;
  let processor: ChatParticipantContributionProcessor;

  beforeEach(() => {
    agentService = createMockAgentService();
    processor = new ChatParticipantContributionProcessor(agentService);
  });

  it('onDidChangeAgents fires when a manifest registers a participant', () => {
    let fired = 0;
    const sub = agentService.onDidChangeAgents(() => { fired++; });
    processor.processContributions(createToolDescription('com.example.tool', [
      { id: 'example.echo', name: 'echo', fullName: 'Echo' },
    ]));
    expect(fired).toBe(1);
    expect(agentService.getRegistered().map((p) => p.id)).toEqual(['example.echo']);
    sub.dispose();
  });

  it('dispatches invoke through IChatAgentService.getAgent(id).handler and routes to the real handler', async () => {
    processor.processContributions(createToolDescription('com.example.tool', [
      { id: 'example.echo', name: 'echo' },
    ]));

    let captured: { req: IChatParticipantRequest | null } = { req: null };
    const real: IChatParticipantHandler = async (req, _ctx, response) => {
      captured.req = req;
      response.markdown(`echo: ${(req as any).prompt ?? ''}`);
      return { metadata: { handled: 'real' } };
    };
    expect(processor.wireRealHandler('example.echo', real)).toBe(true);

    const participant = agentService.getAgent('example.echo');
    expect(participant).toBeDefined();

    const { stream, calls } = createCapturingStream();
    const result = await participant!.handler(
      { prompt: 'hello' } as unknown as IChatParticipantRequest,
      {} as IChatParticipantContext,
      stream,
      NOOP_TOKEN,
    );

    expect((captured.req as any).prompt).toBe('hello');
    expect(calls).toEqual([['markdown', 'echo: hello']]);
    expect((result as any).metadata.handled).toBe('real');
  });

  it('stub handler responds with a "not yet active" warning when the real handler is missing', async () => {
    processor.processContributions(createToolDescription('com.example.tool', [
      { id: 'example.unstarted', name: 'unstarted' },
    ]));
    const participant = agentService.getAgent('example.unstarted');
    expect(participant).toBeDefined();

    const { stream, calls } = createCapturingStream();
    const result = await participant!.handler(
      {} as IChatParticipantRequest,
      {} as IChatParticipantContext,
      stream,
      NOOP_TOKEN,
    );

    const warnings = calls.filter(([k]) => k === 'warning');
    expect(warnings.length).toBe(1);
    expect(String(warnings[0][1])).toContain('not yet active');
    expect(result.errorDetails?.responseIsIncomplete).toBe(true);
  });

  it('removeContributions disposes the participant and fires onDidChangeAgents', () => {
    let fired = 0;
    const sub = agentService.onDidChangeAgents(() => { fired++; });
    processor.processContributions(createToolDescription('com.example.tool', [
      { id: 'example.echo', name: 'echo' },
    ]));
    expect(fired).toBe(1);
    expect(agentService.getAgent('example.echo')).toBeDefined();

    processor.removeContributions('com.example.tool');
    expect(fired).toBe(2);
    expect(agentService.getAgent('example.echo')).toBeUndefined();
    expect(processor.hasContributed('example.echo')).toBe(false);
    sub.dispose();
  });

  it('wireRealHandler is rejected for an id that was never declared by a manifest', () => {
    expect(processor.wireRealHandler('never.declared', async () => ({}))).toBe(false);
  });
});
