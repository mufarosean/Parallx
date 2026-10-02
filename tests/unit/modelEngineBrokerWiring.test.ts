/**
 * The model engine broker wired into the model and chat services
 * (docs/AGENT_RUNTIME_DESIGN.md): a chat turn holds the local engine for its
 * whole length, background runs' calls wait behind it, helpers your turn
 * waits on count as chat, and cloud models are never queued.
 */

import { describe, it, expect, vi } from 'vitest';
import { ChatService } from '../../src/services/chatService';
import { ChatAgentService } from '../../src/services/chatAgentService';
import { ChatModeService } from '../../src/services/chatModeService';
import { LanguageModelsService } from '../../src/services/languageModelsService';
import { LEASE_GRACE_MS } from '../../src/services/modelEngineBroker';
import { tagTurnModelCalls } from '../../src/openclaw/participants/openclawDefaultParticipant';
import type { IChatParticipant, IChatResponseChunk, IChatRequestOptions } from '../../src/services/chatTypes';

const LOCAL = 'qwen3.8:27b';
const CLOUD = 'claude-sonnet-5';

function provider(id: string, model: string, local: boolean) {
  const calls: { at: number; options?: IChatRequestOptions }[] = [];
  return {
    calls,
    p: {
      id, displayName: id, local,
      listModels: async () => [{ id: model, displayName: model, family: 'x', parameterSize: '', quantization: '', contextLength: 0, capabilities: ['completion'] }],
      getModelInfo: async () => ({ id: model, displayName: model, family: 'x', parameterSize: '', quantization: '', contextLength: 0, capabilities: ['completion'] }),
      checkAvailability: async () => ({ available: true }),
      sendChatRequest: (_m: string, _msgs: unknown, options?: IChatRequestOptions) => (async function* () {
        calls.push({ at: Date.now(), options });
        yield { content: 'ok', done: true } as IChatResponseChunk;
      })(),
    } as any,
  };
}

const until = async (cond: () => boolean) => { for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 5)); };
async function collect(it: AsyncIterable<IChatResponseChunk>): Promise<string> { let s = ''; for await (const c of it) s += c.content; return s; }

async function setup() {
  const lms = new LanguageModelsService();
  const local = provider('ollama', LOCAL, true);
  const cloud = provider('anthropic', CLOUD, false);
  lms.registerProvider(local.p);
  lms.registerProvider(cloud.p);
  await until(() => lms.getEngineForModel(LOCAL) === 'ollama' && lms.getEngineForModel(CLOUD) === 'anthropic');
  const agents = new ChatAgentService();
  const service = new ChatService(agents, new ChatModeService(), lms);
  let release: () => void = () => {};
  let entered: () => void = () => {};
  const inTurn = new Promise<void>((r) => { entered = r; });
  const agent: IChatParticipant = {
    id: 'parallx.chat.default', displayName: 'Default', description: 'test', commands: [],
    handler: async (_req, _ctx, response) => {
      entered();
      await new Promise<void>((r) => { release = r; });
      response.markdown('done');
      return {};
    },
  };
  agents.registerAgent(agent);
  return { lms, service, local, cloud, inTurn, release: () => release() };
}

