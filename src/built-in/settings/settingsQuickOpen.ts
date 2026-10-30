// settingsQuickOpen.ts — Ctrl+P finds settings.
//
// The Settings tool registers a Quick Open source listing every setting row
// and every settings page the running tools have registered. A row is found
// by its title, its key or its description; choosing it opens Settings on
// the row's page, scrolls to the row and puts focus on its control. Nothing
// here knows any tool: a tool's settings arrive in the registry while it
// runs and leave with it.

import { registerQuickOpenSource, type QuickOpenSourceItem } from '../../services/quickOpenSources.js';
import { settingsPanelRegistry } from '../../services/settingsPanelRegistry.js';
import type { ISettingSchema, ISettingsRegistryService } from '../../services/settingsRegistryService.js';
import type { IDisposable } from '../../platform/lifecycle.js';
import { humanizeSettingKey } from './settingsEditor.js';

/** Class the found row carries until Settings next repaints it. */
export const FOUND_ROW_CLASS = 'settings-editor__row--found';

/**
 * The Settings page a setting's row is on: a category that shares its name
 * with a registered page is shown on that page (settingsEditor.ts folds the
 * two together), any other category is its own page.
 */
export function settingPageId(schema: Pick<ISettingSchema, 'category'>, panels: readonly { id: string; label: string }[]): string {
  const category = schema.category ?? 'General';
  const owner = panels.find((p) => p.label.trim().toLowerCase() === category.trim().toLowerCase());
  return owner ? `panel:${owner.id}` : `schema:${category}`;
}

export interface SettingsQuickOpenHost {
  /** Open Settings on a page ('panel:<id>' or 'schema:<category>'). */
  openPage(pageId: string): void;
  /** Bring one setting's row into view once its page is showing. */
  revealRow(key: string): void;
}

/** One Quick Open item per settings page, then one per listed setting. */
export function settingsQuickOpenItems(
  schemas: readonly ISettingSchema[],
  panels: readonly { id: string; label: string; description?: string }[],
  host: SettingsQuickOpenHost,
): QuickOpenSourceItem[] {
  const pages: QuickOpenSourceItem[] = panels.map((panel) => ({
    id: `panel:${panel.id}`,
    label: panel.label,
    detail: 'Settings page',
    keywords: panel.description,
    open: () => host.openPage(`panel:${panel.id}`),
  }));
  const rows: QuickOpenSourceItem[] = schemas
    .filter((s) => !s.hidden)
    .map((schema) => ({
      id: schema.key,
      label: schema.label ?? humanizeSettingKey(schema.key),
      detail: schema.category ?? 'General',
      keywords: `${schema.key} ${schema.description}`,
      open: () => {
        host.openPage(settingPageId(schema, panels));
        host.revealRow(schema.key);
      },
    }));
  return [...pages, ...rows];
}

/**
 * Scroll Settings to a row, mark it and focus its control. The row may not
 * exist yet (a page whose tool is still waking), so this looks again on the
 * next frames for a short while, then gives up and leaves the page as it is.
 */
export function revealSettingRow(key: string, frames = 20): void {
  const selector = `.settings-editor__row[data-key="${CSS.escape(key)}"]`;
  const look = (left: number): void => {
    const row = document.querySelector<HTMLElement>(selector);
    if (!row) {
      if (left > 0) requestAnimationFrame(() => look(left - 1));
      return;
    }
    row.scrollIntoView({ block: 'center' });
    row.classList.add(FOUND_ROW_CLASS);
    row.querySelector<HTMLElement>('input, select, textarea, button, [tabindex="0"]')?.focus({ preventScroll: true });
  };
  // After Settings has painted and focused its own search box.
  requestAnimationFrame(() => look(frames));
}

/** Register the settings source; it lists nothing until the user types. */
export function registerSettingsQuickOpen(
  getRegistry: () => ISettingsRegistryService | undefined,
  host: SettingsQuickOpenHost,
): IDisposable {
  return registerQuickOpenSource({
    id: 'settings.rows',
    group: 'settings',
    kind: 'Setting',
    onlyWhenQueried: true,
    listItems: async () => {
      const registry = getRegistry();
      return registry ? settingsQuickOpenItems(registry.getAllSchemas(), settingsPanelRegistry.getPanels(), host) : [];
    },
  });
}
