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
  supportingPassage,
  withoutQuote,
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
    // The link goes to the page and carries the line the sentence rests on.
    expect(renderCitedAnswer(md, report, ctx())).toBe(
      'Clark selects a tail factor of 1.05 ([Clark.pdf, page 13](parallx://explorer/file?path=Clark.pdf&page=13&quote=The+selected+tail+factor+is+1.05%2C+from+the+inverse+power+curve.)).',
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

describe('where on the page a citation rests', () => {
  const PAGE = [
    'Chapter 7: Reserving',
    'Development is slow in the early years and the tail is long.',
    'Age  Paid  Incurred',
    '108  1.08  1.04',
    '120  1.05  1.02',
    'The Bondy method repeats the last selected factor.',
  ].join('\n');

  it('is the line that carries the sentence\'s figure, not the first line of the page', () => {
    expect(supportingPassage('The paid factor at 120 months is 1.05', PAGE)).toBe('120 1.05 1.02');
    expect(supportingPassage('The Bondy method repeats the last factor that was selected', PAGE)).toBe('The Bondy method repeats the last selected factor.');
  });

  it('takes a sentence broken over two lines as one passage, and one line when one says it all', () => {
    const broken = 'The selected tail factor\nis 1.05, from the inverse power curve.\nNothing else here.';
    expect(supportingPassage('The selected tail factor is 1.05', broken)).toBe('The selected tail factor is 1.05, from the inverse power curve.');
    expect(supportingPassage('The tail factor is 1.05', 'The tail factor is 1.05.\nA second line about something else entirely.')).toBe('The tail factor is 1.05.');
  });

  it('reads a paragraph on one long line a sentence at a time, and keeps a passage short', () => {
    const paragraph = `${'Background on the method and its history fills this sentence with many words. '.repeat(4)}The selected tail factor is 1.05, from the inverse power curve. ${'More background follows here. '.repeat(6)}`;
    expect(supportingPassage('Clark selects a tail of 1.05', paragraph)).toBe('The selected tail factor is 1.05, from the inverse power curve.');
    const long = `The tail factor of 1.05 ${'was chosen after weighing a long list of considerations and '.repeat(6)}more.`;
    const cut = supportingPassage('The tail factor is 1.05', long)!;
    expect(cut.length).toBeLessThanOrEqual(160);
    expect(cut).toContain('1.05');
  });

  it('gives nothing when no line stands out: the link then goes to the page', () => {
    expect(supportingPassage('Reserves', PAGE)).toBeUndefined();                       // too little to place
    expect(supportingPassage('The loss ratio is 0.65', PAGE)).toBeUndefined();         // the figure is nowhere on the page
    expect(supportingPassage('Clark prefers stochastic simulation approaches', PAGE)).toBeUndefined();
    expect(supportingPassage('It is 1.05', 'x 1.05')).toBeUndefined();                 // too short to find again
  });

  it('a shown citation carries its line as the link\'s quote; a failed one and a non-PDF link do not', () => {
    page(13, PAGE);
    const lines = citeSource(SID, { key: 'notes', location: 'notes.md · lines 1 to 9', title: 'notes.md', uri: 'parallx://explorer/file?path=notes.md&line=1', text: PAGE, document: true });
    const md = `The paid factor at 120 months is 1.05 [S1]. The Bondy method repeats the last factor [${lines}]. The expected loss ratio for the latest accident year is 0.65 [S1].`;
    const shown = renderCitedAnswer(md, checkCitations(md, ctx()), ctx());
    expect(shown).toContain('(parallx://explorer/file?path=Clark.pdf&page=13&quote=120+1.05+1.02)');
    expect(shown).toContain('(parallx://explorer/file?path=notes.md&line=1)');           // a text file's link already goes to its line
    expect(shown).toContain('[Clark.pdf, page 13 · Unverified](parallx://explorer/file?path=Clark.pdf&page=13 "Unverified');
  });

  it('a label\'s link copied from an earlier answer, quote and all, is still that label\'s link', () => {
    page(13, PAGE);
    const md = 'As before, see [Clark.pdf, page 13](parallx://explorer/file?path=Clark.pdf&page=13&quote=120+1.05+1.02) and [made up](parallx://explorer/file?path=Clark.pdf&page=14&quote=120+1.05+1.02).';
    const report = checkCitations(md, ctx());
    expect(report.problems).toEqual([{ kind: 'unchecked-link', uri: 'parallx://explorer/file?path=Clark.pdf&page=14&quote=120+1.05+1.02', text: 'made up' }]);
    expect(withoutQuote('parallx://explorer/file?path=Clark.pdf&page=13&quote=120+1.05+1.02')).toBe('parallx://explorer/file?path=Clark.pdf&page=13');
    expect(withoutQuote('parallx://canvas/page?id=abc&quote=x')).toBe('parallx://canvas/page?id=abc&quote=x');
  });
});

describe('a citation of a picture of a page', () => {
  const PHOTO = ['Chapter 7: Reserving', 'Development is slow in the early years.', 'The selected tail factor is 1.05, from the inverse power curve.'].join('\n');
  // A picture is read as one block; its link finds it by its opening words.
  const photo = () => citeSource(SID, { key: 'photo', location: 'Scans/page.jpg', title: 'page.jpg', uri: 'parallx://explorer/file?path=Scans%2Fpage.jpg&quote=Chapter+7%3A+Reserving+Development+is+slow', text: PHOTO, document: true });

  it('carries the line the sentence rests on, in place of the picture\'s opening words', () => {
    const label = photo();
    const md = `Clark selects a tail factor of 1.05 [${label}].`;
    expect(renderCitedAnswer(md, checkCitations(md, ctx()), ctx())).toBe(
      'Clark selects a tail factor of 1.05 ([page.jpg](parallx://explorer/file?path=Scans%2Fpage.jpg&quote=The+selected+tail+factor+is+1.05%2C+from+the+inverse+power+curve.)).',
    );
  });

  it('its link copied from an earlier answer is still its link; a Word file\'s link keeps its quote as its address', () => {
    photo();
    const word = 'parallx://explorer/file?path=notes.docx&quote=The+opening+words+of+a+block';
    citeSource(SID, { key: 'word', location: 'notes.docx', title: 'notes.docx', uri: word, text: 'The opening words of a block. The selected tail factor is 1.05.', document: true });
    const copied = 'See [page.jpg](parallx://explorer/file?path=Scans%2Fpage.jpg&quote=The+selected+tail+factor+is+1.05) and [notes](parallx://explorer/file?path=notes.docx&quote=some+other+words+entirely).';
    expect(checkCitations(copied, ctx()).problems).toEqual([{ kind: 'unchecked-link', uri: 'parallx://explorer/file?path=notes.docx&quote=some+other+words+entirely', text: 'notes' }]);
    const md = 'The tail factor is 1.05 [S2].';
    expect(renderCitedAnswer(md, checkCitations(md, ctx()), ctx())).toContain(`(${word})`);
  });
});
