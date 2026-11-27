// homeSettings.ts — Home's three settings: what to call the person, whether
// a workspace opens on Home, and how wide the page's column is.

import type { IDisposable } from '../../platform/lifecycle.js';
import type { ISettingsRegistryService } from '../../services/settingsRegistryService.js';

export const HOME_NAME = 'home.name';
export const HOME_OPEN_ON_START = 'home.openOnStart';
export const HOME_WIDTH = 'home.width';

export type HomeWidth = 'narrow' | 'medium' | 'wide';
const WIDTHS: readonly HomeWidth[] = ['narrow', 'medium', 'wide'];

export type HomeSettingsRegistry = Pick<ISettingsRegistryService, 'register' | 'unregister' | 'getSchema' | 'getValue' | 'setValue' | 'onDidChange'>;

/** Registers the settings; disposing takes them out of Settings again (their values are kept). */
export function registerHomeSettings(registry: HomeSettingsRegistry): IDisposable {
  const mine: string[] = [];
  const add = (schema: Parameters<HomeSettingsRegistry['register']>[0]): void => {
    if (registry.getSchema(schema.key)) return;
    registry.register(schema);
    mine.push(schema.key);
  };
  add({
    key: HOME_NAME, type: 'string', default: '', scope: 'user', category: 'Home', label: 'Your Name',
    description: 'What Home calls you in its greeting. Empty: Home asks once, then greets without a name.',
  });
  add({
    key: HOME_OPEN_ON_START, type: 'boolean', default: true, scope: 'workspace', category: 'Home', label: 'Open on Home',
    description: 'Open Home in front when this workspace opens. Off: the tab that was in front last time stays in front.',
  });
  add({
    key: HOME_WIDTH, type: 'enum', default: 'medium', scope: 'user', category: 'Home', label: 'Content Width',
    description: 'The width of Home\'s column: its title, the field to ask in, the cards and the feed.',
    enumValues: WIDTHS, enumLabels: { narrow: 'Narrow', medium: 'Medium', wide: 'Wide' },
  });
  return { dispose: () => { for (const key of mine.splice(0)) registry.unregister(key); } };
}

export function homeName(registry: HomeSettingsRegistry): string {
  const v = registry.getValue<unknown>(HOME_NAME);
  return typeof v === 'string' ? v.trim() : '';
}

export function homeWidth(registry: HomeSettingsRegistry): HomeWidth {
  const v = registry.getValue<unknown>(HOME_WIDTH);
  return WIDTHS.includes(v as HomeWidth) ? (v as HomeWidth) : 'medium';
}

export function opensOnHome(registry: HomeSettingsRegistry): boolean {
  return registry.getValue<unknown>(HOME_OPEN_ON_START) !== false;
}
