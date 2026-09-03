// settingsEditor.ts — M60 Phase ε §7 T4.D2 Settings editor view
//
// Modal/overlay editor for the registry. Uses src/ui/* components and
// --vscode-* tokens (no inline styles, no native form widgets per §3.3 L4).
//
// Layout:
//   ┌──────────────────────────────────────────────────┐
//   │ Settings                                    [×]  │
//   ├──────────────────────────────────────────────────┤
//   │ Search [____________]  Scope [User|Workspace|All]│
//   ├──────────────────────────────────────────────────┤
//   │ Category: Autonomy                               │
//   │   key                       [input]  ↺           │
//   │   description                                     │
//   │   ...                                             │
//   └──────────────────────────────────────────────────┘
//
// Live apply: every change calls registry.setValue immediately.
// onDidChange events from the registry update the rendered controls
// (so external mutations — e.g. autonomyFlags.setEnabled — stay in sync).

import { Disposable } from '../../platform/lifecycle.js';
import type { IDisposable } from '../../platform/lifecycle.js';
import { $, addDisposableListener } from '../../ui/dom.js';
import { Overlay } from '../../ui/overlay.js';
import { InputBox } from '../../ui/inputBox.js';
import { Toggle } from '../../ui/toggle.js';
import { Dropdown } from '../../ui/dropdown.js';
import { SegmentedControl } from '../../ui/segmentedControl.js';
import type {
  ISettingsRegistryService,
  ISettingSchema,
  SettingScope,
} from '../../services/settingsRegistryService.js';
import { settingsPanelRegistry, type ISettingsPanel } from '../../services/settingsPanelRegistry.js';
import './settings.css';

// ─── Nav model ───────────────────────────────────────────────────────────────

/** One entry in the left navigation: either a schema-driven category or a
 *  custom-rendered panel contributed via settingsPanelRegistry. */
type NavEntry =
  | { kind: 'schema'; id: string; label: string; order: number; category: string }
  | {
      kind: 'panel';
      id: string;
      label: string;
      order: number;
      panel: ISettingsPanel;
      /**
       * Schema category ABSORBED by this panel, when a feature contributes
       * both a rich panel and flat `category:` settings under the same name.
       * The panel renders first and its rows follow, on one page.
       */
      absorbedCategory?: string;
    };

/** A rendered nav group: a header label plus its member entries. */
interface INavGroup {
  readonly id: string;
  readonly label: string;
  readonly entries: NavEntry[];
}

// ─── Curated information architecture ────────────────────────────────────────
//
// The nav used to be a flat alphabetical dump of every category string any
// registration ever wrote (22 siblings, ten of them AI-adjacent). This map is
// the single curated taxonomy: each group claims panel ids (`panel:<id>`) and
// schema categories (`schema:<category>`) in display order. Anything
// UNCLAIMED — new extension categories, future panels — lands in the
// Extensions group automatically, so no registration ever needs a special
// case here to show up somewhere sensible.

const NAV_GROUP_DEFS: readonly { id: string; label: string; members: readonly string[] }[] = [
  { id: 'general',    label: 'General',            members: ['schema:General', 'schema:Workspace'] },
  { id: 'appearance', label: 'Appearance',         members: ['panel:appearance'] },
  { id: 'canvas',     label: 'Canvas',             members: ['schema:Canvas'] },
  { id: 'planner',    label: 'Planner',            members: ['panel:planner', 'schema:Planner'] },
  {
    id: 'ai', label: 'AI', members: [
      'panel:ai',                    // the AI & Models managers panel → "Overview"
      'schema:AI',                   // provider enable toggles → "Providers"
      'schema:Model', 'schema:Agent', 'schema:Chat', 'schema:Persona',
      'schema:Autonomy', 'schema:Autonomy / Surfaces',
      'schema:Retrieval', 'schema:Indexing', 'schema:Suggestions',
      'schema:Tools', 'schema:Integrations', 'schema:Web Research',
    ],
  },
  { id: 'extensions', label: 'Extensions',         members: [] }, // catch-all
  { id: 'keyboard',   label: 'Keyboard Shortcuts', members: ['panel:keyboard'] },
];

/** Display-name fixes for entries whose registered label reads wrong inside
 *  its group (e.g. "AI & Models" as a child of the AI group). */
