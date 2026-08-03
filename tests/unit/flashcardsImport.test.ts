// M93 — Flashcards mechanical import: the deterministic parsers.
//
// Two layers under test:
//   1. ext/flashcards/main.js __testables — fcPairPages (front/back PDF page
//      pairing) and fcParsePastedRows (pasted spreadsheet/hand-typed rows).
//   2. electron/ankiWorker.cjs pure parsing — htmlToText, renderCloze, and
//      parseAnkiTxt ("Notes in Plain Text" exports). parseApkg is NOT covered
//      here: it opens better-sqlite3 (Electron ABI), which vitest cannot load.
//      The synthetic-.apkg probe (ext/flashcards/test/run-apkg-probe.mjs)
//      exercises that path under ELECTRON_RUN_AS_NODE.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
// @ts-expect-error — JS module with no types
import { __testables } from '../../ext/flashcards/main.js';

const require_ = createRequire(import.meta.url);
const { htmlToText, renderCloze, renderTemplate, buildFieldMap, parseAnkiTxt } = require_('../../electron/ankiWorker.cjs');

const { fcPairPages, fcParsePastedRows, fcImportKindOf, fcExtOf } = __testables;

// ─── fcPairPages — odd pages front, even pages back ──────────────────────────

describe('fcPairPages', () => {
  it('pairs consecutive pages into front/back cards', () => {
    const cards = fcPairPages(['Q1', 'A1', 'Q2', 'A2']);
    expect(cards).toEqual([
      { front: 'Q1', back: 'A1', tags: [] },
      { front: 'Q2', back: 'A2', tags: [] },
    ]);
  });

  it('offset skips leading cover pages so pairing starts on the first card face', () => {
    const cards = fcPairPages(['COVER', 'Q1', 'A1', 'Q2', 'A2'], { offset: 1 });
    expect(cards.map((c: { front: string }) => c.front)).toEqual(['Q1', 'Q2']);
    expect(cards[0].back).toBe('A1');
  });

  it('a fully blank pair mid-deck is dropped without shifting later pairs', () => {
    const cards = fcPairPages(['Q1', 'A1', '  ', '', 'Q3', 'A3']);
    expect(cards).toHaveLength(2);
    expect(cards[1]).toEqual({ front: 'Q3', back: 'A3', tags: [] });
  });

  it('an odd trailing page becomes a card with an empty back, not a silent drop', () => {
    const cards = fcPairPages(['Q1', 'A1', 'Q2']);
    expect(cards).toHaveLength(2);
    expect(cards[1]).toEqual({ front: 'Q2', back: '', tags: [] });
  });

  it('trims page text and tolerates null/undefined page entries', () => {
    const cards = fcPairPages(['  Q1  ', null, undefined, 'A2']);
    expect(cards[0]).toEqual({ front: 'Q1', back: '', tags: [] });
    expect(cards[1]).toEqual({ front: '', back: 'A2', tags: [] });
  });

  it('empty input produces no cards', () => {
    expect(fcPairPages([])).toEqual([]);
    expect(fcPairPages(undefined)).toEqual([]);
  });
});

// ─── fcParsePastedRows ───────────────────────────────────────────────────────

describe('fcParsePastedRows', () => {
  it('splits tab-separated rows (spreadsheet paste)', () => {
    const { cards, skipped } = fcParsePastedRows('Front A\tBack A\nFront B\tBack B');
    expect(skipped).toBe(0);
    expect(cards).toEqual([
      { front: 'Front A', back: 'Back A', tags: [] },
      { front: 'Front B', back: 'Back B', tags: [] },
    ]);
  });

  it('joins extra tab columns into the back', () => {
    const { cards } = fcParsePastedRows('Q\tpart one\tpart two');
    expect(cards[0].back).toBe('part one\n\npart two');
  });

  it('splits on " | " and " :: " for hand-typed lines, first separator only', () => {
    const { cards } = fcParsePastedRows('what | why | how\nterm :: meaning');
    expect(cards[0]).toEqual({ front: 'what', back: 'why | how', tags: [] });
    expect(cards[1]).toEqual({ front: 'term', back: 'meaning', tags: [] });
  });

  it('counts lines with no separator as skipped instead of guessing', () => {
    const { cards, skipped } = fcParsePastedRows('just prose here\nQ\tA');
    expect(cards).toHaveLength(1);
    expect(skipped).toBe(1);
  });

  it('skips rows where either side is empty after trimming', () => {
    const { cards, skipped } = fcParsePastedRows('Q\t \n\t back\nQ2\tA2');
    expect(cards).toEqual([{ front: 'Q2', back: 'A2', tags: [] }]);
    expect(skipped).toBe(2);
  });

  it('ignores blank lines entirely (neither cards nor skipped)', () => {
    const { cards, skipped } = fcParsePastedRows('\n\nQ\tA\n\n');
    expect(cards).toHaveLength(1);
    expect(skipped).toBe(0);
  });
});

