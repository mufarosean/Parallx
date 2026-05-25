/**
 * §86 / Slice B13 — keybinding adoption for `copyActiveWorkspaceId`.
 *
 * The slice ships a default `Ctrl+Alt+W` chord on a command gated on
 * the §86 context key `activeWorkspaceId` (introduced by Slice B12).
 * This exercises the KeybindingService's `when`-clause evaluation
 * against the new context key end-to-end through the real
 * ContextKeyService — completing the third keybinding/key pair
 * (B9 = activeResourceType, B11 = compound editor+file, B13 = workspace).
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

function fireCtrlAltW(): void {
  const event = new KeyboardEvent('keydown', {
    key: 'w',
    ctrlKey: true,
    altKey: true,
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, 'target', { value: document.body, writable: false });
  document.dispatchEvent(event);
}

describe('§86 Slice B13 — copyActiveWorkspaceId keybinding', () => {
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

  it('descriptor declares Ctrl+Alt+W gated on activeWorkspaceId', () => {
    const cmd = ALL_BUILTIN_COMMANDS.find(
      (c) => c.id === 'workbench.action.copyActiveWorkspaceId'
    );
    expect(cmd).toBeDefined();
    expect(cmd!.keybinding).toBe('Ctrl+Alt+W');
    expect(cmd!.when).toBe('activeWorkspaceId');
  });

  it('does not fire when activeWorkspaceId is unset', () => {
    keys.registerKeybinding(
      'Ctrl+Alt+W',
      'workbench.action.copyActiveWorkspaceId',
      'activeWorkspaceId',
      'builtin'
    );
    fireCtrlAltW();
    expect(commandService.getExecuted()).toEqual([]);
  });

  it('fires once activeWorkspaceId is set to a non-empty string', () => {
    keys.registerKeybinding(
      'Ctrl+Alt+W',
      'workbench.action.copyActiveWorkspaceId',
      'activeWorkspaceId',
      'builtin'
    );
    contextKeys.createKey<string>('activeWorkspaceId', '').set('ws-1');
    fireCtrlAltW();
    expect(commandService.getExecuted()).toEqual([
      'workbench.action.copyActiveWorkspaceId',
    ]);
  });

  it('does not fire when activeWorkspaceId is cleared back to empty', () => {
    keys.registerKeybinding(
      'Ctrl+Alt+W',
      'workbench.action.copyActiveWorkspaceId',
      'activeWorkspaceId',
      'builtin'
    );
    const k = contextKeys.createKey<string>('activeWorkspaceId', '');
    k.set('ws-1');
    fireCtrlAltW();
    k.set('');
    fireCtrlAltW();
    expect(commandService.getExecuted()).toEqual([
      'workbench.action.copyActiveWorkspaceId',
    ]);
  });
});