const NAV_DISPLAY_OVERRIDES: Record<string, string> = {
  'panel:ai': 'Overview',
  'schema:AI': 'Providers',
  'schema:Autonomy / Surfaces': 'Surfaces',
};

/**
 * Derive a human title from a dotted setting key: drop the family prefix,
 * split camelCase, Title Case the segments. Used when a schema carries no
 * explicit `label`. e.g. `canvas.versionHistory.maxPerPage` → "Version
 * History › Max Per Page".
 */
export function humanizeSettingKey(key: string): string {
  const segs = key.split('.');
  const tail = segs.length > 1 ? segs.slice(1) : segs;
  return tail
    .map((s) => s
      .replace(/[-_]/g, ' ')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/^./, (c) => c.toUpperCase()))
    .join(' › ');
}

/** Optional command runner — registry action rows fire commands when present. */
export interface IEditorCommandRunner {
  executeCommand<T = unknown>(id: string, ...args: unknown[]): Promise<T>;
}

// ─── Filter state ──────────────────────────────────────────────────────────

type ScopeFilter = 'all' | SettingScope;

// ─── SettingsEditor ────────────────────────────────────────────────────────

export class SettingsEditor extends Disposable {
  private readonly _overlay: Overlay;
  private readonly _root: HTMLElement;
  private _navEl!: HTMLElement;
  private _contentEl!: HTMLElement;
  private _searchValue = '';
  private _scopeFilter: ScopeFilter = 'all';
  private readonly _controlDisposables: IDisposable[] = [];
  /** Currently selected nav id (e.g. 'schema:General' or 'panel:appearance'). */
  private _selectedId: string | null = null;
  /** Cleanup for the mounted custom panel, if any. */
  private _activePanelDisposable: IDisposable | null = null;

  constructor(
    parent: HTMLElement,
    private readonly _registry: ISettingsRegistryService,
    private readonly _commands?: IEditorCommandRunner,
    initialPanelId?: string,
  ) {
    super();

    // Deep-link target (e.g. open Settings straight to Appearance). Accept a
    // bare panel id or a full nav id ('panel:appearance' / 'schema:General').
    if (initialPanelId) {
      this._selectedId = initialPanelId.includes(':') ? initialPanelId : `panel:${initialPanelId}`;
    }

    this._overlay = this._register(new Overlay(parent, {
      closeOnClickOutside: true,
      closeOnEscape: true,
      contentClass: 'settings-editor-overlay',
      centered: true,
    }));

    this._root = $('div.settings-editor');
    this._overlay.contentElement.appendChild(this._root);

    // ── Header ───────────────────────────────────────────
    const header = $('div.settings-editor__header');
    const title = $('h2.settings-editor__title');
    title.textContent = 'Settings';
    header.appendChild(title);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'settings-editor__close';
    closeBtn.setAttribute('aria-label', 'Close settings');
    closeBtn.textContent = '×';
    this._register(addDisposableListener(closeBtn, 'click', () => this.hide()));
    header.appendChild(closeBtn);

    this._root.appendChild(header);

    // ── Filter bar ───────────────────────────────────────
    const filterBar = $('div.settings-editor__filters');

    const searchHost = $('div.settings-editor__search');
    const search = new InputBox(searchHost, {
      placeholder: 'Search settings (key, description, category)…',
      ariaLabel: 'Search settings',
    });
    this._register(search);
    this._register(search.onDidChange((value) => {
      this._searchValue = value.trim().toLowerCase();
      this._renderNav();
      this._renderContent();
    }));
    filterBar.appendChild(searchHost);

    const scopeHost = $('div.settings-editor__scope');
    const scopeControl = new SegmentedControl(scopeHost, {
      segments: [
        { value: 'all', label: 'All' },
        { value: 'user', label: 'User' },
        { value: 'workspace', label: 'Workspace' },
      ],
      selected: 'all',
      ariaLabel: 'Scope filter',
    });
    this._register(scopeControl);
    this._register(scopeControl.onDidChange((id) => {
      this._scopeFilter = id as ScopeFilter;
      this._renderContent();
    }));
    filterBar.appendChild(scopeHost);

    this._root.appendChild(filterBar);

    // ── Body: left nav + right content ───────────────────
    const body = $('div.settings-editor__body');
    this._navEl = $('nav.settings-editor__nav');
    this._navEl.setAttribute('aria-label', 'Settings categories');
    this._contentEl = $('div.settings-editor__content');
    this._contentEl.setAttribute('role', 'region');
    body.appendChild(this._navEl);
    body.appendChild(this._contentEl);
    this._root.appendChild(body);

    // ── Live external-mutation re-render ──
    this._register(this._registry.onDidChange(() => {
      // External mutations (e.g. another extension calls setValue) — re-render
      // the content (controls reflect new values). Cheap: bounded by registry
      // size. Nav rebuild is also cheap.
      this._renderNav();
      this._renderContent();
    }));
    // Rebuild when a tool registers/removes a custom panel.
    this._register(settingsPanelRegistry.onDidChange(() => {
      this._renderNav();
      this._renderContent();
    }));

    // Focus search on open
    queueMicrotask(() => search.inputElement.focus());

    this._renderNav();
    this._renderContent();
  }