// ─── fcImportKindOf — the Import tab's file dispatch ─────────────────────────
//
// This mapping was the slice's worst bug: loadPath once compared dotted
// literals ('.apkg') against fcExtOf's dot-less return ('apkg'), so no file
// could ever import. The dispatch is pinned here as the composition the UI
// actually runs: fcImportKindOf(fcExtOf(path)).

describe('fcImportKindOf', () => {
  it('routes Anki containers and text exports to the anki reader', () => {
    expect(fcImportKindOf(fcExtOf('RisingFellow_Exam7.apkg'))).toBe('anki');
    expect(fcImportKindOf(fcExtOf('collection.colpkg'))).toBe('anki');
    expect(fcImportKindOf(fcExtOf('notes.txt'))).toBe('anki');
    expect(fcImportKindOf(fcExtOf('deck.tsv'))).toBe('anki');
    expect(fcImportKindOf(fcExtOf('cards.csv'))).toBe('anki');
  });

  it('routes PDFs to the page-pairing reader, case-insensitively', () => {
    expect(fcImportKindOf(fcExtOf('flashcards.pdf'))).toBe('pdf');
    expect(fcImportKindOf(fcExtOf('FLASHCARDS.PDF'))).toBe('pdf');
  });

  it('rejects everything else', () => {
    expect(fcImportKindOf(fcExtOf('notes.docx'))).toBeNull();
    expect(fcImportKindOf(fcExtOf('no-extension'))).toBeNull();
    expect(fcImportKindOf(fcExtOf(''))).toBeNull();
  });
});

// ─── ankiWorker: htmlToText ──────────────────────────────────────────────────

describe('ankiWorker htmlToText', () => {
  it('turns block boundaries into newlines instead of concatenating words', () => {
    expect(htmlToText('<div>alpha</div><div>beta</div>').text).toBe('alpha\nbeta');
    expect(htmlToText('line one<br>line two').text).toBe('line one\nline two');
  });

  it('renders list items as bullets', () => {
    expect(htmlToText('<ul><li>first</li><li>second</li></ul>').text).toBe('• first\n• second');
  });

  it('decodes named and numeric entities', () => {
    expect(htmlToText('P&amp;C &lt;tail&gt;&nbsp;risk &#8594; loss').text).toBe('P&C <tail> risk → loss');
  });

  it('drops media references and counts them', () => {
    const r = htmlToText('term [sound:pronounce.mp3] <img src="diagram.png"> rest');
    expect(r.media).toBe(2);
    expect(r.text).not.toContain('sound');
    expect(r.text).not.toContain('img');
    expect(r.text).toMatch(/^term\s+rest$/);
  });

  it('collapses runaway blank lines but keeps intentional paragraph breaks', () => {
    expect(htmlToText('<p>a</p><p></p><p></p><p>b</p>').text).toBe('a\n\nb');
  });

  it('decodes hex numeric references and typographic/name-with-digit entities', () => {
    expect(htmlToText('Bornhuetter&#x2013;Ferguson').text).toBe('Bornhuetter–Ferguson');
    expect(htmlToText('don&rsquo;t &mdash; x&sup2; &frac12;').text).toBe('don’t — x² ½');
  });

  it('leaves unknown entities and out-of-range code points as literal text', () => {
    expect(htmlToText('&notarealentity; stays').text).toBe('&notarealentity; stays');
    expect(htmlToText('&#1114112; overflows').text).toBe('&#1114112; overflows');
    expect(htmlToText('&#x110000; overflows').text).toBe('&#x110000; overflows');
  });
});

// ─── ankiWorker: renderTemplate — mechanical qfmt/afmt rendering ─────────────

