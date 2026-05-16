import { describe, it, expect } from 'vitest';
import { extractDistinctiveTerms } from '../../src/services/distinctiveTermExtractor.js';

describe('extractDistinctiveTerms', () => {
  it('returns empty for empty or non-string input', () => {
    expect(extractDistinctiveTerms('')).toEqual([]);
    expect(extractDistinctiveTerms(undefined as any)).toEqual([]);
    expect(extractDistinctiveTerms(null as any)).toEqual([]);
  });

  it('extracts multi-word capitalised phrases', () => {
    const terms = extractDistinctiveTerms('We discuss Bayesian Inference and Markov Chains in detail.');
    expect(terms).toContain('Bayesian Inference');
    expect(terms).toContain('Markov Chains');
  });

  it('extracts hyphenated multi-word capitalised phrases', () => {
    const terms = extractDistinctiveTerms('The Black-Scholes Model assumes log-normal distributions.');
    expect(terms).toContain('Black-Scholes Model');
  });

  it('extracts all-caps acronyms 2-7 chars', () => {
    const terms = extractDistinctiveTerms('CAPM and VAR are common in finance; ETL pipelines move data.');
    expect(terms).toContain('CAPM');
    expect(terms).toContain('VAR');
    expect(terms).toContain('ETL');
  });

  it('does not extract single capitalised words', () => {
    const terms = extractDistinctiveTerms('Today we will talk. Tomorrow we sleep.');
    expect(terms).not.toContain('Today');
    expect(terms).not.toContain('Tomorrow');
  });

  it('does not extract acronyms longer than 7 chars', () => {
    const terms = extractDistinctiveTerms('LONGACRONYM is too long.');
    expect(terms).not.toContain('LONGACRONYM');
  });

  it('ranks terms by frequency descending', () => {
    const text = 'Bayesian Inference. Bayesian Inference is great. Markov Chain.';
    const terms = extractDistinctiveTerms(text);
    expect(terms[0]).toBe('Bayesian Inference');
    expect(terms.indexOf('Bayesian Inference')).toBeLessThan(terms.indexOf('Markov Chain'));
  });

  it('caps at 100 distinct terms per source', () => {
    // Generate 150 unique two-word capitalised phrases
    const phrases: string[] = [];
    for (let i = 0; i < 150; i++) phrases.push(`Term${String.fromCharCode(65 + (i % 26))} Concept${i}`);
    const text = phrases.join('. ') + '.';
    const terms = extractDistinctiveTerms(text);
    expect(terms.length).toBeLessThanOrEqual(100);
  });

  it('preserves case so two documents hit the same term', () => {
    const a = extractDistinctiveTerms('We covered Bayesian Inference.');
    const b = extractDistinctiveTerms('More on Bayesian Inference here.');
    const overlap = a.filter((t) => b.includes(t));
    expect(overlap).toContain('Bayesian Inference');
  });
});
