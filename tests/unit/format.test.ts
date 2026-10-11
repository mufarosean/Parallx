// format.test.ts — the shared text formatters (ui/format.ts).

import { describe, it, expect } from 'vitest';
import { escapeHtml, formatBytes, titleCase } from '../../src/ui/format';

describe('escapeHtml', () => {
  it('escapes the five characters HTML cares about', () => {
    expect(escapeHtml(`<a href="x" title='y'>Tom & Jerry</a>`)).toBe('&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;Tom &amp; Jerry&lt;/a&gt;');
  });
  it('leaves everything else alone', () => {
    expect(escapeHtml('plain text, with: punctuation; and ümlauts')).toBe('plain text, with: punctuation; and ümlauts');
  });
  it('renders a missing value as nothing', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(0)).toBe('0');
  });
});

describe('formatBytes', () => {
  it('picks the unit by size', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(12.3 * 1024 * 1024)).toBe('12.3 MB');
    expect(formatBytes(1.25 * 1024 * 1024 * 1024)).toBe('1.25 GB');
  });
  it('says 0 B for nothing or nonsense', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(-5)).toBe('0 B');
    expect(formatBytes(Number.NaN)).toBe('0 B');
  });
});

describe('titleCase', () => {
  it('capitalizes each word and keeps the rest', () => {
    expect(titleCase("don't panic")).toBe("Don't Panic");
    expect(titleCase('food and dining')).toBe('Food And Dining');
    expect(titleCase('NASA launches')).toBe('NASA Launches');
    expect(titleCase('')).toBe('');
  });
});
