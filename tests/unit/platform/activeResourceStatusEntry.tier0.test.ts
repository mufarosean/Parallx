// activeResourceStatusEntry.tier0.test.ts — Slice B4
//
// Verifies the status-bar reader of IContextService produces the right
// text/tooltip for each ResourceType variant and clears when no resource
// is active.

import { describe, it, expect, beforeEach } from 'vitest';
import { Emitter } from '../../../src/platform/events.js';
import { bindActiveResourceStatusEntry } from '../../../src/workbench/resources/activeResourceStatusEntry.js';
import type { WorkbenchContext } from '../../../src/workbench/resources/contextService.js';

class FakeContextService {
  readonly _emitter = new Emitter<WorkbenchContext>();
  readonly onDidChangeContext = this._emitter.event;
  current: WorkbenchContext = {
    workspaceId: undefined,
    activeSurface: undefined,
    activeSelection: undefined,
    activeResource: undefined,
    activeSurfaceKind: undefined,
    activeResourceType: undefined,
  };
  getContext(): WorkbenchContext { return this.current; }
  matches(p: (c: WorkbenchContext) => boolean): boolean { return p(this.current); }
  set(next: Partial<WorkbenchContext>): void {
    this.current = { ...this.current, ...next };
    this._emitter.fire(this.current);
  }
}

interface FakeEntry { id: string; text: string; tooltip: string; alignment: string; priority: number; disposed: boolean; }

class FakeStatusBar {
  entries: FakeEntry[] = [];
  addEntry(entry: { id: string; text: string; tooltip?: string; alignment: unknown; priority?: number; name?: string }): {
    update(p: { text?: string; tooltip?: string }): void;
    dispose(): void;
  } {
    const stored: FakeEntry = {
      id: entry.id,
      text: entry.text,
      tooltip: entry.tooltip ?? '',
      alignment: typeof entry.alignment === 'string' ? entry.alignment : (entry.alignment === 1 ? 'right' : 'left'),
      priority: entry.priority ?? 0,
      disposed: false,
    };
    this.entries.push(stored);
    return {
      update(p) {
        if (p.text !== undefined) stored.text = p.text;
        if (p.tooltip !== undefined) stored.tooltip = p.tooltip;
      },
      dispose() { stored.disposed = true; },
    };
  }
  get only(): FakeEntry { return this.entries[0]; }
}

function make() {
  const ctx = new FakeContextService();
  const sb = new FakeStatusBar();
  const binding = bindActiveResourceStatusEntry(
    sb as unknown as Parameters<typeof bindActiveResourceStatusEntry>[0],
    ctx as unknown as Parameters<typeof bindActiveResourceStatusEntry>[1],
  );
  return { ctx, sb, binding };
}

describe('activeResourceStatusEntry (Slice B4)', () => {
  let env: ReturnType<typeof make>;
  beforeEach(() => { env = make(); });

  it('registers a single right-aligned entry with id status.activeResourceType', () => {
    expect(env.sb.entries).toHaveLength(1);
    expect(env.sb.only.id).toBe('status.activeResourceType');
    expect(env.sb.only.alignment).toBe('right');
    env.binding.dispose();
  });

  it('seeds with empty text when no resource is active', () => {
    expect(env.sb.only.text).toBe('');
    expect(env.sb.only.tooltip).toBe('No active resource');
    env.binding.dispose();
  });

  it('shows "File" for file resources', () => {
    env.ctx.set({ activeSurfaceKind: 'editor', activeResourceType: 'file' });
    expect(env.sb.only.text).toBe('File');
    expect(env.sb.only.tooltip).toBe('Active resource: file (on editor)');
    env.binding.dispose();
  });

  it('shows "Canvas" for canvas-page resources', () => {
    env.ctx.set({ activeSurfaceKind: 'editor', activeResourceType: 'canvas-page' });
    expect(env.sb.only.text).toBe('Canvas');
    env.binding.dispose();
  });

  it('shows "Chat" for chat-session resources', () => {
    env.ctx.set({ activeSurfaceKind: 'chat', activeResourceType: 'chat-session' });
    expect(env.sb.only.text).toBe('Chat');
    expect(env.sb.only.tooltip).toBe('Active resource: chat-session (on chat)');
    env.binding.dispose();
  });

  it('shows "Artifact" for tool-artifact resources', () => {
    env.ctx.set({ activeSurfaceKind: 'editor', activeResourceType: 'tool-artifact' });
    expect(env.sb.only.text).toBe('Artifact');
    env.binding.dispose();
  });

  it('clears when activeResourceType returns to undefined', () => {
    env.ctx.set({ activeSurfaceKind: 'editor', activeResourceType: 'file' });
    expect(env.sb.only.text).toBe('File');
    env.ctx.set({ activeSurfaceKind: undefined, activeResourceType: undefined });
    expect(env.sb.only.text).toBe('');
    expect(env.sb.only.tooltip).toBe('No active resource');
    env.binding.dispose();
  });

  it('syncNow re-reads without an event', () => {
    env.ctx.current = { ...env.ctx.current, activeSurfaceKind: 'editor', activeResourceType: 'file' };
    expect(env.sb.only.text).toBe('');
    env.binding.syncNow();
    expect(env.sb.only.text).toBe('File');
    env.binding.dispose();
  });

  it('dispose stops updates and disposes the entry accessor', () => {
    env.ctx.set({ activeSurfaceKind: 'editor', activeResourceType: 'file' });
    env.binding.dispose();
    expect(env.sb.only.disposed).toBe(true);
    const before = env.sb.only.text;
    env.ctx.set({ activeSurfaceKind: 'chat', activeResourceType: 'chat-session' });
    expect(env.sb.only.text).toBe(before);
  });
});
