// Creations AI: roleplay memory extraction. It reported "not generating":
// the count of replies restarted every time the chat was opened, and any
// reply that was not bare JSON (prose before it, a fence, a thinking block,
// a reply cut off by the token limit) was dropped without a word.

import { describe, it, expect } from 'vitest';
// @ts-expect-error — JS module with no types
import { extractionDue, parseExtractionReply } from '../../ext/creations-ai/chat-memory.js';
// @ts-expect-error — JS module with no types
import { __testables } from '../../ext/creations-ai/main.js';

const ai = (n: number) => ({ id: `a${n}`, author: 'ai', name: 'Ada', content: `Ada says thing ${n}.` });
const user = (n: number) => ({ id: `u${n}`, author: 'user', name: 'Alex', content: `Alex says thing ${n}.` });
const chat = (pairs: number) => Array.from({ length: pairs }, (_, i) => [user(i), ai(i)]).flat();

describe('when the extractor runs', () => {
  it('runs once six story replies have come since the last run, wherever the chat was closed', () => {
    expect(extractionDue(chat(5), 0).due).toBe(false);
    const due = extractionDue(chat(6), 0);
    expect(due.due).toBe(true);
    expect(due.replies).toBe(6);
    // The mark is on the thread: 6 covered, two more replies is not enough, six more is.
    expect(extractionDue(chat(8), 6).due).toBe(false);
    const next = extractionDue(chat(12), 6);
    expect(next.due).toBe(true);
    expect(next.slice[0].id).toBe('u5'); // a little context before the new part
    expect(next.slice.at(-1).id).toBe('a11');
  });

  it('a long chat with no mark yet is read at its next reply, the recent part only', () => {
    const due = extractionDue(chat(40), 0);
    expect(due.due).toBe(true);
    expect(due.slice).toHaveLength(24);
    expect(due.slice.at(-1).id).toBe('a39');
  });

  it('out-of-character and hidden replies do not count; a shrunken chat counts again', () => {
    const msgs = [...chat(3), ...Array.from({ length: 6 }, (_, i) => ({ ...ai(90 + i), kind: 'ooc' })), { ...ai(99), hiddenFrom: 'ai' }];
    expect(extractionDue(msgs, 0).due).toBe(false);
    expect(extractionDue(chat(6), 30).due).toBe(true);
  });
});

describe('reading what the model returns', () => {
  const json = '{"facts":[{"text":"Ada is left-handed.","category":"trait"}],"beats":[{"summary":"Ada and Alex met at the cafe.","importance":0.7}]}';
  it('takes JSON however it is wrapped', () => {
    for (const reply of [json, 'Here is the JSON:\n' + json + '\nHope that helps!', '```json\n' + json + '\n```', '<think>Let me see.</think>\n' + json]) {
      const r = parseExtractionReply(reply);
      expect(r.facts[0].text).toBe('Ada is left-handed.');
      expect(r.beats[0].summary).toBe('Ada and Alex met at the cafe.');
    }
  });
  it('keeps the complete items of a reply cut off by the token limit', () => {
    const cut = '{"facts":[{"text":"A one.","category":"trait"},{"text":"A two, with a } brace","category":"place"},{"text":"A thr';
    expect(parseExtractionReply(cut).facts.map((f: any) => f.text)).toEqual(['A one.', 'A two, with a } brace']);
  });
  it('says so when there is no JSON at all', () => {
    expect(parseExtractionReply('I cannot help with that.')).toBeNull();
    expect(parseExtractionReply('')).toBeNull();
  });
});

describe('an extraction writes Facts and Timeline into memories.md', () => {
  function world(reply: string) {
    const files = new Map<string, string>();
    const fs = {
      readFile: async (uri: string) => { if (!files.has(uri)) throw new Error('missing'); return { content: files.get(uri) }; },
      writeFile: async (uri: string, content: string) => { files.set(uri, content); },
      mkdir: async () => {},
      exists: async (uri: string) => files.has(uri),
    };
    const msgs = chat(6);
    files.set('ws/.parallx/extensions/text-generator/threads/t1/messages.jsonl', msgs.map((m) => JSON.stringify(m)).join('\n'));
    const parallx = { lm: { sendChatRequest: async function* () { yield { content: reply }; } } };
    return { files, fs, msgs, parallx };
  }

  it('from a reply wrapped in prose, as local models write it', async () => {
    const w = world('Sure! Here is what I found:\n```json\n{"facts":[{"text":"Alex lives in Berlin.","category":"place"}],"beats":[{"summary":"Alex told Ada about Berlin.","importance":0.6}]}\n```');
    const r = await __testables.autoExtractMemoryBackground({ parallx: w.parallx, fs: w.fs, workspaceUri: 'ws', threadId: 't1', modelId: 'm', recentMessages: w.msgs, existingSemantic: [] });
    expect(r).toMatchObject({ ok: true, facts: 1, beats: 1 });
    const mem = await __testables.loadThreadMemory(w.fs, 'ws', 't1');
    expect(mem.facts.map((f: any) => f.text)).toContain('Alex lives in Berlin.');
    expect(mem.beats.map((b: any) => b.text)).toContain('Alex told Ada about Berlin.');
    expect(w.files.get('ws/.parallx/extensions/text-generator/threads/t1/memories.md')).toContain('Alex lives in Berlin.');
  });

  it('asks the model for JSON in the chat\'s context window, with the instructions intact on a long chat', async () => {
    const w = world('{"facts":[],"beats":[]}');
    const seen: { messages: any[]; options: any }[] = [];
    w.parallx.lm.sendChatRequest = async function* (_m: string, messages: any[], options: any) { seen.push({ messages, options }); yield { content: '{"facts":[],"beats":[]}' }; };
    const long = Array.from({ length: 24 }, (_, i) => ({ id: `x${i}`, author: i % 2 ? 'ai' : 'user', name: i % 2 ? 'Ada' : 'Alex', content: 'word '.repeat(800) }));
    const r = await __testables.autoExtractMemoryBackground({ parallx: w.parallx, fs: w.fs, workspaceUri: 'ws', threadId: 't1', modelId: 'm', numCtx: 8192, recentMessages: long, existingSemantic: [] });
    expect(r).toMatchObject({ ok: true, facts: 0, beats: 0 });
    expect(seen[0].options).toMatchObject({ format: 'json', numCtx: 8192, think: false });
    expect(seen[0].messages[0].content).toContain('Return STRICT JSON');
    expect(seen[0].messages[1].content.length).toBeLessThanOrEqual(12_100);
  });

  it('reports a reply with no JSON instead of dropping it silently', async () => {
    const w = world('I would rather not.');
    const r = await __testables.autoExtractMemoryBackground({ parallx: w.parallx, fs: w.fs, workspaceUri: 'ws', threadId: 't1', modelId: 'm', recentMessages: w.msgs, existingSemantic: [] });
    expect(r).toEqual({ ok: false, reason: 'the model answered without JSON ("I would rather not.")' });
  });
});
