// homeApi.ts — `parallx.home`: what a tool puts on Home while it runs.
//
// A source (its things, for the feed) and a card (what it has for today),
// either said once or read each time Home asks. Ids are prefixed with the
// tool's, the card says the tool's own name, and all of it leaves when the
// tool is turned off.

import type { IDisposable } from '../platform/lifecycle.js';
import type { Event } from '../platform/events.js';
import { registerHomeCard, registerHomeCardProvider, registerHomeSource, type HomeCard, type HomeSource } from '../services/homeSources.js';

/** A card as a tool writes it: Home adds where it is from. */
export type ToolHomeCard = Omit<HomeCard, 'from'>;

export interface ToolHomeCardProvider {
  readonly id: string;
  read(): Promise<ToolHomeCard | null>;
  readonly onDidChange?: Event<void>;
}

export function createHomeApi(toolId: string, toolName: string, subscriptions: IDisposable[]) {
  const keep = (d: IDisposable): IDisposable => { subscriptions.push(d); return d; };
  const mine = (card: ToolHomeCard, id: string): HomeCard => ({ ...card, id: `${toolId}:${id}`, from: toolName });
  return Object.freeze({
    registerSource: (source: HomeSource) => keep(registerHomeSource({ ...source, id: `${toolId}:${source.id}` })),
    registerCard: (card: ToolHomeCard) => keep(registerHomeCard(mine(card, card.id))),
    registerCardProvider: (provider: ToolHomeCardProvider) => keep(registerHomeCardProvider({
      id: `${toolId}:${provider.id}`,
      read: async () => { const card = await provider.read(); return card ? mine(card, provider.id) : null; },
      onDidChange: provider.onDidChange,
    })),
  });
}
