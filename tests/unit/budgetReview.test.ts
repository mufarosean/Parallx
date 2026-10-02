// Budget's Review page: why a row is waiting, the verdict it opens with, and
// which rule would really apply. The notes are the exact strings the sync
// writes (budgetSync's cross-check and duplicate notes).
import { describe, it, expect } from 'vitest';
// @ts-expect-error — JS module with no types
import { __testables } from '../../ext/budget/main.js';

const { reviewReason, reviewDefaultVerdict, reviewRuleFor, reviewTypeSource } = __testables;

const zelle = {
  merchant: 'ZELLE TO MARIA LOPEZ', amount_cents: 12000, tx_type: 'transfer', tx_type_source: 'ai', ai_confidence: 'high',
  notes: '[cross-check: tx_type=transfer, merchant=ZELLE TO MARIA LOPEZ, amount=120.00, payee looks external]',
};
const dupe = {
  merchant: 'Apple.com/bill', amount_cents: 299, tx_type: 'purchase', tx_type_source: 'ai', ai_confidence: 'medium',
  notes: '[possible duplicate of 075a1500-66d6-4092-b982-c5a2cea4b730]',
};
const unsure = { merchant: 'SQ *SUNSET CAFE 0042', amount_cents: 1850, tx_type: 'purchase', tx_type_source: 'ai', ai_confidence: 'low', notes: null };

describe('budget review', () => {
  it('names the reason the sync wrote', () => {
    expect(reviewReason(zelle).tag).toBe('Transfer to a person?');
    expect(reviewReason(zelle).why).toContain('ZELLE TO MARIA LOPEZ does not look like one of your accounts');
    expect(reviewReason(dupe).tag).toBe('Possible duplicate');
    expect(reviewReason(unsure).tag).toBe('AI unsure');
    expect(reviewReason({ ...unsure, notes: '[cross-check: tx_type=purchase, merchant=NULL, amount=18.50]' }).tag).toBe('No payee');
    expect(reviewReason({ ...unsure, notes: '[cross-check: tx_type=deposit, merchant=ACME, amount=40.00]' }).tag).toBe('Income or money out?');
  });

  it('a duplicate wins over a cross-check when both are noted', () => {
    expect(reviewReason({ ...zelle, notes: zelle.notes + ' ' + dupe.notes }).tag).toBe('Possible duplicate');
  });

  it('opens on Duplicate only when flagged; otherwise on the type it has', () => {
    expect(reviewDefaultVerdict(dupe)).toBe('duplicate');
    expect(reviewDefaultVerdict(zelle)).toBe('transfer');
    expect(reviewDefaultVerdict({ ...unsure, tx_type: 'cc_payment' })).toBe('purchase');
  });

  it('says who typed it', () => {
    expect(reviewTypeSource(zelle)).toBe('The AI typed it as Transfer.');
    expect(reviewTypeSource(unsure)).toBe('The AI typed it as Expense, and was not sure.');
    expect(reviewTypeSource({ ...unsure, tx_type_source: 'subject', ai_confidence: 'high' })).toBe('The email subject typed it as Expense.');
  });

  it('finds the rule that would win, in the sync order', () => {
    const rules = [
      { id: 'a', pattern: 'SUNSET', match_type: 'contains', category_id: 'dining', priority: 100, auto_created: 0 },
      { id: 'b', pattern: 'SQ *SUNSET CAFE 0042', match_type: 'exact', category_id: 'coffee', priority: 50, auto_created: 1 },
    ];
    expect(reviewRuleFor(rules, 'SQ *SUNSET CAFE 0042').id).toBe('a');
    expect(reviewRuleFor(rules.slice(1), 'sq *sunset cafe 0042').id).toBe('b');
    expect(reviewRuleFor(rules, 'Blue Bottle')).toBeNull();
  });
});
