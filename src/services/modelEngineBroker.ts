// modelEngineBroker.ts — one door to each local model engine (docs/AGENT_RUNTIME_DESIGN.md).
//
// Every model call is a ticket with a priority class. For an engine that
// runs on this machine (Ollama: one GPU, often one request at a time) the
// broker decides who goes next:
//
//   interactive  your chat turn, inline AI, panes, extensions (the default)
//   resumed      a run you just answered
//   scheduled    routines, the heartbeat, scheduled jobs, dashboard refreshes
//   helper       runs spawned by a background run
//   maintenance  indexing and warm-ups
//
// Interactive calls stream straight through; they are never queued behind
// each other (the server orders them, as before) and never behind background
// work. Everything else waits while an interactive call runs, while a chat
// turn holds the engine's lease (its whole turn, tool steps included, plus a
// short grace), and while you are typing in chat. A background call already
// on the engine when chat arrives is preempted: its HTTP request is aborted
// for real and the ticket goes back in the queue. Background output is
// buffered until the call completes, so a preempted call simply resolves
// later with a clean answer: the run never sees the pause.
//
// Engines that are not local (cloud providers) pass through untouched.

import { Disposable, toDisposable } from '../platform/lifecycle.js';
import type { IDisposable } from '../platform/lifecycle.js';
import { Emitter } from '../platform/events.js';
import type { Event } from '../platform/events.js';
import type { IChatRequestOptions, IChatResponseChunk } from './chatTypes.js';

export type EnginePriority = 'interactive' | 'resumed' | 'scheduled' | 'helper' | 'maintenance';

const RANK: Record<EnginePriority, number> = { interactive: 0, resumed: 1, scheduled: 2, helper: 3, maintenance: 4 };

/** After a chat turn ends, background work waits this long (you may reply). */
export const LEASE_GRACE_MS = 4_000;
/** Typing in chat holds background work this long after each keystroke. */
export const TYPING_HOLD_MS = 4_000;
/** Output cap for a background call that names none (thinking counts too). */
export const BACKGROUND_MAX_TOKENS = 8_192;

/** How a caller tags a call (IChatRequestOptions.engine). */
export interface IEngineCallTag {
  /** The run (chat or ephemeral session) this call belongs to. */
  readonly runId?: string;
  /** Explicit class; otherwise the classifier decides from runId. */
  readonly priority?: EnginePriority;
  /** Short words for the Agents view ("Morning Brief"). */
  readonly label?: string;
}

export interface IEngineRequest {
  /** Gate key: the provider id ('ollama'). */
  readonly engine: string;
  /** Local engines are gated; others pass through. */
  readonly gated: boolean;
  readonly modelId: string;
  readonly options?: IChatRequestOptions;
  /** The caller's cancel. */
  readonly signal?: AbortSignal;
}

export type EngineStart = (options: IChatRequestOptions | undefined, signal: AbortSignal) => AsyncIterable<IChatResponseChunk>;

export type RunEngineState = 'waiting' | 'working';

export interface IEngineTicketInfo {
  readonly id: number;
  readonly runId?: string;
  readonly label?: string;
  readonly priority: EnginePriority;
  readonly modelId: string;
  /** When it last started waiting (queued) or started on the engine (running). */
  readonly since: number;
  /** Times it gave way to chat. */
  readonly preemptions: number;
}

export interface IEngineSnapshot {
  readonly engine: string;
  readonly running: readonly IEngineTicketInfo[];
  readonly queued: readonly IEngineTicketInfo[];
  /** A chat turn holds the engine (or its grace or typing hold is on). */
  readonly held: boolean;
}

