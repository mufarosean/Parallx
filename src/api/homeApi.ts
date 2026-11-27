// homeApi.ts — `parallx.home`: what a tool puts on Home while it runs.
//
// A source (its things, for the feed) and a card (what it has for today).
// Ids are prefixed with the tool's, the card says the tool's own name, and
// both leave when the tool is turned off.

import type { IDisposable } from '../platform/lifecycle.js';
import { registerHomeCard, registerHomeSource, type HomeCard, type HomeSource } from '../services/homeSources.js';

export function createHomeApi(toolId: string, toolName: string, subscriptions: IDisposable[]) {
  const keep = (d: IDisposable): IDisposable => { subscriptions.push(d); return d; };
  return Object.freeze({
    registerSource: (source: HomeSource) => keep(registerHomeSource({ ...source, id: `${toolId}:${source.id}` })),
    registerCard: (card: Omit<HomeCard, 'from'>) => keep(registerHomeCard({ ...card, id: `${toolId}:${card.id}`, from: toolName })),
  });
}