describe('ankiWorker renderTemplate', () => {
  const model = {
    flds: [{ name: 'Front', ord: 0 }, { name: 'Back', ord: 1 }, { name: 'Add Reverse', ord: 2 }],
  };

  it('substitutes fields and drops FrontSide (this app shows the front separately)', () => {
    const map = buildFieldMap(model, ['Q', 'A', '']);
    expect(renderTemplate('{{Front}}', map, { side: 'front' })).toBe('Q');
    expect(renderTemplate('{{FrontSide}}<hr id=answer>{{Back}}', map, { side: 'back' })).toBe('<hr id=answer>A');
  });

  it('shows {{#F}} sections only when the field is non-empty — the Add Reverse contract', () => {
    const withMarker = buildFieldMap(model, ['Q', 'A', 'y']);
    const withoutMarker = buildFieldMap(model, ['Q', 'A', '']);
    const qfmt = '{{#Add Reverse}}{{Back}}{{/Add Reverse}}';
    expect(renderTemplate(qfmt, withMarker, { side: 'front' })).toBe('A');
    expect(renderTemplate(qfmt, withoutMarker, { side: 'front' })).toBe('');
  });

  it('shows {{^F}} sections only when the field is empty', () => {
    const map = buildFieldMap(model, ['Q', '', '']);
    expect(renderTemplate('{{^Back}}no answer yet{{/Back}}', map, {})).toBe('no answer yet');
    expect(renderTemplate('{{#Back}}has answer{{/Back}}', map, {})).toBe('');
  });

  it('resolves nested sections innermost-first', () => {
    const map = buildFieldMap(model, ['Q', 'A', 'y']);
    expect(renderTemplate('{{#Front}}{{#Add Reverse}}both{{/Add Reverse}}{{/Front}}', map, {})).toBe('both');
  });

  it('drops specials and unknown fields instead of leaking template syntax', () => {
    const map = buildFieldMap(model, ['Q', 'A', '']);
    expect(renderTemplate('{{Tags}}{{Deck}}{{Nope}}{{Front}}', map, {})).toBe('Q');
  });

  it('renders {{cloze:F}} masked on the front and revealed on the back, by ord', () => {
    const clozeModel = { flds: [{ name: 'Text', ord: 0 }] };
    const map = buildFieldMap(clozeModel, ['The {{c1::heart}} pumps {{c2::blood}}']);
    expect(renderTemplate('{{cloze:Text}}', map, { side: 'front', ord: 0 })).toBe('The […] pumps blood');
    expect(renderTemplate('{{cloze:Text}}', map, { side: 'back', ord: 0 })).toBe('The heart pumps blood');
    expect(renderTemplate('{{cloze:Text}}', map, { side: 'front', ord: 1 })).toBe('The heart pumps […]');
  });

  it('renders {{type:F}} as nothing on the front and the answer on the back', () => {
    const map = buildFieldMap(model, ['Q', 'A', '']);
    expect(renderTemplate('{{Front}} {{type:Back}}', map, { side: 'front' })).toBe('Q ');
    expect(renderTemplate('{{type:Back}}', map, { side: 'back' })).toBe('A');
  });

  it('{{type:cloze:F}} is a typing box, not a second copy of the question', () => {
    // The Anki-manual typed-cloze recipe puts {{cloze:Text}} AND
    // {{type:cloze:Text}} on both sides; the type tag must not re-render the
    // whole text (front) and contributes only the target answer (back).
    const clozeModel = { flds: [{ name: 'Text', ord: 0 }] };
    const map = buildFieldMap(clozeModel, ['The {{c1::heart}} pumps {{c2::blood}}']);
    const tpl = '{{cloze:Text}}<br>{{type:cloze:Text}}';
    expect(renderTemplate(tpl, map, { side: 'front', ord: 0 })).toBe('The […] pumps blood<br>');
    expect(renderTemplate(tpl, map, { side: 'back', ord: 0 })).toBe('The heart pumps blood<br>heart');
  });

  it('pairs section tags whitespace-tolerantly — a stray space must not disarm the guard', () => {
    const map = buildFieldMap(model, ['Q', 'A', '']);
    expect(renderTemplate('{{#Add Reverse }}{{Back}}{{/Add Reverse}}', map, {})).toBe('');
    const withMarker = buildFieldMap(model, ['Q', 'A', 'y']);
    expect(renderTemplate('{{# Add Reverse}}{{Back}}{{/ Add Reverse }}', withMarker, {})).toBe('A');
  });

  it('reduces cosmetic filter chains to the field value', () => {
    const map = buildFieldMap(model, ['Q', 'A', '']);
    expect(renderTemplate('{{text:Front}} / {{hint:Back}}', map, {})).toBe('Q / A');
  });
});

// ─── ankiWorker: renderCloze ─────────────────────────────────────────────────

describe('ankiWorker renderCloze', () => {
  const NOTE = 'The {{c1::heart}} pumps {{c2::blood}}';

  it('hides only the target deletion and reveals the others', () => {
    expect(renderCloze(NOTE, 0)).toEqual({ front: 'The […] pumps blood', back: 'The heart pumps blood' });
    expect(renderCloze(NOTE, 1)).toEqual({ front: 'The heart pumps […]', back: 'The heart pumps blood' });
  });

  it('shows the hint when the deletion has one', () => {
    expect(renderCloze('{{c1::aorta::vessel}} carries blood', 0).front).toBe('[vessel] carries blood');
  });

  it('hides every occurrence of the same index', () => {
    const { front } = renderCloze('{{c1::x}} equals {{c1::x}}', 0);
    expect(front).toBe('[…] equals […]');
  });
});

