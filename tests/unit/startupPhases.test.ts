// startupPhases.test.ts — M86-W2
import { describe, it, expect } from 'vitest';
import { runPhase, runPhasesSequential } from '../../src/workbench/startupPhases.js';
import { Logger, type LogRecord, type ILogSink } from '../../src/platform/log.js';

class CaptureSink implements ILogSink {
  records: LogRecord[] = [];
  append(r: LogRecord): void {
    this.records.push(r);
  }
}

describe('M86-W2 runPhase', () => {
  it('runs warmups concurrently before the body', async () => {
    const order: string[] = [];
    const sink = new CaptureSink();
    const logger = new Logger({ defaultLevel: 'debug', sinks: [sink] });
    const result = await runPhase(
      {
        name: 'phase-1',
        warmups: [
          async () => {
            await delay(50);
            order.push('warm-a');
          },
          async () => {
            await delay(50);
            order.push('warm-b');
          },
        ],
        body: async () => {
          order.push('body');
          return 'result-1';
        },
      },
      logger,
    );
    // body must run AFTER both warmups settled
    expect(order[order.length - 1]).toBe('body');
    expect(order.includes('warm-a')).toBe(true);
    expect(order.includes('warm-b')).toBe(true);
    expect(result.value).toBe('result-1');
    expect(result.timing.name).toBe('phase-1');
    expect(result.timing.totalMs).toBeGreaterThanOrEqual(result.timing.warmupMs);
    // Concurrency invariant: two 50ms warmups run sequentially would take
    // ~100ms; concurrently they take ~50ms. Allow up to 90ms on slow CI.
    expect(result.timing.warmupMs).toBeLessThan(90);
    expect(sink.records.some((r) => r.category === 'perf')).toBe(true);
  });

  it('phase with no warmups still runs the body', async () => {
    const r = await runPhase({
      name: 'empty',
      body: async () => 42,
    });
    expect(r.value).toBe(42);
    expect(r.timing.warmupMs).toBeGreaterThanOrEqual(0);
  });

  it('a rejecting warmup rejects the whole phase', async () => {
    let bodyRan = false;
    await expect(
      runPhase({
        name: 'failing',
        warmups: [
          async () => {
            throw new Error('warmup boom');
          },
        ],
        body: async () => {
          bodyRan = true;
        },
      }),
    ).rejects.toThrow('warmup boom');
    expect(bodyRan).toBe(false);
  });
});

describe('M86-W2 runPhasesSequential', () => {
  it('runs phases in order and collects timings', async () => {
    const order: string[] = [];
    const timings = await runPhasesSequential([
      {
        name: 'A',
        body: async () => {
          order.push('A');
        },
      },
      {
        name: 'B',
        body: async () => {
          order.push('B');
        },
      },
    ]);
    expect(order).toEqual(['A', 'B']);
    expect(timings.map((t) => t.name)).toEqual(['A', 'B']);
  });
});

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
