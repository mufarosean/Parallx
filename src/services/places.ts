// places.ts — the core's one way to move between a tool's screens.
//
// A *place* is a screen of a tool (Planner's Today, Calendar, Tasks). A tool
// declares its places here while it runs and draws each one; the core keeps
// the tool's ONE tab and does the rest the same way for every tool:
//
//   - the tab is named for the place, with the tool's icon;
//   - the bar under the tabs shows the trail (the tool, then the place, and
//     any steps the tool adds), each crumb going there in the same tab;
//   - every place has an address, `parallx://place/<tool>/<place>?<params>`,
//     opened through `parallx.links` like any other link;
//   - after a move the keys land on the new page's title;
//   - whoever draws the tool's column reads `current()` and `onDidMove` to
//     mark where you are (the kit's `markCurrent`);
//   - Open in Its Own Tab, on the tab's menu and on a place link's menu, and
//     Ctrl+click on a place link, open the place in a tab of its own.
//
// The core names no tool: a tool registers (`parallx.places.register`), and
// turned off, its places, their tabs and their addresses go with it.

import { Emitter, type Event } from '../platform/events.js';
import { toDisposable, type IDisposable } from '../platform/lifecycle.js';
import { getIcon, hasIcon } from '../ui/iconRegistry.js';
import type { IEditorTrailCrumb } from '../editor/editorTrail.js';

/** Where in a tool: one of its places, with what the place was given (a day, a list). */
export interface PlaceLocation {
  readonly place: string;
  readonly params?: Readonly<Record<string, string>>;
}

export interface PlaceDefinition {
  /** Stable, used in the address: 'calendar'. */
  readonly id: string;
  /** What the tab and the trail call it: 'Calendar'. */
  readonly title: string;
}

/** A step of the trail after the tool: 'Tasks', then 'Overdue'. */
export interface PlaceStep {
  readonly label: string;
  readonly location: PlaceLocation;
}

/** What the core gives a tool's view of its places. */
export interface PlaceViewHost {
  /** Move this tab to another place (a link on the page): named, trailed, marked, keys on the new title. */
  go(location: PlaceLocation): void;
  /** The page moved by itself (a list chosen on it): record where it is now, without drawing it again. */
  replace(location: PlaceLocation): void;
}

/** A tool's drawing of its places in one tab. */
export interface PlaceView extends IDisposable {
  /** Draw this place. Resolves once it is on screen. */
  show(location: PlaceLocation): void | Promise<void>;
}

export interface PlacesContribution {
  /** The tool's segment in the address: lower-case letters, digits and dashes ('planner'). */
  readonly id: string;
  /** The tool's name, the trail's first crumb: 'Planner'. */
  readonly title: string;
  /** Registry icon id of the tool (the tab's icon and the first crumb's): a tab never has no icon. */
  readonly icon: string;
  /** Its places; the first is where the tool opens. */
  readonly places: readonly PlaceDefinition[];
  /** The tab's editor type; defaults to the id. A tool moving onto places keeps its old type so restored tabs still open. */
  readonly editorType?: string;
  /** The tab's name for a location; defaults to the place's title. */
  titleOf?(location: PlaceLocation): string;
  /** The trail after the tool; defaults to the place alone. The last step is where the tab is. */
  trailOf?(location: PlaceLocation): readonly PlaceStep[];
  /** Draw the tool's places into one tab's container. */
  createView(container: HTMLElement, host: PlaceViewHost): PlaceView;
}

/** The editor input a place tab is (the editors bridge's tool input), as far as the core needs it. */
export interface PlaceTabInput {
  readonly id: string;
  /** The address the tab was last at, kept with the tab across a restart. */
  place: string | undefined;
  openInOwnTab: (() => void) | undefined;
  setName(name: string): void;
  setIconHtml(iconHtml: string | undefined): void;
  setTrail(trail: readonly IEditorTrailCrumb[] | undefined): void;
  readonly onWillDispose: Event<void>;
}

/** How the core opens and finds a tool's tabs, given by whoever registers (the API bridge). */
export interface PlacesEditorHost {
  /** Open (or show, when open) the tool's editor of this type and instance. */
  openEditor(options: { typeId: string; title: string; iconHtml?: string; instanceId: string }): Promise<void>;
  /** Show an open tab. */
  focusEditor(id: string): Promise<boolean>;
  /** The ids of the open editors, the active one marked. */
  openEditorIds(): readonly { id: string; isActive: boolean }[];
  /** The id an editor of this type and instance has (`tool:type:instance`). */
  editorIdOf(typeId: string, instanceId: string): string;
}

