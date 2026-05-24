/**
 * Context key discovery & scope routing (M81 §8 verification gate — closes §22 debt).
 *
 * Manifest M81 §8 listed `contextKeyDiscovery.test.ts` as a required gate
 * before Slice A merge. This file is that gate, retroactively.
 *
 * `ContextKeyService` is the substrate that commands, menus, and keybindings
 * evaluate their `when` clauses against. Three workbench-wide invariants
 * matter and are covered here:
 *
 *   1. Scope hierarchy — a child scope inherits from its parent for
 *      lookups; setting a key on the child masks the parent value.
 *   2. Workbench-wide discovery — `contextMatchesRules` aggregates own
 *      keys from EVERY scope so tool-scoped keys (set in `tool:<id>`
 *      scopes) are visible during global menu/command evaluation.
 *      Without this, contributed when-clauses referencing tool-scoped
 *      keys would silently evaluate to undefined and break.
 *   3. Scope lifecycle — disposing a scope removes its keys from
 *      discovery; recreating the same scope id after disposal works.
 *
 * Lookup-shaped tests cover the typed `createKey<T>` handle and the
 * event-fire contract.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ContextKeyService } from '../../src/context/contextKey.js';

describe('ContextKeyService — scope hierarchy and discovery', () => {
  let svc: ContextKeyService;

  beforeEach(() => {
    svc = new ContextKeyService();
  });

  it('global scope exists at construction', () => {
    expect(svc.hasScope('global')).toBe(true);
  });

  it('child scope inherits parent values', () => {
    svc.setContext('parentKey', true);
    svc.createScope('view:explorer', 'global');
    expect(svc.getContextValue('parentKey', 'view:explorer')).toBe(true);
  });

  it('child override masks parent value, parent unchanged', () => {
    svc.setContext('overrideKey', 'parent');
    svc.createScope('child', 'global');
    svc.setContextInScope('overrideKey', 'child', 'child');
    expect(svc.getContextValue('overrideKey', 'child')).toBe('child');
    expect(svc.getContextValue('overrideKey', 'global')).toBe('parent');
  });

  it('getAllContext walks parent chain', () => {
    svc.setContext('a', 1);
    svc.createScope('child', 'global');
    svc.setContextInScope('b', 2, 'child');
    const all = svc.getAllContext('child');
    expect(all.get('a')).toBe(1);
    expect(all.get('b')).toBe(2);
  });

  it('unknown scopeId falls back to global for reads', () => {
    svc.setContext('k', 'gval');
    expect(svc.getContextValue('k', 'no-such-scope')).toBe('gval');
  });

  it('createKey<T> creates a typed handle bound to a scope', () => {
    const key = svc.createKey<boolean>('myBool', false);
    expect(key.get()).toBe(false);
    key.set(true);
    expect(key.get()).toBe(true);
    expect(svc.getContextValue('myBool')).toBe(true);
    key.reset();
    expect(svc.getContextValue('myBool')).toBeUndefined();
  });

  it('contextMatchesRules aggregates own keys from EVERY scope (workbench-wide discovery)', () => {
    svc.createScope('tool:explorer', 'global');
    svc.setContextInScope('explorerVisible', true, 'tool:explorer');
    // A global when-clause referencing the tool-scoped key must resolve.
    expect(svc.contextMatchesRules('explorerVisible')).toBe(true);
    expect(svc.contextMatchesRules('!explorerVisible')).toBe(false);
  });

  it('contextMatchesRules returns true for empty/undefined when-clause', () => {
    expect(svc.contextMatchesRules(undefined)).toBe(true);
    expect(svc.contextMatchesRules('')).toBe(true);
  });

  it('evaluate honors scope when resolving keys', () => {
    svc.createScope('child', 'global');
    svc.setContextInScope('localKey', true, 'child');
    expect(svc.evaluate('localKey', 'child')).toBe(true);
    // Without aggregation, an evaluate(global) of a child-only key is false.
    expect(svc.evaluate('localKey', 'global')).toBe(false);
  });

  it('scope disposal removes the scope and its keys from discovery', () => {
    const reg = svc.createScope('temp', 'global');
    svc.setContextInScope('tempKey', 'x', 'temp');
    expect(svc.contextMatchesRules('tempKey')).toBe(true);
    reg.dispose();
    expect(svc.hasScope('temp')).toBe(false);
    expect(svc.contextMatchesRules('tempKey')).toBe(false);
  });

  it('recreating a scope id after disposal works', () => {
    const r1 = svc.createScope('reused', 'global');
    r1.dispose();
    const r2 = svc.createScope('reused', 'global');
    expect(svc.hasScope('reused')).toBe(true);
    r2.dispose();
  });

  it('duplicate scope id without disposal is a no-op (warns)', () => {
    svc.createScope('dup', 'global');
    expect(() => svc.createScope('dup', 'global')).not.toThrow();
    expect(svc.hasScope('dup')).toBe(true);
  });

  it('onDidChangeContext fires on set and delete with affectedKeys', () => {
    const events: ReadonlySet<string>[] = [];
    svc.onDidChangeContext((e) => { events.push(e.affectedKeys); });
    svc.setContext('a', 1);
    svc.setContext('a', 1); // same value — should not refire
    svc.setContext('a', 2);
    svc.removeContext('a');
    expect(events.length).toBe(3);
    expect([...events[0]]).toEqual(['a']);
  });

  it('removeContext on missing key is a no-op (no event)', () => {
    const events: unknown[] = [];
    svc.onDidChangeContext((e) => events.push(e));
    svc.removeContext('never-set');
    expect(events.length).toBe(0);
  });
});
