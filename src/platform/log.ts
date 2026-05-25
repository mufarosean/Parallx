// log.ts — structured logger with categories, levels, and ring buffer
//
// M86-W1: replaces ad-hoc console.warn/error with a typed, category-routed
// logger. Provides a ring buffer dumpable from the diagnostics panel so
// future contention/timer audits are self-service.
//
// This file is opt-in. Existing console.* calls keep working; callers
// migrate as they touch sites. The default sink mirrors warn+ to the
// console so nothing regresses for callers that haven't migrated.

export type LogCategory =
  | 'perf'
  | 'ipc'
  | 'storage'
  | 'ext'
  | 'ai'
  | 'ui'
  | 'workbench';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export interface LogRecord {
  readonly timestamp: number;
  readonly category: LogCategory;
  readonly level: LogLevel;
  readonly message: string;
  readonly data?: unknown;
}

export interface ILogSink {
  append(record: LogRecord): void;
}

export interface ILogger {
  debug(category: LogCategory, message: string, data?: unknown): void;
  info(category: LogCategory, message: string, data?: unknown): void;
  warn(category: LogCategory, message: string, data?: unknown): void;
  error(category: LogCategory, message: string, data?: unknown): void;
  setLevel(category: LogCategory, level: LogLevel): void;
  addSink(sink: ILogSink): void;
}

const RING_CAP = 2000;

/**
 * Ring buffer sink. Keeps the most recent RING_CAP records.
 */
export class RingBufferSink implements ILogSink {
  private _buf: LogRecord[] = [];
  private _head = 0;
  private _full = false;

  append(record: LogRecord): void {
    if (!this._full) {
      this._buf.push(record);
      if (this._buf.length === RING_CAP) {
        this._full = true;
        this._head = 0;
      }
      return;
    }
    this._buf[this._head] = record;
    this._head = (this._head + 1) % RING_CAP;
  }

  snapshot(): readonly LogRecord[] {
    if (!this._full) return this._buf.slice();
    return this._buf.slice(this._head).concat(this._buf.slice(0, this._head));
  }

  clear(): void {
    this._buf = [];
    this._head = 0;
    this._full = false;
  }
}

/**
 * Console mirror sink. Mirrors records at level >= the threshold to the
 * appropriate console method. Default threshold is `warn` so debug/info
 * logging from migrated callers doesn't add noise.
 */
export class ConsoleMirrorSink implements ILogSink {
  constructor(private readonly _threshold: LogLevel = 'warn') {}
  append(record: LogRecord): void {
    if (LEVEL_ORDER[record.level] < LEVEL_ORDER[this._threshold]) return;
    const prefix = `[${record.category}]`;
    const args: unknown[] = [prefix, record.message];
    if (record.data !== undefined) args.push(record.data);
    switch (record.level) {
      case 'debug':
      case 'info':
        // eslint-disable-next-line no-console
        console.log(...args);
        return;
      case 'warn':
        // eslint-disable-next-line no-console
        console.warn(...args);
        return;
      case 'error':
        // eslint-disable-next-line no-console
        console.error(...args);
        return;
    }
  }
}

export class Logger implements ILogger {
  private _levels: Record<LogCategory, LogLevel>;
  private _sinks: ILogSink[];

  constructor(opts?: { defaultLevel?: LogLevel; sinks?: ILogSink[] }) {
    const def = opts?.defaultLevel ?? 'warn';
    this._levels = {
      perf: def,
      ipc: def,
      storage: def,
      ext: def,
      ai: def,
      ui: def,
      workbench: def,
    };
    this._sinks = opts?.sinks ?? [];
  }

  setLevel(category: LogCategory, level: LogLevel): void {
    this._levels[category] = level;
  }

  addSink(sink: ILogSink): void {
    this._sinks.push(sink);
  }

  private _emit(category: LogCategory, level: LogLevel, message: string, data?: unknown): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this._levels[category]]) return;
    const record: LogRecord = {
      timestamp: Date.now(),
      category,
      level,
      message,
      data,
    };
    for (const sink of this._sinks) {
      try {
        sink.append(record);
      } catch {
        /* a misbehaving sink must not crash the logger */
      }
    }
  }

  debug(category: LogCategory, message: string, data?: unknown): void {
    this._emit(category, 'debug', message, data);
  }
  info(category: LogCategory, message: string, data?: unknown): void {
    this._emit(category, 'info', message, data);
  }
  warn(category: LogCategory, message: string, data?: unknown): void {
    this._emit(category, 'warn', message, data);
  }
  error(category: LogCategory, message: string, data?: unknown): void {
    this._emit(category, 'error', message, data);
  }
}

// ─── Global accessor ─────────────────────────────────────────────────────────

let _globalRing: RingBufferSink | null = null;
let _globalLogger: Logger | null = null;

/**
 * Returns the process-wide logger. Lazily instantiates with a ring buffer
 * sink and a console mirror at warn+ threshold.
 *
 * Callers that have DI should prefer injecting an ILogger. The global is
 * here for places that don't (extension shims, module-level diagnostics).
 */
export function getLogger(): ILogger {
  if (!_globalLogger) {
    _globalRing = new RingBufferSink();
    _globalLogger = new Logger({
      defaultLevel: 'warn',
      sinks: [_globalRing, new ConsoleMirrorSink('warn')],
    });
  }
  return _globalLogger;
}

/**
 * Returns a snapshot of the global ring buffer for diagnostic dumping.
 * Returns empty array if the logger hasn't been used yet.
 */
export function getLogBuffer(): readonly LogRecord[] {
  if (!_globalRing) return [];
  return _globalRing.snapshot();
}

/**
 * Test-only: reset the global logger so tests start from a clean state.
 */
export function _resetGlobalLoggerForTests(): void {
  _globalRing = null;
  _globalLogger = null;
}