export interface IModelEngineBroker {
  readonly onDidChange: Event<void>;
  /** Route one model call. Yields what `start` yields, in the broker's order. */
  request(req: IEngineRequest, start: EngineStart): AsyncIterable<IChatResponseChunk>;
  /**
   * A chat turn takes the engine for its whole duration. Dispose to let go;
   * background work resumes after the grace period.
   */
  beginInteractive(engine: string): IDisposable;
  /** You are typing in chat: hold background work a moment longer. */
  noteUserActivity(): void;
  /** Decide a call's class from its run id (set by the chat service). */
  setClassifier(fn: ((runId: string) => EnginePriority | undefined) | undefined): void;
  /** Where a run stands right now, if it has a call in flight. */
  getRunState(runId: string): RunEngineState | undefined;
  /** Total time a run has spent waiting for the engine (not working). */
  waitingMs(runId: string): number;
  /** Times a run gave way to chat. */
  preemptions(runId: string): number;
  /** Drop a run's bookkeeping once it is over. */
  forgetRun(runId: string): void;
  snapshot(engine?: string): readonly IEngineSnapshot[];
  /** The model and context size last sent to an engine (what it has loaded). */
  loadedShape(engine: string): { readonly modelId: string; readonly numCtx: number } | undefined;
}

/** Concurrency for background tickets on one engine. Learned later; 1 until proven. */
export type ConcurrencyFn = (engine: string, modelId: string) => number;

interface ITicket {
  readonly id: number;
  readonly engine: string;
  readonly modelId: string;
  readonly runId?: string;
  readonly label?: string;
  readonly priority: EnginePriority;
  readonly enqueuedAt: number;
  since: number;
  state: 'queued' | 'running' | 'done';
  preemptions: number;
  /** Aborts the provider call (preempt or caller cancel). */
  controller?: AbortController;
  preempted: boolean;
  grant?: () => void;
}

interface IRunBook {
  waitingMs: number;
  waitingSince?: number;
  inFlight: number;
  queued: number;
  preemptions: number;
  touched: number;
}

function abortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError');
}

export class ModelEngineBroker extends Disposable implements IModelEngineBroker {
  private readonly _onDidChange = this._register(new Emitter<void>());
  readonly onDidChange: Event<void> = this._onDidChange.event;

  private _nextId = 1;
  private readonly _tickets = new Set<ITicket>();
  /** Open chat-turn leases per engine. */
  private readonly _leases = new Map<string, number>();
  /** Background waits until this time per engine (lease grace). */
  private readonly _holdUntil = new Map<string, number>();
  private _typingUntil = 0;
  private _timer: ReturnType<typeof setTimeout> | undefined;
  private _classifier: ((runId: string) => EnginePriority | undefined) | undefined;
  private readonly _runs = new Map<string, IRunBook>();
  private readonly _shape = new Map<string, { modelId: string; numCtx: number }>();
  private _changeQueued = false;

  constructor(
    private readonly _concurrency: ConcurrencyFn = () => 1,
    private readonly _now: () => number = () => Date.now(),
  ) {
    super();
    this._register(toDisposable(() => { if (this._timer) clearTimeout(this._timer); }));
  }

  setClassifier(fn: ((runId: string) => EnginePriority | undefined) | undefined): void {
    this._classifier = fn;
  }

  // ── Classification ──

  private _classify(tag: IEngineCallTag | undefined): EnginePriority {
    if (tag?.priority && tag.priority in RANK) return tag.priority;
    if (tag?.runId && this._classifier) {
      try {
        const p = this._classifier(tag.runId);
        if (p) return p;
      } catch { /* a broken classifier must not stop chat */ }
    }
    return 'interactive';
  }

  // ── Requests ──

  async *request(req: IEngineRequest, start: EngineStart): AsyncIterable<IChatResponseChunk> {
    const tag = req.options?.engine;
    const priority = this._classify(tag);
    const options = this._policy(req, priority);
    if (options?.numCtx && options.numCtx > 0) this._shape.set(req.engine, { modelId: req.modelId, numCtx: options.numCtx });

    if (!req.gated) {
      yield* start(options, req.signal ?? new AbortController().signal);
      return;
    }

    const now = this._now();
    const ticket: ITicket = {
      id: this._nextId++,
      engine: req.engine,
      modelId: req.modelId,
      runId: tag?.runId,
      label: tag?.label,
      priority,
      enqueuedAt: now,
      since: now,
      state: 'queued',
      preemptions: 0,
      preempted: false,
    };

    if (priority === 'interactive') {
      yield* this._runInteractive(ticket, req, options, start);
    } else {
      yield* this._runBackground(ticket, req, options, start);
    }
  }

