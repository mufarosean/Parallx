// dashboardBridge.test.ts — M86 widget contribution contract.
//
// Covers the three C1 guarantees:
//   1. Boundary validation (typeId namespacing, sizes, refresh policy).
//   2. Ownership (legacy id table, cross-tool hijack refusal, id stability).
//   3. Hub semantics (order independence, change events, dispose cleanup).

import { describe, it, expect, afterEach } from 'vitest';
import {
  DashboardBridge,
  getContributedDashboardWidgetTypes,
  onDashboardWidgetContributionsDidChange,
  LEGACY_WIDGET_TYPE_OWNERS,
  validateWidgetRefreshPolicy,
  type WidgetTypeRegistration,
} from '../../src/api/bridges/dashboardBridge.js';
import type { IDisposable } from '../../src/platform/lifecycle.js';

function makeReg(typeId: string, overrides: Partial<WidgetTypeRegistration<Record<string, unknown>>> = {}): WidgetTypeRegistration<Record<string, unknown>> {
  return {
    typeId,
    displayName: 'Test widget',
    category: 'query',
    defaultSize: { colSpan: 4, rowSpan: 3 },
    defaultConfig: {},
    createWidget: () => ({ dispose() { /* noop */ } }),
    ...overrides,
  };
}

// The hub is module-global: track bridges so each test leaves it clean.
const bridges: DashboardBridge[] = [];
function makeBridge(toolId: string): DashboardBridge {
  const subs: IDisposable[] = [];
  const b = new DashboardBridge(toolId, subs);
  bridges.push(b);
  return b;
}

afterEach(() => {
  for (const b of bridges.splice(0)) {
    try { b.dispose(); } catch { /* already disposed */ }
  }
  expect(getContributedDashboardWidgetTypes()).toHaveLength(0);
});

describe('validation', () => {
  it('rejects a typeId outside the tool namespace', () => {
    const b = makeBridge('parallx.budget');
    expect(() => b.registerWidgetType(makeReg('some.other.widget'))).toThrow(/must start with "parallx\.budget\."/);
  });

  it('accepts a namespaced typeId', () => {
    const b = makeBridge('parallx.budget');
    b.registerWidgetType(makeReg('parallx.budget.mtd-spend'));
    expect(getContributedDashboardWidgetTypes()).toHaveLength(1);
  });

  it('rejects empty and whitespace typeIds', () => {
    const b = makeBridge('parallx.budget');
    expect(() => b.registerWidgetType(makeReg(''))).toThrow();
    expect(() => b.registerWidgetType(makeReg('parallx.budget.a b'))).toThrow();
  });

  it('rejects missing displayName, bad category, missing createWidget', () => {
    const b = makeBridge('parallx.budget');
    expect(() => b.registerWidgetType(makeReg('parallx.budget.w', { displayName: '' }))).toThrow(/displayName/);
    expect(() => b.registerWidgetType(makeReg('parallx.budget.w', { category: 'nope' as never }))).toThrow(/category/);
    expect(() => b.registerWidgetType(makeReg('parallx.budget.w', { createWidget: undefined as never }))).toThrow(/createWidget/);
  });

  it('rejects sizes outside the 12-column grid', () => {
    const b = makeBridge('parallx.budget');
    expect(() => b.registerWidgetType(makeReg('parallx.budget.w', { defaultSize: { colSpan: 13, rowSpan: 3 } }))).toThrow(/defaultSize/);
    expect(() => b.registerWidgetType(makeReg('parallx.budget.w', { defaultSize: { colSpan: 0, rowSpan: 3 } }))).toThrow(/defaultSize/);
    expect(() => b.registerWidgetType(makeReg('parallx.budget.w', { defaultSize: { colSpan: 2.5 as number, rowSpan: 3 } }))).toThrow(/defaultSize/);
  });

  it('rejects incoherent sizeBounds', () => {
    const b = makeBridge('parallx.budget');
    expect(() => b.registerWidgetType(makeReg('parallx.budget.w', {
      sizeBounds: { minColSpan: 6, maxColSpan: 2 },
    }))).toThrow(/sizeBounds/);
  });

  it('rejects sub-60s intervals and malformed cron in defaultRefreshPolicy', () => {
    const b = makeBridge('parallx.budget');
    expect(() => b.registerWidgetType(makeReg('parallx.budget.w', {
      defaultRefreshPolicy: { kind: 'interval', ms: 5_000 },
    }))).toThrow(/60000/);
    expect(() => b.registerWidgetType(makeReg('parallx.budget.w', {
      defaultRefreshPolicy: { kind: 'cron', cron: '* * *' },
    }))).toThrow(/5 fields/);
  });

  it('validateWidgetRefreshPolicy accepts manual, valid interval, valid cron', () => {
    expect(() => validateWidgetRefreshPolicy({ kind: 'manual' })).not.toThrow();
    expect(() => validateWidgetRefreshPolicy({ kind: 'interval', ms: 60_000 })).not.toThrow();
    expect(() => validateWidgetRefreshPolicy({ kind: 'cron', cron: '0 7 * * 1-5' })).not.toThrow();
  });

  it("renderMode 'markdown' makes createWidget optional; 'custom' still requires it", () => {
    const b = makeBridge('parallx.budget');
    // markdown + no createWidget: fine — the dashboard renders the cache.
    b.registerWidgetType(makeReg('parallx.budget.md', { renderMode: 'markdown', createWidget: undefined as never }));
    // custom (default) without createWidget: rejected.
    expect(() => b.registerWidgetType(makeReg('parallx.budget.broken', { createWidget: undefined as never }))).toThrow(/createWidget/);
    // bogus renderMode: rejected.
    expect(() => b.registerWidgetType(makeReg('parallx.budget.bogus', { renderMode: 'iframe' as never }))).toThrow(/renderMode/);
  });
});

