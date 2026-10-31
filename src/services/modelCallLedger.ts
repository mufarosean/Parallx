// modelCallLedger.ts — one record of every model call the app makes.
//
// Chat turns, background helpers (naming a chat, linking pages), inline AI
// and tools calling through `parallx.lm` all reach the model through the
// engine broker, and the broker reports each call here: who asked, which
// model, the prompt and answer tokens when the provider reports them, the
// time to the first output, the total time and how it ended. The user opens
// it with AI: Show Model Calls.
//
// It stays private: no prompt, answer, thinking or tool call text is ever
// read into it. A chunk is looked at only for its token counts and whether it
// carries output; an error keeps its first line, cut short.
//
// It lives in memory for this session and keeps the last MAX_MODEL_CALLS
// calls; the totals by caller count every call since the app started (or
// since Clear).

import { Disposable } from '../platform/lifecycle.js';
import { Emitter } from '../platform/events.js';
import type { Event } from '../platform/events.js';
import type { IChatResponseChunk } from './chatTypes.js';
import type { EnginePriority, EngineStart, IEngineCallTag } from './modelEngineBroker.js';

/** The ledger keeps this many calls; older ones fall off. */
export const MAX_MODEL_CALLS = 500;
/** An error keeps at most this many characters of its first line. */
export const MAX_ERROR_CHARS = 120;

export type ModelCallOutcome = 'running' | 'done' | 'stopped' | 'error';

export interface IModelCallRecord {
  readonly id: number;
  /** When the call was made (epoch ms). */
  readonly startedAt: number;
  /** Who asked: the call's label, else the tool's id, else 'Chat' or a plain description. */
  readonly caller: string;
  /** The tool that called through `parallx.lm`, by id. */
  readonly source?: string;
  readonly priority: EnginePriority;
  readonly modelId: string;
  /** The provider id the model runs on. */
  readonly engine: string;
  readonly promptTokens?: number;
  readonly answerTokens?: number;
  /** From the call to its first output (thinking counts), for the attempt that answered. */
  readonly firstTokenMs?: number;
  /** From the call to its end, waiting in the queue included. */
  readonly totalMs?: number;
  readonly outcome: ModelCallOutcome;
  /** The answer stopped at the token limit or the context window. */
  readonly cutOff?: boolean;
  /** A short reason, for an error. */
  readonly error?: string;
}

export interface IModelCallTotals {
  readonly caller: string;
  /** The tool the calls came from, when a tool made them: a label never merges one tool's calls into another caller's. */
  readonly source?: string;
  readonly calls: number;
  readonly promptTokens: number;
  readonly answerTokens: number;
  readonly totalMs: number;
  readonly errors: number;
}

export interface IModelCallLedger {
  readonly onDidChange: Event<void>;
  /** The kept calls, newest first. */
  entries(): readonly IModelCallRecord[];
  /** Calls, tokens and time by caller, most calls first. */
  totals(): readonly IModelCallTotals[];
  clear(): void;
}

/** What the broker knows about a call as it starts. */
export interface IModelCallStart {
  readonly engine: string;
  readonly modelId: string;
  readonly priority: EnginePriority;
  readonly tag?: IEngineCallTag;
}

/** One call in progress, as the broker drives it. */
export interface IModelCallRecorder {
  /** Wraps the provider start so the first output of each attempt is timed. */
  watch(start: EngineStart): EngineStart;
  /** Passes the call's output through and records how it ends. */
  track(stream: AsyncIterable<IChatResponseChunk>, signal?: AbortSignal): AsyncIterable<IChatResponseChunk>;
}

type MutableRecord = { -readonly [K in keyof IModelCallRecord]: IModelCallRecord[K] };

/** Who a call is, in words: its label, the tool that made it, or what kind of call it is. */
export function callerOf(tag: IEngineCallTag | undefined, priority: EnginePriority): string {
  const label = tag?.label?.trim();
  if (label) return label;
  if (tag?.source) return tag.source;
  if (tag?.runId) return priority === 'interactive' ? 'Chat' : 'Background run';
  return 'Unlabelled call';
}

/** The first line of an error, cut to MAX_ERROR_CHARS. */
export function shortError(err: unknown): string {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : 'Unknown error';
  const line = raw.split(/\r?\n/, 1)[0].trim() || 'Unknown error';
  return line.length > MAX_ERROR_CHARS ? `${line.slice(0, MAX_ERROR_CHARS - 1)}…` : line;
}

function isAbort(err: unknown): boolean {
  return (err instanceof DOMException || err instanceof Error) && err.name === 'AbortError';
}

function hasOutput(chunk: IChatResponseChunk): boolean {
  return !!chunk.content || !!chunk.thinking || !!chunk.toolCalls?.length;
}

