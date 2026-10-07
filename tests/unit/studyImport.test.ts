// studyImport.test.ts — the Study extension's file and report parsers
// (ext/study/src/10-model.js, docs/STUDY_BUILD_SPEC.md §7 and §11): the
// three question-file formats, a synthetic examiner's report with two
// questions and parts, and matching report entries to questions.

import { describe, it, expect } from 'vitest';
// @ts-expect-error — JS module with no types
import { __testables } from '../../ext/study/main.js';

const { stParseQuestionFile, stParseExaminerReport, stMatchReportToQuestions } = __testables;

// ── Question files ─────────────────────────────────────────────────────────────

const MD = `﻿# Exam 7 past questions\r
\r
## 2019 Fall Q5\r
Q: Describe the two methods Clark fits to the loss development pattern and state the difference in the number of parameters.\r
A: The LDF method gives each accident year its own ultimate, so parameters are the accident years plus two.\r
The Cape Cod method fits one ELR for every year, so it has three parameters.\r
Points: names the LDF method | names the Cape Cod method | parameter count differs\r
Exam: CAS Exam 7\r
Sitting: 2019 Fall\r
Number: 5\r
Part: b\r
Source: cas\r
\r
---\r
\r
**Question**\r
State Mack's three chain ladder assumptions.\r
\r
**Answer**\r
Expected next cumulative is the current times a factor; accident years are independent; variance proportional to the current cumulative.\r
\r
**Rubric**\r
- development factor assumption\r
- independence of accident years\r
- variance assumption (optional)\r
Paper: Mack\r
Kind: short\r
\r
---\r
\r
Q: Which curve gives the thinner tail?\r
Kind: mc\r
Options: Weibull | Loglogistic | Pareto\r
A: Weibull\r
\r
---\r
\r
Paper: Orphan block with no question\r
`;

describe('stParseQuestionFile: markdown', () => {
  const { questions, skipped } = stParseQuestionFile(MD, '.md');

  it('reads Q/A blocks, bold blocks and headings, tolerating a BOM and CRLF', () => {
    expect(questions).toHaveLength(3);
    expect(skipped).toBe(1);
  });
  it('keeps the whole multi-line answer, the rubric from Points and the exam fields', () => {
    const q = questions[0];
    expect(q.format).toBe('essay');
    expect(q.stem).toMatch(/^Describe the two methods/);
    expect(q.answer).toContain('The LDF method gives each accident year');
    expect(q.answer).toContain('The Cape Cod method fits one ELR');
    expect(q.rubric).toEqual([
      { text: 'names the LDF method', required: true },
      { text: 'names the Cape Cod method', required: true },
      { text: 'parameter count differs', required: true },
    ]);
    expect(q.rubricOrigin).toBe('source');
    expect(q).toMatchObject({ exam: 'CAS Exam 7', sitting: '2019 Fall', number: '5', part: 'b', source: 'cas', label: '2019 Fall Q5', origin: 'imported' });
    expect(q.originLabel).toBe('CAS Exam 7 · 2019 Fall · Q5(b)');
    expect(q.providerRef).toBe('');
  });
  it('reads a **Question** / **Answer** / **Rubric** block with bullet points, an (optional) point and a kind', () => {
    const q = questions[1];
    expect(q.format).toBe('short');
    expect(q.stem).toBe("State Mack's three chain ladder assumptions.");
    expect(q.answer).toMatch(/^Expected next cumulative/);
    expect(q.rubric).toEqual([
      { text: 'development factor assumption', required: true },
      { text: 'independence of accident years', required: true },
      { text: 'variance assumption', required: false },
    ]);
    expect(q.paper).toBe('Mack');
    expect(q.originLabel).toBe('Mack');
  });
  it('reads an mc question with options and resolves the answer text to an index', () => {
    const q = questions[2];
    expect(q.format).toBe('mc');
    expect(q.options).toEqual(['Weibull', 'Loglogistic', 'Pareto']);
    expect(q.answer).toBe('0');
    expect(q.originLabel).toBe('');
  });
  it('an empty file gives nothing', () => {
    expect(stParseQuestionFile('', 'md')).toEqual({ questions: [], skipped: 0 });
    expect(stParseQuestionFile('\n\n---\n\n', 'md')).toEqual({ questions: [], skipped: 0 });
  });
});

