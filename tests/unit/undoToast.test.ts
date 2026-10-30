// @vitest-environment jsdom
// undoToast.test.ts — the kit's Undo toast: what was just removed, with the
// way back for a few seconds. One at a time, announced politely, never
// takes focus, waits while pointed at or focused, closes on Escape.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { showUndoToast, UNDO_TOAST_TIMEOUT_MS, UNDO_TOAST_RESUME_MS } from '../../src/ui/undoToast';

const toasts = () => Array.from(document.querySelectorAll('.px-toast'));

describe('Undo toast', () => {
  beforeEach(() => { vi.useFakeTimers(); document.body.innerHTML = '<button id="before">x</button>'; (document.getElementById('before') as HTMLElement).focus(); });
  afterEach(() => { vi.useRealTimers(); });

  it('says what happened in a polite live region, without taking focus, and goes after its time', () => {
    showUndoToast({ message: '"Clark notes" moved to Trash', undo: () => {} });
    const region = document.querySelector('.px-toast-region')!;
    expect(region.getAttribute('role')).toBe('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(toasts()[0].textContent).toContain('"Clark notes" moved to Trash');
    expect(document.activeElement?.id).toBe('before');
    const [undo, dismiss] = Array.from(toasts()[0].querySelectorAll('button'));
    expect(undo.textContent).toContain('Undo');
    expect(undo.querySelector('svg, .px-icon, i, span')).not.toBeNull();
    expect(dismiss.getAttribute('aria-label')).toBe('Dismiss');
    vi.advanceTimersByTime(UNDO_TOAST_TIMEOUT_MS - 1);
    expect(toasts()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(toasts()).toHaveLength(0);
  });

  it('Undo runs the way back once and closes', async () => {
    const undo = vi.fn();
    showUndoToast({ message: 'Moved', undo });
    const btn = toasts()[0].querySelector('button')!;
    btn.click(); btn.click();
    await Promise.resolve();
    expect(undo).toHaveBeenCalledTimes(1);
    expect(toasts()).toHaveLength(0);
  });

  it('a new toast replaces the old one, whose Undo is gone', () => {
    const first = vi.fn();
    showUndoToast({ message: 'One', undo: first });
    showUndoToast({ message: 'Two', undo: () => {} });
    expect(toasts().map((t) => t.textContent)).toEqual([expect.stringContaining('Two')]);
    expect(first).not.toHaveBeenCalled();
  });

  it('waits while pointed at, then leaves time to reach Undo', () => {
    showUndoToast({ message: 'Moved', undo: () => {}, timeoutMs: 1000 });
    const t = toasts()[0];
    vi.advanceTimersByTime(900);
    t.dispatchEvent(new Event('pointerenter'));
    vi.advanceTimersByTime(60_000);
    expect(toasts()).toHaveLength(1);
    t.dispatchEvent(new Event('pointerleave'));
    vi.advanceTimersByTime(UNDO_TOAST_RESUME_MS - 1);
    expect(toasts()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(toasts()).toHaveLength(0);
  });

  it('Escape from inside closes it and gives focus back to where it came from', () => {
    showUndoToast({ message: 'Moved', undo: () => {} });
    const btn = toasts()[0].querySelector('button')!;
    const before = document.getElementById('before')!;
    btn.dispatchEvent(new FocusEvent('focusin', { bubbles: true, relatedTarget: before }));
    btn.focus();
    btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(toasts()).toHaveLength(0);
    expect(document.activeElement).toBe(before);
  });

  it('a failing undo is reported, not thrown', async () => {
    const onError = vi.fn();
    showUndoToast({ message: 'Moved', undo: async () => { throw new Error('gone'); }, onError });
    toasts()[0].querySelector('button')!.click();
    await vi.runAllTimersAsync();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'gone' }));
  });
});
