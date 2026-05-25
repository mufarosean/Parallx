/**
 * §86 / Slice B15 — keybinding adoption for `inspectActiveSelection`.
 *
 * Ships `Ctrl+Alt+S` on a command gated on the boolean §86 context key
 * `activeSelectionExists` (introduced by Slice B14). Exercises the
 * KeybindingService against a boolean (rather than string-equality)
 * when-clause end-to-end through the real ContextKeyService.
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

function fireCtrlAltS(): void {
  const event = new KeyboardEvent('keydown', {
    key: 's',
    ctrlKey: true,
    altKey: true,
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, 'target', { value: document.body, writable: false });
  document.dispatchEvent(event);
}

describe('§86 Slice B15 — inspectActiveSelection keybinding', () => {
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

  it('descriptor declares Ctrl+Alt+S gated on activeSelectionExists', () => {
    const cmd = ALL_BUILTIN_COMMANDS.find(
      (c) => c.id === 'workbench.action.inspectActiveSelection'
    );
    expect(cmd).toBeDefined();
    expect(cmd!.keybinding).toBe('Ctrl+Alt+S');
    expect(cmd!.when).toBe('activeSelectionExists');
  });

  it('does not fire when activeSelectionExists is false', () => {
    keys.registerKeybinding(
      'Ctrl+Alt+S',
      'workbench.action.inspectActiveSelection',
      'activeSelectionExists',
      'builtin'
    );
    fireCtrlAltS();
    expect(commandService.getExecuted()).toEqual([]);
  });

  it('fires once activeSelectionExists flips to true', () => {
    keys.registerKeybinding(
      'Ctrl+Alt+S',
      'workbench.action.inspectActiveSelection',
      'activeSelectionExists',
      'builtin'
    );
    contextKeys.createKey<boolean>('activeSelectionExists', false).set(true);
    fireCtrlAltS();
    expect(commandService.getExecuted()).toEqual([
      'workbench.action.inspectActiveSelection',
    ]);
  });

  it('stops firing again once the key flips back to false', () => {
    keys.registerKeybinding(
      'Ctrl+Alt+S',
      'workbench.action.inspectActiveSelection',
      'activeSelectionExists',
      'builtin'
    );
    const k = contextKeys.createKey<boolean>('activeSelectionExists', false);
    k.set(true);
    fireCtrlAltS();
    k.set(false);
    fireCtrlAltS();
    expect(commandService.getExecuted()).toEqual([
      'workbench.action.inspectActiveSelection',
    ]);
  });
});
