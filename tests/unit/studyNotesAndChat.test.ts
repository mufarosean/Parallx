// studyNotesAndChat.test.ts — Study's notes files as material, and his work
// carried to the chat (ext/study/src/22-text-material.js, 72-his-work.js),
// through the __testables export of the generated main.js.
//
// A notes file has no pages, so it is cut into parts at its headings and at
// paragraph ends; its headings are its chapters. A miss is reported to the
// chat with the question, his answer, the right or model answer and the
// quote, and Discuss in Chat stages that record in the chat through the
// chat's own generic commands.

import { describe, it, expect, afterEach } from 'vitest';
// @ts-expect-error — JS module with no types
import { __testables } from '../../ext/study/main.js';

const {
  stTextParts, stIsTextPath, stHasSections, ST_DOCUMENT_EXTS, stSectionsFromOutline,
  stHisAnswer, stRightAnswerOf, stMissOf, stMissLines, stDiscussPrompt, stItemAsShown, stDiscussInChat,
  __setApi, GOOD, AGAIN,
} = __testables;

type AnyRec = Record<string, any>;

describe('a notes file as material', () => {
  it('is a .md, .markdown or .txt; Add Material… offers those beside PDFs', () => {
    expect(['a.md', 'B.MARKDOWN', 'c.txt'].map(stIsTextPath)).toEqual([true, true, true]);
    expect(['a.pdf', 'a.py', 'notes.md.bak'].map(stIsTextPath)).toEqual([false, false, false]);
    expect(ST_DOCUMENT_EXTS).toEqual(['.pdf', '.md', '.markdown', '.txt']);
    expect(stHasSections({ kind: 'text' })).toBe(true);
    expect(stHasSections({ kind: 'canvas' })).toBe(false);
  });

  it('starts a part at each heading, and its headings are nested chapters', () => {
    const md = ['# Reserving', 'Intro line.', '', '## Bornhuetter-Ferguson', 'BF adds unreported loss.', '', '## Benktander', 'A credibility mix.', ''].join('\n');
    const { parts, outline } = stTextParts(md, true);
    expect(parts).toEqual(['# Reserving\nIntro line.', '## Bornhuetter-Ferguson\nBF adds unreported loss.', '## Benktander\nA credibility mix.']);
    expect(outline).toEqual([
      { title: 'Reserving', page: 1, level: 0 },
      { title: 'Bornhuetter-Ferguson', page: 2, level: 1 },
      { title: 'Benktander', page: 3, level: 1 },
    ]);
    // The same ranges a PDF outline gives: the top chapter holds its sections.
    const sections = stSectionsFromOutline(outline, parts.length);
    expect(sections.map((s: AnyRec) => [s.title, s.pageFrom, s.pageTo])).toEqual([['Reserving', 1, 3], ['Bornhuetter-Ferguson', 2, 2], ['Benktander', 3, 3]]);
  });

  it('a # inside a fenced block, or in a .txt, is not a heading', () => {
    const md = ['# Notes', 'Text.', '```', '# not a heading', '```', 'More.'].join('\n');
    expect(stTextParts(md, true).outline.map((o: AnyRec) => o.title)).toEqual(['Notes']);
    expect(stTextParts('# a line of a text file\nmore text', false)).toEqual({ parts: ['# a line of a text file\nmore text'], outline: [] });
  });

  it('cuts a long stretch where a paragraph ends, never inside one under twice the limit', () => {
    const para = (n: number) => Array.from({ length: 12 }, (_, i) => `Paragraph ${n} sentence ${i} has some words in it to be long enough.`).join(' ');
    const text = Array.from({ length: 12 }, (_, n) => para(n)).join('\n\n');
    const { parts } = stTextParts(text, false);
    expect(parts.length).toBeGreaterThan(2);
    // Every paragraph is whole in one part.
    for (let n = 0; n < 12; n++) expect(parts.filter((p: string) => p.includes(para(n))).length).toBe(1);
    expect(parts.join('\n\n')).toBe(text);
  });
});