describe('stParseQuestionFile: csv and tsv', () => {
  const CSV = [
    'question,answer,exam,sitting,number,part,kind,rubric,difficulty,marks',
    '"Explain why the Cape Cod method has a smaller parameter variance than the LDF method.","Fewer parameters, one ELR for all years.",Exam 7,Fall 2019,5,a,essay,fewer parameters|one ELR,hard,1.5',
    '"What is the loglogistic growth curve, G(x)?","x^w / (x^w + theta^w)",Exam 7,Fall 2019,6,,formula,,,',
    '"Compute the ultimate for premium 1,000 and ELR 0.65.",650,Exam 7,Fall 2019,7,,numeric,,,',
    ',no question here,Exam 7,Fall 2019,8,,,,,',
    '"Which method weights ""a priori"" and experience?","Bornhuetter-Ferguson",,,,,short,,,',
  ].join('\r\n');

  it('parses quoted fields, known columns, and keeps unknown columns in providerRef', () => {
    const { questions, skipped } = stParseQuestionFile(CSV, 'csv');
    expect(questions).toHaveLength(4);
    expect(skipped).toBe(1);
    const [q1, q2, q3, q4] = questions;
    expect(q1).toMatchObject({ format: 'essay', exam: 'Exam 7', sitting: 'Fall 2019', number: '5', part: 'a', originLabel: 'Exam 7 · Fall 2019 · Q5(a)' });
    expect(q1.rubric).toEqual([{ text: 'fewer parameters', required: true }, { text: 'one ELR', required: true }]);
    expect(JSON.parse(q1.providerRef)).toEqual({ difficulty: 'hard', marks: '1.5' });
    expect(q2).toMatchObject({ format: 'formula', answer: 'x^w / (x^w + theta^w)', originLabel: 'Exam 7 · Fall 2019 · Q6', providerRef: '' });
    expect(q3).toMatchObject({ format: 'numeric', answer: '650' });
    expect(q4).toMatchObject({ format: 'short', stem: 'Which method weights "a priori" and experience?', answer: 'Bornhuetter-Ferguson', originLabel: '' });
  });

  it('reads a tsv with a tab delimiter and header case ignored', () => {
    const TSV = 'Question\tAnswer\tPaper\tSource\nWhat does ELR stand for?\tExpected loss ratio\tClark\trf\n';
    const { questions } = stParseQuestionFile(TSV, 'tsv');
    expect(questions).toEqual([expect.objectContaining({ stem: 'What does ELR stand for?', answer: 'Expected loss ratio', paper: 'Clark', source: 'rf', format: 'essay', originLabel: 'Clark' })]);
  });

  it('a header-only file gives nothing', () => {
    expect(stParseQuestionFile('question,answer\n', 'csv')).toEqual({ questions: [], skipped: 0 });
  });
});

describe('stParseQuestionFile: json', () => {
  it('reads an array of records with rubric arrays, options and extras', () => {
    const JSON_TEXT = JSON.stringify([
      { question: 'State the process variance under the ODP assumption.', answer: 'sigma squared times the expected reserve.', paper: 'Clark', source: 'rf', exam: 'Exam 7', sitting: '2019 Fall', number: 5, part: 'c', kind: 'essay', rubric: ['sigma squared', { text: 'times expected reserve', required: false }], tags: ['variance'] },
      { question: 'The ____ method fits one ELR for every year.', answer: 'Cape Cod', kind: 'cloze' },
      { question: 'Which has the thinner tail?', kind: 'mc', options: ['Loglogistic', 'Weibull'], answer: 1 },
      { answer: 'no question' },
      'not an object',
    ]);
    const { questions, skipped } = stParseQuestionFile(JSON_TEXT, 'json');
    expect(questions).toHaveLength(3);
    expect(skipped).toBe(2);
    expect(questions[0]).toMatchObject({ format: 'essay', number: '5', part: 'c', originLabel: 'Exam 7 · 2019 Fall · Q5(c)' });
    expect(questions[0].rubric).toEqual([{ text: 'sigma squared', required: true }, { text: 'times expected reserve', required: false }]);
    expect(JSON.parse(questions[0].providerRef)).toEqual({ tags: ['variance'] });
    expect(questions[1].format).toBe('essay');
    expect(questions[2]).toMatchObject({ format: 'mc', options: ['Loglogistic', 'Weibull'], answer: '1' });
  });
  it('accepts a wrapping object and reports invalid JSON', () => {
    expect(stParseQuestionFile('{"questions": [{"question": "q", "answer": "a"}]}', 'json').questions).toHaveLength(1);
    const bad = stParseQuestionFile('{not json', 'json');
    expect(bad.questions).toEqual([]);
    expect(bad.error).toBeTruthy();
  });
});

