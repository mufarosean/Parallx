/**
 * §86 / Slice B9 — keybinding adoption for `copyActiveResourceUri`.
 *
 * The slice ships a default `Ctrl+Alt+U` chord on a command that is
 * gated on the §86 context key `activeResourceType`. This exercises the
 * KeybindingService's `when`-clause evaluation against the new context
 * key end-to-end through the real ContextKeyService.
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KeybindingService } from '../../../src/services/keybindingService';
import { ContextKeyService } from '../../../src/context/contextKey';
import { ALL_BUILTIN_COMMANDS } from '../../../src/commands/structuralCommands';

function createMockCommandService() {
  const executed: string[] = [];
  return {
    hasCommand(_id: string) { return true; },
    async executeCommand(id: string) { executed.push(id); return undefined; },
    getExecuted() { return executed; },
  };
}

function fireCtrlAltU(): void {
  const event = new KeyboardEvent('keydown', {
    key: 'u',
    ctrlKey: true,
    altKey: true,
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, 'target', { value: document.body, writable: false });
  document.dispatchEvent(event);
}

describe('§86 Slice B9 — copyActiveResourceUri keybinding', () => {
  let commandService: ReturnType<typeof createMockCommandService>;
  let contextKeys: ContextKeyService;
  let keys: KeybindingService;

  beforeEach(() => {
    vi.useFakeTimers();
    commandService = createMockCommandService();
    contextKeys = new ContextKeyService();
    keys = new KeybindingService(commandService as never);
    keys.setContextKeyService(contextKeys as never);
  });

  afterEach(() => {
    keys.dispose();
    contextKeys.dispose();
    vi.useRealTimers();
  });

  it('descriptor declares Ctrl+Alt+U gated on activeResourceType', () => {
    const cmd = ALL_BUILTIN_COMMANDS.find(
      (c) => c.id === 'workbench.action.copyActiveResourceUri'
    );
    expect(cmd).toBeDefined();
    expect(cmd!.keybinding).toBe('Ctrl+Alt+U');
    expect(cmd!.when).toBe('activeResourceType');
  });

  it('does not fire when activeResourceType is unset', () => {
    keys.registerKeybinding(
      'Ctrl+Alt+U',
      'workbench.action.copyActiveResourceUri',
      'activeResourceType',
      'builtin'
    );
    fireCtrlAltU();
    expect(commandService.getExecuted()).toEqual([]);
  });

  it('fires once activeResourceType is set', () => {
    keys.registerKeybinding(
      'Ctrl+Alt+U',
      'workbench.action.copyActiveResourceUri',
      'activeResourceType',
      'builtin'
    );
    contextKeys.createKey<string>('activeResourceType', '').set('file');
    fireCtrlAltU();
    expect(commandService.getExecuted()).toEqual([
      'workbench.action.copyActiveResourceUri',
    ]);
  });

  it('clears again when activeResourceType reverts to empty string', () => {
    keys.registerKeybinding(
      'Ctrl+Alt+U',
      'workbench.action.copyActiveResourceUri',
      'activeResourceType',
      'builtin'
    );
    const key = contextKeys.createKey<string>('activeResourceType', '');
    key.set('file');
    fireCtrlAltU();
    key.set('');
    fireCtrlAltU();
    expect(commandService.getExecuted()).toEqual([
      'workbench.action.copyActiveResourceUri',
    ]);
  });
});
