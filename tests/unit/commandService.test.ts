// commandService.test.ts — pin CommandService contracts.
//
// Pins:
//   - registerCommand throws on duplicate id (no silent overwrite)
//   - register fires onDidRegisterCommand once; descriptor reachable via get/has
//   - dispose of registration removes the entry AND fires onDidUnregisterCommand
//   - disposing a stale handle (after another reg replaced it) is a no-op
//   - registerCommands returns aggregate disposable; disposes all on call
//   - executeCommand throws "Unknown command" for unregistered id
//   - executeCommand throws "precondition not met" when when-clause fails
//   - executeCommand passes args through, returns handler result
//   - executeCommand awaits async handlers; fires onDidExecuteCommand once
//   - handler receives a context with getService() and workbench backref
//   - executeCommand without a contextKeyService ignores when-clauses
//   - dispose() clears the registry
//
// Mock substrate: minimal ServiceCollection stand-in (only .get used).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CommandService } from '../../src/commands/commandRegistry';
import type { CommandDescriptor } from '../../src/commands/commandTypes';

function mkServices(): any {
  return {
    get: () => undefined,
  };
}

function desc(over: Partial<CommandDescriptor> & { id: string }): CommandDescriptor {
  return {
    title: 't',
    handler: () => undefined,
    ...over,
  };
}

describe('CommandService — registration', () => {
  let svc: CommandService;
  beforeEach(() => {
    svc = new CommandService(mkServices());
  });

  it('registers a command and makes it reachable via getCommand/hasCommand', () => {
    svc.registerCommand(desc({ id: 'a' }));
    expect(svc.hasCommand('a')).toBe(true);
    expect(svc.getCommand('a')?.id).toBe('a');
    expect(svc.getCommands().size).toBe(1);
  });

  it('throws on duplicate id', () => {
    svc.registerCommand(desc({ id: 'a' }));
    expect(() => svc.registerCommand(desc({ id: 'a' }))).toThrow(/already registered/i);
  });

  it('fires onDidRegisterCommand on registration', () => {
    const ev = vi.fn();
    svc.onDidRegisterCommand(ev);
    svc.registerCommand(desc({ id: 'a' }));
    expect(ev).toHaveBeenCalledTimes(1);
    expect(ev.mock.calls[0][0].commandId).toBe('a');
  });

  it('dispose of a registration unregisters and fires onDidUnregisterCommand', () => {
    const ev = vi.fn();
    svc.onDidUnregisterCommand(ev);
    const handle = svc.registerCommand(desc({ id: 'a' }));
    handle.dispose();
    expect(svc.hasCommand('a')).toBe(false);
    expect(ev).toHaveBeenCalledWith({ commandId: 'a' });
  });

  it('stale disposable (after replacement) is a no-op', () => {
    const handle1 = svc.registerCommand(desc({ id: 'a', title: 'first' }));
    handle1.dispose();
    svc.registerCommand(desc({ id: 'a', title: 'second' }));
    handle1.dispose(); // stale: descriptor identity differs
    expect(svc.hasCommand('a')).toBe(true);
    expect(svc.getCommand('a')?.title).toBe('second');
  });

  it('registerCommands returns aggregate disposable; dispose removes all', () => {
    const h = svc.registerCommands([desc({ id: 'a' }), desc({ id: 'b' })]);
    expect(svc.getCommands().size).toBe(2);
    h.dispose();
    expect(svc.getCommands().size).toBe(0);
  });
});

describe('CommandService — execution', () => {
  let svc: CommandService;
  beforeEach(() => {
    svc = new CommandService(mkServices());
  });

  it('throws "Unknown command" for unregistered id', async () => {
    await expect(svc.executeCommand('nope')).rejects.toThrow(/Unknown command/);
  });

  it('passes args through and returns handler result', async () => {
    svc.registerCommand(
      desc({
        id: 'sum',
        handler: (_ctx, a, b) => (a as number) + (b as number),
      }),
    );
    const r = await svc.executeCommand<number>('sum', 2, 3);
    expect(r).toBe(5);
  });

  it('awaits async handlers and resolves their value', async () => {
    svc.registerCommand(
      desc({
        id: 'asyncCmd',
        handler: async () => {
          await new Promise((r) => setTimeout(r, 0));
          return 'done';
        },
      }),
    );
    expect(await svc.executeCommand<string>('asyncCmd')).toBe('done');
  });

  it('fires onDidExecuteCommand once with commandId, args, result', async () => {
    const ev = vi.fn();
    svc.onDidExecuteCommand(ev);
    svc.registerCommand(desc({ id: 'a', handler: () => 'r' }));
    await svc.executeCommand('a', 1, 2);
    expect(ev).toHaveBeenCalledTimes(1);
    expect(ev.mock.calls[0][0]).toMatchObject({
      commandId: 'a',
      args: [1, 2],
      result: 'r',
    });
    expect(typeof ev.mock.calls[0][0].duration).toBe('number');
  });

  it('when-clause is IGNORED when no contextKeyService is wired', async () => {
    svc.registerCommand(
      desc({ id: 'gated', when: 'someKey', handler: () => 'ok' }),
    );
    expect(await svc.executeCommand('gated')).toBe('ok');
  });

  it('when-clause is EVALUATED once contextKeyService is wired; throws precondition', async () => {
    svc.setContextKeyService({ contextMatchesRules: (when) => when === 'allowed' });
    svc.registerCommand(desc({ id: 'gated', when: 'denied', handler: () => 'ok' }));
    svc.registerCommand(desc({ id: 'open', when: 'allowed', handler: () => 'ok' }));
    await expect(svc.executeCommand('gated')).rejects.toThrow(/precondition not met/);
    expect(await svc.executeCommand('open')).toBe('ok');
  });

  it('handler receives a context with getService() and workbench backref', async () => {
    const services: any = {
      get: (idObj: any) => (idObj?.id === 'X' ? 'service-X' : undefined),
    };
    const svc2 = new CommandService(services);
    const wb = { iam: 'workbench' };
    svc2.setWorkbench(wb);
    let captured: any;
    svc2.registerCommand(desc({ id: 'a', handler: (ctx) => { captured = ctx; } }));
    await svc2.executeCommand('a');
    expect(captured.workbench).toBe(wb);
    expect(captured.getService('X')).toBe('service-X');
    expect(captured.getService('Y')).toBeUndefined();
  });

  it('getService swallows errors thrown by ServiceCollection.get and returns undefined', async () => {
    const services: any = {
      get: () => {
        throw new Error('not found');
      },
    };
    const svc2 = new CommandService(services);
    let result: unknown = 'sentinel';
    svc2.registerCommand(desc({ id: 'a', handler: (ctx) => { result = ctx.getService('any'); } }));
    await svc2.executeCommand('a');
    expect(result).toBeUndefined();
  });
});

describe('CommandService — dispose', () => {
  it('dispose clears the registry', () => {
    const svc = new CommandService(mkServices());
    svc.registerCommand(desc({ id: 'a' }));
    svc.registerCommand(desc({ id: 'b' }));
    svc.dispose();
    expect(svc.getCommands().size).toBe(0);
  });
});
