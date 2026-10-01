// keybindingUtils.ts — the keybinding vocabulary, in one place.
//
// Moved here from keybindingContribution.ts by the Retirement phase
// (Part 3.2): these pure functions were the reason the legacy
// contribution processor could not be gutted — the dispatcher, the
// display layer, the extension API, and the shortcuts panel all imported
// their shared vocabulary from the superseded module. Now the vocabulary
// lives with the services that use it, and the processor is only a
// manifest→service forwarder.

/**
 * Keys that may only be bound by their canonical owner command. Contributions
 * (and user rebinds) that try to point one of these at a different command are
 * rejected, so core shortcuts can't be silently shadowed — the failure mode
 * that let Planner steal Ctrl+Shift+P from the Command Palette.
 *
 * Keys are stored in normalized form (see normalizeKeybinding).
 */
export const RESERVED_KEYBINDINGS: ReadonlyMap<string, string> = new Map([
  ['ctrl+shift+p', 'workbench.action.showCommands'],
  ['f1', 'workbench.action.showCommands'],
]);

/** Returns the owner command if `key` (any form) is reserved, else undefined. */
export function reservedKeyOwner(key: string): string | undefined {
  return RESERVED_KEYBINDINGS.get(normalizeKeybinding(key));
}

// ─── Key Normalization ───────────────────────────────────────────────────────

/**
 * Normalize a keybinding string to a canonical form for matching.
 * - Lowercases all parts
 * - Sorts modifiers alphabetically: alt, ctrl, meta, shift
 * - Handles Mac Cmd → Meta mapping
 *
 * Examples:
 * - 'Ctrl+Shift+P' → 'ctrl+shift+p'
 * - 'Shift+Ctrl+P' → 'ctrl+shift+p'
 * - 'Cmd+S' → 'meta+s'
 */
export function normalizeKeybinding(key: string): string {
  const parts = key.toLowerCase().split('+').map(p => p.trim());
  const modifiers: string[] = [];
  let mainKey = '';

  for (const part of parts) {
    switch (part) {
      case 'ctrl':
      case 'control':
        modifiers.push('ctrl');
        break;
      case 'shift':
        modifiers.push('shift');
        break;
      case 'alt':
      case 'option':
        modifiers.push('alt');
        break;
      case 'meta':
      case 'cmd':
      case 'command':
      case 'win':
      case 'super':
        modifiers.push('meta');
        break;
      default:
        mainKey = part;
        break;
    }
  }

  modifiers.sort();
  if (mainKey) {
    modifiers.push(mainKey);
  }
  return modifiers.join('+');
}

/**
 * Convert a keybinding string to a human-readable display form.
 * Uses platform-appropriate modifier names. Chords ("ctrl+k s") keep their
 * space; letters and function keys are upper case ("Ctrl+K S", "Alt+F4"),
 * so every menu, the palette and Keyboard Shortcuts show the same text.
 */
export function formatKeybindingForDisplay(key: string): string {
  const isMac = navigator.platform?.toUpperCase().includes('MAC') ?? false;
  const NAMED: Record<string, string> = {
    escape: 'Esc', esc: 'Esc', enter: 'Enter', return: 'Enter', tab: 'Tab', space: 'Space',
    backspace: 'Backspace', delete: 'Delete', del: 'Delete', insert: 'Insert', home: 'Home', end: 'End',
    pageup: 'PageUp', pagedown: 'PageDown',
    arrowup: '↑', up: '↑', arrowdown: '↓', down: '↓', arrowleft: '←', left: '←', arrowright: '→', right: '→',
  };
  // Modifiers always in one order (Ctrl, Shift, Alt, Win), whatever order the
  // binding was written in ("alt+ctrl+s" and "ctrl+alt+s" read the same).
  const RANK: Record<string, number> = { ctrl: 0, control: 0, shift: 1, alt: 2, option: 2, meta: 3, cmd: 3, command: 3 };
  const ordered = (parts: string[]): string[] => [...parts].sort((a, b) =>
    (RANK[a.toLowerCase()] ?? 9) - (RANK[b.toLowerCase()] ?? 9));
  const chord = (c: string): string => ordered(c.split('+').map(p => p.trim()).filter(Boolean)).map((part) => {
    const lower = part.toLowerCase();
    switch (lower) {
      case 'ctrl':
      case 'control':
        return isMac ? '⌃' : 'Ctrl';
      case 'shift':
        return isMac ? '⇧' : 'Shift';
      case 'alt':
      case 'option':
        return isMac ? '⌥' : 'Alt';
      case 'meta':
      case 'cmd':
      case 'command':
        return isMac ? '⌘' : 'Win';
      default:
        if (NAMED[lower]) return NAMED[lower];
        if (part.length === 1 || /^f\d{1,2}$/i.test(part)) return part.toUpperCase();
        return part.charAt(0).toUpperCase() + part.slice(1);
    }
  }).join(isMac ? '' : '+');
  return key.trim().split(/\s+/).map(chord).join(' ');
}

/**
 * Build a normalized key string from a keyboard event.
 */
export function keyFromEvent(e: KeyboardEvent): string {
  const modifiers: string[] = [];
  if (e.ctrlKey) modifiers.push('ctrl');
  if (e.shiftKey) modifiers.push('shift');
  if (e.altKey) modifiers.push('alt');
  if (e.metaKey) modifiers.push('meta');
  modifiers.sort();

  // Normalize key name
  let key = e.key.toLowerCase();
  // Map common key names
  if (key === ' ') key = 'space';
  if (key === 'escape') key = 'escape';
  if (key === 'enter') key = 'enter';
  if (key === 'tab') key = 'tab';
  if (key === 'backspace') key = 'backspace';
  if (key === 'delete') key = 'delete';
  if (key === 'arrowup') key = 'up';
  if (key === 'arrowdown') key = 'down';
  if (key === 'arrowleft') key = 'left';
  if (key === 'arrowright') key = 'right';

  // Skip if key is only a modifier
  if (['control', 'shift', 'alt', 'meta'].includes(key)) {
    return '';
  }

  modifiers.push(key);
  return modifiers.join('+');
}
