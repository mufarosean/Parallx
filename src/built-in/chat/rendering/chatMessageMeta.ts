// chatMessageMeta.ts — the quiet line under a chat message: when it was sent,
// and for an answer how long it took and how fast the model wrote it.
//
// A message the user sent shows its time. An answer shows, beside its actions,
// one small button: the time it was finished, how long it took from the
// moment the message was sent, and tokens a second. Opened, it lists where
// the time went: the first word, the prompt the engine read, a model that had
// to be loaded first, the reasoning, the number of model calls.
//
// Speed is the engine's own figure (chatResponseTiming.ts): tokens it wrote
// over the time it spent writing them, summed over the answer's model calls.
// An engine that reports no writing time shows no speed; none is worked out
// from the app's clock. The times are the app's clock and hold for any model.
//
// A time is written for the day it is read on ("9:14 PM", then "Yesterday,
// 9:14 PM", then "Nov 11, 9:14 PM"), so the stamps on screen are rewritten
// when the day turns (keepMessageTimesCurrent).

import { createBlock, createButton } from '../../../ui/kit.js';
import type { IDisposable } from '../../../platform/lifecycle.js';
import { addAppDays, appDateString, appDateTimeString, appTimeString, isSameAppDay, startOfAppDay } from '../../../platform/localTime.js';
import { tokensPerSecond } from '../../../services/chatResponseTiming.js';
import { ChatContentPartKind } from '../../../services/chatTypes.js';
import type { IChatAssistantResponse, IChatThinkingContent, IChatUserMessage } from '../../../services/chatTypes.js';
import './chatMessageMeta.css';

// ── Words ────────────────────────────────────────────────────────────────────

