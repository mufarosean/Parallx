// findService.ts — Find (Ctrl+F): one surface, the active editor first.
//
// Find opens on the editor in front and searches that document. A tool that
// can search somewhere wider (the whole workspace) registers a scope while
// it runs; the surface then shows a switch between "This Document" and each
// scope. The core knows no such tool: with none registered there is no
// switch, and Find is the document's alone.

import { createServiceIdentifier } from '../platform/types.js';
import type { IDisposable } from '../platform/lifecycle.js';
import type { FindOptions } from '../ui/findTargets.js';

/** A wider place to search than the editor in front. */
export interface IFindScope {
  readonly id: string;
  /** The switch's word for it: 'Workspace'. */
  readonly label: string;
  /**
   * Draw the scope's results under the find field. `report` sets the short
   * count beside the field ('7 in 4 files').
   */
  mount(host: HTMLElement, report: (summary: string) => void): IDisposable;
  /** Run the query. An empty query clears the results. */
  search(query: string, options: FindOptions): void;
  /** Open the next (1) or the previous (-1) result. */
  step?(delta: 1 | -1): void;
}

export interface IFindService {
  /** Add a scope for as long as the returned handle lives. */
  registerScope(scope: IFindScope): IDisposable;
  /** Open Find (or bring it forward). Without an id: on the active editor when it can be searched. */
  open(scopeId?: string): void;
  close(): void;
  /** While Find is open: the next (1) or the previous (-1) match. */
  step(delta: 1 | -1): void;
  /** While Find is open: flip one of the three query toggles. */
  toggleOption(option: keyof FindOptions): void;
}

export const IFindService = createServiceIdentifier<IFindService>('IFindService');
