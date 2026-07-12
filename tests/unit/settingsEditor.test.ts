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

async function setup(
  extraSchemas: readonly Parameters<SettingsRegistryService['register']>[0][] = [],
): Promise<{ registry: SettingsRegistryService; editor: SettingsEditor; root: HTMLElement }> {
  const registry = new SettingsRegistryService(createMockStorage(), createMockStorage());
  await registry.initialize();
  for (const schema of extraSchemas) registry.register(schema);

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

  it('renders every registered schema across the category nav', async () => {
    // Two-pane hub: each category renders its rows in the content pane when
    // selected. Walk the nav and gather every key that appears.
    const { editor } = await setup();
    const navItems = Array.from(document.querySelectorAll<HTMLElement>('.settings-editor__nav-item'));
    const keys = new Set<string>();
    for (const item of navItems) {
      item.click();
      document.querySelectorAll<HTMLElement>('.settings-editor__row').forEach((r) => {
        const k = r.getAttribute('data-key');
        if (k) keys.add(k);
      });
    }
    expect(keys).toEqual(new Set([
      'autonomy.flag',
      'autonomy.heartbeat.intervalMs',
      'autonomy.subagent.approvalMode',
      'canvas.propertyBar.collapsed',
    ]));
    editor.dispose();
  });

  it('routes categories through the curated taxonomy (M85 IA)', async () => {
    const { editor } = await setup();
    const items = Array.from(document.querySelectorAll('.settings-editor__nav-item')).map(
      (n) => n.textContent,
    );
    // 'Canvas' is a single-member group → renders flat under the group name.
    expect(items).toContain('Canvas');
    // 'Autonomy' is claimed by the AI group; as its only present member the
    // group collapses to one flat item carrying the GROUP's name.
    expect(items).toContain('AI');
    expect(items).not.toContain('Autonomy');
    editor.dispose();
  });

  it('renders group headers when a group has multiple members', async () => {
    // Autonomy + Persona are both AI-group members → header + two children.
    const { editor } = await setup([{
      key: 'persona.name',
      type: 'string',
      default: '',
      scope: 'user',
      description: 'Persona display name',
      category: 'Persona',
    }]);
    const headers = Array.from(document.querySelectorAll('.settings-editor__nav-group')).map((n) => n.textContent);
    expect(headers).toContain('AI');
    const children = Array.from(document.querySelectorAll('.settings-editor__nav-item--child')).map((n) => n.textContent);
    expect(children).toEqual(expect.arrayContaining(['Autonomy', 'Persona']));
    editor.dispose();
  });

  it('routes unknown categories into the Extensions group', async () => {
    const { editor } = await setup([
      {
        key: 'someext.feature.enabled',
        type: 'boolean',
        default: false,
        scope: 'user',
        description: 'An extension setting with an unclaimed category',
        category: 'Some Extension',
      },
      {
        key: 'otherext.mode',
        type: 'string',
        default: '',
        scope: 'user',
        description: 'Another unclaimed extension category',
        category: 'Other Extension',
      },
    ]);
    const headers = Array.from(document.querySelectorAll('.settings-editor__nav-group')).map((n) => n.textContent);
    expect(headers).toContain('Extensions');
    const children = Array.from(document.querySelectorAll('.settings-editor__nav-item--child')).map((n) => n.textContent);
    expect(children).toEqual(expect.arrayContaining(['Other Extension', 'Some Extension']));
    editor.dispose();
  });

  it('rows lead with a humanized title; the raw key is metadata', async () => {
    const { editor } = await setup();
    // Select the Canvas nav item so its row renders.
    const canvasItem = Array.from(document.querySelectorAll<HTMLElement>('.settings-editor__nav-item'))
      .find((n) => n.textContent === 'Canvas')!;
    canvasItem.click();
    const row = document.querySelector<HTMLElement>('[data-key="canvas.propertyBar.collapsed"]')!;
    expect(row.querySelector('.settings-editor__row-title')?.textContent).toBe('Property Bar › Collapsed');
    expect(row.querySelector('.settings-editor__row-key')?.textContent).toBe('canvas.propertyBar.collapsed');
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
    // Select the AI item (Autonomy's group) so its rows are the visible page.
    const aiItem = Array.from(document.querySelectorAll<HTMLElement>('.settings-editor__nav-item'))
      .find((n) => n.textContent === 'AI')!;
    aiItem.click();
    await registry.setValue('autonomy.flag', true);
    // After re-render, the row should still exist with data-key
    const row = document.querySelector<HTMLElement>('[data-key="autonomy.flag"]');
    expect(row).not.toBeNull();
    editor.dispose();
  });
});
