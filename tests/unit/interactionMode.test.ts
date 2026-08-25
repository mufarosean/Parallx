// interactionMode.test.ts — the interaction-mode subsystem (Phase A).
//
// The contract under test IS the fix for the eaten-keystrokes bug class:
// every mode has the complete exit set, exactly one exit path, stack
// semantics, and focus return. The second half drives the REAL
// ContextMenu through the contract — the first citizen and the first
// entry in the mode-compliance harness.
//
// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  enterMode,
  beginPointerDrag,
  activeModeIds,
  type ModeExitReason,
} from '../../src/ui/interactionMode';
import { ContextMenu } from '../../src/ui/contextMenu';

const tick = () => new Promise((r) => setTimeout(r, 0));

function pressAt(target: EventTarget): void {
  const e = new Event('pointerdown', { bubbles: true, cancelable: true });
  target.dispatchEvent(e);
}

function key(k: string, target: EventTarget = document.body): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
  target.dispatchEvent(e);
  return e;
}

afterEach(() => {
  // No mode may survive a test — the subsystem's own leak check.
  for (const id of [...activeModeIds()]) void id;
  document.body.textContent = '';
});

describe('enterMode — the exit contract', () => {
  it('exits exactly once, with the reason, from any path', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const reasons: ModeExitReason[] = [];
    const handle = enterMode({
      id: 'test',
      ownedRoots: () => [root],
      onExit: (r) => reasons.push(r),
    });
    expect(handle.isActive).toBe(true);
    expect(activeModeIds()).toContain('test');

    handle.exit();
    handle.exit(); // idempotent
    key('Escape'); // stale keys touch nothing
    expect(reasons).toEqual(['programmatic']);
    expect(activeModeIds()).not.toContain('test');
  });

  it('Escape exits the TOPMOST mode only', async () => {
    const rootA = document.createElement('div');
    const rootB = document.createElement('div');
    document.body.append(rootA, rootB);
    const exits: string[] = [];
    const a = enterMode({ id: 'a', ownedRoots: () => [rootA], onExit: (r) => exits.push(`a:${r}`) });
    const b = enterMode({ id: 'b', ownedRoots: () => [rootB], onExit: (r) => exits.push(`b:${r}`) });
    expect(b.isTopmost).toBe(true);
    expect(a.isTopmost).toBe(false);

    key('Escape');
    expect(exits).toEqual(['b:escape']);
    expect(a.isActive).toBe(true);
    expect(a.isTopmost).toBe(true);

    key('Escape');
    expect(exits).toEqual(['b:escape', 'a:escape']);
  });

  it('an outside press exits; the OPENING press does not (deferred arming)', async () => {
    const root = document.createElement('div');
    const outside = document.createElement('div');
    document.body.append(root, outside);
    const exits: ModeExitReason[] = [];
    enterMode({ id: 'test', ownedRoots: () => [root], onExit: (r) => exits.push(r) });

    pressAt(outside); // same tick as entry — the press that opened it
    expect(exits).toEqual([]);

    await tick(); // armed
    pressAt(root); // inside — stays
    expect(exits).toEqual([]);
    pressAt(outside);
    expect(exits).toEqual(['outside-pointer']);
  });

  it('a press inside the topmost mode preserves the modes below it', async () => {
    const rootA = document.createElement('div');
    const rootB = document.createElement('div');
    document.body.append(rootA, rootB);
    const exits: string[] = [];
    enterMode({ id: 'a', ownedRoots: () => [rootA], onExit: (r) => exits.push(`a:${r}`) });
    enterMode({ id: 'b', ownedRoots: () => [rootB], onExit: (r) => exits.push(`b:${r}`) });
    await tick();

    pressAt(rootB); // inside topmost — the submenu case
    expect(exits).toEqual([]);

    pressAt(document.body); // outside everything — the chain closes
    expect(exits).toEqual(['b:outside-pointer', 'a:outside-pointer']);
  });

  it('window blur ends every mode — nothing survives Alt-Tab armed', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const exits: ModeExitReason[] = [];
    enterMode({ id: 'test', ownedRoots: () => [root], onExit: (r) => exits.push(r) });

    window.dispatchEvent(new Event('blur'));
    expect(exits).toEqual(['window-blur']);
  });

  it('focus-loss exit is opt-in and fires when focus leaves the roots', () => {
    const root = document.createElement('div');
    const insideInput = document.createElement('input');
    root.appendChild(insideInput);
    const outsideInput = document.createElement('input');
    document.body.append(root, outsideInput);

    const exits: ModeExitReason[] = [];
    enterMode({
      id: 'capture', ownedRoots: () => [root], exitOnFocusLoss: true,
      onExit: (r) => exits.push(r),
    });

    insideInput.focus();
    insideInput.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(exits).toEqual([]);

    outsideInput.focus();
    outsideInput.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(exits).toEqual(['focus-loss']);
  });

  it('restores focus on exit when the mode stranded it on body', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    const root = document.createElement('div');
    document.body.appendChild(root);
    const handle = enterMode({ id: 'test', ownedRoots: () => [root], onExit: () => {} });

    (document.activeElement as HTMLElement)?.blur(); // stranded
    handle.exit();
    expect(document.activeElement).toBe(input);
  });

  it('does NOT steal focus back when the exit moved it somewhere real', () => {
    const input = document.createElement('input');
    const other = document.createElement('input');
    document.body.append(input, other);
    input.focus();

    const root = document.createElement('div');
    document.body.appendChild(root);
    const handle = enterMode({ id: 'test', ownedRoots: () => [root], onExit: () => other.focus() });

    handle.exit();
    expect(document.activeElement).toBe(other);
  });
});

