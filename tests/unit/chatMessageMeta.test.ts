// @vitest-environment jsdom
// chatMessageMeta.test.ts — the time under a chat message, and an answer's
// line of time and speed with where the time went.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  answerMeta, appendAnswerMeta, appendMessageTime, durationLabel, fullTimeLabel, keepMessageTimesCurrent,
  messageTimeLabel, refreshMessageTimes, registerAnswerTimingCommand, speedLabel,
} from '../../src/built-in/chat/rendering/chatMessageMeta';
import { installKitCommands } from '../../src/ui/kit';
import { appTime, setAssistantTimeZone } from '../../src/platform/localTime';
import { ChatContentPartKind } from '../../src/services/chatTypes';
import type { IChatAssistantResponse, IChatUserMessage } from '../../src/services/chatTypes';

// One zone for every instant here, whatever zone the machine is in.
beforeEach(() => setAssistantTimeZone('America/Chicago'));
afterEach(() => { setAssistantTimeZone(''); vi.useRealTimers(); document.body.innerHTML = ''; });

/** Intl puts a narrow no-break space before AM/PM; the tests read it as a space. */
const plain = (s: string | null | undefined): string => (s ?? '').replace(/[  ]/g, ' ');
const at = (y: number, m: number, d: number, h: number, mi: number, s = 0): number => appTime(y, m - 1, d, h, mi, s);

const NOW = () => at(2026, 11, 13, 21, 30);

describe('messageTimeLabel', () => {
  it('is the time alone today, then says the day, then the date, then the year', () => {
    expect(plain(messageTimeLabel(at(2026, 11, 13, 21, 14), NOW()))).toBe('9:14 PM');
    expect(plain(messageTimeLabel(at(2026, 11, 13, 0, 5), NOW()))).toBe('12:05 AM');
    expect(plain(messageTimeLabel(at(2026, 11, 12, 23, 59), NOW()))).toBe('Yesterday, 11:59 PM');
    expect(plain(messageTimeLabel(at(2026, 11, 11, 21, 14), NOW()))).toBe('Nov 11, 9:14 PM');
    expect(plain(messageTimeLabel(at(2025, 11, 11, 9, 5), NOW()))).toBe('Nov 11, 2025, 9:05 AM');
  });

  it('reads the day in the app zone, not the machine\'s', () => {
    // 04:30 UTC on Nov 14 is still Nov 13 in Chicago.
    const lateEvening = Date.UTC(2026, 10, 14, 4, 30);
    expect(plain(messageTimeLabel(lateEvening, Date.UTC(2026, 10, 14, 5, 0)))).toBe('10:30 PM');
    expect(plain(fullTimeLabel(lateEvening))).toBe('Friday, November 13, 2026 at 10:30:00 PM');
  });
});

describe('durationLabel and speedLabel', () => {
  it('writes a length of time the way it is said', () => {
    expect(durationLabel(40)).toBe('0.1 s');
    expect(durationLabel(1400)).toBe('1.4 s');
    expect(durationLabel(9940)).toBe('9.9 s');
    expect(durationLabel(9960)).toBe('10 s');
    expect(durationLabel(20300)).toBe('20 s');
    expect(durationLabel(59600)).toBe('1 min');
    expect(durationLabel(72000)).toBe('1 min 12 s');
    expect(durationLabel(3600000)).toBe('1 h');
    expect(durationLabel(3840000)).toBe('1 h 4 min');
  });

  it('writes tokens a second with one decimal below a hundred', () => {
    expect(speedLabel(4.56)).toBe('4.6 tokens/s');
    expect(speedLabel(62.174)).toBe('62.2 tokens/s');
    expect(speedLabel(112.4)).toBe('112 tokens/s');
  });
});

function pair(timing?: IChatAssistantResponse['timing'], parts: IChatAssistantResponse['parts'] = [{ kind: ChatContentPartKind.Markdown, content: 'The answer.' }]): { request: IChatUserMessage; response: IChatAssistantResponse } {
  const asked = at(2026, 11, 13, 21, 14, 7);
  return {
    request: { text: 'A question', requestId: 'req-1', attempt: 0, timestamp: asked },
    response: { parts, isComplete: true, modelId: 'gemma4:31b', timestamp: asked, ...(timing ? { timing } : {}) },
  };
}

