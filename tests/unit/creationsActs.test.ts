// @vitest-environment jsdom
// Creations AI: acts (ext/creations-ai/acts.js, acts-panel.js). A plot
// brief becomes a beat sheet, one line per turn with its speaker, kept in
// act.md; Run takes the beats as the chat's own turns, pauses on the
// player's beat, stops on Stop or a failed turn, and ends by writing the
// act to the memory Timeline.

import { describe, it, expect } from 'vitest';
import {
  ACT_FILE, MAX_BEATS, YOU, beatsAskedFor, buildActPlanMessages, resolveBeatSpeaker, parseBeats, renderActFile, parseActFile,
  beatTurn, beatCommand, actTimelineLine, buildNextActMessages, parseNextAct, actStatusLine,
// @ts-expect-error — JS module with no types
} from '../../ext/creations-ai/acts.js';
// @ts-expect-error — JS module with no types
import { createActRunner, actCommand } from '../../ext/creations-ai/acts-panel.js';

const names = ['Ada Lovelace', 'Tom Price'];
const player = { name: 'Alex', plays: '' };

describe('the brief', () => {
  it('asks for the beats the brief names, within bounds, eight by default', () => {
    expect(beatsAskedFor('her childhood, 12 turns')).toBe(12);
    expect(beatsAskedFor('a quiet evening in 3 beats')).toBe(3);
    expect(beatsAskedFor('forty scenes of war')).toBe(8);
    expect(beatsAskedFor('99 turns')).toBe(MAX_BEATS);
    expect(beatsAskedFor('')).toBe(8);
  });
  it('plans with the cast, the player, the memory and the last turns, in the line form it reads back', () => {
    const [system, user] = buildActPlanMessages({
      brief: 'Her childhood in a small town, ages 13 to 18, 6 turns',
      cast: [{ name: 'Ada Lovelace', tagline: 'Counts what others feel', drives: 'Wants the ledger balanced.' }],
      player: { name: 'Alex', plays: 'Tom Price' },
      memory: { facts: [{ text: 'Ada was born in 1815.' }], beats: [{ text: 'They met at the harbour.' }] },
      transcript: [{ name: 'Ada', content: 'Leave it.' }],
      scene: { location: 'the kitchen' },
    });
    expect(system.content).toContain('Write 6 beats');
    expect(system.content).toContain('Narrator: a new scene, a time skip');
    expect(system.content).toContain('Ada Lovelace');
    expect(system.content).toContain('You (the player, who plays Tom Price)');
    expect(system.content).toContain('1. <Speaker>: <one sentence> || <what it sets in motion');
    expect(user.content).toContain('Her childhood in a small town');
    expect(user.content).toContain('Ada was born in 1815.');
    expect(user.content).toContain('They met at the harbour.');
    expect(user.content).toContain('Now: the kitchen');
    expect(user.content).toContain('Ada: Leave it.');
  });
});