  /** Streams straight through; preempts background work on its engine. */
  private async *_runInteractive(ticket: ITicket, req: IEngineRequest, options: IChatRequestOptions | undefined, start: EngineStart): AsyncIterable<IChatResponseChunk> {
    const controller = new AbortController();
    const onCallerAbort = () => controller.abort();
    if (req.signal?.aborted) throw abortError();
    req.signal?.addEventListener('abort', onCallerAbort, { once: true });
    ticket.controller = controller;
    ticket.state = 'running';
    this._tickets.add(ticket);
    this._book(ticket.runId, (b) => { b.inFlight++; });
    this._preemptBackground(ticket.engine);
    this._changed();
    try {
      yield* start(options, controller.signal);
    } finally {
      req.signal?.removeEventListener('abort', onCallerAbort);
      // A consumer that stops early must not leave the generation running.
      controller.abort();
      this._finish(ticket);
    }
  }

  /** Waits its turn, buffers, and retries transparently after a preemption. */
  private async *_runBackground(ticket: ITicket, req: IEngineRequest, options: IChatRequestOptions | undefined, start: EngineStart): AsyncIterable<IChatResponseChunk> {
    if (req.signal?.aborted) throw abortError();
    this._tickets.add(ticket);
    this._book(ticket.runId, (b) => { b.queued++; b.waitingSince ??= this._now(); });
    let buffer: IChatResponseChunk[] | undefined;
    try {
      while (!buffer) {
        await this._waitForGrant(ticket, req.signal);
        const controller = new AbortController();
        ticket.controller = controller;
        ticket.preempted = false;
        const onCallerAbort = () => controller.abort();
        req.signal?.addEventListener('abort', onCallerAbort, { once: true });
        const out: IChatResponseChunk[] = [];
        try {
          for await (const chunk of start(options, controller.signal)) {
            if (ticket.preempted) break;
            out.push(chunk);
          }
          if (!ticket.preempted) {
            if (req.signal?.aborted) throw abortError();
            buffer = out;
          }
        } catch (err) {
          if (req.signal?.aborted) throw abortError();
          // Whatever a preempted call throws (AbortError, a network error
          // from the closed socket), it is a pause, not a failure.
          if (!ticket.preempted) throw err;
        } finally {
          req.signal?.removeEventListener('abort', onCallerAbort);
          controller.abort();
        }
        if (!buffer) this._requeue(ticket);
      }
    } finally {
      this._finish(ticket);
    }
    for (const chunk of buffer) yield chunk;
  }

