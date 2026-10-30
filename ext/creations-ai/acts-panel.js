// acts-panel.js — Creations AI: the act runner and its panel in the chat.
//
// The pure part is acts.js (the prompts, the file, the reading). This file
// runs an act through the chat: plans it from a brief (typed as "/act ..."),
// keeps the beat sheet in act.md beside the thread, and on Run takes the
// beats one by one as the chat's own turns (generateTurn, as a typed
// "/ai @Name note" would), pausing on a beat that is the player's until
// they send, stopping on Stop or a failed turn, and at the end writing one
// line to the memory Timeline and reading the act into memory. The panel
// shares the chat's side panel with Memory and is drawn with the kit alone.
//
// `deps` is what the chat lends it: { threadId, ui, lm, fs, fileUri(name), thread(),
// saveMeta(updates, label), cast() → [{ file, name, char }], userName(),
// userPlays() → the cast name the player plays or '', narratorSpeaker,
// resolveFile(name) → a character file, generateTurn(opts), gen, model()
// → { modelId, numCtx }, memory() → { facts, beats, notes }, rememberBeat
// (text), extractMemory(), others() → [{ name, note }], scene(), rules(),
// transcript() → [{ name, content }], composer: { set(text) },
// openFile(uri), showToast(text), repaint() }.

import { ACT_FILE, actStatusLine, actTimelineLine, beatTurn, buildActPlanMessages, buildNextActMessages, parseActFile, parseBeats, parseNextAct, renderActFile } from './acts.js';
import { stripDashes } from './studio-core.js';

async function collect(stream, onChunk) {
  let text = '';
  for await (const chunk of stream) { if (chunk && chunk.content) { text += chunk.content; if (onChunk) onChunk(text); } }
  return text;
}

/** Room a model gets to reason before its answer (the chat's other thinking calls give the same). */
export const ACT_REASONING_TOKENS = 4096;

/**
 * One planning call that yields an answer: the cap is the answer's plus room
 * to reason, since a thinking model's reasoning counts against it (the plan
 * call had 1800 for both, so a reasoning model spent them all thinking and
 * the act failed with "the model wrote no beats"). A reply with no answer is
 * asked once more with thinking off.
 */
export async function askForAnswer(lm, modelId, messages, opts, answerTokens) {
  const first = await collect(lm.sendChatRequest(modelId, messages, { ...opts, think: true, maxTokens: answerTokens + ACT_REASONING_TOKENS }));
  if (first.replace(/<think>[\s\S]*?(<\/think>|$)/gi, '').trim()) return first;
  return collect(lm.sendChatRequest(modelId, messages, { ...opts, think: false, maxTokens: answerTokens }));
}

/** The runners by thread, for the panel's commands (a button names its thread). */
const runners = new Map();
export const ACT_COMMANDS = { run: 'textGenerator.chat.act.run', stop: 'textGenerator.chat.act.stop', open: 'textGenerator.chat.act.open', propose: 'textGenerator.chat.act.propose' };
/** A panel command for a thread: 'run' | 'stop' | 'open' | 'propose'. */
export function actCommand(action, threadId) {
  const r = runners.get(threadId);
  if (!r) return undefined;
  if (action === 'open') return r.openSheet();
  return typeof r[action] === 'function' ? r[action]() : undefined;
}