export class ModelCallLedger extends Disposable implements IModelCallLedger {
  private readonly _onDidChange = this._register(new Emitter<void>());
  readonly onDidChange: Event<void> = this._onDidChange.event;

  private _nextId = 1;
  /** Oldest first. */
  private _records: MutableRecord[] = [];
  /** By caller and source: the same label from two tools (or from a tool and the app) stays two rows. */
  private readonly _totals = new Map<string, { caller: string; source?: string; calls: number; promptTokens: number; answerTokens: number; totalMs: number; errors: number }>();
  private _changeQueued = false;

  constructor(
    private readonly _now: () => number = () => Date.now(),
    private readonly _max: number = MAX_MODEL_CALLS,
  ) {
    super();
  }

  entries(): readonly IModelCallRecord[] {
    return this._records.map((r) => ({ ...r })).reverse();
  }

  totals(): readonly IModelCallTotals[] {
    return [...this._totals.values()].map((t) => ({ ...t })).sort((a, b) => b.calls - a.calls || a.caller.localeCompare(b.caller));
  }

  clear(): void {
    // A call still running stays: its end has somewhere to land.
    this._records = this._records.filter((r) => r.outcome === 'running');
    this._totals.clear();
    this._changed();
  }

  /** Starts a record; the broker calls this as a call begins. */
  begin(start: IModelCallStart): IModelCallRecorder {
    const record: MutableRecord = {
      id: this._nextId++,
      startedAt: this._now(),
      caller: callerOf(start.tag, start.priority),
      ...(start.tag?.source ? { source: start.tag.source } : {}),
      priority: start.priority,
      modelId: start.modelId,
      engine: start.engine,
      outcome: 'running',
    };
    this._records.push(record);
    if (this._records.length > this._max) this._records.splice(0, this._records.length - this._max);
    this._changed();
    const ledger = this;
    return {
      watch: (start) => (options, signal) => ledger._watchAttempt(record, start(options, signal)),
      track: (stream, signal) => ledger._track(record, stream, signal),
    };
  }

  private async *_watchAttempt(record: MutableRecord, stream: AsyncIterable<IChatResponseChunk>): AsyncIterable<IChatResponseChunk> {
    // A background call that gave way to chat starts again: time its new attempt.
    record.firstTokenMs = undefined;
    for await (const chunk of stream) {
      if (record.firstTokenMs === undefined && hasOutput(chunk)) record.firstTokenMs = Math.max(0, this._now() - record.startedAt);
      yield chunk;
    }
  }

  private async *_track(record: MutableRecord, stream: AsyncIterable<IChatResponseChunk>, signal?: AbortSignal): AsyncIterable<IChatResponseChunk> {
    let ended = false;
    let sawDone = false;
    try {
      for await (const chunk of stream) {
        if (typeof chunk.promptEvalCount === 'number') record.promptTokens = chunk.promptEvalCount;
        if (typeof chunk.evalCount === 'number') record.answerTokens = chunk.evalCount;
        if (chunk.done) sawDone = true;
        if (chunk.doneReason === 'length') record.cutOff = true;
        yield chunk;
      }
      ended = true;
      this._end(record, signal?.aborted && !sawDone ? 'stopped' : 'done');
    } catch (err) {
      ended = true;
      if (isAbort(err) || signal?.aborted) this._end(record, 'stopped');
      else this._end(record, 'error', shortError(err));
      throw err;
    } finally {
      // The caller stopped reading: after the final chunk that is a finished
      // call, before it the answer was cut short on purpose.
      if (!ended) this._end(record, sawDone ? 'done' : 'stopped');
    }
  }

  private _end(record: MutableRecord, outcome: Exclude<ModelCallOutcome, 'running'>, error?: string): void {
    if (record.outcome !== 'running') return;
    record.outcome = outcome;
    record.totalMs = Math.max(0, this._now() - record.startedAt);
    if (error) record.error = error;
    const key = `${record.caller}\u0000${record.source ?? ''}`;
    let t = this._totals.get(key);
    if (!t) { t = { caller: record.caller, ...(record.source ? { source: record.source } : {}), calls: 0, promptTokens: 0, answerTokens: 0, totalMs: 0, errors: 0 }; this._totals.set(key, t); }
    t.calls++;
    t.promptTokens += record.promptTokens ?? 0;
    t.answerTokens += record.answerTokens ?? 0;
    t.totalMs += record.totalMs;
    if (outcome === 'error') t.errors++;
    this._changed();
  }

  /** Coalesce bursts (a call's start and end in one tick) into one event. */
  private _changed(): void {
    if (this._changeQueued) return;
    this._changeQueued = true;
    queueMicrotask(() => {
      this._changeQueued = false;
      this._onDidChange.fire();
    });
  }
}
