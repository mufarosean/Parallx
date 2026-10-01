// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { formatKeybindingForDisplay } from '../../src/services/keybindingUtils';

describe('formatKeybindingForDisplay — one way to write a shortcut', () => {
  it('upper-cases letters and function keys, title-cases modifiers', () => {
    expect(formatKeybindingForDisplay('ctrl+shift+h')).toBe('Ctrl+Shift+H');
    expect(formatKeybindingForDisplay('alt+f4')).toBe('Alt+F4');
    expect(formatKeybindingForDisplay('Ctrl+W')).toBe('Ctrl+W');
  });
  it('puts modifiers in one order however the binding was written', () => {
    expect(formatKeybindingForDisplay('alt+ctrl+s')).toBe('Ctrl+Alt+S');
    expect(formatKeybindingForDisplay('shift+ctrl+p')).toBe('Ctrl+Shift+P');
  });
  it('keeps chords as chords', () => {
    expect(formatKeybindingForDisplay('ctrl+k s')).toBe('Ctrl+K S');
    expect(formatKeybindingForDisplay('ctrl+k ctrl+f')).toBe('Ctrl+K Ctrl+F');
  });
  it('names keys the way people say them', () => {
    expect(formatKeybindingForDisplay('escape')).toBe('Esc');
    expect(formatKeybindingForDisplay('alt+arrowleft')).toBe('Alt+←');
    expect(formatKeybindingForDisplay('delete')).toBe('Delete');
  });
});
