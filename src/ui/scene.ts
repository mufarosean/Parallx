// scene.ts — what is on screen right now, as data.
//
// Every control and surface the kit builds registers here while it is
// mounted, with its id, kind, owner, label and a function that reads its
// state. Nothing draws from the scene; it exists to be read: by the
// introspection service (the model's `app__describe` tool), by the probes
// that drive the app by id, and by tests. docs/SELF_DESCRIBING_UI_DESIGN.md
// section 4 is the design this file implements.
//
// Parents are found from the DOM, not passed: an entry's parent is the
// nearest ancestor element carrying `data-px-surface`. An element registered
// before it is connected is held and added when the observer sees it
// connect; an element removed from the document leaves the scene without
// anyone calling dispose.

import { Emitter, type Event } from '../platform/events.js';
import type { IDisposable } from '../platform/lifecycle.js';
import { isDevMode } from '../platform/devMode.js';

export type SceneKind =
  | 'surface'
  | 'button' | 'iconButton' | 'chip' | 'segmented' | 'toggle'
  | 'input' | 'select' | 'slider'
  | 'list' | 'tree' | 'tabs' | 'menu';

export type SceneState =
  | { readonly kind: 'pressed'; readonly value: boolean }
  | { readonly kind: 'value'; readonly value: string }
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'selection'; readonly value: readonly string[]; readonly count: number }
  | { readonly kind: 'enabled'; readonly value: boolean };

export interface ISceneEntry {
  /** Stable within its parent: 'planner.addTask', 'chat.input'. */
  readonly id: string;
  readonly kind: SceneKind;
  /** Surfaces: the tool that owns it. Controls: inherited from the surface when ''. */
  readonly owner: string;
  /** Surfaces only: tells two open copies apart. */
  readonly instance?: string;
  /** What a person reads. */
  readonly label: string;
  readonly hint?: string;
  /** The command this control runs, when it runs one. */
  readonly command?: string;
  /** Recorded for the docs. Never evaluated here. */
  readonly when?: string;
  /** Never serialised. */
  readonly element: HTMLElement;
  readonly state?: () => SceneState;
}

export interface SceneNode {
  readonly id: string;
  readonly kind: SceneKind;
  readonly owner: string;
  readonly instance?: string;
  readonly label: string;
  readonly hint?: string;
  readonly command?: string;
  readonly state?: SceneState;
  readonly children?: readonly SceneNode[];
  /** Connected, laid out and the document not hidden. */
  readonly visible: boolean;
  /** True for the surface that holds document.activeElement. */
  readonly focused?: boolean;
}

export interface SceneDescription {
  readonly surfaces: readonly SceneNode[];
}

export interface IScene {
  /**
   * Adds the entry under the nearest surface ancestor of entry.element. An
   * element not yet connected is held and added when it connects. The
   * returned disposable removes it.
   */
  register(entry: ISceneEntry): IDisposable;
  /** The mounted entries with this id, in registration order. */
  find(id: string): readonly ISceneEntry[];
  /** Every mounted entry, parents before children, in registration order. */
  entries(): readonly ISceneEntry[];
  /** The entries under one surface entry, recursively. */
  under(surface: ISceneEntry): readonly ISceneEntry[];
  /** The surface entry an element sits in, if any. */
  surfaceOf(element: HTMLElement): ISceneEntry | undefined;
  /** Fires once per task at most, after any change. */
  readonly onDidChange: Event<void>;
  /** The tree as plain data; `scope` is a surface id. */
  describe(scope?: string): SceneDescription;
  /** Tests only: drops every entry and the pending ones. */
  reset(): void;
}

export const SURFACE_ATTR = 'data-px-surface';
export const INSTANCE_ATTR = 'data-px-instance';
export const ID_ATTR = 'data-px-id';