/** The links registry, as far as places need it (one contract for the `place` segment). */
export interface PlacesLinkRegistry {
  register(contract: {
    segment: string;
    displayName: string;
    extensionId: string;
    kinds: Record<string, {
      uriTemplate: string;
      description: string;
      examples?: readonly string[];
      open(parsed: { pathSegments: readonly string[]; params: Readonly<Record<string, string>> }): Promise<boolean>;
      resolveMetadata?(parsed: { pathSegments: readonly string[]; params: Readonly<Record<string, string>> }): Promise<{ title: string; icon?: string } | null>;
    }>;
  }): IDisposable;
}

export const PLACE_SEGMENT = 'place';
const MAIN_INSTANCE = 'main';

interface Entry {
  readonly toolId: string;
  readonly typeId: string;
  readonly contribution: PlacesContribution;
  readonly host: PlacesEditorHost;
}

interface Tab {
  readonly toolKey: string;
  readonly input: PlaceTabInput;
  location: PlaceLocation;
  view: PlaceView | undefined;
  container: HTMLElement | undefined;
  /** Bumped by each move, so an older move that finishes late does not take the keys. */
  seq: number;
}

export interface PlaceMove {
  readonly tool: string;
  readonly location: PlaceLocation;
}

function sameLocation(a: PlaceLocation | undefined, b: PlaceLocation | undefined): boolean {
  if (!a || !b || a.place !== b.place) return false;
  const pa = a.params ?? {}, pb = b.params ?? {};
  const ka = Object.keys(pa).sort(), kb = Object.keys(pb).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && pa[k] === pb[k]);
}

/** `parallx://place/<tool>/<place>?<params>`. */
export function placeAddress(tool: string, location: PlaceLocation): string {
  const query = Object.entries(location.params ?? {})
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return `parallx://${PLACE_SEGMENT}/${encodeURIComponent(tool)}/${encodeURIComponent(location.place)}${query ? `?${query}` : ''}`;
}