describe('model engine broker wiring', () => {
  it('a background run waits for the whole chat turn and its grace, then runs', async () => {
    const s = await setup();
    const chat = s.service.createSession(undefined, LOCAL);
    const bg = s.service.createEphemeralSession(chat.id, { archiveOrigin: 'heartbeat' });
    expect(s.service.classifyRun(chat.id)).toBe('interactive');
    expect(s.service.classifyRun(bg.sessionId)).toBe('scheduled');

    const turn = s.service.sendRequest(chat.id, 'Hello');
    await s.inTurn;
    const bgCall = collect(s.lms.sendChatRequestForModel(LOCAL, [{ role: 'user', content: 'x' }], { engine: { runId: bg.sessionId } }));
    await new Promise((r) => setTimeout(r, 50));
    expect(s.local.calls.length).toBe(0);
    expect(s.lms.getEngineBroker().getRunState(bg.sessionId)).toBe('waiting');

    // The chat's own calls go straight through during its turn.
    expect(await collect(s.lms.sendChatRequestForModel(LOCAL, [{ role: 'user', content: 'y' }], { engine: { runId: chat.id } }))).toBe('ok');
    expect(s.local.calls.length).toBe(1);

    const endedAt = Date.now();
    s.release();
    await turn;
    expect(await bgCall).toBe('ok');
    expect(s.local.calls.length).toBe(2);
    expect(s.local.calls[1].at - endedAt).toBeGreaterThanOrEqual(LEASE_GRACE_MS - 50);
    // Background output is capped; chat's is not.
    expect(s.local.calls[0].options?.maxTokens).toBeUndefined();
    expect(s.local.calls[1].options?.maxTokens).toBeGreaterThan(0);
  }, 15_000);

  it('a helper spawned during your chat turn counts as chat; one spawned outside it is a helper', async () => {
    const s = await setup();
    const chat = s.service.createSession(undefined, LOCAL);
    const outside = s.service.createEphemeralSession(chat.id, { archiveOrigin: 'subagent' });
    const turn = s.service.sendRequest(chat.id, 'Hello');
    await s.inTurn;
    const during = s.service.createEphemeralSession(chat.id, { archiveOrigin: 'subagent' });
    expect(s.service.classifyRun(outside.sessionId)).toBe('helper');
    expect(s.service.classifyRun(during.sessionId)).toBe('interactive');
    s.release();
    await turn;
    s.service.purgeEphemeralSession(during);
    s.service.purgeEphemeralSession(outside);
  });

  it('a helper takes the class of the run that spawned it', async () => {
    const s = await setup();
    const chat = s.service.createSession(undefined, LOCAL);
    const routine = s.service.createEphemeralSession(chat.id, { archiveOrigin: 'workflow' });
    const ofChat = s.service.createEphemeralSession(chat.id, { archiveOrigin: 'subagent', spawnedBy: chat.id });
    const ofRoutine = s.service.createEphemeralSession(chat.id, { archiveOrigin: 'subagent', spawnedBy: routine.sessionId });
    const ofHelper = s.service.createEphemeralSession(chat.id, { archiveOrigin: 'subagent', spawnedBy: ofChat.sessionId });
    expect(s.service.classifyRun(ofChat.sessionId)).toBe('interactive');
    expect(s.service.classifyRun(ofRoutine.sessionId)).toBe('helper');
    expect(s.service.classifyRun(ofHelper.sessionId)).toBe('interactive');
  });

  it('a background run keeps its own model; your chat follows the picker', async () => {
    const s = await setup();
    const chat = s.service.createSession(undefined, LOCAL);
    s.lms.setActiveModel(LOCAL);
    const bg = s.service.createEphemeralSession(chat.id, { archiveOrigin: 'workflow' });
    s.service.updateSessionModel(bg.sessionId, CLOUD);
    await collect(s.lms.sendChatRequest([{ role: 'user', content: 'x' }], { engine: { runId: bg.sessionId } }));
    expect(s.cloud.calls.length).toBe(1);
    await collect(s.lms.sendChatRequest([{ role: 'user', content: 'x' }], { engine: { runId: chat.id } }));
    expect(s.local.calls.length).toBe(1);
  });

  it('a chat turn on a cloud model does not hold the local engine', async () => {
    const s = await setup();
    const chat = s.service.createSession(undefined, CLOUD);
    const bg = s.service.createEphemeralSession(chat.id, { archiveOrigin: 'cron' });
    const turn = s.service.sendRequest(chat.id, 'Hello');
    await s.inTurn;
    expect(await collect(s.lms.sendChatRequestForModel(LOCAL, [{ role: 'user', content: 'x' }], { engine: { runId: bg.sessionId } }))).toBe('ok');
    s.release();
    await turn;
  });

  it('tags every model call a turn makes with its run id, keeping explicit tags', async () => {
    const seen: (IChatRequestOptions | { numCtx?: number; engine?: unknown } | undefined)[] = [];
    const services = {
      sendChatRequest: vi.fn((_m, o) => { seen.push(o); return (async function* () {})(); }),
      sendSummarizationRequest: vi.fn((_m, _s, o) => { seen.push(o); return (async function* () {})(); }),
      sendChatRequestForModel: vi.fn(() => (_m: unknown, o: IChatRequestOptions) => { seen.push(o); return (async function* () {})(); }),
    } as any;
    const tagged = tagTurnModelCalls(services, 'run-1');
    tagged.sendChatRequest([], { temperature: 1 });
    tagged.sendSummarizationRequest!([], undefined, { numCtx: 8 });
    tagged.sendChatRequestForModel!('m')([], undefined);
    tagged.sendChatRequest([], { engine: { priority: 'maintenance' } });
    expect(seen).toEqual([
      { temperature: 1, engine: { runId: 'run-1' } },
      { numCtx: 8, engine: { runId: 'run-1' } },
      { engine: { runId: 'run-1' } },
      { engine: { priority: 'maintenance' } },
    ]);
  });
});
