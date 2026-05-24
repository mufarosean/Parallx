/**
 * Tool activation event filtering (M81 §8 verification gate — closes §22 debt).
 *
 * Manifest M81 §8 listed `toolActivationFiltering.test.ts` as a required
 * gate before Slice B merge. This file is that gate.
 *
 * Validates the contract of `ActivationEventService` — the layer that
 * decides which tools should activate in response to a given event:
 *
 *   - `*` and `onStartupFinished` events fire exactly once and replay
 *     to tools that subscribe after startup.
 *   - `onCommand:<id>` and `onView:<id>` events route only to tools
 *     that registered the matching raw event string.
 *   - Already-activated tools do not receive duplicate activation
 *     requests for the same event.
 *   - Disposing a registration removes the tool from future fan-outs.
 *   - Pending events that fired before any subscriber registered are
 *     replayed at registration time.
 *   - Unparseable activation events are ignored (warned), not thrown.
 */
import { describe, it, expect } from 'vitest';
import {
  ActivationEventService,
  ActivationEventKind,
  parseActivationEvent,
  type ActivationRequest,
} from '../../src/tools/activationEventService.js';

describe('parseActivationEvent', () => {
  it('parses star', () => {
    expect(parseActivationEvent('*')).toEqual({ kind: ActivationEventKind.Star, raw: '*' });
  });

  it('parses onStartupFinished', () => {
    expect(parseActivationEvent('onStartupFinished')).toEqual({
      kind: ActivationEventKind.OnStartupFinished,
      raw: 'onStartupFinished',
    });
  });

  it('parses onCommand with qualifier', () => {
    expect(parseActivationEvent('onCommand:chat.toggle')).toEqual({
      kind: ActivationEventKind.OnCommand,
      qualifier: 'chat.toggle',
      raw: 'onCommand:chat.toggle',
    });
  });

  it('parses onView with qualifier', () => {
    expect(parseActivationEvent('onView:view.chat')).toEqual({
      kind: ActivationEventKind.OnView,
      qualifier: 'view.chat',
      raw: 'onView:view.chat',
    });
  });

  it('rejects empty qualifiers', () => {
    expect(parseActivationEvent('onCommand:')).toBeUndefined();
    expect(parseActivationEvent('onView:')).toBeUndefined();
  });

  it('rejects unknown events', () => {
    expect(parseActivationEvent('onSomethingElse')).toBeUndefined();
    expect(parseActivationEvent('')).toBeUndefined();
  });
});

describe('ActivationEventService filtering', () => {
  function makeService(): { service: ActivationEventService; requests: ActivationRequest[] } {
    const service = new ActivationEventService();
    const requests: ActivationRequest[] = [];
    service.onDidRequestActivation((req) => { requests.push(req); });
    return { service, requests };
  }

  it('routes onCommand events only to tools that registered the matching raw event', () => {
    const { service, requests } = makeService();
    service.registerToolEvents('tool-a', ['onCommand:chat.toggle']);
    service.registerToolEvents('tool-b', ['onCommand:other.cmd']);

    service.fireCommand('chat.toggle');

    expect(requests.map((r) => r.toolId)).toEqual(['tool-a']);
    expect(requests[0].event.raw).toBe('onCommand:chat.toggle');
  });

  it('routes onView events only to tools registered for that view id', () => {
    const { service, requests } = makeService();
    service.registerToolEvents('explorer', ['onView:view.explorer']);
    service.registerToolEvents('chat', ['onView:view.chat']);

    service.fireView('view.chat');

    expect(requests.map((r) => r.toolId)).toEqual(['chat']);
  });

  it('replays onStartupFinished to tools that register AFTER startup', () => {
    const { service, requests } = makeService();
    service.fireStartupFinished();
    service.registerToolEvents('late-tool', ['onStartupFinished']);

    expect(requests.map((r) => r.toolId)).toEqual(['late-tool']);
  });

  it('replays * to tools that register AFTER startup', () => {
    const { service, requests } = makeService();
    service.fireStartupFinished();
    service.registerToolEvents('star-tool', ['*']);

    expect(requests.map((r) => r.toolId)).toEqual(['star-tool']);
  });

  it('replays previously-fired onCommand events to a late subscriber', () => {
    const { service, requests } = makeService();
    service.fireCommand('chat.toggle');
    service.registerToolEvents('late-tool', ['onCommand:chat.toggle']);

    expect(requests.map((r) => r.toolId)).toEqual(['late-tool']);
  });

  it('does not re-request activation for already-activated tools', () => {
    const { service, requests } = makeService();
    service.registerToolEvents('tool-a', ['onCommand:chat.toggle']);
    service.fireCommand('chat.toggle');
    expect(requests.length).toBe(1);

    service.markActivated('tool-a');
    service.fireCommand('chat.toggle');
    expect(requests.length).toBe(1);

    service.clearActivated('tool-a');
    service.fireCommand('chat.toggle');
    expect(requests.length).toBe(2);
  });

  it('does not refire onStartupFinished if called twice', () => {
    const { service, requests } = makeService();
    service.registerToolEvents('startup-tool', ['onStartupFinished']);
    service.fireStartupFinished();
    service.fireStartupFinished();

    expect(requests.length).toBe(1);
  });

  it('removes the tool from future fan-outs when its registration is disposed', () => {
    const { service, requests } = makeService();
    const reg = service.registerToolEvents('tool-a', ['onCommand:chat.toggle']);
    service.fireCommand('chat.toggle');
    expect(requests.length).toBe(1);

    service.clearActivated('tool-a');
    reg.dispose();
    service.fireCommand('chat.toggle');

    expect(requests.length).toBe(1);
  });

  it('exposes the set of tools listening for a raw event via getToolsForEvent', () => {
    const { service } = makeService();
    service.registerToolEvents('a', ['onCommand:x']);
    service.registerToolEvents('b', ['onCommand:x']);
    service.registerToolEvents('c', ['onCommand:y']);

    expect([...service.getToolsForEvent('onCommand:x')].sort()).toEqual(['a', 'b']);
    expect(service.getToolsForEvent('onCommand:y')).toEqual(['c']);
    expect(service.getToolsForEvent('onCommand:unknown')).toEqual([]);
  });

  it('ignores unparseable activation events without throwing', () => {
    const { service, requests } = makeService();
    // Should not throw and should not register a phantom subscription.
    service.registerToolEvents('weird-tool', ['onSomethingElse', 'onCommand:valid.cmd']);
    service.fireCommand('valid.cmd');

    expect(requests.map((r) => r.toolId)).toEqual(['weird-tool']);
    expect(service.getToolsForEvent('onSomethingElse')).toEqual([]);
  });

  it('reports startupFinished status correctly', () => {
    const { service } = makeService();
    expect(service.startupFinished).toBe(false);
    service.fireStartupFinished();
    expect(service.startupFinished).toBe(true);
  });

  it('fires onDidFireEvent for observability for every triggered event', () => {
    const service = new ActivationEventService();
    const observed: string[] = [];
    service.onDidFireEvent((p) => { observed.push(p.raw); });

    service.fireStartupFinished();
    service.fireCommand('x');
    service.fireView('y');

    expect(observed).toEqual(['*', 'onStartupFinished', 'onCommand:x', 'onView:y']);
  });
});