export function createActRunner(deps) {
  let stopRequested = false;
  let busy = false;

  const act = () => (deps.thread() && deps.thread().act) || null;
  const setAct = (next, label = 'act') => { const t = deps.thread(); if (!t) return; t.act = next; deps.saveMeta({ act: next }, label); deps.repaint(); };
  const names = () => deps.cast().map((c) => c.name);
  const player = () => ({ name: deps.userName(), plays: deps.userPlays() });
  const readSheet = async () => {
    try { const { content } = await deps.fs.readFile(deps.fileUri(ACT_FILE)); return parseActFile(content, { names: names(), player: player() }); } catch { return null; }
  };

  /** A brief to a beat sheet in act.md: the act is planned. */
  async function plan(brief) {
    const text = String(brief || '').trim();
    if (!text) { deps.showToast('Write the act after /act: what this stretch of the story covers.'); return; }
    if (busy) { deps.showToast('An act is already being planned or run.'); return; }
    busy = true;
    setAct({ brief: text, beats: [], index: 0, status: 'planning', createdAt: Date.now() }, 'act brief');
    try {
      const { modelId, numCtx } = await deps.model();
      const cast = deps.cast().map((c) => ({ name: c.name, tagline: c.tagline, drives: c.drives }));
      const messages = buildActPlanMessages({ brief: text, cast, player: player(), others: deps.others(), scene: deps.scene(), memory: await deps.memory(), transcript: deps.transcript(), rules: deps.rules() });
      const raw = await askForAnswer(deps.lm, modelId, messages, { temperature: 0.9, ...(numCtx ? { numCtx } : {}) }, 1800);
      const beats = parseBeats(raw, { names: names(), player: player() });
      if (!beats.length) throw new Error('the model wrote no beats');
      await deps.fs.writeFile(deps.fileUri(ACT_FILE), renderActFile(text, beats));
      setAct({ ...act(), beats, index: 0, status: 'planned' }, 'act plan');
      deps.showToast(`Act planned: ${beats.length} ${beats.length === 1 ? 'beat' : 'beats'}. Edit act.md if you like, then Run.`);
    } catch (err) {
      setAct({ ...act(), status: 'failed', error: err && err.message ? err.message : String(err) }, 'act plan');
      deps.showToast(`Could not plan the act: ${err && err.message ? err.message : String(err)}.`);
    } finally {
      busy = false;
      deps.repaint();
    }
  }

  /** The beats from act.md, read fresh, from the current index; each one a turn. */
  async function run() {
    const cur = act();
    if (!cur || !cur.brief) { deps.showToast('No act to run. Write one: /act followed by the brief.'); return; }
    if (busy || deps.gen.isGenerating) { deps.showToast('A turn is being written. Run the act once it is done.'); return; }
    const sheet = await readSheet();
    const beats = sheet && sheet.beats.length ? sheet.beats : cur.beats;
    if (!beats || !beats.length) { deps.showToast('The act has no beats. Open act.md and write some, one per line.'); return; }
    const brief = (sheet && sheet.brief) || cur.brief;
    busy = true;
    stopRequested = false;
    let index = cur.status === 'done' ? 0 : Math.min(cur.index || 0, beats.length);
    setAct({ ...cur, brief, beats, index, status: 'running' }, 'act run');
    try {
      while (index < beats.length) {
        const beat = beats[index];
        if (beat.kind === 'you') { setAct({ ...act(), index, status: 'waiting' }, 'act run'); return; }
        const turn = beatTurn(beat, index, beats.length, brief, { narratorSpeaker: deps.narratorSpeaker, fileFor: deps.resolveFile });
        if (!turn.speaker) { index++; continue; }
        await deps.generateTurn({ speaker: turn.speaker, instruction: turn.instruction });
        if (deps.gen.lastError) { setAct({ ...act(), index, status: 'stopped' }, 'act run'); deps.showToast('The act stopped: a turn failed. Run goes on from that beat.'); return; }
        index++;
        setAct({ ...act(), index, status: stopRequested || deps.gen.stopRequested ? 'stopped' : 'running' }, 'act run');
        if (stopRequested || deps.gen.stopRequested) return;
      }
      setAct({ ...act(), index, status: 'done', finishedAt: Date.now() }, 'act done');
      try { await deps.rememberBeat(actTimelineLine(brief, beats.length)); } catch { /* the chat itself is the record */ }
      try { await deps.extractMemory(); } catch { /* the next exchange extracts */ }
      deps.showToast('The act has run. Write the next one with /act, or ask for a proposal.');
    } finally {
      busy = false;
      deps.repaint();
    }
  }

  /** The player wrote their beat: the act goes on from the next one. */
  async function continueAfterPlayer() {
    const cur = act();
    if (!cur || cur.status !== 'waiting') return false;
    setAct({ ...cur, index: (cur.index || 0) + 1, status: 'planned' }, 'act run');
    await run();
    return true;
  }

  function stop() {
    stopRequested = true;
    if (deps.gen.isGenerating) deps.gen.stopRequested = true;
    const cur = act();
    if (cur && (cur.status === 'running' || cur.status === 'waiting')) setAct({ ...cur, status: 'stopped' }, 'act stop');
  }

  /** The next act's brief, proposed from where the story stands, into the composer to edit and send. */
  async function proposeNext() {
    if (busy) return;
    busy = true;
    deps.repaint();
    try {
      const { modelId, numCtx } = await deps.model();
      const cast = deps.cast().map((c) => ({ name: c.name, tagline: c.tagline, drives: c.drives, secrets: c.secrets }));
      const messages = buildNextActMessages({ cast, memory: await deps.memory(), transcript: deps.transcript(), lastBrief: act() ? act().brief : '' });
      const brief = parseNextAct(await askForAnswer(deps.lm, modelId, messages, { temperature: 0.9, format: 'json', ...(numCtx ? { numCtx } : {}) }, 600));
      if (!brief) throw new Error('the model proposed nothing readable');
      deps.composer.set(`/act ${stripDashes(brief)}`);
    } catch (err) {
      deps.showToast(`Could not propose an act: ${err && err.message ? err.message : String(err)}.`);
    } finally {
      busy = false;
      deps.repaint();
    }
  }

  const waiting = () => { const cur = act(); return !!cur && cur.status === 'waiting'; };

  /** The panel into `host`, with the kit alone: the state, the actions, the sheet. */
  async function render(host) {
    const cur = act();
    host.replaceChildren();
    const running = !!cur && cur.status === 'running';
    const canRun = !!cur && cur.beats && cur.beats.length > 0 && !running && cur.status !== 'planning' && !busy;
    const runLabel = !cur ? 'Run' : cur.status === 'stopped' ? 'Continue' : cur.status === 'done' ? 'Run Again' : 'Run';
    const args = [deps.threadId];
    host.appendChild(deps.ui.renderMarkdown(actStatusLine(cur)));
    if (running || waiting()) deps.ui.createButton(host, { id: 'textGenerator.chat.act.stop', command: ACT_COMMANDS.stop, args, label: 'Stop', icon: 'square', size: 'sm', title: 'Stop the act after the turn being written' });
    else deps.ui.createButton(host, { id: 'textGenerator.chat.act.run', command: ACT_COMMANDS.run, args, label: runLabel, icon: 'play', size: 'sm', kind: 'primary', disabled: !canRun, title: 'Take the beats in act.md as turns, one by one' });
    if (cur && cur.brief) deps.ui.createButton(host, { id: 'textGenerator.chat.act.open', command: ACT_COMMANDS.open, args, label: 'Open act.md', icon: 'file-text', size: 'sm', title: 'Edit the beat sheet; the run reads it fresh' });
    deps.ui.createButton(host, { id: 'textGenerator.chat.act.propose', command: ACT_COMMANDS.propose, args, label: 'Propose Next Act', icon: 'sparkles', size: 'sm', disabled: busy || running, title: 'A brief for the next act, from where the story stands, put in the message box to edit and send' });
    if (cur && cur.status === 'failed' && cur.error) host.appendChild(deps.ui.renderMarkdown(`Planning failed: ${cur.error}.`));
    const sheet = cur && cur.brief ? await readSheet() : null;
    const beats = sheet && sheet.beats.length ? sheet.beats : (cur && cur.beats) || [];
    if (beats.length) {
      const done = cur ? (cur.status === 'done' ? beats.length : cur.index || 0) : 0;
      const lines = beats.map((b, i) => `${i < done ? '~~' : ''}${i + 1}. ${b.speaker}: ${b.note}${b.then ? ` (${b.then})` : ''}${i < done ? '~~' : ''}`);
      host.appendChild(deps.ui.renderMarkdown(`**${(sheet && sheet.brief) || cur.brief}**\n\n${lines.join('\n\n')}`));
    }
  }

  const runner = { plan, run, stop, continueAfterPlayer, propose: proposeNext, proposeNext, waiting, render, isBusy: () => busy, openSheet: () => deps.openFile(deps.fileUri(ACT_FILE)), release: () => { if (runners.get(deps.threadId) === runner) runners.delete(deps.threadId); } };
  runners.set(deps.threadId, runner);
  return runner;
}