interface Mounted {
  readonly entry: ISceneEntry;
  /** The surface entry this one sits under; undefined for a top-level surface. */
  parent: Mounted | undefined;
  readonly children: Mounted[];
  /** Order of registration, for stable listings. */
  readonly seq: number;
}

const warned = new Set<string>();
function complain(message: string): void {
  if (isDevMode) throw new Error(`[scene] ${message}`);
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(`[scene] ${message}`);
}

/**
 * After the current task, never on an animation frame: a window that is
 * hidden or behind another throttles frames, and a probe reading the scene
 * from such a window must not wait on one.
 */
function SCHEDULE(fn: () => void): void {
  queueMicrotask(fn);
}

class Scene implements IScene {
  /** Surfaces by element. */
  private readonly _mounted = new Map<HTMLElement, Mounted>();
  /** Controls by element. A view's root can be both its surface and, say, its tree. */
  private readonly _controls = new Map<HTMLElement, Mounted>();
  private readonly _pending = new Map<HTMLElement, ISceneEntry>();
  private readonly _roots: Mounted[] = [];
  private _seq = 0;
  private _observer: MutationObserver | undefined;
  private _changeQueued = false;
  private readonly _onDidChange = new Emitter<void>();
  readonly onDidChange: Event<void> = this._onDidChange.event;

  register(entry: ISceneEntry): IDisposable {
    if (!entry.id || !entry.label) {
      complain(`a ${entry.kind} needs an id and a label (id: "${entry.id}", label: "${entry.label}")`);
    }
    const el = entry.element;
    if (entry.kind === 'surface') {
      el.setAttribute(SURFACE_ATTR, entry.id);
      if (entry.instance !== undefined) el.setAttribute(INSTANCE_ATTR, entry.instance);
    } else {
      el.setAttribute(ID_ATTR, entry.id);
    }
    this._ensureObserver();
    if (el.isConnected) this._add(entry);
    else this._pending.set(el, entry);
    let disposed = false;
    const map = entry.kind === 'surface' ? this._mounted : this._controls;
    return {
      dispose: () => {
        if (disposed) return;
        disposed = true;
        this._pending.delete(el);
        // Only this entry: a view's root can hold a surface and a control.
        const m = map.get(el);
        if (m) this._drop(el, m, map);
      },
    };
  }

  find(id: string): readonly ISceneEntry[] {
    const out: ISceneEntry[] = [];
    for (const m of this._ordered()) if (m.entry.id === id) out.push(m.entry);
    return out;
  }

  entries(): readonly ISceneEntry[] {
    return this._ordered().map((m) => m.entry);
  }

  under(surface: ISceneEntry): readonly ISceneEntry[] {
    const m = this._mounted.get(surface.element);
    if (!m) return [];
    const out: ISceneEntry[] = [];
    const walk = (node: Mounted): void => {
      for (const c of [...node.children].sort((a, b) => a.seq - b.seq)) { out.push(c.entry); walk(c); }
    };
    walk(m);
    return out;
  }

  surfaceOf(element: HTMLElement): ISceneEntry | undefined {
    const host = element.closest(`[${SURFACE_ATTR}]`);
    return host instanceof HTMLElement ? this._mounted.get(host)?.entry : undefined;
  }

  describe(scope?: string): SceneDescription {
    const active = typeof document !== 'undefined' ? document.activeElement : null;
    const focusedSurface = active instanceof HTMLElement ? this.surfaceOf(active) : undefined;
    const toNode = (m: Mounted): SceneNode => {
      const e = m.entry;
      let state: SceneState | undefined;
      try { state = e.state?.(); } catch { state = undefined; }
      const node: SceneNode = {
        id: e.id,
        kind: e.kind,
        owner: this._ownerOf(m),
        ...(e.instance !== undefined ? { instance: e.instance } : {}),
        label: e.label,
        ...(e.hint ? { hint: e.hint } : {}),
        ...(e.command ? { command: e.command } : {}),
        ...(state ? { state } : {}),
        visible: isVisible(e.element),
        ...(e.kind === 'surface' ? { focused: focusedSurface?.element === e.element } : {}),
        ...(e.kind === 'surface' ? { children: [...m.children].sort((a, b) => a.seq - b.seq).map(toNode) } : {}),
      };
      return node;
    };
    let roots = [...this._roots].sort((a, b) => a.seq - b.seq);
    if (scope) {
      const found: Mounted[] = [];
      for (const m of this._ordered()) if (m.entry.kind === 'surface' && m.entry.id === scope) found.push(m);
      roots = found;
    }
    return { surfaces: roots.map(toNode) };
  }