  show(): void {
    this._overlay.show();
  }

  hide(): void {
    this._overlay.hide();
  }

  override dispose(): void {
    this._disposeActivePanel();
    this._disposeControls();
    super.dispose();
  }

  // ─────────────────────────────────────────────────────────────────────────

  private _disposeControls(): void {
    for (const d of this._controlDisposables) d.dispose();
    this._controlDisposables.length = 0;
  }

  private _disposeActivePanel(): void {
    this._activePanelDisposable?.dispose();
    this._activePanelDisposable = null;
  }

  private _matches(schema: ISettingSchema): boolean {
    if (this._scopeFilter !== 'all' && schema.scope !== this._scopeFilter) return false;
    if (!this._searchValue) return true;
    const title = schema.label ?? humanizeSettingKey(schema.key);
    const haystack = `${title} ${schema.key} ${schema.description} ${schema.category ?? ''}`.toLowerCase();
    return haystack.includes(this._searchValue);
  }

  /** Collect every available nav entry (panels + schema categories), keyed by id. */
  private _collectEntries(): Map<string, NavEntry> {
    const byId = new Map<string, NavEntry>();

    // Panels first, indexed by normalised label so a schema category with the
    // same name can be folded into them below.
    const panelByLabel = new Map<string, NavEntry & { kind: 'panel' }>();
    for (const panel of settingsPanelRegistry.getPanels()) {
      const entry = {
        kind: 'panel' as const,
        id: `panel:${panel.id}`,
        label: panel.label,
        order: panel.order ?? 50,
        panel,
      };
      byId.set(entry.id, entry);
      panelByLabel.set(panel.label.trim().toLowerCase(), entry);
    }

    const cats = new Set<string>();
    for (const s of this._registry.getAllSchemas()) cats.add(s.category ?? 'General');
    for (const cat of cats) {
      // A feature that contributes BOTH a rich panel and flat settings under
      // the same name previously produced two identical nav rows — one from
      // `panel:<id>`, one from `schema:<category>` — with no way for the user
      // to tell which was which. Neither source is wrong; they are two halves
      // of one page. Fold the category into the panel and render both.
      const owner = panelByLabel.get(cat.trim().toLowerCase());
      if (owner) {
        owner.absorbedCategory = cat;
        continue;
      }
      byId.set(`schema:${cat}`, { kind: 'schema', id: `schema:${cat}`, label: cat, order: 50, category: cat });
    }
    return byId;
  }

  /** Route every entry through the curated taxonomy; unclaimed → Extensions. */
  private _buildGroups(): INavGroup[] {
    const byId = this._collectEntries();
    const claimed = new Set<string>();
    const groups: INavGroup[] = [];

    for (const def of NAV_GROUP_DEFS) {
      const entries: NavEntry[] = [];
      for (const member of def.members) {
        const entry = byId.get(member);
        if (entry) {
          entries.push({ ...entry, label: NAV_DISPLAY_OVERRIDES[member] ?? entry.label });
          claimed.add(member);
        }
      }
      groups.push({ id: def.id, label: def.label, entries });
    }

    // Catch-all: anything not claimed above lands in Extensions, sorted.
    const extensions = groups.find((g) => g.id === 'extensions')!;
    const unclaimed = [...byId.entries()]
      .filter(([id]) => !claimed.has(id))
      .map(([, entry]) => entry)
      .sort((a, b) => a.label.localeCompare(b.label));
    extensions.entries.push(...unclaimed);

    return groups.filter((g) => g.entries.length > 0);
  }