describe('answerMeta', () => {
  it('says when, how long and how fast, and lists where the time went', () => {
    const asked = at(2026, 11, 13, 21, 14, 7);
    const { request, response } = pair(
      { firstWordAt: asked + 1400, completedAt: asked + 20300, calls: 2, writtenTokens: 1040, timedTokens: 1040, writingMs: 16730, readTokens: 21400, readingMs: 6100, loadingMs: 38200 },
      [
        { kind: ChatContentPartKind.Thinking, content: 'Let me think.', isCollapsed: true, startTime: asked + 1400, endTime: asked + 13700 },
        { kind: ChatContentPartKind.Thinking, content: '', isCollapsed: true, progressMessage: undefined, startTime: asked, endTime: asked + 900 }, // a status line, not reasoning
        { kind: ChatContentPartKind.Markdown, content: 'The answer.' },
      ],
    );
    const meta = answerMeta(request, response, NOW());
    expect(plain(meta.line)).toBe('9:14 PM · 20 s · 62.2 tokens/s');
    expect(plain(meta.spoken)).toBe('Time and speed of this answer, answered 9:14 PM, took 20 s, 62.2 tokens a second');
    expect(meta.details.map(([name, value]) => [name, plain(value)])).toEqual([
      ['Asked', 'Friday, November 13, 2026 at 9:14:07 PM'],
      ['Answered', 'Friday, November 13, 2026 at 9:14:27 PM'],
      ['First word', 'after 1.4 s'],
      ['Whole answer', '20 s'],
      ['Speed', '62.2 tokens/s'],
      ['Written', '1,040 tokens in 17 s, reasoning included'],
      ['Prompt read', '21,400 tokens in 6.1 s'],
      ['Model loaded', 'in 38 s'],
      ['Reasoning', '12 s'],
      ['Model', 'gemma4:31b, 2 calls'],
    ]);
  });

  it('shows the time alone for an answer kept before timing was (and for one with no figures)', () => {
    const { request, response } = pair();
    const meta = answerMeta(request, response, NOW());
    expect(plain(meta.line)).toBe('9:14 PM');
    expect(meta.details.map(([name]) => name)).toEqual(['Asked', 'Model']);
  });

  it('shows no speed for an engine that reports tokens and no writing time, and none is made up', () => {
    const asked = at(2026, 11, 13, 21, 14, 7);
    const { request, response } = pair({ firstWordAt: asked + 800, completedAt: asked + 9000, calls: 1, writtenTokens: 640, readTokens: 1200 });
    const meta = answerMeta(request, response, NOW());
    expect(plain(meta.line)).toBe('9:14 PM · 9.0 s');
    expect(meta.details.find(([name]) => name === 'Speed')).toBeUndefined();
    expect(meta.details.find(([name]) => name === 'Written')?.[1]).toBe('640 tokens');
    expect(meta.details.find(([name]) => name === 'Prompt read')?.[1]).toBe('1,200 tokens');
  });

  it('says the count includes the reasoning whenever the answer has any, however short it was', () => {
    const asked = at(2026, 11, 13, 21, 14, 7);
    const timing = { completedAt: asked + 5000, calls: 1, writtenTokens: 282, timedTokens: 282, writingMs: 4536 };
    const instant = pair(timing, [
      { kind: ChatContentPartKind.Thinking, content: 'A short answer will do.', isCollapsed: true, startTime: asked + 60, endTime: asked + 60 },
      { kind: ChatContentPartKind.Markdown, content: 'The answer.' },
    ]);
    const details = answerMeta(instant.request, instant.response, NOW()).details;
    expect(details.find(([name]) => name === 'Written')?.[1]).toBe('282 tokens in 4.5 s, reasoning included');
    expect(details.find(([name]) => name === 'Reasoning')).toBeUndefined(); // no time worth a row
    const none = pair(timing);
    expect(answerMeta(none.request, none.response, NOW()).details.find(([name]) => name === 'Written')?.[1]).toBe('282 tokens in 4.5 s');
  });

  it('leaves out a model load too short to notice', () => {
    const asked = at(2026, 11, 13, 21, 14, 7);
    const { request, response } = pair({ completedAt: asked + 5000, calls: 1, writtenTokens: 100, timedTokens: 100, writingMs: 2000, loadingMs: 40 });
    expect(answerMeta(request, response, NOW()).details.find(([name]) => name === 'Model loaded')).toBeUndefined();
  });
});

