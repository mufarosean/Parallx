// Budget chat tools read the argument names their schemas declare.
//
// Found 2026-09-28 while auditing every tool for silently dropped arguments:
// budget.queryTransactions declared from/to/merchant/category and read
// startDate/endDate/merchantContains/categoryId, so every filter the model
// set was ignored; renameCategory, deleteCategory and createCategorizationRule
// required names their schemas never offered, so they could not succeed.

import { describe, it, expect, beforeEach } from 'vitest';
// @ts-expect-error — JS module with no types
import { __testables } from '../../ext/budget/main.js';

const {
  __setDbBridge,
  budgetToolQueryTransactions,
  budgetToolRenameCategory,
  budgetToolDeleteCategory,
  budgetToolCreateCategorizationRule,
} = __testables as {
  __setDbBridge(bridge: unknown): void;
  budgetToolQueryTransactions(args: Record<string, unknown>): Promise<IToolOut>;
  budgetToolRenameCategory(args: Record<string, unknown>): Promise<IToolOut>;
  budgetToolDeleteCategory(args: Record<string, unknown>): Promise<IToolOut>;
  budgetToolCreateCategorizationRule(args: Record<string, unknown>): Promise<IToolOut>;
};

interface IToolOut { content: unknown; isError?: boolean }
interface ICall { sql: string; params: unknown[] }

const CATEGORIES = [{ id: 'cat-groceries', name: 'Groceries' }, { id: 'cat-dining', name: 'Dining' }];

function makeBridge() {
  const calls: ICall[] = [];
  const flat = (sql: string) => sql.replace(/\s+/g, ' ').trim();
  return {
    calls,
    async run(sql: string, params: unknown[] = []) { calls.push({ sql: flat(sql), params }); return {}; },
    async get(sql: string, params: unknown[] = []) {
      calls.push({ sql: flat(sql), params });
      if (/FROM categories WHERE LOWER\(name\)/.test(flat(sql))) {
        const wanted = String(params[0]).toLowerCase();
        return { row: CATEGORIES.find((c) => c.name.toLowerCase() === wanted) };
      }
      return { row: undefined };
    },
    async all(sql: string, params: unknown[] = []) { calls.push({ sql: flat(sql), params }); return { rows: [] }; },
  };
}

const text = (out: IToolOut): string => typeof out.content === 'string' ? out.content : JSON.stringify(out.content);

describe('budget tools read the arguments their schemas declare', () => {
  let bridge: ReturnType<typeof makeBridge>;
  beforeEach(() => {
    bridge = makeBridge();
    __setDbBridge(bridge);
  });

  it('queryTransactions filters by merchant, dates and category name', async () => {
    const out = await budgetToolQueryTransactions({ merchant: 'kroger', from: '2026-09-01', to: '2026-09-30', category: 'groceries', limit: 10 });
    expect(out.isError).toBeFalsy();
    const query = bridge.calls.find((c) => c.sql.includes('FROM transactions'))!;
    expect(query.sql).toContain('LOWER(merchant) LIKE LOWER(?)');
    expect(query.sql).toContain('transaction_date >= ?');
    expect(query.sql).toContain('transaction_date <= ?');
    expect(query.sql).toContain('category_id = ?');
    expect(query.params).toEqual(['%kroger%', '2026-09-01', '2026-09-30', 'cat-groceries', 10]);
  });

  it('queryTransactions treats status "all" as no status filter', async () => {
    await budgetToolQueryTransactions({ status: 'all' });
    const query = bridge.calls.find((c) => c.sql.includes('FROM transactions'))!;
    expect(query.sql).not.toContain('status = ?');
    await budgetToolQueryTransactions({ status: 'review' });
    const second = bridge.calls.filter((c) => c.sql.includes('FROM transactions'))[1];
    expect(second.sql).toContain('status = ?');
    expect(second.params[0]).toBe('review');
  });

  it('queryTransactions refuses an unknown category, never widening to every transaction', async () => {
    const out = await budgetToolQueryTransactions({ category: 'Yachts' });
    expect(out.isError).toBe(true);
    expect(text(out)).toContain('Unknown category');
    expect(bridge.calls.some((c) => c.sql.includes('FROM transactions'))).toBe(false);
  });

  it('queryTransactions still accepts the older names', async () => {
    await budgetToolQueryTransactions({ merchantContains: 'shell', startDate: '2026-01-01', endDate: '2026-01-31', categoryId: 'cat-dining' });
    const query = bridge.calls.find((c) => c.sql.includes('FROM transactions'))!;
    expect(query.params.slice(0, 4)).toEqual(['%shell%', '2026-01-01', '2026-01-31', 'cat-dining']);
  });

  it('renameCategory takes the current and the new name', async () => {
    const out = await budgetToolRenameCategory({ from: 'Dining', to: ' Restaurants ' });
    expect(out.isError).toBeFalsy();
    const update = bridge.calls.find((c) => c.sql.startsWith('UPDATE categories SET name'))!;
    expect(update.params).toEqual(['Restaurants', 'cat-dining']);
  });

  it('renameCategory says which category it could not find', async () => {
    const out = await budgetToolRenameCategory({ from: 'Yachts', to: 'Boats' });
    expect(out.isError).toBe(true);
    expect(text(out)).toContain('Unknown category: "Yachts"');
    expect(bridge.calls.some((c) => c.sql.startsWith('UPDATE'))).toBe(false);
  });

  it('deleteCategory takes the category name', async () => {
    const out = await budgetToolDeleteCategory({ name: 'Groceries' });
    expect(out.isError).toBeFalsy();
    const update = bridge.calls.find((c) => c.sql.startsWith('UPDATE categories SET archived'))!;
    expect(update.params).toEqual(['cat-groceries']);
  });

  it('createCategorizationRule takes the merchant text and the category name', async () => {
    const out = await budgetToolCreateCategorizationRule({ merchant: 'KROGER', category: 'Groceries', matchType: 'contains' });
    expect(out.isError).toBeFalsy();
    const insert = bridge.calls.find((c) => c.sql.startsWith('INSERT INTO categorization_rules'))!;
    expect(insert.params[1]).toBe('KROGER');
    expect(insert.params[2]).toBe('contains');
    expect(insert.params[3]).toBe('cat-groceries');
  });

  it('createCategorizationRule names the missing argument by its declared name', async () => {
    const out = await budgetToolCreateCategorizationRule({ category: 'Groceries' });
    expect(out.isError).toBe(true);
    expect(text(out)).toContain('merchant is required');
  });
});