// ── Examiner's reports ─────────────────────────────────────────────────────────

const REPORT_PAGES = [
  `Casualty Actuarial Society\r
Exam 7\r
Estimation of Policy Liabilities, Insurance Company Valuation, and Enterprise Risk Management\r
Fall 2019\r
\r
EXAMINER'S REPORT\r
\r
General comments: candidates should show their work.`,
  `QUESTION 5\r
TOTAL POINT VALUE: 2.75   LEARNING OBJECTIVE(S): A2\r
SAMPLE ANSWERS\r
Part a: 1.25 points\r
Sample 1\r
Under the LDF method each accident year has its own ultimate, so the number of parameters is the number of accident years plus two.\r
Sample 2\r
The LDF method has n + 2 parameters for n accident years.\r
\r
Part b: 1.5 points\r
The Cape Cod method fits one expected loss ratio for every year, so the ultimate is premium times ELR times G(x).\r
Fewer parameters means a smaller parameter variance.`,
  `EXAMINER'S REPORT\r
Candidates were generally well prepared for this question.\r
Part a\r
Common errors included counting the parameters as the number of accident years, forgetting omega and theta.\r
Part b\r
Some candidates stated that the Cape Cod method has more parameters than the LDF method, which is the reverse of the truth.\r
\r
QUESTION 12 (part b)\r
TOTAL POINT VALUE: 1.0\r
Sample Answer:\r
The three assumptions are the development factor, independence of accident years, and the variance proportional to the current cumulative.\r
Examiner's Comments\r
Candidates commonly omitted the variance assumption or stated it as proportional to the square of the cumulative.`,
  `Question 13\r
Model Solution\r
The mean squared error is the sum of the process variance and the estimation error.\r
\r
Common Errors\r
Candidates added the standard deviations rather than the variances.`,
];

describe('stParseExaminerReport', () => {
  const report = stParseExaminerReport(REPORT_PAGES);

  it('reads the exam and sitting from the first page', () => {
    expect(report.exam).toBe('Exam 7');
    expect(report.sitting).toBe('2019 Fall');
  });

  it('splits a question with parts into one entry per part, each with its sample and comments', () => {
    const q5 = report.questions.filter((q: { number: number }) => q.number === 5);
    expect(q5.map((q: { part: string }) => q.part)).toEqual(['a', 'b']);
    const [a, b] = q5;
    expect(a.page).toBe(2);
    expect(a.sampleAnswer).toContain('Under the LDF method each accident year has its own ultimate');
    expect(a.sampleAnswer).toContain('n + 2 parameters');
    expect(a.sampleAnswer).not.toContain('Cape Cod');
    expect(a.sampleAnswer).not.toContain('TOTAL POINT VALUE');
    expect(a.commonErrors).toBe('Common errors included counting the parameters as the number of accident years, forgetting omega and theta.');
    expect(b.sampleAnswer).toMatch(/^The Cape Cod method fits one expected loss ratio/);
    expect(b.sampleAnswer).toMatch(/smaller parameter variance\.$/);
    expect(b.commonErrors).toContain('reverse of the truth');
    expect(b.commonErrors).not.toContain('omega and theta');
  });

  it('reads a part named in the heading, Sample Answer: and Examiner\'s Comments headings', () => {
    const q12 = report.questions.find((q: { number: number }) => q.number === 12);
    expect(q12).toMatchObject({ number: 12, part: 'b', page: 3 });
    expect(q12.sampleAnswer).toBe('The three assumptions are the development factor, independence of accident years, and the variance proportional to the current cumulative.');
    expect(q12.commonErrors).toBe('Candidates commonly omitted the variance assumption or stated it as proportional to the square of the cumulative.');
  });

  it('reads Question n, Model Solution and Common Errors headings; no part gives an empty part', () => {
    const q13 = report.questions.find((q: { number: number }) => q.number === 13);
    expect(q13).toEqual({
      number: 13, part: '', page: 4,
      sampleAnswer: 'The mean squared error is the sum of the process variance and the estimation error.',
      commonErrors: 'Candidates added the standard deviations rather than the variances.',
    });
    expect(report.questions).toHaveLength(4);
  });

  it('a sentence that starts with "Question 5" is not an entry heading', () => {
    const r = stParseExaminerReport(['Exam 7 Spring 2020', 'Question 5 was answered well by most candidates who sat the exam this year.\nQUESTION 5\nSample Answers\nAn answer.']);
    expect(r.sitting).toBe('2020 Spring');
    expect(r.questions).toEqual([{ number: 5, part: '', sampleAnswer: 'An answer.', commonErrors: '', page: 2 }]);
  });

  it('handles empty input and a report without exam markers', () => {
    expect(stParseExaminerReport([])).toEqual({ exam: '', sitting: '', questions: [] });
    expect(stParseExaminerReport(['just prose'])).toEqual({ exam: '', sitting: '', questions: [] });
  });
});

