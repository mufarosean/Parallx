// M99 — Worksheets: pure-logic tests for the chat-tool report builders
// (what the AI actually reads when it looks at the bank and the user's work).

import { describe, it, expect } from 'vitest';
import { buildProgressReport, buildUserWorkReport } from '../../src/built-in/worksheet/worksheetChat.js';
import type { WorksheetItem, WorksheetItemSummary, WorksheetAttempt } from '../../src/built-in/worksheet/worksheetData.js';

function summary(over: Partial<WorksheetItemSummary>): WorksheetItemSummary {
  return {
    id: 1, title: 'Item', questionMd: '', solutionNotesMd: '',
    sourceUri: '', sourceLabel: '', sourcePage: 0, tags: '',
    createdAt: 1_700_000_000_000, attemptState: '', attemptCount: 0,
    ...over,
  };
}

function item(over: Partial<WorksheetItem>): WorksheetItem {
  return {
    id: 1, title: 'Item', questionMd: '', givensJson: '', solutionJson: '',
    solutionNotesMd: '', sourceUri: '', sourceLabel: '', sourcePage: 0,
    tags: '', createdAt: 1_700_000_000_000,
    ...over,
  };
}

const CELLS = JSON.stringify({
  sheets: { sheet1: { cellData: { 0: { 0: { v: 'Premium' } }, 3: { 1: { v: 12, f: '=A1*2' } } } } },
});

describe('buildProgressReport', () => {
  it('says the bank is empty and how to fill it', () => {
    const out = buildProgressReport([]);
    expect(out).toContain('empty');
    expect(out).toContain('Generate Items');
  });

  it('rolls up per tag with attempted counts and latest grades', () => {
    const out = buildProgressReport([
      summary({ id: 1, title: 'Brosius A', tags: 'brosius,reserves', attemptState: 'nailed', attemptCount: 2 }),
      summary({ id: 2, title: 'Brosius B', tags: 'brosius', attemptState: 'missed', attemptCount: 1 }),
      summary({ id: 3, title: 'Untagged never tried' }),
      summary({ id: 4, title: 'Mid-attempt', tags: 'reserves', attemptState: 'open' }),
    ]);
    expect(out).toContain('Practice bank: 4 items, 3 attempted.');
    expect(out).toContain('- #brosius: 2 items, 2 attempted (1 nailed, 1 missed)');
    expect(out).toContain('- #reserves: 2 items, 2 attempted (1 nailed)');
    expect(out).toContain('- (untagged): 1 items, 0 attempted');
    expect(out).toContain('[id 2] "Brosius B"');
    expect(out).toContain('latest: missed');
    expect(out).toContain('IN PROGRESS');
    expect(out).toContain('never attempted');
  });
});

describe('buildUserWorkReport', () => {
  it('reports an untouched item without inventing work', () => {
    const out = buildUserWorkReport(item({ title: 'Fresh', questionMd: 'Do the thing.' }), null);
    expect(out).toContain('"Fresh"');
    expect(out).toContain('Do the thing.');
    expect(out).toContain("USER'S WORK: none yet");
  });

  it('serializes the user cells, solution, notes, and prior review', () => {
    const attempt: WorksheetAttempt = {
      id: 9, itemId: 4, startedAt: 1, updatedAt: 2,
      cellsJson: CELLS, selfGrade: 'partial', aiReviewMd: 'Watch the tail factor.', completed: true,
    };
    const out = buildUserWorkReport(item({
      id: 4, title: 'Loss Ratio', questionMd: 'Compute it.',
      solutionJson: CELLS, solutionNotesMd: 'Divide losses by premium.',
      sourceLabel: 'RF Cookbook', sourcePage: 12,
    }), attempt);
    expect(out).toContain('Item [id 4] "Loss Ratio" (source: RF Cookbook p.12)');
    expect(out).toContain('completed, self-graded "partial"');
    expect(out).toContain('A1: Premium');
    expect(out).toContain('B4: 12 (=A1*2)');
    expect(out).toContain('MODEL SOLUTION CELLS:');
    expect(out).toContain('Divide losses by premium.');
    expect(out).toContain('PRIOR AI REVIEW OF THIS ATTEMPT:');
    expect(out).toContain('Watch the tail factor.');
  });

  it('flags an in-progress attempt and an empty sheet honestly', () => {
    const attempt: WorksheetAttempt = {
      id: 9, itemId: 1, startedAt: 1, updatedAt: 2,
      cellsJson: '{"sheets":{}}', selfGrade: '', aiReviewMd: '', completed: false,
    };
    const out = buildUserWorkReport(item({}), attempt);
    expect(out).toContain('in progress');
    expect(out).toContain('(sheet is empty)');
  });
});
