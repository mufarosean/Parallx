// Budget's Transactions page: deep links land on the right quick filter,
// amounts read by kind, the sync's note tags survive an edit, and a row's
// origin is never guessed as "by hand" when the AI imported it.
import { describe, it, expect } from 'vitest';
// @ts-expect-error — JS module with no types
import { __testables } from '../../ext/budget/main.js';

const { txViewFor, txAmountView, splitTxNotes, txOrigin } = __testables;

describe('budget transactions', () => {
  it('maps every deep link the app sends onto a quick filter', () => {
    expect(txViewFor(null)).toBe('all');
    expect(txViewFor({ type: 'spend', categoryId: 'x' })).toBe('spend');
    expect(txViewFor({ type: 'fee' })).toBe('spend');
    expect(txViewFor({ type: 'deposit' })).toBe('income');
    expect(txViewFor({ type: 'transfer' })).toBe('transfer');
    expect(txViewFor({ type: 'all', status: 'review' })).toBe('review');
    expect(txViewFor({ type: 'all', accountId: 'a' })).toBe('all');
  });

  it('marks money in, mutes transfers, leaves spending plain', () => {
    expect(txAmountView({ tx_type: 'purchase', amount_cents: 675 })).toEqual({ text: '$6.75', tone: 'out' });
    expect(txAmountView({ tx_type: 'deposit', amount_cents: -412500 })).toEqual({ text: '+$4,125.00', tone: 'in' });
    expect(txAmountView({ tx_type: 'purchase', amount_cents: -1200 })).toEqual({ text: '+$12.00', tone: 'in' });
    expect(txAmountView({ tx_type: 'transfer', amount_cents: 50000 })).toEqual({ text: '$500.00', tone: 'move' });
  });

  it('keeps the sync tags out of the editable note, and back on save', () => {
    const notes = 'split with Sam [cross-check: tx_type=transfer, merchant=X, amount=1.00, payee looks external] [hidden: ignored]';
    const { note, tags } = splitTxNotes(notes);
    expect(note).toBe('split with Sam');
    expect(tags).toEqual(['[cross-check: tx_type=transfer, merchant=X, amount=1.00, payee looks external]', '[hidden: ignored]']);
    expect(splitTxNotes(null)).toEqual({ note: '', tags: [] });
    expect(splitTxNotes('[possible duplicate of abc]').note).toBe('');
  });

  it('says where a row came from', () => {
    expect(txOrigin({ gmail_message_id: 'm1', source: 'gmail' })).toBe('email');
    expect(txOrigin({ source: 'csv' })).toBe('csv');
    expect(txOrigin({ source: 'manual', tx_type_source: 'manual' })).toBe('manual');
    expect(txOrigin({ source: 'gmail', gmail_message_id: null, tx_type_source: 'ai' })).toBe('email-gone');
    expect(txOrigin({ source: 'gmail', gmail_message_id: null, tx_type_source: 'manual' })).toBe('manual');
  });
});

describe('budget CSV import parsing', () => {
  const { splitCsvRecords, csvDate } = __testables;
  it('keeps a line break inside a quoted field in one record', () => {
    const recs = splitCsvRecords('date,merchant,amount,notes\r\n2026-10-01,Cafe,12.00,"Dinner\nwith Sam"\n2026-10-02,Shop,5.00,\n');
    expect(recs).toHaveLength(3);
    expect(recs[1]).toBe('2026-10-01,Cafe,12.00,"Dinner\nwith Sam"');
  });
  it('reads ISO and US dates and refuses the rest', () => {
    expect(csvDate('2026-10-01')).toBe('2026-10-01');
    expect(csvDate('9/14/2026')).toBe('2026-09-14');
    expect(csvDate('09/14/26')).toBe('2026-09-14');
    expect(csvDate('14/09/2026')).toBeNull();
    expect(csvDate('Sep 14')).toBeNull();
  });
});
