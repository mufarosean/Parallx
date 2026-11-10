// @vitest-environment jsdom
// findTargets.test.ts — what Find (Ctrl+F) searches inside one editor.

import { describe, it, expect } from 'vitest';
import { buildFindRegex, domFindTarget, textareaFindTarget } from '../../src/ui/findTargets.js';

const plain = { caseSensitive: false, wholeWord: false, useRegex: false };

describe('buildFindRegex', () => {
  it('reads a plain query literally and ignores case unless asked', () => {
    expect('a.b A.B axb'.match(buildFindRegex('a.b', plain)!)).toEqual(['a.b', 'A.B']);
    expect('a.b A.B'.match(buildFindRegex('a.b', { ...plain, caseSensitive: true })!)).toEqual(['a.b']);
  });
  it('matches whole words, and regular expressions when asked', () => {
    expect('chain chains'.match(buildFindRegex('chain', { ...plain, wholeWord: true })!)).toEqual(['chain']);
    expect('a1 b22'.match(buildFindRegex('\\d+', { ...plain, useRegex: true })!)).toEqual(['1', '22']);
  });
  it('gives nothing for an empty query or a broken expression', () => {
    expect(buildFindRegex('', plain)).toBeNull();
    expect(buildFindRegex('(', { ...plain, useRegex: true })).toBeNull();
  });
});

describe('textareaFindTarget', () => {
  it('counts the matches, selects the current one and wraps round', () => {
    const ta = document.createElement('textarea');
    ta.value = 'chain ladder\nthe chain\nChain again';
    document.body.appendChild(ta);
    const target = textareaFindTarget(ta);
    expect(target.find('chain', plain)).toEqual({ current: 1, total: 3 });
    expect(ta.value.slice(ta.selectionStart, ta.selectionEnd)).toBe('chain');
    expect(target.step(1)).toEqual({ current: 2, total: 3 });
    expect(ta.selectionStart).toBe(17);
    expect(target.step(1)).toEqual({ current: 3, total: 3 });
    expect(target.step(1)).toEqual({ current: 1, total: 3 });
    expect(target.step(-1)).toEqual({ current: 3, total: 3 });
    expect(target.find('nothing here', plain)).toEqual({ current: 0, total: 0 });
    ta.remove();
  });
});

describe('domFindTarget', () => {
  it('finds text across inline formatting, never across blocks, and skips fields and hidden parts', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p>The <b>chain</b> ladder</p><p>ladder</p><p hidden>chain ladder</p><textarea>chain ladder</textarea><p>end chain</p><p>ladder start</p>';
    document.body.appendChild(root);
    const target = domFindTarget(root);
    // 'chain ladder' in the first paragraph only: the last two paragraphs are separate blocks.
    expect(target.find('chain ladder', plain)?.total).toBe(1);
    expect(target.find('ladder', plain)?.total).toBe(3);
    expect(target.step(1)).toEqual({ current: 2, total: 3 });
    target.clear();
    expect(target.step(1)).toEqual({ current: 0, total: 0 });
    root.remove();
  });
});
