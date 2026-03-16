import { describe, expect, it } from 'vitest';

import {
  extractExplicitSourceAnchors,
  scoreExplicitSourceCandidate,
} from '../../src/built-in/chat/data/chatDataService';

describe('extractExplicitSourceAnchors', () => {
  it('extracts container document anchors from ordering queries', () => {
    const anchors = extractExplicitSourceAnchors(
      'In the Exam 7 Study Guide table of contents, which paper comes immediately after Clark?',
    );

    expect(anchors).toContain('exam 7 study guide');
  });

  it('extracts reading-list style anchors generically', () => {
    const anchors = extractExplicitSourceAnchors(
      'According to the CAS reading list, which paper has the most pages?',
    );

    expect(anchors).toContain('cas reading list');
  });
});

describe('scoreExplicitSourceCandidate', () => {
  it('ranks container documents above incidental item files for structure queries', () => {
    const query = 'In the Exam 7 Study Guide table of contents, which paper comes immediately after Clark?';

    const studyGuide = scoreExplicitSourceCandidate(query, 'Study Guide - CAS Exam 7 RF.pdf');
    const clark = scoreExplicitSourceCandidate(query, 'RF Guides/Clark.pdf');

    expect(studyGuide.score).toBeGreaterThan(clark.score);
    expect(studyGuide.anchorMatches).toContain('exam 7 study guide');
    expect(clark.anchorMatches).toHaveLength(0);
  });

  it('still ranks the directly named file highest when the query targets that file', () => {
    const query = 'According to Clark.pdf, what does Clark say about the Cape Cod method?';

    const studyGuide = scoreExplicitSourceCandidate(query, 'Study Guide - CAS Exam 7 RF.pdf');
    const clark = scoreExplicitSourceCandidate(query, 'RF Guides/Clark.pdf');

    expect(clark.score).toBeGreaterThan(studyGuide.score);
  });

  it('prefers structured reference documents for reading-list style queries', () => {
    const query = 'According to the Exam 7 Reading List, which paper has 82 pages?';

    const readingList = scoreExplicitSourceCandidate(query, 'Exam 7 Reading List.pdf');
    const mackPaper = scoreExplicitSourceCandidate(query, 'Source Material/Mack_Chain Ladder.pdf');

    expect(readingList.score).toBeGreaterThan(mackPaper.score);
  });
});