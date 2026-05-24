/**
 * Pin-the-invariant: ChatModeService.
 *
 * Zero prior unit coverage. Pins:
 *  - Default mode is Agent.
 *  - getAvailableModes() returns exactly [Edit, Agent] in that order.
 *  - setMode fires onDidChangeMode exactly once when the mode changes.
 *  - setMode is idempotent — does NOT fire when the new mode equals the
 *    current mode (prevents redundant re-evaluation of mode-dependent UI).
 *  - dispose() releases the emitter (post-dispose setMode is a no-op).
 */

import { describe, expect, it } from 'vitest';
import { ChatModeService } from '../../src/services/chatModeService';
import { ChatMode } from '../../src/services/chatTypes';

describe('ChatModeService', () => {
  it('defaults to Agent mode', () => {
    const svc = new ChatModeService();
    expect(svc.getMode()).toBe(ChatMode.Agent);
    svc.dispose();
  });

  it('getAvailableModes returns [Edit, Agent] in that order', () => {
    const svc = new ChatModeService();
    expect(svc.getAvailableModes()).toEqual([ChatMode.Edit, ChatMode.Agent]);
    svc.dispose();
  });

  it('setMode updates the current mode and fires onDidChangeMode once', () => {
    const svc = new ChatModeService();
    const fired: ChatMode[] = [];
    svc.onDidChangeMode((m) => fired.push(m));
    svc.setMode(ChatMode.Edit);
    expect(svc.getMode()).toBe(ChatMode.Edit);
    expect(fired).toEqual([ChatMode.Edit]);
    svc.dispose();
  });

  it('setMode is idempotent — no fire when setting current mode', () => {
    const svc = new ChatModeService();
    const fired: ChatMode[] = [];
    svc.onDidChangeMode((m) => fired.push(m));
    // Default is Agent; setting Agent should be a no-op.
    svc.setMode(ChatMode.Agent);
    expect(fired).toEqual([]);
    // Now switch and switch again to the same target.
    svc.setMode(ChatMode.Edit);
    svc.setMode(ChatMode.Edit);
    expect(fired).toEqual([ChatMode.Edit]);
    svc.dispose();
  });

  it('round-trip Edit → Agent → Edit fires three change events', () => {
    const svc = new ChatModeService();
    const fired: ChatMode[] = [];
    svc.onDidChangeMode((m) => fired.push(m));
    svc.setMode(ChatMode.Edit);
    svc.setMode(ChatMode.Agent);
    svc.setMode(ChatMode.Edit);
    expect(fired).toEqual([ChatMode.Edit, ChatMode.Agent, ChatMode.Edit]);
    svc.dispose();
  });

  it('after dispose, the change-event listener no longer fires', () => {
    const svc = new ChatModeService();
    const fired: ChatMode[] = [];
    svc.onDidChangeMode((m) => fired.push(m));
    svc.dispose();
    svc.setMode(ChatMode.Edit);
    // Internal _currentMode does update (no guard) but listeners have been
    // detached, so consumers see no notifications.
    expect(fired).toEqual([]);
  });
});
