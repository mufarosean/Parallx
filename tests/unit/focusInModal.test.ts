// @vitest-environment jsdom
// focusInModal.test.ts — with a dialog open, F6 keeps the keyboard's focus in
// it. It used to move the focus to the window's areas behind Settings, and
// Escape (which the dialog hears from inside) then no longer closed it.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { keepFocusInModal, modalOnTop } from '../../src/ui/dom';
import { Overlay } from '../../src/ui/overlay';
import { focusNextPart, focusPreviousPart } from '../../src/commands/focusCommands';
import type { CommandExecutionContext } from '../../src/commands/commandTypes';

afterEach(() => { document.body.innerHTML = ''; });

/** A workbench as the focus commands see it: every part showing, the editor focused. */
function workbench() {
  const focusPart = vi.fn();
  const w = { focusPart, isPartVisible: () => true, hasFocus: (id: string) => id === 'workbench.parts.editor' };
  const ctx = { getService: () => undefined, workbench: w, origin: 'keybinding' } as unknown as CommandExecutionContext;
  return { ctx, focusPart };
}

function settings() {
  const overlay = new Overlay(document.body, { label: 'Settings' });
  const field = document.createElement('input');
  const button = document.createElement('button');
  overlay.contentElement.append(field, button);
  overlay.show();
  return { overlay, field, button };
}

describe('the dialog that has the window', () => {
  it('is the one opened last; a notice with buttons in the corner is not one', () => {
    expect(modalOnTop()).toBeNull();
    const notice = document.createElement('div');
    notice.className = 'parallx-notification parallx-notification--prompt';
    notice.setAttribute('aria-modal', 'true');
    document.body.appendChild(notice);
    expect(modalOnTop()).toBeNull();
    const s = settings();
    expect(modalOnTop()).toBe(s.overlay.contentElement);
    const confirm = document.createElement('div');
    confirm.setAttribute('aria-modal', 'true');
    document.body.appendChild(confirm);
    expect(modalOnTop()).toBe(confirm);
    confirm.remove();
    s.overlay.hide();
    expect(modalOnTop()).toBeNull();
    s.overlay.dispose();
  });

  it('gets the focus back when it has gone behind it, on its first control', () => {
    const behind = document.createElement('button');
    document.body.appendChild(behind);
    const s = settings();
    s.button.focus();
    expect(keepFocusInModal()).toBe(true);
    expect(document.activeElement).toBe(s.button); // already inside: left where it is
    behind.focus();
    expect(keepFocusInModal()).toBe(true);
    expect(document.activeElement).toBe(s.field);
    s.overlay.dispose();
    expect(keepFocusInModal()).toBe(false);
  });

  it('takes the focus itself when it has no control', () => {
    const bare = document.createElement('div');
    bare.setAttribute('aria-modal', 'true');
    document.body.appendChild(bare);
    expect(keepFocusInModal()).toBe(true);
    expect(document.activeElement).toBe(bare);
  });
});

describe('F6 with a dialog open', () => {
  it('leaves the window\'s areas alone and keeps the focus in the dialog, so Escape still closes it', () => {
    const s = settings();
    s.field.focus();
    const w = workbench();
    void focusNextPart.handler(w.ctx);
    void focusPreviousPart.handler(w.ctx);
    expect(w.focusPart).not.toHaveBeenCalled();
    expect(s.overlay.contentElement.contains(document.activeElement)).toBe(true);
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(s.overlay.visible).toBe(false);
    s.overlay.dispose();
  });

  it('moves between the window\'s areas as before when no dialog is open', () => {
    const w = workbench();
    void focusNextPart.handler(w.ctx);
    expect(w.focusPart).toHaveBeenCalledWith('workbench.parts.panel');
    void focusPreviousPart.handler(w.ctx);
    expect(w.focusPart).toHaveBeenLastCalledWith('workbench.parts.sidebar');
  });
});