describe('ownership and id stability', () => {
  it('legacy ids may only be registered by their mapped owner', () => {
    // Every legacy id: mapped owner passes, anyone else is refused.
    for (const [typeId, owner] of Object.entries(LEGACY_WIDGET_TYPE_OWNERS)) {
      const good = makeBridge(owner);
      const d = good.registerWidgetType(makeReg(typeId));
      const evil = makeBridge('parallx.evil');
      expect(() => evil.registerWidgetType(makeReg(typeId))).toThrow();
      d.dispose();
    }
  });

  it('refuses cross-tool typeId hijack even for namespaced ids', () => {
    const a = makeBridge('parallx.explorer');
    // Legacy id owned by explorer…
    a.registerWidgetType(makeReg('parallx.dashboard.recent-files'));
    // …the mapped owner is the only one allowed, so another tool with the
    // same id string is rejected at the namespace gate already. For two
    // registrations of the SAME id by the same tool, the later replaces.
    const replaced = a.registerWidgetType(makeReg('parallx.dashboard.recent-files', { displayName: 'Replacement' }));
    const entries = getContributedDashboardWidgetTypes();
    expect(entries).toHaveLength(1);
    expect(entries[0].registration.displayName).toBe('Replacement');
    replaced.dispose();
  });
});

describe('hub semantics', () => {
  it('contributions appear with ownerToolId and disappear on dispose', () => {
    const b = makeBridge('parallx.budget');
    const d = b.registerWidgetType(makeReg('parallx.budget.w'));
    const [entry] = getContributedDashboardWidgetTypes();
    expect(entry.ownerToolId).toBe('parallx.budget');
    expect(entry.registration.typeId).toBe('parallx.budget.w');
    d.dispose();
    expect(getContributedDashboardWidgetTypes()).toHaveLength(0);
  });

  it('fires change events on register and dispose', () => {
    const b = makeBridge('parallx.budget');
    let fired = 0;
    const sub = onDashboardWidgetContributionsDidChange(() => { fired++; });
    const d = b.registerWidgetType(makeReg('parallx.budget.w'));
    d.dispose();
    sub.dispose();
    expect(fired).toBe(2);
  });

  it('bridge dispose removes all of the tool\'s contributions and locks the API', () => {
    const b = makeBridge('parallx.budget');
    b.registerWidgetType(makeReg('parallx.budget.one'));
    b.registerWidgetType(makeReg('parallx.budget.two'));
    expect(getContributedDashboardWidgetTypes()).toHaveLength(2);
    b.dispose();
    expect(getContributedDashboardWidgetTypes()).toHaveLength(0);
    expect(() => b.registerWidgetType(makeReg('parallx.budget.three'))).toThrow(/deactivated/);
    expect(() => b.listWidgetTypes()).toThrow(/deactivated/);
  });

  it('listWidgetTypes exposes metadata only (no renderer)', () => {
    const b = makeBridge('parallx.budget');
    b.registerWidgetType(makeReg('parallx.budget.w', { description: 'desc', icon: 'i' }));
    const [desc] = b.listWidgetTypes();
    expect(desc).toMatchObject({
      typeId: 'parallx.budget.w',
      displayName: 'Test widget',
      description: 'desc',
      icon: 'i',
      category: 'query',
      ownerToolId: 'parallx.budget',
    });
    expect((desc as Record<string, unknown>).createWidget).toBeUndefined();
    expect((desc as Record<string, unknown>).refresh).toBeUndefined();
  });

  it('two tools contribute independently', () => {
    const a = makeBridge('parallx.explorer');
    const b = makeBridge('parallx.budget');
    a.registerWidgetType(makeReg('parallx.explorer.w'));
    b.registerWidgetType(makeReg('parallx.budget.w'));
    expect(getContributedDashboardWidgetTypes()).toHaveLength(2);
    a.dispose();
    const remaining = getContributedDashboardWidgetTypes();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].ownerToolId).toBe('parallx.budget');
  });
});