  /** Flat entry list in nav order (for selection fallback + lookups). */
  private _buildNav(): NavEntry[] {
    return this._buildGroups().flatMap((g) => g.entries);
  }

  private _renderNav(): void {
    const groups = this._buildGroups();
    this._navEl.replaceChildren();

    // Ensure a valid selection.
    const all = groups.flatMap((g) => g.entries);
    if (!this._selectedId || !all.some((e) => e.id === this._selectedId)) {
      this._selectedId = all[0]?.id ?? null;
    }

    const makeItem = (entry: NavEntry, label: string, child: boolean): void => {
      const item = $('button.settings-editor__nav-item');
      item.setAttribute('type', 'button');
      if (child) item.classList.add('settings-editor__nav-item--child');
      item.textContent = label;
      if (entry.id === this._selectedId && !this._searchValue) {
        item.classList.add('settings-editor__nav-item--active');
      }
      this._register(addDisposableListener(item, 'click', () => {
        if (this._selectedId === entry.id && !this._searchValue) return;
        this._selectedId = entry.id;
        this._searchValue = '';
        this._renderNav();
        this._renderContent();
      }));
      this._navEl.appendChild(item);
    };

    for (const group of groups) {
      if (group.entries.length === 1) {
        // Single-member group renders flat under the GROUP's name — a header
        // over one indented child is visual noise (Appearance, Canvas, …).
        makeItem(group.entries[0], group.label, false);
        continue;
      }
      const header = $('div.settings-editor__nav-group');
      header.textContent = group.label;
      this._navEl.appendChild(header);
      for (const entry of group.entries) {
        makeItem(entry, entry.label, true);
      }
    }
  }

  /** Render the right pane for the current selection (or search results). */
  private _renderContent(): void {
    this._disposeActivePanel();
    this._disposeControls();
    this._contentEl.replaceChildren();
    this._contentEl.classList.remove('settings-editor__content--fill');
    this._contentEl.scrollTop = 0;

    // Search overrides category navigation with a flat, cross-category result.
    if (this._searchValue) {
      this._renderSearchResults();
      return;
    }

    const entry = this._buildNav().find((e) => e.id === this._selectedId);
    if (!entry) {
      const empty = $('div.settings-editor__empty');
      empty.textContent = 'No settings available.';
      this._contentEl.appendChild(empty);
      return;
    }

    if (entry.kind === 'panel') {
      if (entry.panel.fill) this._contentEl.classList.add('settings-editor__content--fill');
      const heading = $('h3.settings-editor__content-title');
      heading.textContent = entry.label;
      this._contentEl.appendChild(heading);
      if (entry.panel.description) {
        const d = $('p.settings-editor__content-desc');
        d.textContent = entry.panel.description;
        this._contentEl.appendChild(d);
      }
      const host = $('div.settings-editor__panel-host');
      this._contentEl.appendChild(host);
      const disp = entry.panel.render(host);
      this._activePanelDisposable = disp ?? null;

      // Rows for a schema category this panel absorbed (see _collectEntries).
      // A `fill` panel owns its own scroll and would clip anything appended
      // after it, so those keep the panel alone and stay reachable by search.
      if (entry.absorbedCategory && !entry.panel.fill) {
        const rows = this._registry
          .getAllSchemas()
          .filter((s) => (s.category ?? 'General') === entry.absorbedCategory && this._matches(s));
        if (rows.length) {
          const sub = $('h4.settings-editor__category-title');
          sub.textContent = 'All Settings';
          this._contentEl.appendChild(sub);
          for (const schema of rows) this._contentEl.appendChild(this._renderRow(schema));
        }
      }
      return;
    }

    // Schema category — render its rows.
    const heading = $('h3.settings-editor__content-title');
    heading.textContent = entry.label;
    this._contentEl.appendChild(heading);

    const rows = this._registry
      .getAllSchemas()
      .filter((s) => (s.category ?? 'General') === entry.category && this._matches(s));
    for (const schema of rows) {
      this._contentEl.appendChild(this._renderRow(schema));
    }
  }