describe('his work, as the chat sees it', () => {
  const mc = { id: 4, format: 'mc', stem: 'Which is right about the Cape Cod method?', options: ['Uses premium.', 'Ignores premium.', 'Uses paid only.'], answer: '0', sourceQuote: 'The Cape Cod method uses premium as the exposure base.', sourcePage: 9, materialId: 1 };
  const typed = { id: 5, format: 'short', stem: 'State what the BF method adds.', answer: 'The expected unreported loss.', rubric: [{ text: 'expected unreported loss', required: true }, { text: 'to the reported loss', required: true }], sourceQuote: 'BF adds the expected unreported loss to the reported loss.', sourcePage: 2, materialId: 1 };

  it('his answer and the right one: the option he chose and the right option; or what he typed and the model answer', () => {
    expect(stHisAnswer({ formatUsed: 'mc', chosen: '2' }, mc)).toBe('Uses paid only.');
    expect(stRightAnswerOf(mc)).toBe('Uses premium.');
    expect(stHisAnswer({ formatUsed: 'short', typed: 'It adds premium.' }, typed)).toBe('It adds premium.');
    expect(stRightAnswerOf(typed)).toBe('The expected unreported loss.');
    // An mc question he typed an answer to: what he typed, against the right option.
    expect(stHisAnswer({ formatUsed: 'short', typed: 'premium' }, mc)).toBe('premium');
  });

  it('a record holds the question, his answer, the right or model answer, the quote and what he missed', () => {
    const material = { id: 1, kind: 'pdf', label: 'Clark 2003' };
    const m = stMissOf(typed, { formatUsed: 'short', typed: 'It adds premium.', verdict: { points: [{ status: 'miss' }, { status: 'hit' }], note: 'Leaves out the unreported part.' } }, { material });
    expect(m).toMatchObject({ question: typed.stem, answer: 'It adds premium.', right: typed.answer, typed: true, quote: typed.sourceQuote, where: 'Clark 2003, p. 2', missed: ['expected unreported loss'], note: 'Leaves out the unreported part.' });
    const lines = stMissLines(m, 1).join('\n');
    for (const part of [typed.stem, 'It adds premium.', typed.answer, typed.sourceQuote]) expect(lines).toContain(part);
    expect(lines).toContain('Model answer:');
    const c = stMissLines(stMissOf(mc, { formatUsed: 'mc', chosen: '1' }, { material }), 2).join('\n');
    expect(c).toContain('Right answer: Uses premium.');
    expect(c).toContain('Answered: Ignores premium.');
    // A notes file's parts are not pages: no page is named for one.
    expect(stMissOf(mc, { formatUsed: 'mc', chosen: '1' }, { material: { id: 1, kind: 'text', label: 'My notes' } }).where).toBe('My notes');
  });

  it('each part is clipped so the output stays compact', () => {
    const long = { ...typed, answer: 'x'.repeat(5000) };
    const lines = stMissLines(stMissOf(long, { formatUsed: 'short', typed: 'y'.repeat(5000) }), 1);
    expect(Math.max(...lines.map((l: string) => l.length))).toBeLessThan(700);
  });

  it('the staged prompt carries all four and asks the model to start from his answer', () => {
    const text = stDiscussPrompt(stMissOf(mc, { formatUsed: 'mc', chosen: '1' }), { right: false });
    for (const part of [mc.stem, 'My answer: Ignores premium.', 'Right answer: Uses premium.', mc.sourceQuote]) expect(text).toContain(part);
    expect(text).toMatch(/start from my answer/i);
    expect(text).toMatch(/study_weak_spots/);
  });

  it('the card as shown: his choice or typed text and the verdict, before the record lands', () => {
    const shownWrong = stItemAsShown({ item: { id: 1, status: 'pending', chosen: '' }, q: mc, fmt: 'mc', chosen: 1 });
    expect(shownWrong).toMatchObject({ chosen: '1', status: 'wrong', formatUsed: 'mc' });
    expect(stItemAsShown({ item: { id: 1, status: 'pending' }, q: mc, fmt: 'mc', chosen: 0 }).status).toBe('right');
    const t = stItemAsShown({ item: { id: 2, status: 'answered' }, q: typed, fmt: 'short', typedField: { value: 'My words.' }, result: { rating: GOOD, verdict: { points: [] }, rubric: [], label: 'Correct' } });
    expect(t).toMatchObject({ typed: 'My words.', status: 'right' });
    expect(stItemAsShown({ item: { status: 'answered' }, q: typed, fmt: 'short', result: { rating: AGAIN, verdict: { points: [] }, rubric: [] } }).status).toBe('wrong');
  });
});

describe('Discuss in Chat', () => {
  afterEach(() => __setApi(null));

  const fakeApi = (commands: string[]) => {
    const ran: { id: string; args: unknown[] }[] = [];
    const said: string[] = [];
    __setApi({
      commands: { async getCommands() { return commands; }, async executeCommand(id: string, ...args: unknown[]) { ran.push({ id, args }); } },
      window: { async showInformationMessage(m: string) { said.push(m); } },
    });
    return { ran, said };
  };
  const q = { id: 4, format: 'mc', stem: 'Which is right?', options: ['A one.', 'B one.'], answer: '0', sourceQuote: 'The text says A.', sourcePage: 0, sourceUri: 'file:///ws/notes.md', materialId: 0 };

  it('opens the chat, attaches the source file and stages the record, through the chat\'s own commands', async () => {
    const { ran } = fakeApi(['chat.show', 'chat.addFileAttachment', 'chat.stagePrompt']);
    expect(await stDiscussInChat(q, { formatUsed: 'mc', chosen: '1', status: 'wrong' })).toBe(true);
    expect(ran.map((r) => r.id)).toEqual(['chat.show', 'chat.addFileAttachment', 'chat.stagePrompt']);
    expect(ran[1].args[0]).toMatchObject({ fullPath: '/ws/notes.md' });
    const text = (ran[2].args[0] as AnyRec).text as string;
    for (const part of ['Which is right?', 'My answer: B one.', 'Right answer: A one.', 'The text says A.']) expect(text).toContain(part);
  });

  it('with no chat, says so and does nothing else', async () => {
    const { ran, said } = fakeApi([]);
    expect(await stDiscussInChat(q, { formatUsed: 'mc', chosen: '1', status: 'wrong' })).toBe(false);
    expect(ran).toEqual([]);
    expect(said).toEqual(['The chat is not available.']);
  });
});
