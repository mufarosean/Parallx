// navigationHistory.ts — one record of where he has been, for Back and Forward.
//
// A step is the tab in front: a thing (a file, a page, a web page) by its
// tab, a tool's place (services/places.ts) by its tab and its address. A
// switch to another tab, the opening of one, and a move to another place
// are each a step; the same step twice in a row is one. Back goes to the
// step before, Forward to the one after, as a browser does: a new step
// after going back drops the steps ahead. A step whose tab was closed is
// opened again (a place in its tool's tab; a thing from what its tab saved),
// and one that cannot be is skipped. The moves Back and Forward make are not
// steps of their own.
//
// It lives for the window's life and names no tool: the editor area and the
// places point are given by the workbench (workbench/navigationWiring.ts).
// Settings (a dialog), Chat and Agents (the right side) are not tabs, so are
// never steps.

import { Emitter, type Event } from '../platform/events.js';

/** What a tab saved of itself, to be opened again once closed. */
export interface NavigationReopen {
  readonly typeId: string;
  readonly data?: Record<string, unknown>;
}

export interface NavigationStep {
  /** The tab's editor id. */
  readonly editorId: string;
  /** The editor group it was in. */
  readonly groupId?: string;
  /** What Back's name and the list say: the tab's name, or the place's. */
  readonly label: string;
  /** A place's address (`parallx://place/...`); none for a thing. */
  readonly place?: string;
  /** How to open a thing again once its tab is closed. */
  readonly reopen?: NavigationReopen;
}

/** The editor area and the places point, as far as Back and Forward need them. */
export interface NavigationHost {
  /** The step the window is at now: the tab in front, or undefined when none is. */
  current(): NavigationStep | undefined;
  isOpen(editorId: string): boolean;
  /** Bring an open tab to the front. */
  focus(editorId: string, groupId?: string): Promise<boolean>;
  /** Open a closed thing again from what its tab saved. */
  reopen(reopen: NavigationReopen, groupId?: string): Promise<boolean>;
  /** Go to a place, in this tab when it is open, else in its tool's tab. */
  openPlace(address: string, editorId?: string): Promise<boolean>;
  /** Put the keys on the page's title, as after any move. */
  focusTitle(): void;
}

/** How many steps are kept; the oldest go first. */
export const MAX_STEPS = 50;
/** How many steps the arrows' list offers. */
export const LIST_STEPS = 10;

const keyOf = (s: NavigationStep): string => `${s.editorId}\n${s.place ?? ''}`;

export class NavigationHistory {
  private _host: NavigationHost | undefined;
  private _steps: NavigationStep[] = [];
  private _index = -1;
  private _started = false;
  /** Set while Back or Forward moves, so its own move is not a new step. */
  private _moving = false;
  private _queue: Promise<void> = Promise.resolve();

  private readonly _onDidChange = new Emitter<void>();
  /** Fires when the steps or where he is among them change. */
  readonly onDidChange: Event<void> = this._onDidChange.event;

  /** Given once by the workbench. */
  setHost(host: NavigationHost): void {
    this._host = host;
  }

  /** Begin recording (once the last session's tabs are back), from the tab in front. */
  start(): void {
    this._started = true;
    this.note();
  }

  /** Where he is may have changed: a tab came to the front, or a tab moved to another place. */
  note(): void {
    if (!this._started || this._moving || !this._host) return;
    const now = this._host.current();
    if (!now) return;
    const at = this._steps[this._index];
    if (at && keyOf(at) === keyOf(now)) {
      this._steps[this._index] = now; // the same step, its name or saved state brought up to date
      this._onDidChange.fire();
      return;
    }
    this._steps.splice(this._index + 1);
    this._steps.push(now);
    if (this._steps.length > MAX_STEPS) this._steps.splice(0, this._steps.length - MAX_STEPS);
    this._index = this._steps.length - 1;
    this._onDidChange.fire();
  }

  get canGoBack(): boolean { return this._index > 0; }
  get canGoForward(): boolean { return this._index >= 0 && this._index < this._steps.length - 1; }

  /** The step Back would go to, and Forward. */
  get previous(): NavigationStep | undefined { return this._steps[this._index - 1]; }
  get next(): NavigationStep | undefined { return this._steps[this._index + 1]; }

  /** The last few steps behind (nearest first) or ahead, each with the jump it is. */
  list(direction: 'back' | 'forward'): readonly { step: NavigationStep; offset: number }[] {
    const out: { step: NavigationStep; offset: number }[] = [];
    const dir = direction === 'back' ? -1 : 1;
    for (let k = 1; k <= LIST_STEPS; k++) {
      const step = this._steps[this._index + dir * k];
      if (!step) break;
      out.push({ step, offset: dir * k });
    }
    return out;
  }

  back(): Promise<void> { return this.go(-1); }
  forward(): Promise<void> { return this.go(1); }

  /** Move `offset` steps (negative: back). Presses made while a move runs wait their turn. */
  go(offset: number): Promise<void> {
    const run = this._queue.then(() => this._go(offset));
    this._queue = run.catch(() => { /* the next press still runs */ });
    return run;
  }

  /** For tests and the scene: the steps' labels and where he is. */
  snapshot(): { readonly labels: readonly string[]; readonly index: number } {
    return { labels: this._steps.map((s) => s.label), index: this._index };
  }

  private async _go(offset: number): Promise<void> {
    const host = this._host;
    if (!host || !offset) return;
    let target = this._index + offset;
    while (target >= 0 && target < this._steps.length && target !== this._index) {
      const step = this._steps[target];
      if (await this._goTo(host, step)) {
        this._index = target;
        const now = host.current();
        if (now) this._steps[target] = now; // reopened, its tab may have a new id
        this._onDidChange.fire();
        host.focusTitle();
        return;
      }
      // Gone and not to be opened again: skip it, and try the next one that way
      // (ahead, the next one slides into its slot).
      this._steps.splice(target, 1);
      if (target < this._index) { this._index -= 1; target -= 1; }
      this._onDidChange.fire();
    }
  }

  private async _goTo(host: NavigationHost, step: NavigationStep): Promise<boolean> {
    this._moving = true;
    try {
      const open = host.isOpen(step.editorId);
      if (step.place) return await host.openPlace(step.place, open ? step.editorId : undefined);
      if (open) return await host.focus(step.editorId, step.groupId);
      return step.reopen ? await host.reopen(step.reopen, step.groupId) : false;
    } catch (err) {
      console.warn('[Navigation] a step could not be opened:', err);
      return false;
    } finally {
      this._moving = false;
    }
  }
}

/** The window's one record. */
export const navigationHistory = new NavigationHistory();
