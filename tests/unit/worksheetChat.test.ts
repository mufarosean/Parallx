// M99 — Worksheets: pure-logic tests for the chat-tool report builders
// (what the AI actually reads when it looks at the bank and the user's work).

import { describe, it, expect } from 'vitest';
import { buildProgressReport, buildUserWorkReport, buildNotesDigest } from '../../src/built-in/worksheet/worksheetChat.js';
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
    expect(out).toContain('- #brosius: 2 items, 2 attempted (1 easy, 1 hard)');
    expect(out).toContain('- #reserves: 2 items, 2 attempted (1 easy)');
    expect(out).toContain('- (untagged): 1 items, 0 attempted');
    expect(out).toContain('[id 2] "Brosius B"');
    expect(out).toContain('latest: hard');
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
    expect(out).toContain('completed, self-graded "medium"');
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

describe('buildNotesDigest', () => {
  it('says there are none, and where one is written', () => {
    expect(buildNotesDigest([summary({ id: 1 })])).toMatch(/No notes yet/);
  });
  it('lists noted problems newest first with paper, rating, star and the note, and counts them', () => {
    const out = buildNotesDigest([
      summary({ id: 1, title: 'Old', paper: 'sp26', attemptState: 'hard', note: 'Review the tail factor', noteAt: 1_000 }),
      summary({ id: 2, title: 'Plain' }),
      summary({ id: 3, title: 'New', tags: 'brosius', attemptState: 'easy', starred: true, note: 'Line one\nline two', noteAt: 2_000 }),
    ]);
    expect(out).toContain('2 of 3 problems carry a note');
    expect(out.indexOf('"New"')).toBeLessThan(out.indexOf('"Old"'));
    expect(out).toContain('[id 3] "New" (#brosius · rated easy · starred)');
    expect(out).toContain('Line one / line two');
    expect(out).toContain('[id 1] "Old" (sp26 · rated hard)');
    expect(out).not.toContain('"Plain"');
  });
});

describe('notes in the other reports', () => {
  it('the progress report carries each note', () => {
    expect(buildProgressReport([summary({ id: 1, title: 'A', note: 'check the formula' })])).toContain('my note: "check the formula"');
  });
  it('the user-work report carries the note only when given one', () => {
    const out = buildUserWorkReport(item({ id: 1 }), null, 'redo this');
    expect(out).toContain("THE USER'S OWN NOTE ON THIS PROBLEM:");
    expect(out).toContain('redo this');
    expect(buildUserWorkReport(item({ id: 1 }), null)).not.toContain('OWN NOTE');
  });
});