/** The tool and location an address names, or null when it is not a place's address. */
export function parsePlaceAddress(address: string): PlaceMove | null {
  const m = /^parallx:\/\/place\/([^/?#]+)(?:\/([^?#]*))?(?:\?([^#]*))?$/i.exec(address.trim());
  if (!m) return null;
  try {
    const tool = decodeURIComponent(m[1]);
    const place = decodeURIComponent((m[2] ?? '').split('/')[0] ?? '');
    const params: Record<string, string> = {};
    for (const pair of (m[3] ?? '').split('&')) {
      if (!pair) continue;
      const at = pair.indexOf('=');
      const k = decodeURIComponent((at < 0 ? pair : pair.slice(0, at)).replace(/\+/g, ' '));
      const v = at < 0 ? '' : decodeURIComponent(pair.slice(at + 1).replace(/\+/g, ' '));
      if (k) params[k] = v;
    }
    return { tool, location: { place, ...(Object.keys(params).length ? { params } : {}) } };
  } catch {
    return null;
  }
}

/** Put the keys on the page's title: the kit header's h1, else the page's first h1. Waits a little for a page still drawing. */
export function focusPageTitle(container: HTMLElement, isStillWanted: () => boolean = () => true): void {
  let tries = 0;
  const attempt = (): void => {
    if (!isStillWanted() || !container.isConnected) return;
    // A dialog the page opened on the way (a new task's form) keeps the keys.
    if (document.activeElement?.closest?.('[role="dialog"], [role="alertdialog"], [aria-modal="true"]')) return;
    const title = container.querySelector<HTMLElement>('.px-page-header__title') ?? container.querySelector<HTMLElement>('h1');
    if (title && title.getClientRects().length) {
      if (!title.hasAttribute('tabindex')) title.tabIndex = -1;
      title.focus({ preventScroll: true });
      return;
    }
    if (++tries < 60) requestAnimationFrame(attempt);
  };
  attempt();
}

export class PlacesService {
  private readonly _entries = new Map<string, Entry>();
  private readonly _tabs = new Map<string, Tab>();
  /** Where a tab not yet drawn is to open, and whether the keys go to its title. */
  private readonly _pending = new Map<string, { location: PlaceLocation; focus: boolean }>();
  /** Last time each tab was in front, to find the tool's tab when none of its is. */
  private readonly _lastActive = new Map<string, number>();
  private _activeClock = 0;
  private _instanceCounter = 0;
  private _links: PlacesLinkRegistry | undefined;
  private _linkContract: IDisposable | undefined;

  private readonly _onDidMove = new Emitter<PlaceMove>();
  /** Fires when a tool's current place changes: a move, or another of its tabs came to the front. */
  readonly onDidMove: Event<PlaceMove> = this._onDidMove.event;

  private readonly _onDidChange = new Emitter<void>();
  /** Fires when a tool's places are registered or go. */
  readonly onDidChange: Event<void> = this._onDidChange.event;

  // ── Registration ─────────────────────────────────────────────────────

  register(toolId: string, contribution: PlacesContribution, host: PlacesEditorHost): IDisposable {
    const key = contribution.id;
    if (!/^[a-z0-9][a-z0-9-]*$/.test(key)) throw new Error(`[Places] "${key}" is not a place id: lower-case letters, digits and dashes.`);
    if (!contribution.places.length) throw new Error(`[Places] "${key}" declares no places.`);
    const holder = this._entries.get(key);
    if (holder && holder.toolId !== toolId) throw new Error(`[Places] "${key}" is already registered by "${holder.toolId}".`);
    const entry: Entry = { toolId, typeId: contribution.editorType ?? key, contribution, host };
    this._entries.set(key, entry);
    this._syncLinks();
    this._onDidChange.fire();
    return toDisposable(() => {
      if (this._entries.get(key) !== entry) return;
      this._entries.delete(key);
      for (const [id, tab] of this._tabs) if (tab.toolKey === key) this._dropTab(id);
      this._syncLinks();
      this._onDidChange.fire();
    });
  }

  /** The tools with places, for whoever lists them. */
  list(): readonly { id: string; title: string; places: readonly PlaceDefinition[] }[] {
    return [...this._entries.values()].map((e) => ({ id: e.contribution.id, title: e.contribution.title, places: e.contribution.places }));
  }

  /** The editor type of a tool's place tabs, for the bridge that registers the provider. */
  editorTypeOf(contribution: PlacesContribution): string {
    return contribution.editorType ?? contribution.id;
  }

  // ── Links ────────────────────────────────────────────────────────────

  /** Give the core's links registry; places register one contract on it, kinds per tool. */
  setLinkRegistry(links: PlacesLinkRegistry | undefined): void {
    this._links = links;
    this._syncLinks();
  }

  private _attachedEditors: unknown;
  /**
   * The core's links registry and editor area, given once (by the API bridge,
   * which has both): addresses become links, and the tab in front is noted.
   */
  attach(links: PlacesLinkRegistry | undefined, editors: { readonly onDidActiveEditorChange: Event<{ readonly id: string } | undefined> } | undefined): void {
    if (links && links !== this._links) this.setLinkRegistry(links);
    if (editors && editors !== this._attachedEditors) {
      this._attachedEditors = editors;
      editors.onDidActiveEditorChange((e) => this.noteActiveEditor(e?.id));
    }
  }

  private _syncLinks(): void {
    this._linkContract?.dispose();
    this._linkContract = undefined;
    if (!this._links || !this._entries.size) return;
    const kinds: Parameters<PlacesLinkRegistry['register']>[0]['kinds'] = {};
    for (const entry of this._entries.values()) {
      const c = entry.contribution;
      kinds[c.id] = {
        uriTemplate: `parallx://place/${c.id}/<place>`,
        description: `A place in ${c.title}: ${c.places.map((p) => `${p.id} (${p.title})`).join(', ')}.`,
        examples: c.places.map((p) => placeAddress(c.id, { place: p.id })),
        open: async (parsed) => this.open(c.id, { place: parsed.pathSegments[1] ?? '', params: parsed.params }),
        resolveMetadata: async (parsed) => {
          const loc = this._normalize(entry, { place: parsed.pathSegments[1] ?? '', params: parsed.params });
          return { title: `${c.title}: ${this._titleOf(entry, loc)}`, icon: c.icon };
        },
      };
    }
    try {
      this._linkContract = this._links.register({ segment: PLACE_SEGMENT, displayName: 'Places', extensionId: 'core', kinds });
    } catch (err) {
      console.warn('[Places] the place links could not be registered:', err);
    }
  }

  // ── Where a tool is ─────────────────────────────────────────────────

  /** Where the tool's tab in front (or last in front) is. */
  current(tool: string): PlaceLocation | undefined {
    const tab = this._currentTab(tool);
    return tab?.location;
  }

  /** The address of a location in a tool. */
  addressOf(tool: string, location: PlaceLocation): string {
    return placeAddress(tool, location);
  }

  /** Tell the core which editor is in front (the workbench forwards the editor service's event). */
  noteActiveEditor(id: string | undefined): void {
    if (!id) return;
    const tab = this._tabs.get(id);
    const known = tab || this._isPlaceEditorId(id);
    if (!known) return;
    const before = tab ? this._currentTab(tab.toolKey) : undefined;
    this._lastActive.set(id, ++this._activeClock);
    if (tab && before !== tab) this._onDidMove.fire({ tool: tab.toolKey, location: tab.location });
  }

  // ── Moving ───────────────────────────────────────────────────────────

  /** Open an address (`parallx://place/...`). False when it names no place of a running tool. */
  openAddress(address: string, options: { readonly newTab?: boolean } = {}): Promise<boolean> {
    const parsed = parsePlaceAddress(address);
    return parsed ? this.open(parsed.tool, parsed.location, options) : Promise.resolve(false);
  }

  /**
   * Go to a place of a tool. In the tool's tab (the one in front, else the
   * one last in front, else a new one), or with `newTab` in a tab of its own,
   * or in the tab `tabId` names. Without a location: the tool's tab as it
   * is, or its first place.
   */
  async open(tool: string, location?: PlaceLocation, options: { readonly newTab?: boolean; readonly tabId?: string } = {}): Promise<boolean> {
    const entry = this._entries.get(tool);
    if (!entry) return false;
    let targetId: string | undefined;
    if (options.tabId) targetId = options.tabId;
    else if (!options.newTab) targetId = this._currentTabId(tool);

    if (targetId) {
      const tab = this._tabs.get(targetId);
      const loc = location ? this._normalize(entry, location) : (tab?.location ?? this._storedLocation(entry, targetId));
      if (tab?.view) {
        await entry.host.focusEditor(targetId);
        // Shown again, its pane may have been made anew (and taken the move already).
        if (tab.view) await this._move(tab, loc, true);
        return true;
      }
      this._pending.set(targetId, { location: loc, focus: true });
      const shown = await entry.host.focusEditor(targetId);
      if (shown) return true;
      // The tab closed meanwhile: open the place afresh.
      this._pending.delete(targetId);
    }

    const loc = this._normalize(entry, location ?? { place: entry.contribution.places[0].id });
    const mainId = entry.host.editorIdOf(entry.typeId, MAIN_INSTANCE);
    const mainOpen = entry.host.openEditorIds().some((d) => d.id === mainId);
    const instanceId = options.newTab || mainOpen ? this._freeInstanceId(entry) : MAIN_INSTANCE;
    const id = entry.host.editorIdOf(entry.typeId, instanceId);
    this._pending.set(id, { location: loc, focus: true });
    await entry.host.openEditor({ typeId: entry.typeId, title: this._titleOf(entry, loc), iconHtml: this._toolIconHtml(entry), instanceId });
    return true;
  }

  // ── The tab ──────────────────────────────────────────────────────────

  /** Draw a tool's places into a tab: what the bridge's editor provider does for each pane. */
  createPane(tool: string, container: HTMLElement, input: PlaceTabInput): IDisposable {
    const entry = this._entries.get(tool);
    if (!entry) return toDisposable(() => { /* the tool went */ });
    const pending = this._pending.get(input.id);
    this._pending.delete(input.id);
    const location = pending?.location ?? this._tabs.get(input.id)?.location ?? this._storedLocation(entry, input.id, input.place);
    let tab = this._tabs.get(input.id);
    if (!tab) {
      tab = { toolKey: tool, input, location, view: undefined, container: undefined, seq: 0 };
      this._tabs.set(input.id, tab);
      const forget = input.onWillDispose(() => { forget.dispose(); this._dropTab(input.id); });
    }
    const theTab = tab;
    theTab.container = container;
    input.setIconHtml(this._toolIconHtml(entry)); // the tool's icon, also on a tab restored from before
    input.openInOwnTab = () => { void this.open(tool, theTab.location, { newTab: true }); };
    const host: PlaceViewHost = {
      go: (loc) => { void this._move(theTab, this._normalize(entry, loc), true); },
      replace: (loc) => { this._record(theTab, this._normalize(entry, loc)); },
    };
    theTab.view = entry.contribution.createView(container, host);
    void this._move(theTab, location, pending?.focus ?? false, true);
    const view = theTab.view;
    return toDisposable(() => {
      if (theTab.view === view) { theTab.view = undefined; theTab.container = undefined; }
      try { view.dispose(); } catch (err) { console.warn('[Places] a view failed to close:', err); }
    });
  }

  private async _move(tab: Tab, location: PlaceLocation, focus: boolean, force = false): Promise<void> {
    const entry = this._entries.get(tab.toolKey);
    if (!entry) return;
    const seq = ++tab.seq;
    const changed = !sameLocation(tab.location, location);
    this._record(tab, location, force);
    if (changed || force || focus) {
      try { await tab.view?.show(location); } catch (err) { console.error(`[Places] ${tab.toolKey} could not show ${location.place}:`, err); }
    }
    if (focus && tab.container) {
      const container = tab.container;
      focusPageTitle(container, () => tab.seq === seq && tab.container === container);
    }
  }

  /** Name the tab, write its trail and address, and say the tool moved. */
  private _record(tab: Tab, location: PlaceLocation, force = false): void {
    const entry = this._entries.get(tab.toolKey);
    if (!entry) return;
    const changed = !sameLocation(tab.location, location);
    tab.location = location;
    tab.input.place = placeAddress(tab.toolKey, location);
    tab.input.setName(this._titleOf(entry, location));
    tab.input.setTrail(this._trailOf(entry, tab));
    if ((changed || force) && this._currentTab(tab.toolKey) === tab) this._onDidMove.fire({ tool: tab.toolKey, location });
  }

  private _trailOf(entry: Entry, tab: Tab): IEditorTrailCrumb[] {
    const c = entry.contribution;
    const tool = c.id;
    const steps = c.trailOf?.(tab.location) ?? [{ label: this._titleOf(entry, tab.location), location: tab.location }];
    const go = (loc: PlaceLocation) => (o: { readonly newTab: boolean }) => {
      void this.open(tool, loc, o.newTab ? { newTab: true } : { tabId: tab.input.id });
    };
    const first: PlaceLocation = { place: c.places[0].id };
    const crumbs: IEditorTrailCrumb[] = [{ label: c.title, icon: hasIcon(c.icon) ? c.icon : 'layout-dashboard', address: placeAddress(tool, first), open: go(first) }];
    steps.forEach((s, i) => {
      const loc = this._normalize(entry, s.location);
      crumbs.push({ label: s.label, address: placeAddress(tool, loc), open: go(loc), ...(i === steps.length - 1 ? { current: true } : {}) });
    });
    return crumbs;
  }

  private _dropTab(id: string): void {
    this._tabs.delete(id);
    this._pending.delete(id);
    this._lastActive.delete(id);
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  private _normalize(entry: Entry, location: PlaceLocation): PlaceLocation {
    const known = entry.contribution.places.find((p) => p.id === location.place);
    if (!known) return { place: entry.contribution.places[0].id };
    const params = location.params && Object.keys(location.params).length ? { ...location.params } : undefined;
    return params ? { place: known.id, params } : { place: known.id };
  }

  private _titleOf(entry: Entry, location: PlaceLocation): string {
    try {
      const own = entry.contribution.titleOf?.(location);
      if (own) return own;
    } catch { /* the place's own title below */ }
    return entry.contribution.places.find((p) => p.id === location.place)?.title ?? entry.contribution.title;
  }

  private _toolIconHtml(entry: Entry): string | undefined {
    const c = entry.contribution;
    return getIcon(hasIcon(c.icon) ? c.icon : 'layout-dashboard');
  }

  private _storedLocation(entry: Entry, id: string, address?: string): PlaceLocation {
    const known = this._tabs.get(id);
    if (known) return known.location;
    const parsed = address ? parsePlaceAddress(address) : null;
    if (parsed && parsed.tool === entry.contribution.id) return this._normalize(entry, parsed.location);
    return { place: entry.contribution.places[0].id };
  }

  private _isPlaceEditorId(id: string): boolean {
    for (const entry of this._entries.values()) {
      if (id.startsWith(`${entry.toolId}:${entry.typeId}:`)) return true;
    }
    return false;
  }

  /** The id of the tool's tab in front, else the one last in front, else any open one. */
  private _currentTabId(tool: string): string | undefined {
    const entry = this._entries.get(tool);
    if (!entry) return undefined;
    const prefix = entry.host.editorIdOf(entry.typeId, '');
    const open = entry.host.openEditorIds().filter((d) => d.id.startsWith(prefix));
    if (!open.length) return undefined;
    const active = open.find((d) => d.isActive);
    if (active) return active.id;
    return [...open].sort((a, b) => (this._lastActive.get(b.id) ?? 0) - (this._lastActive.get(a.id) ?? 0))[0].id;
  }

  private _currentTab(tool: string): Tab | undefined {
    const id = this._currentTabId(tool);
    return id ? this._tabs.get(id) : undefined;
  }

  private _freeInstanceId(entry: Entry): string {
    const open = new Set(entry.host.openEditorIds().map((d) => d.id));
    let instance: string;
    do { instance = `tab-${Date.now().toString(36)}-${++this._instanceCounter}`; } while (open.has(entry.host.editorIdOf(entry.typeId, instance)));
    return instance;
  }
}

/** The app's one places service. */
export const places = new PlacesService();
