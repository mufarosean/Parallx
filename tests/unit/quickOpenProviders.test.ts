// @vitest-environment jsdom
// Quick Open providers: settings, tools and themes, each a source registered
// into the generic Quick Open registry, each naming no tool of its own.
import { describe, it, expect, vi } from 'vitest';
import { settingsQuickOpenItems, settingPageId, registerSettingsQuickOpen } from '../../src/built-in/settings/settingsQuickOpen';
import { toolQuickOpenItems, type ToolQuickOpenHost } from '../../src/built-in/tool-gallery/toolQuickOpen';
import { themeQuickOpenItems } from '../../src/workbench/themeQuickOpen';
import { getQuickOpenSources } from '../../src/services/quickOpenSources';
import type { ISettingSchema } from '../../src/services/settingsRegistryService';
import type { PxAppearanceState, PxThemePreset } from '../../src/theme/pxAppearance';

const schema = (key: string, extra: Partial<ISettingSchema> = {}): ISettingSchema => ({
  key, type: 'string', default: '', scope: 'user', description: `About ${key}`, ...extra,
});

describe('settings source', () => {
  it('lists pages, then every visible setting by its title, category and key', () => {
    const host = { openPage: vi.fn(), revealRow: vi.fn() };
    const items = settingsQuickOpenItems(
      [schema('chat.defaultModel', { label: 'Default Model', category: 'Chat' }), schema('internal.flag', { hidden: true }), schema('editor.wordWrap')],
      [{ id: 'keyboard', label: 'Keyboard Shortcuts', description: 'Rebind keys' }],
      host,
    );
    expect(items.map((i) => i.label)).toEqual(['Keyboard Shortcuts', 'Default Model', 'Word Wrap']);
    expect(items[1]).toMatchObject({ detail: 'Chat', keywords: 'chat.defaultModel About chat.defaultModel' });
    expect(items[2].detail).toBe('General');
  });

  it('opens Settings on the row page and reveals the row', () => {
    const host = { openPage: vi.fn(), revealRow: vi.fn() };
    const [, row] = settingsQuickOpenItems([schema('look.accent', { category: 'Look' })], [{ id: 'look', label: 'Look' }], host);
    row.open();
    expect(host.openPage).toHaveBeenCalledWith('panel:look');
    expect(host.revealRow).toHaveBeenCalledWith('look.accent');
  });

  it('finds the page a category is shown on', () => {
    expect(settingPageId({ category: 'Appearance' }, [{ id: 'appearance', label: 'appearance ' }])).toBe('panel:appearance');
    expect(settingPageId({ category: 'Chat' }, [])).toBe('schema:Chat');
    expect(settingPageId({}, [])).toBe('schema:General');
  });

  it('registers as a source that waits for a query, and leaves when disposed', async () => {
    const d = registerSettingsQuickOpen(() => undefined, { openPage: vi.fn(), revealRow: vi.fn() });
    const source = getQuickOpenSources().find((s) => s.id === 'settings.rows');
    expect(source).toMatchObject({ group: 'settings', kind: 'Setting', onlyWhenQueried: true });
    expect(await source!.listItems()).toEqual([]);
    d.dispose();
    expect(getQuickOpenSources().some((s) => s.id === 'settings.rows')).toBe(false);
  });
});

describe('tools source', () => {
  const tools = [
    { id: 'ext.reader', name: 'Reader', description: 'Reads things' },
    { id: 'core.tools', name: 'Tools', description: 'The Tools page' },
  ];
  const host = (enabled: Record<string, boolean>) => {
    const h = {
      getAll: () => tools,
      isEnabled: (id: string) => enabled[id] ?? false,
      canChangeEnablement: (id: string) => id !== 'core.tools',
      setEnabled: vi.fn(async (_id: string, _on: boolean) => {}),
      openPage: vi.fn((_tool: { id: string }) => {}),
    };
    return h satisfies ToolQuickOpenHost;
  };

  it('lists every tool, on or off, then a switch for each that can change', () => {
    const items = toolQuickOpenItems(host({ 'ext.reader': false, 'core.tools': true }));
    expect(items.map((i) => [i.label, i.detail])).toEqual([
      ['Reader', 'Off'], ['Tools', 'Always on'], ['Enable Reader', 'Turns it on'],
    ]);
    expect(items[2].keywords).toContain('turn on Reader');
  });

  it('opens a tool page, and switches a tool the other way', () => {
    const h = host({ 'ext.reader': true });
    const items = toolQuickOpenItems(h);
    items.find((i) => i.label === 'Reader')!.open();
    expect(h.openPage).toHaveBeenCalledWith(tools[0]);
    const off = items.find((i) => i.label === 'Disable Reader')!;
    expect(off.detail).toBe('Turns it off; its data is kept');
    off.open();
    expect(h.setEnabled).toHaveBeenCalledWith('ext.reader', false);
  });
});

describe('themes source', () => {
  const state: PxAppearanceState = { mode: 'dark', base: 'slate', accent: 'steel', textSize: 1.25 };
  const preset: PxThemePreset = { id: 't1', name: 'Evening', mode: 'light', base: 'warm', accent: 'rose', font: 'inter' };

  it('lists modes, palettes, accents and saved themes, marking the ones in use', () => {
    const items = themeQuickOpenItems(state, [preset], true, vi.fn());
    const byLabel = new Map(items.map((i) => [i.label, i.detail]));
    expect(byLabel.get('Dark')).toBe('Mode, in use');
    expect(byLabel.get('Match System')).toBe('Mode');
    expect(byLabel.get('Slate')).toBe('Palette, in use');
    expect(byLabel.get('Warm')).toBe('Palette');
    expect(byLabel.get('Steel')).toBe('Accent, in use');
    expect(byLabel.get('Evening')).toBe('Saved theme');
  });

  it('applies a look and leaves the comfort settings alone', () => {
    const apply = vi.fn();
    const items = themeQuickOpenItems(state, [preset], false, apply);
    items.find((i) => i.label === 'Evening')!.open();
    expect(apply).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'light', base: 'warm', accent: 'rose', font: undefined, textSize: 1.25 }));
    items.find((i) => i.label === 'Match System')!.open();
    expect(apply).toHaveBeenLastCalledWith(expect.objectContaining({ followSystem: true, mode: 'light', base: 'slate' }));
    items.find((i) => i.label === 'Amber')!.open();
    expect(apply).toHaveBeenLastCalledWith(expect.objectContaining({ accent: 'amber', mode: 'dark' }));
  });
});