describe('on the page', () => {
  /** A command service like the app's: the kit's button runs the registered command through it. */
  function commands() {
    const map = new Map<string, (...args: unknown[]) => unknown>();
    installKitCommands({ executeCommand: async (id, ...args) => map.get(id)?.(...args) });
    return { map, registerCommand: (id: string, handler: (...args: unknown[]) => unknown) => { map.set(id, handler); return { dispose: () => { map.delete(id); } }; } };
  }

  it('puts the time under a sent message, with the whole date and time on hover', () => {
    vi.useFakeTimers({ now: NOW() });
    const root = document.createElement('div');
    appendMessageTime(root, at(2026, 11, 13, 21, 14, 7));
    const time = root.querySelector('.parallx-chat-message-time') as HTMLElement;
    expect(plain(time.textContent)).toBe('9:14 PM');
    expect(plain(time.title)).toBe('Friday, November 13, 2026 at 9:14:07 PM');
    appendMessageTime(root, 0); // a message with no time gets no stamp
    expect(root.querySelectorAll('.parallx-chat-message-time')).toHaveLength(1);
  });

  it('puts an answer\'s line in its row of actions as a button that opens the details, by its command', async () => {
    vi.useFakeTimers({ now: NOW() });
    const c = commands();
    registerAnswerTimingCommand(c);
    const asked = at(2026, 11, 13, 21, 14, 7);
    const { request, response } = pair({ firstWordAt: asked + 1400, completedAt: asked + 20300, calls: 1, writtenTokens: 1040, timedTokens: 1040, writingMs: 16730 });
    const actions = document.createElement('div');
    document.body.appendChild(actions);
    appendAnswerMeta(actions, request, response);

    const button = actions.querySelector('button.parallx-chat-meta') as HTMLButtonElement;
    const details = document.getElementById(button.getAttribute('aria-controls')!) as HTMLElement;
    expect(plain(button.textContent)).toBe('9:14 PM · 20 s · 62.2 tokens/s');
    expect(plain(button.getAttribute('aria-label'))).toContain('took 20 s, 62.2 tokens a second');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(details.hidden).toBe(true);
    expect([...details.querySelectorAll('th')].map((th) => th.textContent)).toEqual(['Asked', 'Answered', 'First word', 'Whole answer', 'Speed', 'Written', 'Model']);
    expect(details.querySelector('th')!.getAttribute('scope')).toBe('row');

    button.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(details.hidden).toBe(false);
    button.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(details.hidden).toBe(true);
  });

  it('the command opens only an answer\'s details, nothing else on the page', () => {
    const c = commands();
    registerAnswerTimingCommand(c);
    const other = document.createElement('div');
    other.id = 'something-else';
    document.body.appendChild(other);
    const run = c.map.get('chat.toggleAnswerTiming')!;
    expect(run('something-else')).toBe(false);
    expect(run('"] , body, [x="')).toBe(false);
    expect(run(42)).toBe(false);
    expect(other.hidden).toBe(false);
  });

  it('rewrites the times when the day turns', () => {
    vi.useFakeTimers({ now: NOW() });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const asked = at(2026, 11, 13, 21, 14, 7);
    appendMessageTime(container, asked);
    const { request, response } = pair({ completedAt: asked + 20300, calls: 1, writtenTokens: 1040, timedTokens: 1040, writingMs: 16730 });
    appendAnswerMeta(container, request, response);
    const keep = keepMessageTimesCurrent(container);
    const time = container.querySelector('.parallx-chat-message-time') as HTMLElement;
    const button = container.querySelector('button.parallx-chat-meta') as HTMLButtonElement;

    vi.advanceTimersByTime(2 * 60 * 60 * 1000); // 23:30: still today
    expect(plain(time.textContent)).toBe('9:14 PM');
    vi.advanceTimersByTime(31 * 60 * 1000 + 2000); // past midnight
    expect(plain(time.textContent)).toBe('Yesterday, 9:14 PM');
    expect(plain(button.textContent)).toBe('Yesterday, 9:14 PM · 20 s · 62.2 tokens/s');
    expect(plain(button.getAttribute('aria-label'))).toContain('answered Yesterday, 9:14 PM');
    vi.advanceTimersByTime(24 * 60 * 60 * 1000); // the timer is set again each day
    expect(plain(time.textContent)).toBe('Nov 13, 9:14 PM');

    keep.dispose();
    refreshMessageTimes(container, at(2027, 1, 2, 8, 0));
    expect(plain(time.textContent)).toBe('Nov 13, 2026, 9:14 PM');
  });
});
