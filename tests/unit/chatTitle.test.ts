// chatTitle.test.ts — a chat is named by its first words at once, then by
// its model after the first answer, and only while it still has its
// first-words name: a greeting names nothing, an assistant's own run keeps
// its name, a name given meanwhile stands, and the setting turns it off.

import { describe, it, expect, vi } from 'vitest';
import { Emitter } from '../../src/platform/events';
import { ChatContentPartKind, type IChatSession } from '../../src/services/chatTypes';
import { cleanModelTitle, exchangeToName, firstWordsTitle, registerChatTitleNamer, titleMessages } from '../../src/services/chatTitle';

function session(over: Partial<IChatSession> & { pairs?: [string, string, boolean?][] } = {}): IChatSession {
  const { pairs = [['How do I compute the tail factor in Clark?', 'Fit a growth curve and extrapolate.']], ...rest } = over;
  return {
    id: 'chat-1', title: firstWordsTitle(pairs[0]?.[0] ?? '') ?? 'New Chat', modelId: 'qwen', mode: 'agent', createdAt: 0,
    requestInProgress: false, pendingRequests: [],
    messages: pairs.map(([q, a, done = true], i) => ({
      request: { text: q, requestId: `r${i}`, timestamp: 0 },
      response: { parts: a ? [{ kind: ChatContentPartKind.Markdown, content: a }] : [], isComplete: done, modelId: 'qwen', timestamp: 0 },
    })),
    ...rest,
  } as unknown as IChatSession;
}

describe('chat titles', () => {
  it('names by the first words, and not by a greeting', () => {
    expect(firstWordsTitle('Hello!')).toBeUndefined();
    expect(firstWordsTitle('Short question')).toBe('Short question');
    expect(firstWordsTitle('x'.repeat(60))).toBe('x'.repeat(47) + '...');
  });

  it('cleans what the model answers into a name', () => {
    expect(cleanModelTitle('"Clark Tail Factor Method."')).toBe('Clark Tail Factor Method');
    expect(cleanModelTitle('<think>hmm</think>\n\nTitle: **Budget Review**\nmore')).toBe('Budget Review');
    expect(cleanModelTitle('# Loss Reserving Basics')).toBe('Loss Reserving Basics');
    expect(cleanModelTitle('   \n')).toBeUndefined();
    const long = cleanModelTitle('A Very Long Title That Goes On And On Past Any Reasonable Length For A Chat');
    expect(long!.length).toBeLessThanOrEqual(61);
    expect(long!.endsWith('…')).toBe(true);
  });

  it('names a chat after a greeting by its first real exchange', () => {
    const s = session({ pairs: [['hi', 'Hello!'], ['Explain the Mack method', 'It estimates the variance of reserves.']], title: 'Explain the Mack method' });
    expect(exchangeToName(s)).toEqual({ question: 'Explain the Mack method', answer: 'It estimates the variance of reserves.' });
  });

  it('leaves a chat that is already named, still answering, or not the user\'s', () => {
    expect(exchangeToName(session({ title: 'Clark Tail Factor' }))).toBeUndefined();
    expect(exchangeToName(session({ pairs: [['What is IBNR?', 'Incurred but', false]] }))).toBeUndefined();
    expect(exchangeToName(session({ pairs: [['What is IBNR?', '']] }))).toBeUndefined();
    expect(exchangeToName(session({ origin: 'cron' }))).toBeUndefined();
    expect(exchangeToName(session({ pairs: [['hey', 'Hi there']] }))).toBeUndefined();
  });

  it('asks for a short title from the first question and answer, clipped', () => {
    const [system, user] = titleMessages('q'.repeat(2000), 'answer');
    expect(system.content).toContain('2 to 6 words');
    expect(user.content).toContain('q'.repeat(1500) + '…');
    expect(user.content).toContain('First answer:\nanswer');
  });

  it('asks the chat\'s model once, and keeps a name given meanwhile', async () => {
    const done = new Emitter<{ sessionId: string }>();
    const s = session();
    const titles: string[] = [];
    const calls: { model: string; label?: string }[] = [];
    let enabled = true;
    let answer = 'Clark Tail Factor';
    const reg = registerChatTitleNamer({
      onDidCompleteRequest: done.event,
      getSession: () => s,
      setSessionTitle: (_id, t) => { titles.push(t); s.title = t; },
      async *sendChatRequestForModel(model, _m, o) { calls.push({ model, label: o?.engine?.label }); yield { content: answer } as never; },
      enabled: () => enabled,
    });
    enabled = false;
    done.fire({ sessionId: 'chat-1' });
    expect(calls).toHaveLength(0);
    enabled = true;
    done.fire({ sessionId: 'chat-1' });
    done.fire({ sessionId: 'chat-1' });
    await vi.waitFor(() => expect(titles).toEqual(['Clark Tail Factor']));
    expect(calls).toEqual([{ model: 'qwen', label: 'Naming a chat' }]);

    // A name given while the model answers stands.
    const t = session({ id: 'chat-2' } as Partial<IChatSession>);
    const reg2 = registerChatTitleNamer({
      onDidCompleteRequest: done.event,
      getSession: () => t,
      setSessionTitle: (_id, title) => titles.push(title),
      async *sendChatRequestForModel() { t.title = 'Named By Hand'; yield { content: 'Model Name' } as never; },
      enabled: () => true,
    });
    answer = 'unused';
    done.fire({ sessionId: 'chat-2' });
    await new Promise((r) => setTimeout(r, 10));
    expect(titles).toEqual(['Clark Tail Factor']);
    reg.dispose(); reg2.dispose();
  });
});
