/**
 * Pin-the-invariant: ContributionRegistry — optional 5th/6th processors.
 *
 * Complements tests/unit/contributionRegistry.test.ts (which only covers
 * the four-core wiring). Pins:
 *  - Optional chatParticipant + canvasBlockType run in order after view.
 *  - Optional processors are skipped entirely when not supplied — no
 *    throw, no console.error.
 *  - Optional processors get the same error-isolation as the core four:
 *    a throwing chatParticipant does NOT block canvasBlockType, and vice
 *    versa.
 *  - Optional removeContributions receives the toolId (not description).
 */

import { describe, expect, it, vi } from 'vitest';
import { ContributionRegistry } from '../../src/contributions/contributionRegistry';
import type { IToolDescription } from '../../src/tools/toolManifest';

type AnyProc = {
  processContributions: (d: IToolDescription) => void;
  removeContributions: (id: string) => void;
};

function makeProc(label: string, calls: string[]): AnyProc {
  return {
    processContributions: (d: IToolDescription) => { calls.push(`${label}:process:${d.manifest.id}`); },
    removeContributions: (id: string) => { calls.push(`${label}:remove:${id}`); },
  };
}

function makeThrowing(label: string, calls: string[]): AnyProc {
  return {
    processContributions: () => { calls.push(`${label}:process:throw`); throw new Error(`${label} boom`); },
    removeContributions: () => { calls.push(`${label}:remove:throw`); throw new Error(`${label} boom`); },
  };
}

const description = {
  manifest: { id: 'tool-1' },
  toolPath: '/x',
  isBuiltin: false,
} as unknown as IToolDescription;

describe('ContributionRegistry — optional chatParticipant / canvasBlockType', () => {
  it('invokes optional processors in order: chat then canvas, after the four core processors', () => {
    const calls: string[] = [];
    const reg = new ContributionRegistry(
      makeProc('cmd', calls) as never,
      makeProc('kb', calls) as never,
      makeProc('menu', calls) as never,
      makeProc('view', calls) as never,
      makeProc('chat', calls) as never,
      makeProc('canvas', calls) as never,
    );
    reg.processContributions(description);
    expect(calls).toEqual([
      'cmd:process:tool-1',
      'kb:process:tool-1',
      'menu:process:tool-1',
      'view:process:tool-1',
      'chat:process:tool-1',
      'canvas:process:tool-1',
    ]);
    reg.dispose();
  });

  it('removeContributions invokes optional processors with toolId (not description)', () => {
    const calls: string[] = [];
    const reg = new ContributionRegistry(
      makeProc('cmd', calls) as never,
      makeProc('kb', calls) as never,
      makeProc('menu', calls) as never,
      makeProc('view', calls) as never,
      makeProc('chat', calls) as never,
      makeProc('canvas', calls) as never,
    );
    reg.removeContributions('tool-2');
    // Just check the optional ones ran with the id.
    expect(calls).toContain('chat:remove:tool-2');
    expect(calls).toContain('canvas:remove:tool-2');
    // And that the registration order is preserved end-to-end.
    expect(calls.indexOf('chat:remove:tool-2')).toBeGreaterThan(calls.indexOf('view:remove:tool-2'));
    expect(calls.indexOf('canvas:remove:tool-2')).toBeGreaterThan(calls.indexOf('chat:remove:tool-2'));
    reg.dispose();
  });

  it('skips optional processors entirely when not supplied — no throw, no console.error', () => {
    const calls: string[] = [];
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => { /* */ });
    const reg = new ContributionRegistry(
      makeProc('cmd', calls) as never,
      makeProc('kb', calls) as never,
      makeProc('menu', calls) as never,
      makeProc('view', calls) as never,
      // No chat, no canvas.
    );
    expect(() => reg.processContributions(description)).not.toThrow();
    expect(() => reg.removeContributions('tool-3')).not.toThrow();
    // Only the four core processors fired.
    expect(calls.filter((c) => c.startsWith('chat:'))).toEqual([]);
    expect(calls.filter((c) => c.startsWith('canvas:'))).toEqual([]);
    expect(errSpy.mock.calls.length).toBe(0);
    errSpy.mockRestore();
    reg.dispose();
  });

  it('throwing chatParticipant does NOT block canvasBlockType (error isolation extends to optionals)', () => {
    const calls: string[] = [];
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => { /* */ });
    const reg = new ContributionRegistry(
      makeProc('cmd', calls) as never,
      makeProc('kb', calls) as never,
      makeProc('menu', calls) as never,
      makeProc('view', calls) as never,
      makeThrowing('chat', calls) as never,
      makeProc('canvas', calls) as never,
    );
    reg.processContributions(description);
    expect(calls).toContain('chat:process:throw');
    expect(calls).toContain('canvas:process:tool-1');
    expect(errSpy.mock.calls.length).toBe(1);
    errSpy.mockRestore();
    reg.dispose();
  });

  it('throwing canvasBlockType does NOT propagate; the four core processors had already run', () => {
    const calls: string[] = [];
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => { /* */ });
    const reg = new ContributionRegistry(
      makeProc('cmd', calls) as never,
      makeProc('kb', calls) as never,
      makeProc('menu', calls) as never,
      makeProc('view', calls) as never,
      makeProc('chat', calls) as never,
      makeThrowing('canvas', calls) as never,
    );
    expect(() => reg.processContributions(description)).not.toThrow();
    expect(() => reg.removeContributions('tool-9')).not.toThrow();
    expect(errSpy.mock.calls.length).toBe(2); // process + remove
    errSpy.mockRestore();
    reg.dispose();
  });
});
