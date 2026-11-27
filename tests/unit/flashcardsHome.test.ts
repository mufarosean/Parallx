// flashcardsHome.test.ts — what Flashcards puts on Home (ext/flashcards/home.js):
// the card for today from the counts, and the decks as things for the feed.

import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error a plain JS module of the extension
import { fcHomeCard, fcHomeDecks, fcRegisterHome } from '../../ext/flashcards/home.js';

const counts = (newCount: number, learnCount: number, reviewCount: number) => ({ newCount, learnCount, reviewCount, dueTotal: newCount + learnCount + reviewCount });

describe('Flashcards\' card for today', () => {
  it('has no card while there are no decks', () => {
    expect(fcHomeCard({ decks: 0, served: 0, counts: counts(0, 0, 0) })).toBeNull();
  });

  it('says the number the session hands over, with Study as its action', () => {
    const card = fcHomeCard({ decks: 1, served: 30, counts: counts(6, 4, 20) });
    expect(card).toMatchObject({ id: 'today', number: '30', unit: 'cards due', line: '6 are new, 24 to review.', action: { label: 'Study', command: 'flashcards.study' } });
  });

  it('says one card in the singular', () => {
    expect(fcHomeCard({ decks: 1, served: 1, counts: counts(1, 0, 0) })).toMatchObject({ number: '1', unit: 'card due', line: 'It is new.' });
    expect(fcHomeCard({ decks: 1, served: 1, counts: counts(0, 0, 1) })).toMatchObject({ line: 'A review.' });
  });

  it('says when every card is new, or every card a review', () => {
    expect(fcHomeCard({ decks: 1, served: 3, counts: counts(3, 0, 0) }).line).toBe('All of them are new.');
    expect(fcHomeCard({ decks: 1, served: 5, counts: counts(0, 2, 3) }).line).toBe('All of them are reviews.');
  });

  it('says how many more wait when the daily limits hold some back', () => {
    expect(fcHomeCard({ decks: 2, served: 20, counts: counts(100, 0, 3) }).line).toBe('83 more wait behind today\'s limits.');
    expect(fcHomeCard({ decks: 2, served: 20, counts: counts(21, 0, 0) }).line).toBe('1 more waits behind today\'s limits.');
  });

  it('with nothing due says so and opens Flashcards instead', () => {
    expect(fcHomeCard({ decks: 1, served: 0, counts: counts(0, 0, 0) })).toMatchObject({ number: '0', unit: 'cards due', line: 'Nothing due right now.', action: { label: 'Open Flashcards', command: 'flashcards.open' } });
  });
});

describe('Flashcards\' decks in the feed', () => {
  it('are things with a card count, last reviewed first; a deck never studied goes by when it was made', () => {
    const open = vi.fn();
    const items = fcHomeDecks([
      { id: 1, name: 'Reserving', description: 'Exam 7', created_at: 100, cards: 62, reviewed: 900 },
      { id: 2, name: 'New Deck', description: '', created_at: 950, cards: 1, reviewed: null },
    ], open);
    expect(items.map((i: { title: string }) => i.title)).toEqual(['New Deck', 'Reserving']);
    expect(items[1]).toMatchObject({ id: '1', kind: 'Deck', summary: 'Exam 7', touchedAt: 900, stat: { value: '62', unit: 'cards' } });
    expect(items[0]).toMatchObject({ summary: undefined, touchedAt: 950, stat: { value: '1', unit: 'card' } });
    items[1].open();
    expect(open).toHaveBeenCalledWith(1);
  });
});

describe('registering on Home', () => {
  const today = async () => ({ decks: 1, served: 3, counts: counts(3, 0, 0) });
  const onData = () => ({ dispose() {} });

  it('does nothing on a host without Home', () => {
    const context = { subscriptions: [] as { dispose(): void }[] };
    fcRegisterHome({}, context, { all: async () => [], today, onData, openDeck: () => {} });
    expect(context.subscriptions).toEqual([]);
  });

  it('gives Home a card to read and the decks as a source, both following the data', async () => {
    const providers: { id: string; read(): Promise<unknown>; onDidChange: unknown }[] = [];
    const sources: { id: string; listRecent(n: number): Promise<unknown[]>; onDidChange: unknown }[] = [];
    const api = { home: {
      registerCardProvider: (p: typeof providers[number]) => { providers.push(p); return { dispose() {} }; },
      registerSource: (s: typeof sources[number]) => { sources.push(s); return { dispose() {} }; },
    } };
    const context = { subscriptions: [] as { dispose(): void }[] };
    fcRegisterHome(api, context, { all: async () => [{ id: 1, name: 'Reserving', description: '', created_at: 1, cards: 3, reviewed: 5 }], today, onData, openDeck: () => {} });
    expect(context.subscriptions).toHaveLength(2);
    expect(providers[0].id).toBe('today');
    expect(await providers[0].read()).toMatchObject({ number: '3', unit: 'cards due' });
    expect(providers[0].onDidChange).toBe(onData);
    expect(await sources[0].listRecent(5)).toHaveLength(1);
    expect(sources[0].onDidChange).toBe(onData);
  });
});