describe('reading beats', () => {
  it('names the Narrator, a cast member by full or first name, and the player as You', () => {
    expect(resolveBeatSpeaker('Narrator', { names, player })).toEqual({ kind: 'narrator', name: 'Narrator' });
    expect(resolveBeatSpeaker('ada', { names, player })).toEqual({ kind: 'character', name: 'Ada Lovelace' });
    expect(resolveBeatSpeaker('Tom Price', { names, player })).toEqual({ kind: 'character', name: 'Tom Price' });
    expect(resolveBeatSpeaker('You', { names, player })).toEqual({ kind: 'you', name: YOU });
    expect(resolveBeatSpeaker('Alex', { names, player })).toEqual({ kind: 'you', name: YOU });
    expect(resolveBeatSpeaker('Tom', { names, player: { name: 'Alex', plays: 'Tom Price' } })).toEqual({ kind: 'you', name: YOU, as: 'Tom Price' });
    expect(resolveBeatSpeaker('Mother', { names, player })).toBeNull();
  });
  it('tolerates numbering, bold and a thinking block; an unknown speaker becomes the Narrator\'s beat with the name kept', () => {
    const beats = parseBeats([
      '<think>plan</think>',
      '1. **Narrator**: Cut to the harbour at dawn — the buyer waiting || the deal is on',
      '2. Ada: Asks him where the money went',
      '- Mother: calls up the stairs that supper is ready. || the talk is cut short',
      '3. You: Decide whether to tell her.',
      'not a beat line',
    ].join('\n'), { names, player });
    expect(beats.map((b: any) => [b.kind, b.speaker, b.note, b.then])).toEqual([
      ['narrator', 'Narrator', 'Cut to the harbour at dawn, the buyer waiting', 'the deal is on'],
      ['character', 'Ada Lovelace', 'Asks him where the money went', ''],
      ['narrator', 'Narrator', 'Mother calls up the stairs that supper is ready', 'the talk is cut short'],
      ['you', 'You', 'Decide whether to tell her', ''],
    ]);
  });
  it('the act file round-trips: the brief as the heading, the beats as a list', () => {
    const beats = parseBeats('1. Narrator: Cut to dawn || the buyer waits\n2. Ada: Asks him', { names, player });
    const text = renderActFile('Her childhood', beats);
    expect(text.startsWith('# Her childhood\n')).toBe(true);
    expect(text).toContain('1. Narrator: Cut to dawn || the buyer waits');
    expect(text).toContain('2. Ada Lovelace: Asks him');
    expect(ACT_FILE).toBe('act.md');
    const back = parseActFile(text, { names, player });
    expect(back.brief).toBe('Her childhood');
    expect(back.beats).toEqual(beats);
  });
});

describe('a beat as a turn', () => {
  it('a Narrator beat is the Narrator\'s turn, a character beat theirs, with the beat set in its act; the player\'s has no speaker', () => {
    const beats = parseBeats('1. Narrator: Cut to dawn || the buyer waits\n2. Ada: Asks him\n3. You: Answer her', { names, player });
    const ctx = { narratorSpeaker: '__narrator__', fileFor: (n: string) => `${n.split(' ')[0].toLowerCase()}.json` };
    const t0 = beatTurn(beats[0], 0, 3, 'Her childhood', ctx);
    expect(t0.speaker).toBe('__narrator__');
    expect(t0.instruction).toBe('Cut to dawn (the buyer waits). Beat 1 of 3 of this act (Her childhood).');
    expect(beatTurn(beats[1], 1, 3, 'Her childhood', ctx)).toEqual({ speaker: 'ada.json', instruction: 'Asks him. Beat 2 of 3 of this act (Her childhood).' });
    expect(beatTurn(beats[2], 2, 3, 'Her childhood', ctx)).toEqual({ speaker: null, instruction: 'Answer her' });
    expect(beatCommand(beats[0])).toBe('/nar Cut to dawn');
    expect(beatCommand(beats[1])).toBe('/ai @"Ada Lovelace" Asks him');
    expect(actTimelineLine('Her childhood', 3)).toBe('An act ran (3 turns): Her childhood');
  });
  it('proposes the next act as JSON and reads it back', () => {
    const [system, user] = buildNextActMessages({ cast: [{ name: 'Ada', secrets: 'The abacus.' }], memory: { beats: [{ text: 'An act ran.' }] }, lastBrief: 'Her childhood' });
    expect(system.content).toContain('{"brief": "..."}');
    expect(user.content).toContain('Hides: The abacus.');
    expect(user.content).toContain("The last act's brief:\nHer childhood");
    expect(parseNextAct('{"brief": "The summer she leaves — and who she tells."}')).toBe('The summer she leaves, and who she tells.');
    expect(parseNextAct('no')).toBe('');
  });
  it('says where the act stands', () => {
    expect(actStatusLine(null)).toContain('/act');
    const beats = parseBeats('1. Narrator: Dawn\n2. You: Answer', { names, player });
    expect(actStatusLine({ brief: 'x', beats, index: 0, status: 'planned' })).toBe('Planned: 2 beats. Edit act.md, then Run.');
    expect(actStatusLine({ brief: 'x', beats, index: 1, status: 'waiting' })).toContain('Your turn: Answer');
    expect(actStatusLine({ brief: 'x', beats, index: 1, status: 'running' })).toBe('Running: beat 2 of 2.');
    expect(actStatusLine({ brief: 'x', beats, index: 2, status: 'done' })).toBe('Done: 2 beats ran.');
  });
});