  reset(): void {
    this._mounted.clear();
    this._controls.clear();
    this._pending.clear();
    this._roots.length = 0;
    this._observer?.disconnect();
    this._observer = undefined;
  }

  // ── Mounting ──

  private _add(entry: ISceneEntry): void {
    const el = entry.element;
    const map = entry.kind === 'surface' ? this._mounted : this._controls;
    if (map.has(el)) return;
    const parent = this._parentFor(entry);
    const siblings = parent ? parent.children : this._roots;
    // Two controls with one id under one surface is a mistake. Two surfaces
    // with one id and instance is not: the same file open in two editor
    // groups is two regions on screen, and both are listed.
    if (entry.kind !== 'surface') {
      // A sibling whose element already left the document is on its way out
      // (the observer drops it next frame); a control replacing it in the
      // same frame is not a duplicate.
      for (const stale of siblings.filter((s) => !s.entry.element.isConnected)) this._remove(stale.entry.element);
      const dup = siblings.find((s) => s.entry.id === entry.id && s.entry.instance === entry.instance);
      if (dup) {
        complain(`"${entry.id}" is registered twice under ${parent ? parent.entry.id : 'the window'}`);
        return;
      }
    }
    const m: Mounted = { entry, parent, children: [], seq: this._seq++ };
    map.set(el, m);
    if (parent) parent.children.push(m); else this._roots.push(m);
    // A surface whose host surface is not yet mounted (registered out of
    // order) is parented when the host arrives: section _reparent.
    if (entry.kind === 'surface') this._adoptOrphans(m);
    this._notify();
  }

  /** Controls and surfaces that mounted before their surface did, now under it. */
  private _adoptOrphans(surface: Mounted): void {
    for (const m of this._roots.slice()) {
      if (m === surface) continue;
      const host = m.entry.element.parentElement?.closest(`[${SURFACE_ATTR}]`);
      if (host === surface.entry.element) {
        this._roots.splice(this._roots.indexOf(m), 1);
        m.parent = surface;
        surface.children.push(m);
      }
    }
  }

  /**
   * The surface an entry sits under: for a control declared on a surface's
   * own element, that surface; otherwise the nearest surface ancestor.
   */
  private _parentFor(entry: ISceneEntry): Mounted | undefined {
    const el = entry.element;
    if (entry.kind !== 'surface') {
      const own = this._mounted.get(el);
      if (own) return own;
    }
    const host = el.parentElement?.closest(`[${SURFACE_ATTR}]`);
    return host instanceof HTMLElement ? this._mounted.get(host) : undefined;
  }

  private _remove(el: HTMLElement): void {
    const control = this._controls.get(el);
    if (control) this._drop(el, control, this._controls);
    const surface = this._mounted.get(el);
    if (surface) this._drop(el, surface, this._mounted);
  }

  private _drop(el: HTMLElement, m: Mounted, map: Map<HTMLElement, Mounted>): void {
    map.delete(el);
    const siblings = m.parent ? m.parent.children : this._roots;
    const i = siblings.indexOf(m);
    if (i >= 0) siblings.splice(i, 1);
    // A surface disposed while its element stays in the document (its
    // registration replaced) hands its children to the surface above; one
    // whose element left the document takes them with it.
    if (el.isConnected) {
      const to = m.parent ? m.parent.children : this._roots;
      for (const c of m.children.splice(0)) { c.parent = m.parent; to.push(c); }
    } else {
      for (const c of m.children.slice()) this._remove(c.entry.element);
    }
    this._notify();
  }