/** When a message was sent, as short as the day allows: "9:14 PM" today, "Yesterday, 9:14 PM", "Nov 11, 9:14 PM", "Nov 11, 2025, 9:14 PM". */
export function messageTimeLabel(at: number, now: number = Date.now()): string {
  const time = appTimeString(at, { hour: 'numeric', minute: '2-digit' });
  if (isSameAppDay(at, now)) return time;
  if (isSameAppDay(at, addAppDays(now, -1))) return `Yesterday, ${time}`;
  const sameYear = appDateString(at, { year: 'numeric' }) === appDateString(now, { year: 'numeric' });
  const date = appDateString(at, sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
  return `${date}, ${time}`;
}

/** The whole date and time, to the second: the tooltip, and the details. */
export function fullTimeLabel(at: number): string {
  return appDateTimeString(at, { dateStyle: 'full', timeStyle: 'medium' });
}

/** A length of time: "0.4 s", "1.4 s", "20 s", "1 min 12 s", "1 h 4 min". */
export function durationLabel(ms: number): string {
  const seconds = Math.max(0, ms) / 1000;
  if (seconds < 9.95) return `${Math.max(0.1, Math.round(seconds * 10) / 10).toFixed(1)} s`;
  if (seconds < 59.5) return `${Math.round(seconds)} s`;
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  if (h > 0) return m ? `${h} h ${m} min` : `${h} h`;
  return s ? `${m} min ${s} s` : `${m} min`;
}

/** Tokens a second: one decimal below a hundred, whole above. */
export function speedLabel(tokensPerSec: number): string {
  return `${tokensPerSec >= 99.95 ? String(Math.round(tokensPerSec)) : tokensPerSec.toFixed(1)} tokens/s`;
}

const count = (n: number): string => Math.round(n).toLocaleString('en-US');

/** Whether the answer has reasoning, and the time the model spent on it, from the bursts the answer kept (a burst that only carried a status line is not reasoning). */
function reasoningOf(response: IChatAssistantResponse): { any: boolean; ms: number } {
  let any = false, ms = 0;
  for (const part of response.parts) {
    if (part.kind !== ChatContentPartKind.Thinking) continue;
    const t = part as IChatThinkingContent;
    if (!t.content) continue;
    any = true;
    if (t.startTime != null && t.endTime != null && t.endTime > t.startTime) ms += t.endTime - t.startTime;
  }
  return { any, ms };
}

export interface IAnswerMeta {
  /** The quiet line: when, how long, how fast. */
  readonly line: string;
  /** The same in words, for a screen reader. */
  readonly spoken: string;
  /** Where the time went, as rows of a name and a value. */
  readonly details: ReadonlyArray<readonly [string, string]>;
}

/** What is said under an answer. Parts the answer has no figure for are left out. */
export function answerMeta(request: IChatUserMessage, response: IChatAssistantResponse, now: number = Date.now()): IAnswerMeta {
  const t = response.timing ?? {};
  const asked = request.timestamp;
  const answered = t.completedAt ?? response.timestamp;
  const took = t.completedAt !== undefined && t.completedAt >= asked ? t.completedAt - asked : undefined;
  const speed = tokensPerSecond(t);
  const when = messageTimeLabel(answered, now);

  const line = [when, took !== undefined ? durationLabel(took) : '', speed !== undefined ? speedLabel(speed) : ''].filter(Boolean).join(' · ');
  const spoken = ['Time and speed of this answer', `answered ${when}`, took !== undefined ? `took ${durationLabel(took)}` : '',
    speed !== undefined ? `${speedLabel(speed).replace('tokens/s', 'tokens a second')}` : ''].filter(Boolean).join(', ');

  const details: Array<readonly [string, string]> = [['Asked', fullTimeLabel(asked)]];
  if (t.completedAt !== undefined) details.push(['Answered', fullTimeLabel(t.completedAt)]);
  if (t.firstWordAt !== undefined && t.firstWordAt >= asked) details.push(['First word', `after ${durationLabel(t.firstWordAt - asked)}`]);
  if (took !== undefined) details.push(['Whole answer', durationLabel(took)]);
  if (speed !== undefined) details.push(['Speed', speedLabel(speed)]);
  const thought = reasoningOf(response);
  if (t.writtenTokens) {
    const timed = t.writingMs && t.timedTokens === t.writtenTokens ? ` in ${durationLabel(t.writingMs)}` : '';
    details.push(['Written', `${count(t.writtenTokens)} tokens${timed}${thought.any ? ', reasoning included' : ''}`]);
  }
  if (t.readTokens) details.push(['Prompt read', `${count(t.readTokens)} tokens${t.readingMs ? ` in ${durationLabel(t.readingMs)}` : ''}`]);
  if (t.loadingMs !== undefined && t.loadingMs >= 1000) details.push(['Model loaded', `in ${durationLabel(t.loadingMs)}`]);
  if (thought.ms >= 100) details.push(['Reasoning', durationLabel(thought.ms)]);
  if (response.modelId) details.push(['Model', (t.calls ?? 0) > 1 ? `${response.modelId}, ${t.calls} calls` : response.modelId]);
  return { line, spoken, details };
}

// ── On the page ──────────────────────────────────────────────────────────────

const STAMP = 'data-chat-time';

/** The time under a message the user sent; its whole date and time on hover. */
export function appendMessageTime(root: HTMLElement, at: number): void {
  if (!Number.isFinite(at) || at <= 0) return;
  createBlock(root, 'div', { className: 'parallx-chat-message-time', text: messageTimeLabel(at), attrs: { title: fullTimeLabel(at), [STAMP]: String(at) } });
}

let seq = 0;
const TOGGLE_COMMAND = 'chat.toggleAnswerTiming';

/**
 * chat.toggleAnswerTiming (id): opens or closes the details under one answer's
 * line of time and speed. Returns whether they are open now; false for an id
 * that is not such a line's.
 */
export function registerAnswerTimingCommand(commands: { registerCommand(id: string, handler: (...args: unknown[]) => unknown): IDisposable }): IDisposable {
  return commands.registerCommand(TOGGLE_COMMAND, (id: unknown) => {
    const details = typeof id === 'string' ? document.getElementById(id) : null;
    const button = Array.from(document.querySelectorAll<HTMLElement>('.parallx-chat-meta')).find((b) => b.getAttribute('aria-controls') === id);
    if (!details || !button || !details.classList.contains('parallx-chat-meta-details')) return false;
    const open = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', String(open));
    details.hidden = !open;
    return open;
  });
}

/**
 * Under an answer, in its row of actions: the line of time and speed, a
 * button that opens to where the time went.
 */
export function appendAnswerMeta(actions: HTMLElement, request: IChatUserMessage, response: IChatAssistantResponse): void {
  const meta = answerMeta(request, response);
  const detailsId = `parallx-chat-meta-${++seq}`;
  actions.classList.add('parallx-chat-message-footer');
  const button = createButton(actions, {
    id: null, label: meta.line, kind: 'ghost', size: 'sm', icon: 'chevron-right', title: 'Where The Time Went',
    command: TOGGLE_COMMAND, args: [detailsId],
  });
  button.classList.add('parallx-chat-meta');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', detailsId);
  button.setAttribute('aria-label', meta.spoken);
  // The line and its spoken form are rewritten when the day turns: what they are made of rides on the button.
  button.setAttribute(STAMP, String(response.timing?.completedAt ?? response.timestamp));
  (button as IMetaButton).__parallxMeta = (now) => answerMeta(request, response, now);

  const details = createBlock(actions, 'div', { className: 'parallx-chat-meta-details', attrs: { id: detailsId } });
  details.hidden = true;
  const table = createBlock(details, 'table', { attrs: { 'aria-label': 'Time and speed of this answer' } });
  const body = createBlock(table, 'tbody');
  for (const [name, value] of meta.details) {
    const row = createBlock(body, 'tr');
    createBlock(row, 'th', { text: name, attrs: { scope: 'row' } });
    createBlock(row, 'td', { text: value });
  }
}

interface IMetaButton extends HTMLButtonElement { __parallxMeta?: (now: number) => IAnswerMeta; }

/** Rewrite every time under `container` for the day it is now. */
export function refreshMessageTimes(container: HTMLElement, now: number = Date.now()): void {
  for (const el of Array.from(container.querySelectorAll<HTMLElement>(`[${STAMP}]`))) {
    const remake = (el as IMetaButton).__parallxMeta;
    if (remake) {
      const meta = remake(now);
      const label = el.querySelector('.px-btn__label');
      if (label) label.textContent = meta.line;
      el.setAttribute('aria-label', meta.spoken);
      continue;
    }
    const at = Number(el.getAttribute(STAMP));
    if (Number.isFinite(at) && at > 0) el.textContent = messageTimeLabel(at, now);
  }
}

/**
 * Keeps the times under `container` right across midnight: a moment after the
 * user's day turns, "9:14 PM" becomes "Yesterday, 9:14 PM". One timer, set
 * again each day, gone when the returned handle is disposed.
 */
export function keepMessageTimesCurrent(container: HTMLElement): IDisposable {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = (): void => {
    const now = Date.now();
    const nextDay = startOfAppDay(addAppDays(now, 1));
    timer = setTimeout(() => { refreshMessageTimes(container); arm(); }, Math.max(1000, nextDay - now + 1000));
  };
  arm();
  return { dispose: () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; } };
}