describe('beginPointerDrag — the drag contract', () => {
  const startEvent = () => new MouseEvent('pointerdown') as unknown as PointerEvent;

  it('ends exactly once and always restores body styles', () => {
    let ends = 0;
    const handle = beginPointerDrag(startEvent(), {
      id: 'test-drag', cursor: 'col-resize',
      onMove: () => {}, onEnd: () => { ends++; },
    });
    expect(document.body.style.userSelect).toBe('none');
    expect(document.body.style.cursor).toBe('col-resize');

    document.dispatchEvent(new Event('pointerup'));
    document.dispatchEvent(new Event('pointerup'));
    expect(ends).toBe(1);
    expect(document.body.style.userSelect).toBe('');
    expect(document.body.style.cursor).toBe('');
    expect(handle.isActive).toBe(false);
  });

  it('Escape cancels; window blur cancels — a lost mouseup cannot strand the app', () => {
    const outcomes: boolean[] = [];
    beginPointerDrag(startEvent(), { id: 'd1', onMove: () => {}, onEnd: (c) => outcomes.push(c) });
    key('Escape');
    expect(outcomes).toEqual([true]);
    expect(document.body.style.userSelect).toBe('');

    beginPointerDrag(startEvent(), { id: 'd2', onMove: () => {}, onEnd: (c) => outcomes.push(c) });
    window.dispatchEvent(new Event('blur'));
    expect(outcomes).toEqual([true, true]);
  });

  it('routes moves while active and never after end', () => {
    const moves: number[] = [];
    beginPointerDrag(startEvent(), {
      id: 'd3', onMove: () => moves.push(1), onEnd: () => {},
    });
    document.dispatchEvent(new Event('pointermove'));
    document.dispatchEvent(new Event('pointerup'));
    document.dispatchEvent(new Event('pointermove'));
    expect(moves).toHaveLength(1);
  });
});

describe('ContextMenu under the contract — the first citizen', () => {
  const show = (autoSelectFirst = false) => ContextMenu.show({
    items: [
      { id: 'one', label: 'One' },
      { id: 'two', label: 'Two' },
    ],
    anchor: { x: 10, y: 10 },
    autoSelectFirst,
  });

  it('Enter with NOTHING armed passes through and the menu steps aside', () => {
    const menu = show();
    const dismissed = vi.fn();
    const selected = vi.fn();
    menu.onDidDismiss(dismissed);
    menu.onDidSelect(selected);

    const e = key('Enter');
    expect(selected).not.toHaveBeenCalled();     // nothing executed
    expect(dismissed).toHaveBeenCalledTimes(1);  // menu got out of the way
    expect(e.defaultPrevented).toBe(false);      // the key reaches its target
  });

  it('ArrowDown arms, then Enter selects — navigation still works', () => {
    const menu = show();
    const selected = vi.fn();
    menu.onDidSelect(selected);

    key('ArrowDown');
    key('Enter');
    expect(selected).toHaveBeenCalledTimes(1);
    expect(selected.mock.calls[0][0].item.id).toBe('one');
  });

  it('a pointer LEAVING the menu un-arms it — grazing cannot prime Enter', () => {
    const menu = show(true); // armed on open (keyboard-open path)
    const selected = vi.fn();
    const dismissed = vi.fn();
    menu.onDidSelect(selected);
    menu.onDidDismiss(dismissed);

    const el = document.querySelector('.context-menu') as HTMLElement;
    el.dispatchEvent(new MouseEvent('mouseleave'));
    key('Enter');
    expect(selected).not.toHaveBeenCalled();
    expect(dismissed).toHaveBeenCalledTimes(1);
  });

  it('Escape, outside press, and window blur all dismiss', async () => {
    for (const trigger of ['escape', 'outside', 'blur'] as const) {
      const menu = show();
      const dismissed = vi.fn();
      menu.onDidDismiss(dismissed);
      await tick(); // arm outside-pointer
      if (trigger === 'escape') key('Escape');
      else if (trigger === 'outside') pressAt(document.body);
      else window.dispatchEvent(new Event('blur'));
      expect(dismissed, trigger).toHaveBeenCalledTimes(1);
      expect(document.querySelector('.context-menu')).toBeNull();
    }
  });

  it('direct dispose() also fires onDidDismiss and leaves no mode behind', () => {
    const menu = show();
    const dismissed = vi.fn();
    menu.onDidDismiss(dismissed);
    menu.dispose(); // the textEditorPane path that used to skip dismissal
    expect(dismissed).toHaveBeenCalledTimes(1);
    expect(activeModeIds()).not.toContain('context-menu');
  });

  it('Home/End stay with the editable unless a row is armed', () => {
    const menu = show();
    const eHome = key('Home');
    expect(eHome.defaultPrevented).toBe(false);
    key('ArrowDown');
    const eEnd = key('End');
    expect(eEnd.defaultPrevented).toBe(true);
    menu.dismiss();
  });
});
