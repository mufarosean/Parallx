/**
 * §86 / Slice B11 — compound when-clause + keybinding for
 * `copyActiveFilePath`. Verifies that:
 *
 *   1. The descriptor declares a compound `&&` when-clause binding two
 *      §86 context keys (`activeResourceType` and `activeSurfaceKind`).
 *   2. The default `Ctrl+Alt+P` chord fires only while both keys hold
 *      their required values, against the real `ContextKeyService`.
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

function fireCtrlAltP(): void {
  const event = new KeyboardEvent('keydown', {
    key: 'p',
    ctrlKey: true,
    altKey: true,
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, 'target', { value: document.body, writable: false });
  document.dispatchEvent(event);
}

describe('§86 Slice B11 — copyActiveFilePath compound when + keybinding', () => {
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

  it('descriptor declares compound when-clause and Ctrl+Alt+P keybinding', () => {
    const cmd = ALL_BUILTIN_COMMANDS.find(
      (c) => c.id === 'workbench.action.copyActiveFilePath'
    );
    expect(cmd).toBeDefined();
    expect(cmd!.keybinding).toBe('Ctrl+Alt+P');
    expect(cmd!.when).toBe(
      "activeResourceType == 'file' && activeSurfaceKind == 'editor'"
    );
  });

  it('does not fire while neither key is set', () => {
    keys.registerKeybinding(
      'Ctrl+Alt+P',
      'workbench.action.copyActiveFilePath',
      "activeResourceType == 'file' && activeSurfaceKind == 'editor'",
      'builtin'
    );
    fireCtrlAltP();
    expect(commandService.getExecuted()).toEqual([]);
  });

  it('does not fire when only one half of the compound is satisfied', () => {
    const t = contextKeys.createKey<string>('activeResourceType', '');
    const s = contextKeys.createKey<string>('activeSurfaceKind', '');
    keys.registerKeybinding(
      'Ctrl+Alt+P',
      'workbench.action.copyActiveFilePath',
      "activeResourceType == 'file' && activeSurfaceKind == 'editor'",
      'builtin'
    );
    // Only the resource type matches.
    t.set('file');
    fireCtrlAltP();
    expect(commandService.getExecuted()).toEqual([]);
    // Now flip the other side wrong (canvas-page) and clear resource type.
    t.set('');
    s.set('canvas-page');
    fireCtrlAltP();
    expect(commandService.getExecuted()).toEqual([]);
  });

  it('fires only when both halves match', () => {
    const t = contextKeys.createKey<string>('activeResourceType', '');
    const s = contextKeys.createKey<string>('activeSurfaceKind', '');
    keys.registerKeybinding(
      'Ctrl+Alt+P',
      'workbench.action.copyActiveFilePath',
      "activeResourceType == 'file' && activeSurfaceKind == 'editor'",
      'builtin'
    );
    t.set('file');
    s.set('editor');
    fireCtrlAltP();
    expect(commandService.getExecuted()).toEqual([
      'workbench.action.copyActiveFilePath',
    ]);
  });

  it('reverts to no-op once either key changes away from required value', () => {
    const t = contextKeys.createKey<string>('activeResourceType', '');
    const s = contextKeys.createKey<string>('activeSurfaceKind', '');
    keys.registerKeybinding(
      'Ctrl+Alt+P',
      'workbench.action.copyActiveFilePath',
      "activeResourceType == 'file' && activeSurfaceKind == 'editor'",
      'builtin'
    );
    t.set('file');
    s.set('editor');
    fireCtrlAltP();
    s.set('chat');
    fireCtrlAltP();
    expect(commandService.getExecuted()).toEqual([
      'workbench.action.copyActiveFilePath',
    ]);
  });
});
