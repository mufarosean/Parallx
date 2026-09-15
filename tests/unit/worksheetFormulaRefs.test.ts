// Worksheets: dollar signs survive a reference drag. Sequence nodes are what
// the engine's lexer returns: plain strings for operators and function
// names, nodes for references (nodeType 4 in the engine's enum).
import { describe, it, expect } from 'vitest';
import { applyMarkers, restoreAbsoluteMarkers } from '../../src/built-in/worksheet/formulaRefs.js';

const REFERENCE = 4;
const ref = (token: string) => ({ nodeType: REFERENCE, token });
const num = (token: string) => ({ nodeType: 1, token });

describe('applyMarkers', () => {
  it('puts the old markers on the new cells', () => {
    expect(applyMarkers('$A$1', 'A1')).toBe('$A$1');
    expect(applyMarkers('$A$1', 'B2')).toBe('$B$2');
    expect(applyMarkers('A$1', 'C3')).toBe('C$3');
    expect(applyMarkers('$A1', 'C3')).toBe('$C3');
    expect(applyMarkers('$A$1:$B$2', 'C3:D4')).toBe('$C$3:$D$4');
    expect(applyMarkers('$A$1:B2', 'C3:D4')).toBe('$C$3:D4');
    expect(applyMarkers('$A$1', 'B1:B2')).toBe('$B$1:$B$2');
    expect(applyMarkers("'Sheet 2'!$A$1", "'Sheet 2'!B2")).toBe("'Sheet 2'!$B$2");
    expect(applyMarkers('$A$1', 'named_range')).toBe('named_range');
  });
});

describe('restoreAbsoluteMarkers', () => {
  it('restores the untouched reference after a drag moved another (the reproduced bug)', () => {
    const before = ['=', ref('$A$1'), '+', ref('B1')];
    const after = ['=', ref('A1'), '+', ref('B2')];
    expect(restoreAbsoluteMarkers(before, after, REFERENCE)).toBe('=$A$1+B2');
  });
  it('restores after a resize, and carries the markers onto a moved absolute reference', () => {
    expect(restoreAbsoluteMarkers(['=', ref('$A$1'), '+', ref('B1')], ['=', ref('A1'), '+', ref('B1:B2')], REFERENCE)).toBe('=$A$1+B1:B2');
    expect(restoreAbsoluteMarkers(['=', ref('$A$1'), '*', ref('B1')], ['=', ref('C3'), '*', ref('B1')], REFERENCE)).toBe('=$C$3*B1');
  });
  it('restores a drag that dropped the reference back on its own cell', () => {
    expect(restoreAbsoluteMarkers(['=', ref('$A$1'), '+', ref('B1')], ['=', ref('A1'), '+', ref('B1')], REFERENCE, true)).toBe('=$A$1+B1');
  });
  it('leaves F4 toggles and typing alone', () => {
    // One reference lost its markers and nothing moved, no pointer drag: F4 cycling, or a deleted $.
    expect(restoreAbsoluteMarkers(['=', ref('$A$1'), '+', ref('B1')], ['=', ref('A1'), '+', ref('B1')], REFERENCE)).toBeNull();
    // Nothing lost.
    expect(restoreAbsoluteMarkers(['=', ref('$A$1'), '+', ref('B1')], ['=', ref('$A$1'), '+', ref('B2')], REFERENCE)).toBeNull();
    // A different edit: reference count changed.
    expect(restoreAbsoluteMarkers(['=', ref('$A$1'), '+', ref('B1')], ['=', ref('A1')], REFERENCE)).toBeNull();
    // No references at all.
    expect(restoreAbsoluteMarkers(['=', num('1'), '+', num('2')], ['=', num('1'), '+', num('3')], REFERENCE)).toBeNull();
  });
  it('restores when every reference lost its markers with none moved, which only a rewrite does', () => {
    const before = ['=SUM(', ref('$A$1'), ',', ref('$B$1'), ')'];
    const after = ['=SUM(', ref('A1'), ',', ref('B1'), ')'];
    expect(restoreAbsoluteMarkers(before, after, REFERENCE)).toBe('=SUM($A$1,$B$1)');
  });
});
