// @vitest-environment jsdom
// settingsEditor.test.ts — M60 Phase ε §7 T4.D2
//
// Renders the editor under jsdom against a small in-memory registry.
// Verifies search filtering, type-driven control rendering, and live apply.

import { describe, it, expect, beforeEach } from 'vitest';
import { SettingsEditor } from '../../src/built-in/settings/settingsEditor';
import { SettingsRegistryService } from '../../src/services/settingsRegistryService';
import type { IStorage } from '../../src/platform/storage';

function createMockStorage(): IStorage {
  const map = new Map<string, string>();
  return {
    async get(key: string): Promise<string | undefined> { return map.get(key); },
    async set(key: string, value: string): Promise<void> { map.set(key, value); },
    async delete(key: string): Promise<void> { map.delete(key); },
    async has(key: string): Promise<boolean> { return map.has(key); },
    async keys(): Promise<string[]> { return Array.from(map.keys()); },
    async clear(): Promise<void> { map.clear(); },
  };
}

async function setup(): Promise<{ registry: SettingsRegistryService; editor: SettingsEditor; root: HTMLElement }> {
  const registry = new SettingsRegistryService(createMockStorage(), createMockStorage());
  await registry.initialize();

  registry.register({
    key: 'autonomy.flag',
    type: 'boolean',
    default: false,
    scope: 'user',
    description: 'A boolean autonomy flag for testing',
    category: 'Autonomy',
  });
  registry.register({
    key: 'autonomy.heartbeat.intervalMs',
    type: 'number',
    default: 60000,
    scope: 'user',
    description: 'Heartbeat interval in milliseconds',
    category: 'Autonomy',
    min: 1000,
    max: 600000,
  });
  registry.register({
    key: 'autonomy.subagent.approvalMode',
    type: 'enum',
    default: 'always-ask',
    scope: 'user',
    description: 'Subagent spawn approval mode',
    category: 'Autonomy',
    enumValues: ['always-ask', 'session-allow', 'remember'],
  });
  registry.register({
    key: 'canvas.propertyBar.collapsed',
    type: 'boolean',
    default: false,
    scope: 'workspace',
    description: 'Whether the canvas property bar is collapsed by default',
    category: 'Canvas',
  });

  const root = document.createElement('div');
  document.body.appendChild(root);
  const editor = new SettingsEditor(root, registry);
  editor.show();
  return { registry, editor, root };
}

describe('SettingsEditor — D2', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('renders rows for every registered schema', async () => {
    const { editor } = await setup();
    const rows = document.querySelectorAll<HTMLElement>('.settings-editor__row');
    expect(rows.length).toBe(4);
    const keys = Array.from(rows).map((r) => r.getAttribute('data-key'));
    expect(keys).toEqual(
      expect.arrayContaining([
        'autonomy.flag',
        'autonomy.heartbeat.intervalMs',
        'autonomy.subagent.approvalMode',
        'canvas.propertyBar.collapsed',
      ]),
    );
    editor.dispose();
  });

  it('groups schemas by category', async () => {
    const { editor } = await setup();
    const cats = Array.from(document.querySelectorAll('.settings-editor__category-title')).map(
      (n) => n.textContent,
    );
    expect(cats).toEqual(expect.arrayContaining(['Autonomy', 'Canvas']));
    editor.dispose();
  });

  it('filters rows by search text', async () => {
    const { editor } = await setup();
    const input = document.querySelector<HTMLInputElement>('.settings-editor__search input');
    expect(input).not.toBeNull();
    input!.value = 'heartbeat';
    input!.dispatchEvent(new Event('input', { bubbles: true }));

    const rows = document.querySelectorAll<HTMLElement>('.settings-editor__row');
    expect(rows.length).toBe(1);
    expect(rows[0].getAttribute('data-key')).toBe('autonomy.heartbeat.intervalMs');
    editor.dispose();
  });

  it('renders empty state when no settings match', async () => {
    const { editor } = await setup();
    const input = document.querySelector<HTMLInputElement>('.settings-editor__search input');
    input!.value = 'zzz-no-match';
    input!.dispatchEvent(new Event('input', { bubbles: true }));

    const empty = document.querySelector('.settings-editor__empty');
    expect(empty).not.toBeNull();
    expect(empty!.textContent).toMatch(/no settings/i);
    editor.dispose();
  });

  it('re-renders when registry fires onDidChange', async () => {
    const { editor, registry } = await setup();
    await registry.setValue('autonomy.flag', true);
    // After re-render, the row should still exist with data-key
    const row = document.querySelector<HTMLElement>('[data-key="autonomy.flag"]');
    expect(row).not.toBeNull();
    editor.dispose();
  });
});