  private _renderSearchResults(): void {
    const heading = $('h3.settings-editor__content-title');
    heading.textContent = 'Search results';
    this._contentEl.appendChild(heading);

    const schemas = this._registry.getAllSchemas().filter((s) => this._matches(s));
    if (schemas.length === 0) {
      const empty = $('div.settings-editor__empty');
      empty.textContent = 'No settings match the current filter.';
      this._contentEl.appendChild(empty);
      return;
    }
    // Group by category so results stay readable.
    const byCategory = new Map<string, ISettingSchema[]>();
    for (const s of schemas) {
      const cat = s.category ?? 'General';
      (byCategory.get(cat) ?? byCategory.set(cat, []).get(cat)!).push(s);
    }
    for (const cat of Array.from(byCategory.keys()).sort()) {
      const catHeader = $('h4.settings-editor__category-title');
      catHeader.textContent = cat;
      this._contentEl.appendChild(catHeader);
      for (const schema of byCategory.get(cat)!) {
        this._contentEl.appendChild(this._renderRow(schema));
      }
    }
  }

  private _renderRow(schema: ISettingSchema): HTMLElement {
    const row = $('div.settings-editor__row');
    row.setAttribute('role', 'listitem');
    row.setAttribute('data-key', schema.key);

    // Human title first (explicit label, else derived from the key) — raw
    // dotted keys are engineering IDs, not UI. The key stays visible as
    // small metadata for search/debugging parity with the settings files.
    const head = $('div.settings-editor__row-head');
    const titleEl = $('span.settings-editor__row-title');
    titleEl.textContent = schema.label ?? humanizeSettingKey(schema.key);
    head.appendChild(titleEl);

    const scopeBadge = $('span.settings-editor__row-scope');
    scopeBadge.textContent = schema.scope;
    head.appendChild(scopeBadge);

    if (schema.deprecated) {
      const dep = $('span.settings-editor__row-deprecated');
      dep.textContent = `deprecated: ${schema.deprecated}`;
      head.appendChild(dep);
    }

    row.appendChild(head);

    const keyEl = $('div.settings-editor__row-key');
    keyEl.textContent = schema.key;
    row.appendChild(keyEl);

    const desc = $('div.settings-editor__row-desc');
    desc.textContent = schema.description;
    row.appendChild(desc);

    const controlHost = $('div.settings-editor__row-control');
    this._renderControl(schema, controlHost);
    row.appendChild(controlHost);

    return row;
  }