describe('the runner', () => {
  function world(planReply: string, { onTurn = (_n: number) => {} }: { onTurn?: (n: number) => void } = {}) {
    const files = new Map<string, string>();
    const turns: any[] = [];
    const toasts: string[] = [];
    const beatsRemembered: string[] = [];
    let extracted = 0;
    const thread: any = { act: null, userPlaysAs: null };
    const gen = { isGenerating: false, stopRequested: false, lastError: null as any };
    let composer = '';
    async function* chunks(parts: string[]) { for (const p of parts) yield { content: p }; }
    const deps = {
      ui: {
        createButton: (c: HTMLElement, o: any) => { const b = document.createElement('button'); b.textContent = o.label; b.disabled = !!o.disabled; b.dataset.command = o.command; b.dataset.args = JSON.stringify(o.args || []); c.appendChild(b); return b; },
        renderMarkdown: (md: string) => { const d = document.createElement('div'); d.className = 'px-markdown'; d.textContent = md; return d; },
      },
      lm: { sendChatRequest: (_m: string, messages: any[]) => chunks([messages[0].content.startsWith('You plan one act') ? planReply : '{"brief": "The summer she leaves."}']) },
      fs: { readFile: async (uri: string) => { if (!files.has(uri)) throw new Error('no file'); return { content: files.get(uri) }; }, writeFile: async (uri: string, content: string) => { files.set(uri, content); } },
      threadId: 't1', gen, fileUri: (name: string) => `t1/${name}`, thread: () => thread, narratorSpeaker: '__narrator__',
      saveMeta: (updates: any) => { Object.assign(thread, updates); },
      cast: () => [{ file: 'ada.json', name: 'Ada Lovelace', tagline: 'Counts', drives: 'Wants order.' }, { file: 'tom.json', name: 'Tom Price' }],
      userName: () => 'Alex', userPlays: () => '', resolveFile: (n: string) => (n.startsWith('Ada') ? 'ada.json' : 'tom.json'),
      generateTurn: async (o: any) => { turns.push(o); gen.isGenerating = false; onTurn(turns.length); },
      model: async () => ({ modelId: 'm1', numCtx: 0 }),
      memory: async () => ({ facts: [], beats: [], notes: '' }), rememberBeat: async (text: string) => { beatsRemembered.push(text); }, extractMemory: async () => { extracted++; },
      others: () => [], scene: () => null, rules: () => '', transcript: () => [],
      composer: { set: (t: string) => { composer = t; } }, openFile: async () => {}, showToast: (t: string) => toasts.push(t), repaint: () => {},
    };
    return { runner: createActRunner(deps), files, turns, toasts, thread, gen, beatsRemembered, get composer() { return composer; }, get extracted() { return extracted; } };
  }

  it('plans into act.md, runs the beats as turns, pauses for the player, goes on after they write, and remembers the act', async () => {
    const w = world('1. Narrator: Cut to the town, summer || she is thirteen\n2. Ada: Counts the coins on the counter\n3. You: Tell her what you saw\n4. Tom: Laughs it off');
    await w.runner.plan('Her childhood, 4 turns');
    expect(w.thread.act.status).toBe('planned');
    expect(w.thread.act.beats).toHaveLength(4);
    expect(w.files.get('t1/act.md')).toContain('# Her childhood, 4 turns');
    expect(w.toasts.at(-1)).toContain('Act planned: 4 beats');

    await w.runner.run();
    expect(w.turns.map((t) => t.speaker)).toEqual(['__narrator__', 'ada.json']);
    expect(w.turns[0].instruction).toContain('Cut to the town, summer (she is thirteen). Beat 1 of 4');
    expect(w.thread.act.status).toBe('waiting');
    expect(w.runner.waiting()).toBe(true);

    expect(await w.runner.continueAfterPlayer()).toBe(true);
    expect(w.turns.map((t) => t.speaker)).toEqual(['__narrator__', 'ada.json', 'tom.json']);
    expect(w.thread.act.status).toBe('done');
    expect(w.beatsRemembered).toEqual(['An act ran (4 turns): Her childhood, 4 turns']);
    expect(w.extracted).toBe(1);
  });

  it('runs the sheet as edited in act.md, not the plan as first written', async () => {
    const w = world('1. Narrator: Dawn\n2. Ada: Counts');
    await w.runner.plan('A morning');
    w.files.set('t1/act.md', '# A morning, rewritten\n\n1. Tom: Opens the shutters\n');
    await w.runner.run();
    expect(w.turns.map((t) => t.speaker)).toEqual(['tom.json']);
    expect(w.thread.act.brief).toBe('A morning, rewritten');
    expect(w.thread.act.status).toBe('done');
  });

  it('stops after the turn being written, and Continue goes on from the next beat', async () => {
    const w = world('1. Narrator: Dawn\n2. Ada: Counts\n3. Tom: Laughs', { onTurn: (n) => { if (n === 2) w.gen.stopRequested = true; } });
    await w.runner.plan('A morning');
    await w.runner.run();
    expect(w.turns.map((t) => t.speaker)).toEqual(['__narrator__', 'ada.json']);
    expect(w.thread.act.status).toBe('stopped');
    expect(w.thread.act.index).toBe(2);
    w.gen.stopRequested = false;
    await w.runner.run();
    expect(w.turns.map((t) => t.speaker)).toEqual(['__narrator__', 'ada.json', 'tom.json']);
    expect(w.thread.act.status).toBe('done');
  });

  it('a turn that fails stops the act at its beat', async () => {
    const w = world('1. Narrator: Dawn\n2. Ada: Counts', { onTurn: (n) => { if (n === 1) w.gen.lastError = new Error('boom'); } });
    await w.runner.plan('A morning');
    await w.runner.run();
    expect(w.turns).toHaveLength(1);
    expect(w.thread.act.status).toBe('stopped');
    expect(w.thread.act.index).toBe(0);
    expect(w.toasts.at(-1)).toContain('a turn failed');
  });

  it('a plan with no beats fails loudly; the next act lands in the composer', async () => {
    const w = world('nothing useful here');
    await w.runner.plan('A morning');
    expect(w.thread.act.status).toBe('failed');
    expect(w.toasts.at(-1)).toContain('Could not plan the act');
    await w.runner.proposeNext();
    expect(w.composer).toBe('/act The summer she leaves.');
  });

  it('draws the panel with the kit: the state line, Run, Open act.md, Propose, each a command naming the thread; the sheet with run beats struck through', async () => {
    const w = world('1. Narrator: Dawn\n2. Ada: Counts');
    const host = document.createElement('div');
    await w.runner.render(host);
    expect(host.textContent).toContain('No act yet');
    expect([...host.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Run', 'Propose Next Act']);
    expect([...host.querySelectorAll('button')].map((b) => `${b.dataset.command} ${b.dataset.args}`)).toEqual(['textGenerator.chat.act.run ["t1"]', 'textGenerator.chat.act.propose ["t1"]']);
    // The commands reach the runner by thread.
    expect(await actCommand('propose', 't1')).toBeUndefined();
    expect(w.composer).toBe('/act The summer she leaves.');
    expect(actCommand('run', 'nowhere')).toBeUndefined();
    await w.runner.plan('A morning');
    await w.runner.render(host);
    expect(host.textContent).toContain('Planned: 2 beats');
    expect([...host.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Run', 'Open act.md', 'Propose Next Act']);
    expect(host.textContent).toContain('1. Narrator: Dawn');
    await w.runner.run();
    await w.runner.render(host);
    expect(host.textContent).toContain('Done: 2 beats ran.');
    expect(host.textContent).toContain('~~1. Narrator: Dawn~~');
    expect([...host.querySelectorAll('button')].map((b) => b.textContent)[0]).toBe('Run Again');
  });
});
