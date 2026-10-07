// flashcardsAddCards.test.ts — the argument of flashcards.addCards, normalized.
//
// Another tool hands cards over as plain objects; fcNormalizeAddCards is
// the pure step before fcGetOrCreateDeckByName and fcCreateCardsBulk.

import { describe, it, expect } from 'vitest';
// @ts-expect-error — JS module with no types
import { __testables } from '../../ext/flashcards/main.js';

const { fcNormalizeAddCards } = __testables;

describe('fcNormalizeAddCards', () => {
  it('trims the deck name and shapes each card for the bulk insert', () => {
    const out = fcNormalizeAddCards({
      deckName: '  Study: Exam 7 ',
      cards: [{
        front: ' What is the Cape Cod method? ', back: 'One expected loss ratio…', notes: 'n',
        tags: ['study', ' study:c:3 ', ''], sourceUri: 'file:///a.pdf', sourceLabel: 'a.pdf', sourcePage: 15,
        sourceExcerpt: 'The Cape Cod…', recallMode: 'conceptual', rubric: [{ text: 'ELR', required: true }, 'tail'],
      }],
    });
    expect(out.deckName).toBe('Study: Exam 7');
    expect(out.cards).toEqual([{
      front: 'What is the Cape Cod method?', back: 'One expected loss ratio…', notes: 'n',
      tags: ['study', 'study:c:3'], sourceUri: 'file:///a.pdf', sourceLabel: 'a.pdf', sourcePage: 15,
      sourceExcerpt: 'The Cape Cod…', recallMode: 'conceptual',
      rubric: [{ text: 'ELR', required: true }, { text: 'tail', required: true }],
    }]);
  });

  it('drops cards without a front, parses comma tags, and leaves the recall mode to the card type when none is given', () => {
    const out = fcNormalizeAddCards({ deckName: 'D', cards: [
      { front: '', back: 'x' },
      null,
      { front: 'F', tags: 'a, b', sourcePage: '3', rubric: 'not json', recallMode: 'nonsense' },
      { front: 'G', sourcePage: -2 },
    ] });
    expect(out.cards.map((c: { front: string }) => c.front)).toEqual(['F', 'G']);
    expect(out.cards[0].tags).toEqual(['a', 'b']);
    expect(out.cards[0].sourcePage).toBe(3);
    expect(out.cards[0].rubric).toEqual([]);
    expect(out.cards[0].recallMode).toBe('recognition');
    expect(out.cards[1].recallMode).toBeUndefined();
    expect(out.cards[1].sourcePage).toBe(0);
  });

  it('tolerates a missing or malformed argument', () => {
    expect(fcNormalizeAddCards(undefined)).toEqual({ deckName: '', cards: [] });
    expect(fcNormalizeAddCards({ deckName: 'D', cards: 'nope' })).toEqual({ deckName: 'D', cards: [] });
  });
});