  private _ordered(): Mounted[] {
    const out: Mounted[] = [];
    const walk = (list: Mounted[]): void => {
      for (const m of [...list].sort((a, b) => a.seq - b.seq)) { out.push(m); walk(m.children); }
    };
    walk(this._roots);
    return out;
  }

  private _ownerOf(m: Mounted): string {
    let cur: Mounted | undefined = m;
    while (cur) {
      if (cur.entry.owner) return cur.entry.owner;
      cur = cur.parent;
    }
    return 'core';
  }

  private _notify(): void {
    if (this._changeQueued) return;
    this._changeQueued = true;
    SCHEDULE(() => { this._changeQueued = false; this._onDidChange.fire(); });
  }

  // ── The observer ──

  private _ensureObserver(): void {
    if (this._observer || typeof MutationObserver === 'undefined' || typeof document === 'undefined') return;
    // The observer already delivers one batch per task; the batch is
    // handled where it arrives.
    this._observer = new MutationObserver((records) => {
      this._queue(records);
      this._flush();
    });
    this._observer.observe(document.body, { childList: true, subtree: true });
  }

  private readonly _added = new Set<Node>();
  private readonly _removed = new Set<Node>();
  private _queue(records: MutationRecord[]): void {
    for (const r of records) {
      for (const n of r.addedNodes) this._added.add(n);
      for (const n of r.removedNodes) this._removed.add(n);
    }
  }

  private _flush(): void {
    // A batch delivered after a test window was torn down has nothing to do.
    if (typeof HTMLElement === 'undefined') { this._removed.clear(); this._added.clear(); return; }
    const removed = [...this._removed]; this._removed.clear();
    const added = [...this._added]; this._added.clear();
    for (const n of removed) {
      if (!(n instanceof HTMLElement)) continue;
      if (n.isConnected) continue; // moved, not removed
      for (const el of withTagged(n)) this._remove(el);
    }
    for (const n of added) {
      if (!(n instanceof HTMLElement) || !n.isConnected) continue;
      for (const el of withTagged(n)) {
        const pending = this._pending.get(el);
        if (pending) { this._pending.delete(el); this._add(pending); continue; }
        // A moved element: re-parent to where it now is.
        const moved = this._mounted.get(el) ?? this._controls.get(el);
        if (moved) this._reparent(moved);
      }
    }
    // Pending entries whose element connected inside a subtree the observer
    // reported by its root only.
    for (const [el, entry] of [...this._pending]) {
      if (el.isConnected) { this._pending.delete(el); this._add(entry); }
    }
  }

  private _reparent(m: Mounted): void {
    const parent = this._parentFor(m.entry);
    if (parent === m.parent) return;
    const from = m.parent ? m.parent.children : this._roots;
    const i = from.indexOf(m);
    if (i >= 0) from.splice(i, 1);
    m.parent = parent;
    (parent ? parent.children : this._roots).push(m);
    this._notify();
  }
}

/** The element and every descendant carrying a scene attribute. */
function withTagged(root: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  if (root.hasAttribute(SURFACE_ATTR) || root.hasAttribute(ID_ATTR)) out.push(root);
  root.querySelectorAll<HTMLElement>(`[${SURFACE_ATTR}], [${ID_ATTR}]`).forEach((el) => out.push(el));
  return out;
}

/** Connected, laid out and the document not hidden (paneOnScreen's rule). */
export function isVisible(element: HTMLElement): boolean {
  if (typeof document === 'undefined') return false;
  return !document.hidden && element.isConnected && element.offsetParent !== null;
}

export const scene: IScene = new Scene();
