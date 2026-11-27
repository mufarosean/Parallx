// placesBridge.ts — `parallx.places`: a tool declares its places and draws
// each; the core (services/places.ts) keeps the one tab, its name, the trail
// in the bar under the tabs, the addresses, where the keys land and the
// column's mark. The tab is the tool's own editor type, registered here
// through the tool's editors bridge, so it restores and closes like any of
// the tool's tabs and goes when the tool is turned off.

import { toDisposable, type IDisposable } from '../../platform/lifecycle.js';
import type { Event } from '../../platform/events.js';
import type { IEditorService } from '../../services/serviceTypes.js';
import { places, type PlaceLocation, type PlaceMove, type PlacesContribution, type PlacesLinkRegistry, type PlaceTabInput } from '../../services/places.js';
import type { EditorsBridge } from './editorsBridge.js';

export interface PlacesApi {
  register(contribution: PlacesContribution): IDisposable;
  open(target: string | { readonly tool: string; readonly place?: string; readonly params?: Readonly<Record<string, string>> }, options?: { readonly newTab?: boolean }): Promise<boolean>;
  current(tool: string): PlaceLocation | undefined;
  addressOf(tool: string, location: PlaceLocation): string;
  readonly onDidMove: Event<PlaceMove>;
}

export function createPlacesApi(toolId: string, editors: EditorsBridge, editorService: IEditorService | undefined, links: PlacesLinkRegistry | undefined, subscriptions: IDisposable[]): PlacesApi {
  // The core's links and editor area, given to the one places service the first time (the same for every tool).
  places.attach(links, editorService);
  const own: IDisposable[] = [];
  subscriptions.push(toDisposable(() => { for (const d of own.splice(0)) d.dispose(); }));
  return Object.freeze({
    register(contribution: PlacesContribution): IDisposable {
      const typeId = places.editorTypeOf(contribution);
      const registration = places.register(toolId, contribution, {
        openEditor: (o) => editors.openEditor(o),
        focusEditor: (id) => editors.focusEditor(id),
        openEditorIds: () => (editorService?.getOpenEditors() ?? []).map((d) => ({ id: d.id, isActive: d.isActive })),
        editorIdOf: (type, instance) => `${toolId}:${type}:${instance}`,
      });
      let provider: IDisposable;
      try {
        provider = editors.registerEditorProvider(typeId, {
          createEditorPane: (container: HTMLElement, input?: unknown) => places.createPane(contribution.id, container, input as unknown as PlaceTabInput),
        });
      } catch (err) {
        registration.dispose();
        throw err;
      }
      const both = toDisposable(() => { provider.dispose(); registration.dispose(); });
      own.push(both);
      return both;
    },
    open(target, options) {
      if (typeof target === 'string') return places.openAddress(target, options);
      return places.open(target.tool, target.place ? { place: target.place, ...(target.params ? { params: target.params } : {}) } : undefined, options);
    },
    current: (tool) => places.current(tool),
    addressOf: (tool, location) => places.addressOf(tool, location),
    onDidMove: (listener) => {
      const d = places.onDidMove(listener);
      own.push(d);
      return d;
    },
  } satisfies PlacesApi);
}
