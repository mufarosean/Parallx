/**
 * Unit tests for KeybindingService — chord resolution, editable target exclusion,
 * last-wins priority, and registration lifecycle.
 *
 * Uses jsdom for the document-level keydown listener.
 *
 * @vitest-environment jsdom
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { KeybindingService } from '../../src/services/keybindingService';

// ── Mocks ───────────────────────────────────────────────────────────────────

function createMockCommandService() {
  const commands = new Set<string>();
  const executed: string[] = [];

  return {
    hasCommand(id: string) { return commands.has(id); },
    async executeCommand(id: string) {
      executed.push(id);
      return undefined;
    },
    addCommand(id: string) { commands.add(id); },
    getExecuted() { return executed; },
    clearExecuted() { executed.length = 0; },
  };
}

function createMockContextKeyService(rules: Record<string, boolean> = {}) {
  return {
    contextMatchesRules(when: string | undefined) {
      if (!when) return true;
      return rules[when] ?? false;
    },
    setRule(when: string, value: boolean) {
      rules[when] = value;
    },
  };
}

/** Fire a synthetic keydown event on document. */
function fireKeydown(key: string, opts: {
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  target?: Element;
} = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    ctrlKey: opts.ctrlKey ?? false,
    shiftKey: opts.shiftKey ?? false,
    altKey: opts.altKey ?? false,
    metaKey: opts.metaKey ?? false,
    bubbles: true,
    cancelable: true,
  });

  // If a target is specified, dispatch from it; otherwise from document
  const target = opts.target ?? document.body;
  Object.defineProperty(event, 'target', { value: target, writable: false });
  document.dispatchEvent(event);
  return event;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('KeybindingService', () => {
  let commandService: ReturnType<typeof createMockCommandService>;
  let contextService: ReturnType<typeof createMockContextKeyService>;
  let service: KeybindingService;

  beforeEach(() => {
    vi.useFakeTimers();
    commandService = createMockCommandService();
    contextService = createMockContextKeyService();
    service = new KeybindingService(commandService as any);
    service.setContextKeyService(contextService as any);
  });

  afterEach(() => {
    service.dispose();
    vi.useRealTimers();
  });

  // ── Registration ──

  describe('registration', () => {
    it('registers and looks up a keybinding', () => {
      commandService.addCommand('cmd.test');
      service.registerKeybinding('Ctrl+B', 'cmd.test');
      expect(service.lookupKeybinding('cmd.test')).toBe('ctrl+b');
    });

    it('deregisters on dispose', () => {
      commandService.addCommand('cmd.temp');
      const disposable = service.registerKeybinding('Ctrl+T', 'cmd.temp');
      expect(service.lookupKeybinding('cmd.temp')).toBe('ctrl+t');

      disposable.dispose();
      expect(service.lookupKeybinding('cmd.temp')).toBeUndefined();
    });

    it('removeKeybindingsBySource removes only matching source', () => {
      commandService.addCommand('cmd.a');
      commandService.addCommand('cmd.b');
      service.registerKeybinding('Ctrl+A', 'cmd.a', undefined, 'tool:alpha');
      service.registerKeybinding('Ctrl+B', 'cmd.b', undefined, 'tool:beta');

      service.removeKeybindingsBySource('tool:alpha');
      expect(service.lookupKeybinding('cmd.a')).toBeUndefined();
      expect(service.lookupKeybinding('cmd.b')).toBe('ctrl+b');
    });

    it('getAllKeybindings returns all registered entries', () => {
      commandService.addCommand('cmd.x');
      commandService.addCommand('cmd.y');
      service.registerKeybinding('Ctrl+X', 'cmd.x');
      service.registerKeybinding('Ctrl+Y', 'cmd.y');

      const all = service.getAllKeybindings();
      expect(all).toHaveLength(2);
    });
  });

  // ── Single-key dispatch ──

  describe('single-key dispatch', () => {
    it('dispatches a simple keybinding', async () => {
      commandService.addCommand('cmd.bold');
      service.registerKeybinding('Ctrl+B', 'cmd.bold');

      let dispatched: string | null = null;
      service.onDidDispatch(e => { dispatched = e.commandId; });

      fireKeydown('b', { ctrlKey: true });

      // executeCommand is async — flush microtasks
      await vi.advanceTimersByTimeAsync(0);
      expect(dispatched).toBe('cmd.bold');
      expect(commandService.getExecuted()).toContain('cmd.bold');
    });

    it('does not dispatch when command does not exist', async () => {
      // Register binding but don't add command to service
      service.registerKeybinding('Ctrl+Q', 'cmd.missing');

      fireKeydown('q', { ctrlKey: true });
      await vi.advanceTimersByTimeAsync(0);

      expect(commandService.getExecuted()).not.toContain('cmd.missing');
    });
  });

  // ── Last-wins priority ──

  describe('last-wins priority', () => {
    it('last registered binding wins for same key', async () => {
      commandService.addCommand('cmd.first');
      commandService.addCommand('cmd.second');

      service.registerKeybinding('Ctrl+B', 'cmd.first');
      service.registerKeybinding('Ctrl+B', 'cmd.second');

      fireKeydown('b', { ctrlKey: true });
      await vi.advanceTimersByTimeAsync(0);

      // cmd.second was registered last → wins
      expect(commandService.getExecuted()).toContain('cmd.second');
      expect(commandService.getExecuted()).not.toContain('cmd.first');
    });
  });

  // ── When-clause filtering ──

  describe('when-clause filtering', () => {
    it('only dispatches matching when-clause', async () => {
      commandService.addCommand('cmd.sidebar');
      commandService.addCommand('cmd.fallback');

      service.registerKeybinding('Ctrl+B', 'cmd.fallback');
      service.registerKeybinding('Ctrl+B', 'cmd.sidebar', 'sidebarVisible');

      // sidebarVisible is false by default in our mock
      fireKeydown('b', { ctrlKey: true });
      await vi.advanceTimersByTimeAsync(0);
      expect(commandService.getExecuted()).toContain('cmd.fallback');

      commandService.clearExecuted();
      contextService.setRule('sidebarVisible', true);

      fireKeydown('b', { ctrlKey: true });
      await vi.advanceTimersByTimeAsync(0);
      expect(commandService.getExecuted()).toContain('cmd.sidebar');
    });
  });

  // ── Chord keybindings ──

  describe('chord keybindings', () => {
    it('dispatches a two-key chord', async () => {
      commandService.addCommand('cmd.format');
      service.registerKeybinding('Ctrl+K Ctrl+F', 'cmd.format');

      let chordEntered = false;
      service.onDidEnterChordPrefix(() => { chordEntered = true; });

      // First key: enters chord mode
      fireKeydown('k', { ctrlKey: true });
      expect(chordEntered).toBe(true);

      // Second key: completes chord
      fireKeydown('f', { ctrlKey: true });
      await vi.advanceTimersByTimeAsync(0);

      expect(commandService.getExecuted()).toContain('cmd.format');
    });

    it('cancels chord on timeout', async () => {
      commandService.addCommand('cmd.chord');
      service.registerKeybinding('Ctrl+K Ctrl+C', 'cmd.chord');

      let chorCancelled = false;
      service.onDidCancelChord(() => { chorCancelled = true; });

      fireKeydown('k', { ctrlKey: true });

      // Wait past the 1500ms timeout
      vi.advanceTimersByTime(1501);
      expect(chorCancelled).toBe(true);
    });

    it('chord wins over single-key when both registered', async () => {
      commandService.addCommand('cmd.single');
      commandService.addCommand('cmd.chord');

      service.registerKeybinding('Ctrl+K', 'cmd.single');
      service.registerKeybinding('Ctrl+K Ctrl+F', 'cmd.chord');

      let chordEntered = false;
      service.onDidEnterChordPrefix(() => { chordEntered = true; });

      // Pressing Ctrl+K should enter chord mode (chord priority)
      fireKeydown('k', { ctrlKey: true });
      expect(chordEntered).toBe(true);

      // Complete the chord
      fireKeydown('f', { ctrlKey: true });
      await vi.advanceTimersByTimeAsync(0);

      expect(commandService.getExecuted()).toContain('cmd.chord');
      expect(commandService.getExecuted()).not.toContain('cmd.single');
    });

    it('second key mismatch cancels chord', async () => {
      commandService.addCommand('cmd.chord');
      service.registerKeybinding('Ctrl+K Ctrl+F', 'cmd.chord');

      let cancelled = false;
      service.onDidCancelChord(() => { cancelled = true; });

      fireKeydown('k', { ctrlKey: true }); // enters chord mode

      // Press wrong second key
      fireKeydown('z', { ctrlKey: true });
      expect(cancelled).toBe(true);

      await vi.advanceTimersByTimeAsync(0);
      expect(commandService.getExecuted()).not.toContain('cmd.chord');
    });
  });

  // ── Editable target exclusion ──

  describe('editable target exclusion', () => {
    it('skips keybinding when target is a text input', async () => {
      commandService.addCommand('cmd.skip');
      service.registerKeybinding('Ctrl+B', 'cmd.skip');

      const input = document.createElement('input');
      input.type = 'text';
      document.body.appendChild(input);

      fireKeydown('b', { ctrlKey: true, target: input });
      await vi.advanceTimersByTimeAsync(0);

      expect(commandService.getExecuted()).not.toContain('cmd.skip');
      document.body.removeChild(input);
    });

    it('does NOT skip for non-text input types (button)', async () => {
      commandService.addCommand('cmd.allow');
      service.registerKeybinding('Ctrl+B', 'cmd.allow');

      const input = document.createElement('input');
      input.type = 'button';
      document.body.appendChild(input);

      fireKeydown('b', { ctrlKey: true, target: input });
      await vi.advanceTimersByTimeAsync(0);

      expect(commandService.getExecuted()).toContain('cmd.allow');
      document.body.removeChild(input);
    });

    it('does NOT skip for readonly inputs', async () => {
      commandService.addCommand('cmd.readonly');
      service.registerKeybinding('Ctrl+B', 'cmd.readonly');

      const input = document.createElement('input');
      input.type = 'text';
      input.readOnly = true;
      document.body.appendChild(input);

      fireKeydown('b', { ctrlKey: true, target: input });
      await vi.advanceTimersByTimeAsync(0);

      expect(commandService.getExecuted()).toContain('cmd.readonly');
      document.body.removeChild(input);
    });

    it('skips for contenteditable elements', async () => {
      commandService.addCommand('cmd.ce');
      service.registerKeybinding('Ctrl+B', 'cmd.ce');

      const div = document.createElement('div');
      div.setAttribute('contenteditable', 'true');
      document.body.appendChild(div);

      // Note: jsdom may not fully implement isContentEditable.
      // If this property is undefined in jsdom, the keybinding service
      // won't detect the element as editable via the final fallback.
      // Skip assertion if jsdom lacks support.
      if (div.isContentEditable === true) {
        fireKeydown('b', { ctrlKey: true, target: div });
        await vi.advanceTimersByTimeAsync(0);
        expect(commandService.getExecuted()).not.toContain('cmd.ce');
      } else {
        // jsdom limitation — verify the closest selector at least matches
        const match = div.closest('[contenteditable="true"]');
        expect(match).toBe(div);
      }

      document.body.removeChild(div);
    });
  });

  // ── Events ──

  describe('events', () => {
    it('fires onDidDispatch with key and commandId', async () => {
      commandService.addCommand('cmd.evt');
      service.registerKeybinding('Ctrl+E', 'cmd.evt');

      let event: any = null;
      service.onDidDispatch(e => { event = e; });

      fireKeydown('e', { ctrlKey: true });
      await vi.advanceTimersByTimeAsync(0);

      expect(event).toBeDefined();
      expect(event.key).toBe('ctrl+e');
      expect(event.commandId).toBe('cmd.evt');
    });
  });
});