describe('stMatchReportToQuestions', () => {
  const report = stParseExaminerReport(REPORT_PAGES);
  const questions = [
    { id: 1, exam: 'CAS Exam 7', sitting: 'Fall 2019', number: 5, part: 'a' },
    { id: 2, exam: 'CAS Exam 7', sitting: 'Fall 2019', number: 5, part: 'b' },
    { id: 3, exam: 'CAS Exam 7', sitting: 'Fall 2019', number: 5, part: 'c' },
    { id: 4, originLabel: 'CAS Exam 7 · 2019 Fall · Q12(b)' },
    { id: 5, originLabel: 'Exam 7 · 2019 Spring · Q13' },
    { id: 6, exam: 'Exam 8', sitting: '2019 Fall', number: 13 },
    { id: 7, originLabel: 'Exam 7 · 2019 Fall · Q13' },
    { id: 8, exam: '', sitting: '', number: 13, part: '' },
    { id: 9, exam: 'Exam 7', sitting: '2019 Fall', number: 5, part: '' },
  ];

  it('matches by exam, sitting, number and part, through fields or the origin label', () => {
    const matches = stMatchReportToQuestions(report, questions);
    const ids = (n: number, p: string) => matches.filter((m: { entry: { number: number; part: string } }) => m.entry.number === n && m.entry.part === p).map((m: { questionId: number }) => m.questionId);
    expect(ids(5, 'a')).toEqual([1]);
    expect(ids(5, 'b')).toEqual([2]);
    expect(ids(12, 'b')).toEqual([4]);
    expect(ids(13, '')).toEqual([7, 8]);
    expect(matches.every((m: { entry: unknown }) => m.entry && typeof m.entry === 'object')).toBe(true);
    expect(matches.map((m: { questionId: number }) => m.questionId)).not.toContain(3);
    expect(matches.map((m: { questionId: number }) => m.questionId)).not.toContain(5);
    expect(matches.map((m: { questionId: number }) => m.questionId)).not.toContain(6);
    expect(matches.map((m: { questionId: number }) => m.questionId)).not.toContain(9);
  });

  it('a report without exam or sitting matches on number and part alone', () => {
    const bare = { exam: '', sitting: '', questions: [{ number: 13, part: '', sampleAnswer: 's', commonErrors: '', page: 1 }] };
    expect(stMatchReportToQuestions(bare, questions).map((m: { questionId: number }) => m.questionId)).toEqual([5, 6, 7, 8]);
    expect(stMatchReportToQuestions({ questions: [] }, questions)).toEqual([]);
    expect(stMatchReportToQuestions(report, [])).toEqual([]);
  });
});
