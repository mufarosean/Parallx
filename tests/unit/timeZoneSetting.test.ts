// @vitest-environment jsdom
// The Time Zone setting: one app-wide value (stored as chat.timeZone), shown
// with the general settings rather than under AI, edited in one place only,
// and applied to the app's clock (assistantTimeZone, api.env.timeZone) as
// soon as it changes.

import { describe, it, expect, afterEach } from 'vitest';
import { SettingsEditor } from '../../src/built-in/settings/settingsEditor';
import { SettingsRegistryService } from '../../src/services/settingsRegistryService';
import { ServiceCollection } from '../../src/services/serviceCollection';
import { registerUnifiedAIConfigService } from '../../src/workbench/workbenchServices';
import { registerAIProfileSettings } from '../../src/aiSettings/aiProfileSettingsSchemas';
import { assistantTimeZone, machineTimeZone, setAssistantTimeZone } from '../../src/services/localTime';
import type { IStorage } from '../../src/platform/storage';

function memStorage(): IStorage {
  const map = new Map<string, string>();
  return {
    async get(k: string) { return map.get(k); },
    async set(k: string, v: string) { map.set(k, v); },
    async delete(k: string) { map.delete(k); },
    async has(k: string) { return map.has(k); },
    async keys() { return [...map.keys()]; },
    async clear() { map.clear(); },
  };
}

async function setup() {
  const unified = await registerUnifiedAIConfigService(new ServiceCollection(), memStorage());
  const registry = new SettingsRegistryService(memStorage(), memStorage());
  await registry.initialize();
  registerAIProfileSettings(registry, unified);
  return { unified, registry };
}

afterEach(() => {
  setAssistantTimeZone('');
  document.body.replaceChildren();
});

describe('the Time Zone setting', () => {
  it('is one General setting titled Time Zone, under the stored key chat.timeZone', async () => {
    const { registry } = await setup();
    const matches = registry.getAllSchemas().filter((s) => /time ?zone/i.test(s.key) || /time zone/i.test(s.label ?? ''));
    expect(matches.map((s) => s.key)).toEqual(['chat.timeZone']);
    const schema = matches[0];
    expect(schema.category).toBe('General');
    expect(schema.label).toBe('Time Zone');
    expect(schema.description).toMatch(/^Empty uses this computer's zone\./);
    expect(schema.description).not.toMatch(/—/);
  });

  it('shows on the General page of the Settings editor, not under AI', async () => {
    const { registry } = await setup();
    const root = document.createElement('div');
    document.body.appendChild(root);
    const editor = new SettingsEditor(root, registry);
    editor.show();

    const navItems = Array.from(document.querySelectorAll<HTMLElement>('.settings-editor__nav-item'));
    const general = navItems.find((n) => n.textContent === 'General');
    expect(general).toBeDefined();
    general!.click();
    const rowKeys = () => Array.from(document.querySelectorAll<HTMLElement>('.settings-editor__row')).map((r) => r.dataset.key);
    expect(rowKeys()).toContain('chat.timeZone');
    const row = document.querySelector<HTMLElement>('[data-key="chat.timeZone"]')!;
    expect(row.querySelector('.settings-editor__row-title')?.textContent).toBe('Time Zone');

    // Not on the AI Chat page any more.
    const chat = navItems.find((n) => n.textContent === 'Chat');
    expect(chat).toBeDefined();
    chat!.click();
    expect(rowKeys()).not.toContain('chat.timeZone');
    editor.dispose();
  });

  it('a change applies to the app clock at once', async () => {
    const { registry, unified } = await setup();
    expect(assistantTimeZone()).toBe(machineTimeZone());

    await registry.setValue('chat.timeZone', '  Asia/Tokyo ');
    expect(unified.getEffectiveConfig().chat.timeZone).toBe('Asia/Tokyo');
    expect(registry.getValue('chat.timeZone')).toBe('Asia/Tokyo');
    expect(assistantTimeZone()).toBe('Asia/Tokyo');

    await registry.setValue('chat.timeZone', '');
    expect(assistantTimeZone()).toBe(machineTimeZone());
  });
});
