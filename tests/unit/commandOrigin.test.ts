// commandOrigin.test.ts — the attribution contract of the action language.
//
// SYSTEM_INTEGRITY.md Phase B: every route into executeCommand stamps WHERE
// the call came from; the journal derives WHO acted from that stamp. These
// tests pin the bus contract (origin on the event and the handler context,
// 'programmatic' default, alias forwarding) and the settings-write half
// (origin on ISettingChange, 'user' default, 'binding' echoes).

import { describe, it, expect } from 'vitest';
import { CommandService } from '../../src/commands/commandRegistry.js';
import type { CommandExecutedEvent, CommandOrigin } from '../../src/commands/commandTypes.js';
import { ServiceCollection } from '../../src/services/serviceCollection.js';
import { SettingsRegistryService } from '../../src/services/settingsRegistryService.js';
import type { ISettingChange } from '../../src/services/settingsRegistryService.js';
import { Emitter } from '../../src/platform/events.js';

function makeService(): CommandService {
  return new CommandService(new ServiceCollection());
}

describe('command origin — the bus contract', () => {
  it('executeCommandFrom stamps the origin on the executed event', async () => {
    const svc = makeService();
    const events: CommandExecutedEvent[] = [];
    svc.onDidExecuteCommand((e) => events.push(e));
    svc.registerCommand({ id: 'test.hello', title: 'Hello', handler: () => 42 });

    await svc.executeCommandFrom('palette', 'test.hello');
    await svc.executeCommandFrom('keybinding', 'test.hello');
    await svc.executeCommandFrom('menu', 'test.hello');
    await svc.executeCommandFrom('ai', 'test.hello');
    await svc.executeCommandFrom('ext:my-tool', 'test.hello');

    expect(events.map((e) => e.origin)).toEqual(['palette', 'keybinding', 'menu', 'ai', 'ext:my-tool']);
    svc.dispose();
  });

  it('plain executeCommand defaults to programmatic', async () => {
    const svc = makeService();
    const events: CommandExecutedEvent[] = [];
    svc.onDidExecuteCommand((e) => events.push(e));
    svc.registerCommand({ id: 'test.plain', title: 'Plain', handler: () => undefined });

    await svc.executeCommand('test.plain');

    expect(events).toHaveLength(1);
    expect(events[0].origin).toBe('programmatic');
    svc.dispose();
  });

  it('the handler context carries the origin so aliases can forward it', async () => {
    const svc = makeService();
    let seen: CommandOrigin | undefined;
    svc.registerCommand({
      id: 'test.inner', title: 'Inner',
      handler: (ctx) => { seen = ctx.origin; },
    });
    svc.registerCommand({
      id: 'test.alias', title: 'Alias',
      handler: async (ctx) => svc.executeCommandFrom(ctx.origin, 'test.inner'),
    });

    await svc.executeCommandFrom('palette', 'test.alias');
    expect(seen).toBe('palette');

    await svc.executeCommand('test.alias');
    expect(seen).toBe('programmatic');
    svc.dispose();
  });

  it('args and result still ride the event unchanged', async () => {
    const svc = makeService();
    const events: CommandExecutedEvent[] = [];
    svc.onDidExecuteCommand((e) => events.push(e));
    svc.registerCommand({ id: 'test.sum', title: 'Sum', handler: (_ctx, a, b) => (a as number) + (b as number) });

    const result = await svc.executeCommandFrom('ui', 'test.sum', 2, 3);

    expect(result).toBe(5);
    expect(events[0].args).toEqual([2, 3]);
    expect(events[0].result).toBe(5);
    expect(events[0].origin).toBe('ui');
    svc.dispose();
  });
});

describe('settings-write origin — the attribution contract', () => {
  function makeRegistry(): SettingsRegistryService {
    const svc = new SettingsRegistryService(undefined, undefined);
    svc.register({
      key: 'test.flag', type: 'boolean', default: false,
      scope: 'user', title: 'Test Flag', description: 'A test flag.',
    } as never);
    return svc;
  }

  it('setValue stamps user by default and honors an explicit origin', async () => {
    const svc = makeRegistry();
    const changes: ISettingChange[] = [];
    svc.onDidChange((c) => changes.push(c));

    await svc.setValue('test.flag', true);
    await svc.setValue('test.flag', false, undefined, 'system');
    await svc.setValue('test.flag', true, undefined, 'ai');
    await svc.setValue('test.flag', false, undefined, 'ext:budget');

    expect(changes.map((c) => c.origin)).toEqual(['user', 'system', 'ai', 'ext:budget']);
    svc.dispose();
  });

  it('reset stamps user by default', async () => {
    const svc = makeRegistry();
    const changes: ISettingChange[] = [];
    svc.onDidChange((c) => changes.push(c));

    await svc.reset('test.flag');
    await svc.reset('test.flag', 'system');

    expect(changes.map((c) => c.origin)).toEqual(['user', 'system']);
    svc.dispose();
  });

  it('a bound key echoing an external mutation stamps binding', async () => {
    const svc = makeRegistry();
    const changes: ISettingChange[] = [];
    svc.onDidChange((c) => changes.push(c));

    const external = new Emitter<boolean>();
    let stored = false;
    svc.bind<boolean>('test.flag', {
      getValue: () => stored,
      setValue: (v) => { stored = v; },
      onDidChange: external.event,
    });

    external.fire(true);

    expect(changes).toHaveLength(1);
    expect(changes[0].origin).toBe('binding');
    expect(changes[0].key).toBe('test.flag');

    // A write THROUGH the registry to the bound key still attributes the caller.
    await svc.setValue('test.flag', false, undefined, 'ai');
    expect(changes[1].origin).toBe('ai');
    svc.dispose();
  });
});
