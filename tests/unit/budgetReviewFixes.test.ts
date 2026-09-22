// Budget: the 2026-09-21 review fixes. A transfer's payee must look like one
// of the user's own accounts; a subject line that says "payment to" a payee
// or a Zelle send is a purchase; the model's JSON is read through prose.
import { describe, it, expect } from 'vitest';
// @ts-expect-error — JS module with no types
import { __testables } from '../../ext/budget/main.js';

const { looksLikeAccountName, classifySubjectTxType, tryParseModelJson, normalizeMerchant, ruleMatchesMerchant } = __testables;

describe('normalizeMerchant', () => {
  it('strips processor prefixes, store numbers and a trailing state', () => {
    expect(normalizeMerchant('SQ *COFFEE SHOP 0042 DENVER CO')).toBe('coffee shop denver');
    expect(normalizeMerchant('TST* THE DINER #12')).toBe('the diner');
    expect(normalizeMerchant('AMAZON.COM*AB12CD3EF')).toBe('ab12cd3ef');
  });
  it('leaves a plain name alone', () => {
    expect(normalizeMerchant('Xcel Energy')).toBe('xcel energy');
    expect(normalizeMerchant('')).toBe('');
  });
  it('lets one rule cover a chain through the normalised form', () => {
    const rule = { pattern: 'coffee shop', match_type: 'contains' };
    expect(ruleMatchesMerchant(rule, 'SQ *COFFEE SHOP 0042 DENVER CO')).toBe(true);
    // Exact stays exact on the raw text: a store number makes it a different string.
    expect(ruleMatchesMerchant({ pattern: 'the diner', match_type: 'exact' }, 'TST* THE DINER #12')).toBe(false);
    expect(ruleMatchesMerchant({ pattern: 'the diner', match_type: 'contains' }, 'TST* THE DINER #12')).toBe(true);
    expect(ruleMatchesMerchant(rule, 'Xcel Energy')).toBe(false);
  });
});

describe('looksLikeAccountName', () => {
  it('accepts the user\'s own accounts and cards', () => {
    for (const m of ['Checking', 'Total Checking', 'Savings', 'Visa', 'Chase Freedom', 'Credit card ending in 4321', 'Account ...1234', 'Card x9876']) {
      expect(looksLikeAccountName(m)).toBe(true);
    }
  });
  it('rejects a person or a business', () => {
    for (const m of ['John Doe', 'Xcel Energy', 'State Farm', 'Zelle to Maria', 'AT&T']) {
      expect(looksLikeAccountName(m)).toBe(false);
    }
  });
  it('treats no merchant as fine (the other cross-check catches it)', () => {
    expect(looksLikeAccountName('')).toBe(true);
    expect(looksLikeAccountName(null)).toBe(true);
  });
});

describe('classifySubjectTxType', () => {
  it('reads a card payment as a transfer', () => {
    expect(classifySubjectTxType('Your automatic payment is scheduled')).toBe('transfer');
    expect(classifySubjectTxType("We've received your payment")).toBe('transfer');
  });
  it('reads a Zelle send and a bill payment to a payee as purchases, before the transfer patterns', () => {
    expect(classifySubjectTxType('You sent $50.00 to John Doe')).toBe('purchase');
    expect(classifySubjectTxType('You sent money with Zelle')).toBe('purchase');
    expect(classifySubjectTxType('Your payment to Xcel Energy is scheduled')).toBe('purchase');
  });
  it('keeps a payment to the user\'s own account a transfer', () => {
    expect(classifySubjectTxType('A payment to your credit card account was scheduled')).toBe('transfer');
  });
  it('reads deposits and fees, and says nothing for the rest', () => {
    expect(classifySubjectTxType('Direct deposit posted')).toBe('deposit');
    expect(classifySubjectTxType('You received money with Zelle')).toBe('deposit');
    expect(classifySubjectTxType('Overdraft fee charged')).toBe('fee');
    expect(classifySubjectTxType('Your statement is ready')).toBe(null);
  });
});

describe('tryParseModelJson', () => {
  it('reads clean JSON, JSON inside prose, and gives up on none', () => {
    expect(tryParseModelJson('{"a":1}')).toEqual({ a: 1 });
    expect(tryParseModelJson('Sure! {"event_type":"purchase"} hope that helps')).toEqual({ event_type: 'purchase' });
    expect(tryParseModelJson('no json here')).toBeUndefined();
    expect(tryParseModelJson('')).toBeUndefined();
  });
});