  private _renderControl(schema: ISettingSchema, host: HTMLElement): void {
    const current = this._registry.getValue(schema.key);

    switch (schema.type) {
      case 'boolean': {
        const toggle = new Toggle(host, {
          checked: current as boolean,
          ariaLabel: schema.key,
        });
        this._controlDisposables.push(toggle);
        this._controlDisposables.push(toggle.onDidChange(async (val) => {
          try {
            await this._registry.setValue(schema.key, val);
          } catch (err) {
            console.warn(`[SettingsEditor] write failed for ${schema.key}:`, err);
            // Snap back on failure
            toggle.checked = current as boolean;
          }
        }));
        break;
      }
      case 'number': {
        const inputBox = new InputBox(host, {
          value: String(current),
          ariaLabel: schema.key,
        });
        this._controlDisposables.push(inputBox);
        const tryWrite = async (raw: string) => {
          const num = Number(raw);
          if (!Number.isFinite(num)) return;
          try {
            await this._registry.setValue(schema.key, num);
          } catch (err) {
            console.warn(`[SettingsEditor] number write rejected for ${schema.key}:`, err);
          }
        };
        this._controlDisposables.push(inputBox.onDidSubmit((v) => void tryWrite(v)));
        this._controlDisposables.push(addDisposableListener(inputBox.inputElement, 'blur', () => {
          void tryWrite(inputBox.inputElement.value);
        }));
        if (schema.min !== undefined || schema.max !== undefined) {
          const hint = $('span.settings-editor__hint');
          hint.textContent = `${schema.min ?? '−∞'} … ${schema.max ?? '∞'}`;
          host.appendChild(hint);
        }
        break;
      }
      case 'string': {
        const inputBox = new InputBox(host, {
          value: current as string,
          ariaLabel: schema.key,
          type: schema.secret ? 'password' : 'text',
        });
        this._controlDisposables.push(inputBox);
        const write = async (raw: string) => {
          try {
            await this._registry.setValue(schema.key, raw);
          } catch (err) {
            console.warn(`[SettingsEditor] string write rejected for ${schema.key}:`, err);
          }
        };
        this._controlDisposables.push(inputBox.onDidSubmit((v) => void write(v)));
        this._controlDisposables.push(addDisposableListener(inputBox.inputElement, 'blur', () => {
          void write(inputBox.inputElement.value);
        }));
        break;
      }
      case 'multiline': {
        const textarea = document.createElement('textarea');
        textarea.className = 'settings-editor__multiline';
        textarea.spellcheck = false;
        textarea.rows = schema.rows ?? 4;
        textarea.value = current as string;
        textarea.setAttribute('aria-label', schema.key);
        host.appendChild(textarea);
        const write = async () => {
          try {
            await this._registry.setValue(schema.key, textarea.value);
          } catch (err) {
            console.warn(`[SettingsEditor] multiline write rejected for ${schema.key}:`, err);
          }
        };
        this._controlDisposables.push(addDisposableListener(textarea, 'blur', () => void write()));
        break;
      }
      case 'action': {
        const btn = document.createElement('button');
        btn.className = 'settings-editor__action';
        btn.type = 'button';
        btn.textContent = schema.actionLabel ?? 'Open…';
        btn.setAttribute('aria-label', schema.actionLabel ?? schema.key);
        this._controlDisposables.push(addDisposableListener(btn, 'click', () => {
          if (!this._commands || !schema.command) {
            console.warn(`[SettingsEditor] no command runner for ${schema.key}`);
            return;
          }
          // Hide overlay so the launched manager (or external view) is unobscured.
          this.hide();
          this._commands.executeCommand(schema.command).catch((err) => {
            console.warn(`[SettingsEditor] command ${schema.command} failed:`, err);
          });
        }));
        host.appendChild(btn);
        // Action rows have no value to reset — skip the reset button below.
        return;
      }
      case 'enum': {
        const dropdown = new Dropdown(host, {
          items: schema.enumValues!.map((v) => ({ value: v, label: v })),
          selected: current as string,
          ariaLabel: schema.key,
        });
        this._controlDisposables.push(dropdown);
        this._controlDisposables.push(dropdown.onDidChange(async (val) => {
          try {
            await this._registry.setValue(schema.key, val);
          } catch (err) {
            console.warn(`[SettingsEditor] enum write rejected for ${schema.key}:`, err);
          }
        }));
        break;
      }
      case 'object': {
        // JSON textarea (advanced settings)
        const textarea = document.createElement('textarea');
        textarea.className = 'settings-editor__json';
        textarea.spellcheck = false;
        textarea.rows = 4;
        textarea.value = JSON.stringify(current, null, 2);
        textarea.setAttribute('aria-label', schema.key);
        host.appendChild(textarea);

        const status = $('span.settings-editor__json-status');
        host.appendChild(status);

        const tryParse = async () => {
          try {
            const parsed = JSON.parse(textarea.value) as unknown;
            await this._registry.setValue(schema.key, parsed);
            status.textContent = 'Saved';
            status.classList.remove('settings-editor__json-status--error');
          } catch (err) {
            status.textContent = (err as Error).message;
            status.classList.add('settings-editor__json-status--error');
          }
        };
        this._controlDisposables.push(addDisposableListener(textarea, 'blur', () => void tryParse()));
        break;
      }
    }

    // Reset button — applies to every type.
    const resetBtn = document.createElement('button');
    resetBtn.className = 'settings-editor__reset';
    resetBtn.textContent = 'Reset';
    resetBtn.setAttribute('aria-label', `Reset ${schema.key} to default`);
    this._controlDisposables.push(addDisposableListener(resetBtn, 'click', async () => {
      try {
        await this._registry.reset(schema.key);
      } catch (err) {
        console.warn(`[SettingsEditor] reset failed for ${schema.key}:`, err);
      }
    }));
    host.appendChild(resetBtn);
  }
}