  private _waitForGrant(ticket: ITicket, signal: AbortSignal | undefined): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        ticket.grant = undefined;
        reject(abortError());
        this._pump();
      };
      if (signal?.aborted) { reject(abortError()); return; }
      signal?.addEventListener('abort', onAbort, { once: true });
      ticket.grant = () => {
        signal?.removeEventListener('abort', onAbort);
        ticket.grant = undefined;
        resolve();
      };
      this._changed();
      this._pump();
    });
  }

  private _requeue(ticket: ITicket): void {
    ticket.state = 'queued';
    ticket.since = this._now();
    ticket.controller = undefined;
    this._book(ticket.runId, (b) => { b.inFlight = Math.max(0, b.inFlight - 1); b.queued++; b.waitingSince ??= this._now(); });
    this._changed();
  }

  private _finish(ticket: ITicket): void {
    if (ticket.state === 'done') return;
    const was = ticket.state;
    ticket.state = 'done';
    ticket.grant = undefined;
    this._tickets.delete(ticket);
    this._book(ticket.runId, (b) => {
      if (was === 'running') b.inFlight = Math.max(0, b.inFlight - 1);
      else b.queued = Math.max(0, b.queued - 1);
      if (b.queued === 0 && b.waitingSince !== undefined) {
        b.waitingMs += this._now() - b.waitingSince;
        b.waitingSince = undefined;
      }
    });
    this._changed();
    this._pump();
  }

  // ── Scheduling ──

  /** Grant queued background tickets whose engine is free. */
  private _pump(): void {
    if (this._timer) { clearTimeout(this._timer); this._timer = undefined; }
    const now = this._now();
    let wakeAt = Infinity;
    const engines = new Set([...this._tickets].map((t) => t.engine));
    for (const engine of engines) {
      const blockedUntil = this._blockedUntil(engine, now);
      if (blockedUntil === Infinity) continue; // a lease or interactive call; its end pumps
      if (blockedUntil > now) { wakeAt = Math.min(wakeAt, blockedUntil); continue; }
      const queued = [...this._tickets]
        .filter((t) => t.engine === engine && t.state === 'queued' && t.grant)
        .sort((a, b) => RANK[a.priority] - RANK[b.priority] || a.enqueuedAt - b.enqueuedAt || a.id - b.id);
      for (const t of queued) {
        const running = [...this._tickets].filter((r) => r.engine === engine && r.state === 'running').length;
        if (running >= Math.max(1, this._concurrency(engine, t.modelId))) break;
        t.state = 'running';
        t.since = now;
        this._book(t.runId, (b) => {
          b.queued = Math.max(0, b.queued - 1);
          b.inFlight++;
          if (b.queued === 0 && b.waitingSince !== undefined) {
            b.waitingMs += now - b.waitingSince;
            b.waitingSince = undefined;
          }
        });
        const grant = t.grant;
        grant?.();
        this._changed();
      }
    }
    if (wakeAt < Infinity) {
      this._timer = setTimeout(() => { this._timer = undefined; this._pump(); }, Math.max(0, wakeAt - now) + 5);
    }
  }

  /** 0 = free now; a time = free then; Infinity = held until something ends. */
  private _blockedUntil(engine: string, now: number): number {
    if ((this._leases.get(engine) ?? 0) > 0) return Infinity;
    for (const t of this._tickets) {
      if (t.engine === engine && t.priority === 'interactive' && t.state === 'running') return Infinity;
    }
    const hold = Math.max(this._holdUntil.get(engine) ?? 0, this._typingUntil);
    return hold > now ? hold : 0;
  }

  private _preemptBackground(engine: string): void {
    for (const t of this._tickets) {
      if (t.engine !== engine || t.priority === 'interactive' || t.state !== 'running' || t.preempted) continue;
      t.preempted = true;
      t.preemptions++;
      this._book(t.runId, (b) => { b.preemptions++; });
      t.controller?.abort();
    }
  }

  // ── Lease ──

  beginInteractive(engine: string): IDisposable {
    this._leases.set(engine, (this._leases.get(engine) ?? 0) + 1);
    this._preemptBackground(engine);
    this._changed();
    let released = false;
    return toDisposable(() => {
      if (released) return;
      released = true;
      const n = (this._leases.get(engine) ?? 1) - 1;
      if (n > 0) this._leases.set(engine, n); else this._leases.delete(engine);
      this._holdUntil.set(engine, this._now() + LEASE_GRACE_MS);
      this._changed();
      this._pump();
    });
  }

  noteUserActivity(): void {
    this._typingUntil = this._now() + TYPING_HOLD_MS;
    // Typing does not stop work already running; it only keeps the queue
    // still so a reply you are writing finds the engine free.
    if ([...this._tickets].some((t) => t.state === 'queued')) this._pump();
  }

  // ── Policy ──

  /**
   * Per-class request shaping.
   *
   * Loaded shape: a model loaded at one context size reloads (seconds, and
   * the prompt cache is lost) when a request names another. Your chat
   * turns set the size. Everyone else (background runs, extensions, inline
   * AI) adopts the loaded size when theirs is smaller or unnamed: a bigger
   * window costs nothing once loaded, and their prompt budget stays their
   * own. A background call that needs more than is loaded keeps its size;
   * it only ever runs while chat is idle, so the reload never lands on you.
   *
   * Output cap: background calls that name no cap get one (thinking counts).
   */
  private _policy(req: IEngineRequest, priority: EnginePriority): IChatRequestOptions | undefined {
    let options = req.options;
    const setsShape = priority === 'interactive' && !!options?.engine?.runId;
    const loaded = this._shape.get(req.engine);
    if (!setsShape && loaded && loaded.modelId === req.modelId) {
      const asked = options?.numCtx ?? 0;
      if (asked < loaded.numCtx) options = { ...(options ?? {}), numCtx: loaded.numCtx };
    }
    if (priority !== 'interactive' && !(options?.maxTokens && options.maxTokens > 0)) {
      options = { ...(options ?? {}), maxTokens: BACKGROUND_MAX_TOKENS };
    }
    return options;
  }

  /** The model and context size last sent to an engine (what it has loaded). */
  loadedShape(engine: string): { readonly modelId: string; readonly numCtx: number } | undefined {
    return this._shape.get(engine);
  }

  // ── Runs ──

  private _book(runId: string | undefined, fn: (b: IRunBook) => void): void {
    if (!runId) return;
    let b = this._runs.get(runId);
    if (!b) {
      b = { waitingMs: 0, inFlight: 0, queued: 0, preemptions: 0, touched: 0 };
      this._runs.set(runId, b);
    }
    fn(b);
    b.touched = this._now();
    if (this._runs.size > 500) this._pruneRuns();
  }

  private _pruneRuns(): void {
    const cutoff = this._now() - 60 * 60_000;
    for (const [id, b] of this._runs) {
      if (b.inFlight === 0 && b.queued === 0 && b.touched < cutoff) this._runs.delete(id);
    }
  }

  getRunState(runId: string): RunEngineState | undefined {
    const b = this._runs.get(runId);
    if (!b) return undefined;
    if (b.queued > 0) return 'waiting';
    if (b.inFlight > 0) return 'working';
    return undefined;
  }

  waitingMs(runId: string): number {
    const b = this._runs.get(runId);
    if (!b) return 0;
    return b.waitingMs + (b.waitingSince !== undefined ? this._now() - b.waitingSince : 0);
  }

  preemptions(runId: string): number {
    return this._runs.get(runId)?.preemptions ?? 0;
  }

  forgetRun(runId: string): void {
    const b = this._runs.get(runId);
    if (b && b.inFlight === 0 && b.queued === 0) this._runs.delete(runId);
  }

  snapshot(engine?: string): readonly IEngineSnapshot[] {
    const now = this._now();
    const engines = new Set<string>([...this._tickets].map((t) => t.engine));
    for (const e of this._leases.keys()) engines.add(e);
    if (engine) { engines.clear(); engines.add(engine); }
    const info = (t: ITicket): IEngineTicketInfo => ({
      id: t.id, runId: t.runId, label: t.label, priority: t.priority, modelId: t.modelId, since: t.since, preemptions: t.preemptions,
    });
    return [...engines].map((e) => {
      const mine = [...this._tickets].filter((t) => t.engine === e);
      return {
        engine: e,
        running: mine.filter((t) => t.state === 'running').map(info),
        queued: mine.filter((t) => t.state === 'queued')
          .sort((a, b) => RANK[a.priority] - RANK[b.priority] || a.enqueuedAt - b.enqueuedAt)
          .map(info),
        held: this._blockedUntil(e, now) !== 0,
      };
    });
  }

  /** Coalesce bursts of state changes into one event per tick. */
  private _changed(): void {
    if (this._changeQueued) return;
    this._changeQueued = true;
    queueMicrotask(() => {
      this._changeQueued = false;
      this._onDidChange.fire();
    });
  }
}
