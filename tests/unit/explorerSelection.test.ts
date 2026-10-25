// The file tree's selection: click, Ctrl+click, Shift+click and Ctrl+A, as
// in every file manager.
import { describe, it, expect } from 'vitest';
import { ExplorerSelection } from '../../src/built-in/explorer/explorerSelection';

const rows = ['a', 'b', 'c', 'd', 'e'];

describe('ExplorerSelection', () => {
  it('a click selects one row', () => {
    const s = new ExplorerSelection<string>();
    s.single('b');
    s.single('d');
    expect(s.items(rows)).toEqual(['d']);
  });

  it('Ctrl adds and takes away one row, but never empties the selection', () => {
    const s = new ExplorerSelection<string>();
    s.single('a');
    s.toggle('c');
    s.toggle('e');
    expect(s.items(rows)).toEqual(['a', 'c', 'e']);
    s.toggle('c');
    expect(s.items(rows)).toEqual(['a', 'e']);
    s.toggle('a');
    s.toggle('e');
    expect(s.items(rows)).toEqual(['e']);
  });

  it('Shift selects the run from the anchor, either way', () => {
    const s = new ExplorerSelection<string>();
    s.single('b');
    s.range('d', rows);
    expect(s.items(rows)).toEqual(['b', 'c', 'd']);
    s.range('a', rows);
    expect(s.items(rows)).toEqual(['a', 'b']);
  });

  it('Shift after Ctrl ranges from the row Ctrl last chose', () => {
    const s = new ExplorerSelection<string>();
    s.single('a');
    s.toggle('d');
    s.range('e', rows);
    expect(s.items(rows)).toEqual(['d', 'e']);
  });

  it('Ctrl+A selects every visible row; rows that scroll out of the tree drop', () => {
    const s = new ExplorerSelection<string>();
    s.all(rows);
    expect(s.size).toBe(5);
    expect(s.items(['a', 'c'])).toEqual(['a', 'c']);
    expect(s.size).toBe(2);
  });
});
