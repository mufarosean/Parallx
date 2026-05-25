// log.test.ts — M86-W1 structured logger tests
import { describe, it, expect, beforeEach } from 'vitest';
import {
  Logger,
  RingBufferSink,
  ConsoleMirrorSink,
  getLogger,
  getLogBuffer,
  _resetGlobalLoggerForTests,
  type LogRecord,
  type ILogSink,
} from '../../../src/platform/log.js';

class CaptureSink implements ILogSink {
  records: LogRecord[] = [];
  append(r: LogRecord): void {
    this.records.push(r);
  }
}

describe('M86-W1 Logger', () => {
  beforeEach(() => {
    _resetGlobalLoggerForTests();
  });

  it('emits records at or above the category level', () => {
    const sink = new CaptureSink();
    const log = new Logger({ defaultLevel: 'warn', sinks: [sink] });
    log.warn('perf', 'should record');
    log.error('perf', 'should record too');
    expect(sink.records.length).toBe(2);
    expect(sink.records[0].level).toBe('warn');
    expect(sink.records[1].level).toBe('error');
  });

  it('suppresses records below the category level', () => {
    const sink = new CaptureSink();
    const log = new Logger({ defaultLevel: 'warn', sinks: [sink] });
    log.debug('perf', 'suppressed');
    log.info('perf', 'suppressed');
    expect(sink.records.length).toBe(0);
  });

  it('honors per-category level overrides', () => {
    const sink = new CaptureSink();
    const log = new Logger({ defaultLevel: 'warn', sinks: [sink] });
    log.setLevel('perf', 'debug');
    log.debug('perf', 'perf debug');
    log.debug('ipc', 'ipc debug suppressed');
    expect(sink.records.length).toBe(1);
    expect(sink.records[0].category).toBe('perf');
  });

  it('attaches optional data payload', () => {
    const sink = new CaptureSink();
    const log = new Logger({ defaultLevel: 'debug', sinks: [sink] });
    log.warn('storage', 'with payload', { key: 'abc', durationMs: 42 });
    expect(sink.records[0].data).toEqual({ key: 'abc', durationMs: 42 });
  });

  it('survives a misbehaving sink without crashing', () => {
    const bad: ILogSink = {
      append() {
        throw new Error('sink boom');
      },
    };
    const good = new CaptureSink();
    const log = new Logger({ defaultLevel: 'warn', sinks: [bad, good] });
    expect(() => log.warn('ui', 'still works')).not.toThrow();
    expect(good.records.length).toBe(1);
  });
});

describe('M86-W1 RingBufferSink', () => {
  it('caps at 2000 records (FIFO eviction)', () => {
    const ring = new RingBufferSink();
    for (let i = 0; i < 2500; i++) {
      ring.append({
        timestamp: i,
        category: 'perf',
        level: 'warn',
        message: `m${i}`,
      });
    }
    const snap = ring.snapshot();
    expect(snap.length).toBe(2000);
    // After 2500 inserts the oldest surviving entry is index 500.
    expect(snap[0].message).toBe('m500');
    expect(snap[snap.length - 1].message).toBe('m2499');
  });

  it('snapshot returns records in insertion order before wrap', () => {
    const ring = new RingBufferSink();
    ring.append({ timestamp: 1, category: 'perf', level: 'warn', message: 'a' });
    ring.append({ timestamp: 2, category: 'perf', level: 'warn', message: 'b' });
    const snap = ring.snapshot();
    expect(snap.map(r => r.message)).toEqual(['a', 'b']);
  });

  it('clear empties the buffer', () => {
    const ring = new RingBufferSink();
    ring.append({ timestamp: 1, category: 'perf', level: 'warn', message: 'a' });
    ring.clear();
    expect(ring.snapshot()).toEqual([]);
  });
});

describe('M86-W1 ConsoleMirrorSink', () => {
  it('suppresses below threshold', () => {
    const sink = new ConsoleMirrorSink('warn');
    const original = console.log;
    let called = 0;
    console.log = () => {
      called++;
    };
    try {
      sink.append({ timestamp: 0, category: 'perf', level: 'info', message: 'x' });
    } finally {
      console.log = original;
    }
    expect(called).toBe(0);
  });
});

describe('M86-W1 global logger', () => {
  it('returns a singleton across calls', () => {
    const a = getLogger();
    const b = getLogger();
    expect(a).toBe(b);
  });

  it('records flow into the global ring buffer', () => {
    const log = getLogger();
    log.error('workbench', 'global ring test');
    const buf = getLogBuffer();
    expect(buf.some(r => r.message === 'global ring test')).toBe(true);
  });
});
