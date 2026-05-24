// selectionActionDispatcher.test.ts — pin SelectionActionDispatcher contracts.
//
// Pins:
//   - registerHandler stores by actionId; getHandlers returns a snapshot
//   - registering duplicate actionId overwrites + warns (no throw)
//   - returned disposable removes only IF the registry still holds same instance
//   - dispatch routes payload+services to the matching handler
//   - dispatch is a NO-OP after dispose
//   - dispatch with no registered handler warns and returns without throwing
//   - dispatch with services unset errors and returns without invoking handler
//   - dispatch publishes selection through SelectionService BEFORE handler.execute
//   - explicit ctor-arg SelectionService wins over module-level active service
//   - module-level setActiveSelectionService picked up when no explicit service
//   - SelectionService.setSelection throw is caught and logged; handler still runs
//   - dispose clears registry and prevents further dispatch

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  SelectionActionDispatcher,
  setActiveSelectionService,
} from '../../src/services/selectionActionDispatcher';
import type {
  ISelectionActionHandler,
  ISelectionActionPayload,
  IActionHandlerServices,
} from '../../src/services/selectionActionTypes';

function mkPayload(over: Partial<ISelectionActionPayload> = {}): ISelectionActionPayload {
  return {
    actionId: 'add-to-chat',
    selectedText: 'hello',
    surface: 'editor',
    source: { fileName: 'a.md', filePath: '/a.md' },
    ...over,
  };
}

function mkHandler(actionId: string): ISelectionActionHandler & { execute: ReturnType<typeof vi.fn> } {
  return {
    actionId,
    label: actionId,
    execute: vi.fn(async () => {}),
  };
}

function mkServices(): IActionHandlerServices {
  return {
    chatAccess: {
      addSelectionAttachment: vi.fn(),
      setInputValue: vi.fn(),
      focus: vi.fn(),
      submit: vi.fn(),
      reveal: vi.fn(),
    },
    executeCommand: vi.fn(async () => undefined),
  };
}

describe('SelectionActionDispatcher — registration', () => {
  let d: SelectionActionDispatcher;
  beforeEach(() => {
    d = new SelectionActionDispatcher();
  });

  it('registerHandler stores by actionId and is reachable via getHandlers', () => {
    const h = mkHandler('add-to-chat');
    d.registerHandler(h);
    expect(d.getHandlers()).toEqual([h]);
  });

  it('getHandlers returns a snapshot array (not live)', () => {
    const h = mkHandler('a');
    d.registerHandler(h);
    const snap = d.getHandlers();
    d.registerHandler(mkHandler('b'));
    expect(snap.length).toBe(1);
  });

  it('duplicate registration overwrites and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h1 = mkHandler('a');
    const h2 = mkHandler('a');
    d.registerHandler(h1);
    d.registerHandler(h2);
    expect(d.getHandlers()).toEqual([h2]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Overwriting existing handler for 'a'"));
    warn.mockRestore();
  });

  it('dispose-disposable removes only when registry still holds same instance', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h1 = mkHandler('a');
    const h2 = mkHandler('a');
    const disp1 = d.registerHandler(h1);
    d.registerHandler(h2); // overwrites h1
    disp1.dispose();
    // h2 should survive — stale disposable is a no-op
    expect(d.getHandlers()).toEqual([h2]);
  });

  it('dispose-disposable removes the handler when it still owns the slot', () => {
    const h = mkHandler('a');
    const disp = d.registerHandler(h);
    disp.dispose();
    expect(d.getHandlers()).toEqual([]);
  });
});