// ─── ankiWorker: parseAnkiTxt ────────────────────────────────────────────────

describe('ankiWorker parseAnkiTxt', () => {
  it('parses a plain tab-separated export into one deck', () => {
    const r = parseAnkiTxt('Front A\tBack A\nFront B\tBack B\n');
    expect(r.ok).toBe(true);
    expect(r.cardCount).toBe(2);
    expect(r.decks).toHaveLength(1);
    expect(r.decks[0].name).toBe('Imported');
    expect(r.decks[0].cards[0]).toEqual({ front: 'Front A', back: 'Back A', tags: [] });
  });

  it('flattens field HTML by default and counts skipped media', () => {
    const r = parseAnkiTxt('Q &amp; A\t<div>one</div><div>two</div> <img src="x.png">\n');
    expect(r.decks[0].cards[0].front).toBe('Q & A');
    expect(r.decks[0].cards[0].back).toBe('one\ntwo');
    expect(r.mediaSkipped).toBe(1);
  });

  it('honours #html:false by keeping markup literal', () => {
    const r = parseAnkiTxt('#separator:tab\n#html:false\n<b>bold</b>\tstays\n');
    expect(r.decks[0].cards[0].front).toBe('<b>bold</b>');
  });

  it('honours #separator:comma over the default', () => {
    const r = parseAnkiTxt('#separator:comma\nfront,back\n');
    expect(r.decks[0].cards[0]).toEqual({ front: 'front', back: 'back', tags: [] });
  });

  it('uses the caller default separator (.csv) when no header declares one', () => {
    const r = parseAnkiTxt('front,back\n', { defaultSep: ',' });
    expect(r.decks[0].cards[0]).toEqual({ front: 'front', back: 'back', tags: [] });
  });

  it('handles quoted fields: embedded separators, doubled quotes, spanning newlines', () => {
    const r = parseAnkiTxt('"has\ttab and ""quote"""\t"line one\nline two"\n');
    expect(r.cardCount).toBe(1);
    expect(r.decks[0].cards[0].front).toBe('has\ttab and "quote"');
    expect(r.decks[0].cards[0].back).toBe('line one\nline two');
  });

  it('routes deck and tags columns via headers and excludes them from fields', () => {
    const content =
      '#separator:tab\n#deck column:3\n#tags column:4\n'
      + 'Q1\tA1\tExam 7::Reserving\tbrosius credibility\n'
      + 'Q2\tA2\tExam 7::ERM\t\n';
    const r = parseAnkiTxt(content);
    expect(r.decks.map((d: { name: string }) => d.name)).toEqual(['Exam 7::Reserving', 'Exam 7::ERM']);
    expect(r.decks[0].cards[0]).toEqual({ front: 'Q1', back: 'A1', tags: ['brosius', 'credibility'] });
  });

  it('expands a cloze note into one card per distinct index', () => {
    const content =
      '#separator:tab\n#notetype column:1\n'
      + 'Cloze\tThe {{c1::heart}} pumps {{c2::blood}}\textra detail\n';
    const r = parseAnkiTxt(content);
    expect(r.cardCount).toBe(2);
    const cards = r.decks[0].cards;
    expect(cards[0].front).toBe('The […] pumps blood');
    expect(cards[0].back).toBe('The heart pumps blood\n\nextra detail');
    expect(cards[1].front).toBe('The heart pumps […]');
  });

  it('detects cloze notes by content when no notetype column exists', () => {
    const r = parseAnkiTxt('{{c1::Mack}} assumes independence\t\n');
    expect(r.cardCount).toBe(1);
    expect(r.decks[0].cards[0].front).toBe('[…] assumes independence');
  });

  it('cloze detection does not leak regex state between rows', () => {
    // A stateful global regex would miss the second cloze row after matching
    // the first; every cloze row must expand regardless of what came before.
    const content = '{{c1::a}} first\t\nplain front\tplain back\n{{c1::b}} second\t\n';
    const r = parseAnkiTxt(content);
    expect(r.cardCount).toBe(3);
  });

  it('survives CRLF line endings and a leading BOM', () => {
    const r = parseAnkiTxt('﻿#separator:tab\r\nfront\tback\r\n');
    expect(r.cardCount).toBe(1);
    expect(r.decks[0].cards[0]).toEqual({ front: 'front', back: 'back', tags: [] });
  });

  it('skips rows that flatten to nothing', () => {
    const r = parseAnkiTxt('front\tback\n\t\n\n');
    expect(r.cardCount).toBe(1);
  });
});
