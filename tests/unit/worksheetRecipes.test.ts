// worksheetRecipes.test.ts — the recipe a problem's solution names, read
// from its sheet, and the Problem Bank's recipe filter.

import { describe, it, expect } from 'vitest';
import { cleanRecipeText, parseRecipe, readRecipeCell, recipeOfSheet, recipeGroups, recipeKey } from '../../src/built-in/worksheet/recipes';
import { bankMatches, type BankFilterItem } from '../../src/built-in/worksheet/bankFilters';

function sheet(cells: Record<number, Record<number, unknown>>): string {
  const cellData: Record<string, Record<string, unknown>> = {};
  for (const [r, cols] of Object.entries(cells)) {
    cellData[r] = {};
    for (const [c, v] of Object.entries(cols)) cellData[r][c] = typeof v === 'string' ? { v } : v;
  }
  return JSON.stringify({ sheetOrder: ['s1'], sheets: { s1: { cellData } } });
}

describe('reading the recipe a solution names', () => {
  it('finds the name under the Recipe label, a row or two down, plain or rich text', () => {
    expect(readRecipeCell(JSON.parse(sheet({ 35: { 11: 'Recipe' }, 36: { 11: 'Siewert - Aggregate Excess of Loss Ultimate' } })))).toBe('Siewert - Aggregate Excess of Loss Ultimate');
    expect(readRecipeCell(JSON.parse(sheet({ 42: { 11: 'Recipe' }, 44: { 11: 'Brosius - Least Squares Method' } })))).toBe('Brosius - Least Squares Method');
    expect(readRecipeCell(JSON.parse(sheet({ 3: { 2: 'Recipe' }, 4: { 2: { p: { body: { dataStream: 'Clark - Normalized Residuals\r\n' } } } } })))).toBe('Clark - Normalized Residuals');
    expect(readRecipeCell(JSON.parse(sheet({ 3: { 2: 'Discussion' }, 4: { 2: 'Clark - Normalized Residuals' } })))).toBe('');
  });

  it('cleans dashes, accents and line breaks', () => {
    expect(cleanRecipeText('Meyers � Kolmogorov – Smirnov (K-S) Test')).toBe('Meyers - Kolmogorov - Smirnov (K-S) Test');
    expect(cleanRecipeText('Taylor - Re-Normalizing ODP Cross-Classified\nParameters')).toBe('Taylor - Re-Normalizing ODP Cross-Classified Parameters');
    expect(cleanRecipeText('Hürlimann - Credible Loss Ratio Claims Reserve')).toBe('Hürlimann - Credible Loss Ratio Claims Reserve');
  });

  it('splits the paper from the name, the paper as the bank keys it', () => {
    expect(parseRecipe('Siewert - Direct Development Method')).toEqual({ paper: 'siewert', name: 'Direct Development Method' });
    expect(parseRecipe('Mack - Chain Ladder - MSE Calculation')).toEqual({ paper: 'mack1994', name: 'MSE Calculation' });
    expect(parseRecipe('Mack (94) - Calendar Year Test')).toEqual({ paper: 'mack1994', name: 'Calendar Year Test' });
    expect(parseRecipe('Mack Benktander - Benktander Method')).toEqual({ paper: 'mack2000', name: 'Benktander Method' });
    expect(parseRecipe('Venter Factors - Parameterized BF: f(d)h(w) - Constant Variance')).toEqual({ paper: 'venter', name: 'Parameterized BF: f(d)h(w) - Constant Variance' });
    expect(parseRecipe('Teng and Perkins - Premium Asset')).toEqual({ paper: 'teng', name: 'Premium Asset' });
    expect(parseRecipe('Venter Factors - Testable Implications of Mack Assumptions')!.paper).toBe('venter');
    // A lone word is no recipe.
    expect(parseRecipe('Source')).toBeNull();
    expect(parseRecipe('')).toBeNull();
  });

  it('reads a whole stored sheet, and nothing from a sheet without the label', () => {
    expect(recipeOfSheet(sheet({ 10: { 11: 'Recipe' }, 11: { 11: 'Verrall - Fully Stochastic BF Model' } }), 'verrall')).toEqual({ paper: 'verrall', name: 'Fully Stochastic BF Model' });
    expect(recipeOfSheet(sheet({ 10: { 1: 'SHOW ALL WORK.' } }))).toBeNull();
    expect(recipeOfSheet('not json')).toBeNull();
  });
});

describe('the recipe filter', () => {
  const base: BankFilterItem = {
    title: 'Siewert RF 3', sheetName: 'Siewert.RF_03', questionMd: 'q', paper: 'siewert', note: '', tags: '',
    source: 'rf', kind: 'quant', starred: false, attemptCount: 0, attemptState: '',
  };
  const a = { ...base, recipe: 'Direct Development Method', recipePaper: 'siewert' };
  const b = { ...base, title: 'Clark RF 1', paper: 'clark', recipe: 'Normalized Residuals', recipePaper: 'clark' };
  const none = { ...base, title: 'MAC-01' };

  it('groups the recipes in use by paper, with counts', () => {
    const g = recipeGroups([a, a, b, none]);
    expect([...g.keys()]).toEqual(['siewert', 'clark']);
    expect(g.get('siewert')!.get('Direct Development Method')).toBe(2);
  });

  it('keeps only problems with a chosen recipe, combined with the other filters and search', () => {
    const pick = new Set([recipeKey('siewert', 'Direct Development Method')]);
    expect(bankMatches(a, new Set(), '', pick)).toBe(true);
    expect(bankMatches(b, new Set(), '', pick)).toBe(false);
    expect(bankMatches(none, new Set(), '', pick)).toBe(false);
    expect(bankMatches(none, new Set(), '', new Set())).toBe(true);
    expect(bankMatches(a, new Set(['qual']), '', pick)).toBe(false);
    expect(bankMatches(b, new Set(), 'normalized residuals')).toBe(true);
  });
});