describe('SelectionActionDispatcher — dispatch', () => {
  let d: SelectionActionDispatcher;
  beforeEach(() => {
    d = new SelectionActionDispatcher();
  });

  it('routes payload + services to the matching handler', async () => {
    d.setServices(mkServices() as IActionHandlerServices);
    const h = mkHandler('add-to-chat');
    d.registerHandler(h);
    const payload = mkPayload();
    await d.dispatch(payload);
    expect(h.execute).toHaveBeenCalledTimes(1);
    expect(h.execute.mock.calls[0][0]).toBe(payload);
  });

  it('warns and returns when no handler registered for action', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    d.setServices(mkServices() as IActionHandlerServices);
    await d.dispatch(mkPayload({ actionId: 'unknown-x' }));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("No handler registered for action 'unknown-x'"));
    warn.mockRestore();
  });

  it('errors and returns when services not set', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const h = mkHandler('add-to-chat');
    d.registerHandler(h);
    await d.dispatch(mkPayload());
    expect(h.execute).not.toHaveBeenCalled();
    expect(err).toHaveBeenCalledWith(expect.stringContaining('Services not set'));
    err.mockRestore();
  });

  it('no-op after dispose', async () => {
    d.setServices(mkServices() as IActionHandlerServices);
    const h = mkHandler('add-to-chat');
    d.registerHandler(h);
    d.dispose();
    await d.dispatch(mkPayload());
    expect(h.execute).not.toHaveBeenCalled();
  });

  it('dispose clears registry', () => {
    d.registerHandler(mkHandler('a'));
    d.registerHandler(mkHandler('b'));
    d.dispose();
    expect(d.getHandlers()).toEqual([]);
  });
});

describe('SelectionActionDispatcher — SelectionService broadcast (M81 Slice A)', () => {
  afterEach(() => {
    setActiveSelectionService(undefined);
  });

  it('publishes selection BEFORE handler.execute when using ctor-arg service', async () => {
    const order: string[] = [];
    const svc: any = {
      setSelection: vi.fn((_id: string, _sel: any) => order.push('svc')),
    };
    const d = new SelectionActionDispatcher(svc);
    d.setServices(mkServices() as IActionHandlerServices);
    const h: ISelectionActionHandler = {
      actionId: 'a',
      label: 'a',
      execute: async () => {
        order.push('handler');
      },
    };
    d.registerHandler(h);
    await d.dispatch(mkPayload({ actionId: 'a' }));
    expect(svc.setSelection).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['svc', 'handler']);
  });

  it('ctor-arg SelectionService wins over module-level active service', async () => {
    const ctorSvc: any = { setSelection: vi.fn() };
    const modSvc: any = { setSelection: vi.fn() };
    setActiveSelectionService(modSvc);
    const d = new SelectionActionDispatcher(ctorSvc);
    d.setServices(mkServices() as IActionHandlerServices);
    d.registerHandler(mkHandler('add-to-chat'));
    await d.dispatch(mkPayload());
    expect(ctorSvc.setSelection).toHaveBeenCalledTimes(1);
    expect(modSvc.setSelection).not.toHaveBeenCalled();
  });

  it('falls back to module-level service when no ctor arg supplied', async () => {
    const modSvc: any = { setSelection: vi.fn() };
    setActiveSelectionService(modSvc);
    const d = new SelectionActionDispatcher();
    d.setServices(mkServices() as IActionHandlerServices);
    d.registerHandler(mkHandler('add-to-chat'));
    await d.dispatch(mkPayload());
    expect(modSvc.setSelection).toHaveBeenCalledTimes(1);
  });

  it('throw from setSelection is caught and handler still runs', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const svc: any = {
      setSelection: () => {
        throw new Error('boom');
      },
    };
    const d = new SelectionActionDispatcher(svc);
    d.setServices(mkServices() as IActionHandlerServices);
    const h = mkHandler('add-to-chat');
    d.registerHandler(h);
    await d.dispatch(mkPayload());
    expect(h.execute).toHaveBeenCalledTimes(1);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it('setActiveSelectionService(undefined) clears the fallback', async () => {
    const modSvc: any = { setSelection: vi.fn() };
    setActiveSelectionService(modSvc);
    setActiveSelectionService(undefined);
    const d = new SelectionActionDispatcher();
    d.setServices(mkServices() as IActionHandlerServices);
    d.registerHandler(mkHandler('add-to-chat'));
    await d.dispatch(mkPayload());
    expect(modSvc.setSelection).not.toHaveBeenCalled();
  });
});
