// openclawCitationCheck.test.ts — citations are checked before an answer is shown.
//
// The model cites with the labels reading tools hand out ([S3]). A label it
// never read, a page that does not hold the sentence's figure, a hand-made
// link and an answer that cites nothing it read all go back to the model;
// what still fails is shown as Unverified, never as a good link.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildCitationCorrection,
  checkCitations,
  renderCitedAnswer,
  type ICitationContext,
} from '../../src/openclaw/openclawCitationCheck';
import {
  _resetSourceHandlesForTest,
  citeSource,
  getSourceHandle,
  recordMintedLink,
  sessionSourceHandles,
  sourceHandleMark,
  sourceHandlesSince,
  wasLinkMinted,
} from '../../src/services/sourceHandles';

const SID = 'chat-1';

function page(n: number, text: string): string {
  const uri = `parallx://explorer/file?path=Clark.pdf&page=${n}`;
  return citeSource(SID, { key: uri, location: `Clark.pdf · page ${n} of 30`, title: `Clark.pdf, page ${n}`, uri, text, document: true });
}

function ctx(mark = 0): ICitationContext {
  return {
    lookup: (id) => getSourceHandle(SID, id),
    sessionHandles: sessionSourceHandles(SID),
    turnHandles: sourceHandlesSince(SID, mark),
    isLinkMinted: (uri) => wasLinkMinted(SID, uri),
  };
}

beforeEach(() => _resetSourceHandlesForTest());

describe('source labels', () => {
  it('count up, and the same spot read again keeps its label', () => {
    expect(page(12, 'one')).toBe('S1');
    expect(page(13, 'two')).toBe('S2');
    expect(page(12, 'one, read again')).toBe('S1');
    expect(getSourceHandle(SID, 's1')!.text).toBe('one, read again');
  });

  it('know which were read this turn', () => {
    page(1, 'before');
    const mark = sourceHandleMark(SID);
    page(2, 'during');
    expect(sourceHandlesSince(SID, mark).map((h) => h.id)).toEqual(['S2']);
  });
});

describe('checkCitations', () => {
  it('passes a figure cited to the page that holds it, and links it', () => {
    page(12, 'Development is slow.');
    page(13, 'The selected tail factor is 1.05, from the inverse power curve.');
    const md = 'Clark selects a tail factor of 1.05 [S2].';
    const report = checkCitations(md, ctx());
    expect(report.problems).toEqual([]);
    expect(renderCitedAnswer(md, report, ctx())).toBe(
      'Clark selects a tail factor of 1.05 ([Clark.pdf, page 13](parallx://explorer/file?path=Clark.pdf&page=13)).',
    );
  });

  it('catches a figure cited to the wrong page, and names the page that has it', () => {
    page(12, 'Development is slow in the early years.');
    page(13, 'The selected tail factor is 1.05, from the inverse power curve.');
    const md = 'The selected tail factor is 1.05 [S1].';
    const report = checkCitations(md, ctx());
    expect(report.problems).toEqual([
      { kind: 'unsupported', label: 'S1', claim: 'The selected tail factor is 1.05', missing: ['1.05'], better: 'S2' },
    ]);
    expect(buildCitationCorrection(report.problems)).toContain('[S2] does: cite it instead.');
    const shown = renderCitedAnswer(md, report, ctx());
    expect(shown).toContain('[Clark.pdf, page 12 · Unverified](parallx://explorer/file?path=Clark.pdf&page=12 "Unverified: the source does not contain 1.05")');
  });

  it('cites the sentence before a label that follows its full stop', () => {
    page(13, 'The selected tail factor is 1.05.');
    expect(checkCitations('The tail factor is 1.05. [S1]', ctx()).problems).toEqual([]);
  });

  it('accepts a figure rounded or written as a percent', () => {
    page(4, 'The loss ratio is 0.6475 and the trend is 0.05 a year.');
    expect(checkCitations('The loss ratio is about 0.65 and the trend is 5% [S1].', ctx()).problems).toEqual([]);
  });

  it('catches a label no block was read with', () => {
    page(1, 'Something.');
    const report = checkCitations('Reserves are adequate [S9].', ctx());
    expect(report.problems[0]).toMatchObject({ kind: 'unknown-label', label: 'S9' });
    expect(renderCitedAnswer('Reserves are adequate [S9].', report, ctx())).toBe('Reserves are adequate (S9 · Unverified).');
  });

  it('lets several labels back one sentence together', () => {
    page(1, 'The paid tail is 1.02.');
    page(2, 'The incurred tail is 1.01.');
    expect(checkCitations('The paid tail is 1.02 and the incurred tail is 1.01 [S1, S2].', ctx()).problems).toEqual([]);
  });

  it('ignores labels inside code', () => {
    expect(checkCitations('Use `arr[S3]` or\n```\nx = y[S4]\n```', ctx()).labels).toEqual([]);
  });

  it('passes a link link_create made, and flags one written by hand', () => {
    recordMintedLink(SID, 'parallx://explorer/file?path=a.pdf&page=2');
    const md = 'See [a.pdf](parallx://explorer/file?path=a.pdf&page=2) and [b.pdf](parallx://explorer/file?path=b.pdf&page=9).';
    const report = checkCitations(md, ctx());
    expect(report.problems).toEqual([{ kind: 'unchecked-link', uri: 'parallx://explorer/file?path=b.pdf&page=9', text: 'b.pdf' }]);
    expect(renderCitedAnswer(md, report, ctx())).toContain('[b.pdf · Unverified](parallx://explorer/file?path=b.pdf&page=9 "Unverified: this link was not checked")');
  });

  it('asks for citations when an answer uses documents read this turn and cites none', () => {
    const mark = sourceHandleMark(SID);
    page(5, 'Clark fits a loglogistic or Weibull growth curve to the development data. The expected loss is the premium times the expected loss ratio.');
    const md = 'Clark fits a loglogistic or Weibull growth curve to the development data. The expected loss comes from the premium times the expected loss ratio, which sets the reserve.';
    expect(checkCitations(md, ctx(mark)).problems).toEqual([{ kind: 'uncited' }]);
  });

  it('does not ask a short or unrelated answer to cite', () => {
    const mark = sourceHandleMark(SID);
    page(5, 'Clark fits a loglogistic growth curve.');
    expect(checkCitations('I could not find that in the guide.', ctx(mark)).problems).toEqual([]);
  });
});
