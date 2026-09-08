// Worksheets: workbook → problems. A small workbook shaped like the study
// workbook (an index sheet, two problem sheets, machinery) checks the
// vocabulary: paper, source, kind, quadrant, the student's rating, where the
// solution and the work area are, and that the rating dropdown is stripped
// from the snapshot while its fill stays.
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { openXlsx } from '../../src/built-in/worksheet/ooxml.js';
import { detectProblems, normalizeRating, ratingLabel, RATING_SCORE, paperLabel, isProblemSheetName, problemTags, questionText } from '../../src/built-in/worksheet/problemImport.js';

async function buildWorkbook(): Promise<Uint8Array> {
  const zip = new JSZip();
  const sheet = (id: number) => `worksheets/sheet${id}.xml`;
  zip.file('xl/workbook.xml', `<workbook xmlns:r="r"><sheets>
    <sheet name="Dashboard" sheetId="1" r:id="rId1"/>
    <sheet name="Problems" sheetId="2" state="hidden" r:id="rId2"/>
    <sheet name="Brosius.RF_01" sheetId="3" state="hidden" r:id="rId3"/>
    <sheet name="Clark.CAS_SP16_04" sheetId="4" state="hidden" r:id="rId4"/>
    <sheet name="Venter.RF_Essay" sheetId="5" state="hidden" r:id="rId5"/></sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<Relationships>${[1, 2, 3, 4, 5].map((i) => `<Relationship Id="rId${i}" Target="${sheet(i)}"/>`).join('')}</Relationships>`);
  zip.file('xl/styles.xml', `<styleSheet><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
    <fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/></patternFill></fill></fills>
    <borders count="2"><border/><border><left style="thick"/><right style="thick"/><top style="thick"/><bottom style="thick"/></border></borders>
    <cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="0" fillId="2" borderId="0"/><xf numFmtId="0" fontId="0" fillId="2" borderId="1"/></cellXfs></styleSheet>`);
  zip.file('xl/worksheets/sheet1.xml', `<worksheet><sheetData><row r="1"><c r="A1" t="str"><v>Exam 7 dashboard</v></c></row></sheetData></worksheet>`);
  zip.file('xl/worksheets/sheet2.xml', `<worksheet><sheetData>
    <row r="1"><c r="A1" t="str"><v>Sheet Name/Question</v></c><c r="G1" t="str"><v>Quadrant</v></c><c r="I1" t="str"><v>Pre-Defined Question Types</v></c></row>
    <row r="2"><c r="A2" t="str"><v>Brosius.RF_01</v></c><c r="G2"><v>2</v></c><c r="I2" t="str"><v>Quantitative</v></c></row>
    <row r="3"><c r="A3" t="str"><v>Clark.CAS_SP16_04</v></c><c r="G3"><v>1</v></c><c r="I3" t="str"><v>Qualitative</v></c></row>
  </sheetData></worksheet>`);
  zip.file('xl/worksheets/sheet3.xml', `<worksheet><sheetData>
    <row r="1"><c r="A1" t="str" s="1"><v>RF Brosius - 1</v></c><c r="D1" t="str" s="1"><v>Self-Rating:</v></c><c r="E1" t="str" s="2"><v>Medium</v></c><c r="K1" t="str"><v>Solution -&gt;</v></c></row>
    <row r="3"><c r="B3" t="str" s="1"><v>Given the following information for insurer ABC:</v></c></row>
    <row r="8"><c r="C8" s="1"><v>470</v></c><c r="M8"><f>C8/2</f><v>235</v></c></row>
    <row r="16"><c r="B16" t="str" s="1"><v>Calculate the estimated ultimate losses for accident year 2013.</v></c></row>
    <row r="19"><c r="A19" t="str" s="1"><v>SHOW ALL WORK.</v></c></row>
    <row r="21"><c r="B21" t="str"><v>my old work</v></c></row>
  </sheetData></worksheet>`);
  zip.file('xl/worksheets/sheet4.xml', `<worksheet><sheetData>
    <row r="1"><c r="A1" t="str"><v>Source:</v></c><c r="B1" t="str"><v>Spring 2016</v></c><c r="D1" t="str"><v>Self-Rating:</v></c><c r="E1" t="str"><v>Unrated</v></c><c r="L1" t="str"><v>Solutions -&gt;</v></c></row>
    <row r="4"><c r="B4" t="str"><v>Discuss the reasonability of the estimate.</v></c></row>
    <row r="23"><c r="A23" t="str"><v>SHOW ALL WORK.</v></c></row>
  </sheetData></worksheet>`);
  zip.file('xl/worksheets/sheet5.xml', `<worksheet><sheetData>
    <row r="1"><c r="A1" t="str"><v>Venter Essay Problems</v></c><c r="D1" t="str"><v>Self-Rating:</v></c><c r="E1" t="str"><v>Hard</v></c></row>
    <row r="3"><c r="A3" t="str"><v>Question 1: Describe the tests.</v></c></row>
  </sheetData></worksheet>`);
  return zip.generateAsync({ type: 'uint8array' });
}

describe('ratings and labels', () => {
  it('reads both vocabularies as the same three levels', () => {
    expect(normalizeRating('Easy')).toBe('easy');
    expect(normalizeRating('nailed')).toBe('easy');
    expect(normalizeRating('partial')).toBe('medium');
    expect(normalizeRating('missed')).toBe('hard');
    expect(normalizeRating('Unrated')).toBe('');
    expect(ratingLabel('partial')).toBe('Medium');
    expect(RATING_SCORE.easy + RATING_SCORE.medium + RATING_SCORE.hard).toBe(1.5);
  });
  it('names papers and recognises problem sheets', () => {
    expect(paperLabel('Mack1994')).toBe('Mack (1994)');
    expect(paperLabel('sahas')).toBe('Sahasrabuddhe');
    expect(paperLabel('newpaper')).toBe('Newpaper');
    expect(isProblemSheetName('Brosius.RF_01')).toBe(true);
    expect(isProblemSheetName('Quiz Generator')).toBe(false);
    expect(isProblemSheetName('Shapland Q&A')).toBe(false);
    expect(problemTags({ paper: 'clark', source: 'cas', kind: 'qual', quadrant: 1 })).toBe('clark,cas,qual,q1');
    expect(problemTags({ paper: 'clark', source: 'rf', kind: 'quant', quadrant: 0 })).toBe('clark,rf,quant');
  });
});

describe('detectProblems', () => {
  it('describes every problem sheet and skips the machinery', async () => {
    const book = await openXlsx(await buildWorkbook());
    const progress: number[] = [];
    const { problems, skipped } = await detectProblems(book, (done) => progress.push(done));
    expect(skipped.map((s) => s.name)).toEqual(['Dashboard', 'Problems']);
    expect(progress).toEqual([1, 2, 3]);
    expect(problems.map((p) => p.sheetName)).toEqual(['Brosius.RF_01', 'Clark.CAS_SP16_04', 'Venter.RF_Essay']);

    const [rf, cas, essay] = problems;
    expect(rf).toMatchObject({ title: 'RF Brosius - 1', paper: 'brosius', source: 'rf', kind: 'quant', quadrant: 2, rating: 'medium', solutionCol: 10, workRow: 18, tags: 'brosius,rf,quant,q2' });
    expect(rf.questionMd).toBe('Given the following information for insurer ABC:\nCalculate the estimated ultimate losses for accident year 2013.');
    expect(cas).toMatchObject({ title: 'Source:', paper: 'clark', source: 'cas', kind: 'qual', quadrant: 1, rating: '', solutionCol: 11, workRow: 22 });
    expect(essay).toMatchObject({ paper: 'venter', source: 'rf', kind: 'essay', quadrant: 0, rating: 'hard', solutionCol: -1, workRow: -1 });

    // The snapshot keeps the whole sheet (solution included, nothing hidden here) minus the rating dropdown's content, fill kept.
    const snap = JSON.parse(rf.sheetJson);
    const ws = snap.sheets[snap.sheetOrder[0]];
    expect(ws.cellData[0][3].v).toBeUndefined();
    expect(ws.cellData[0][4].v).toBeUndefined();
    expect(snap.styles[ws.cellData[0][4].s]).toEqual({ bg: { rgb: '#F2F2F2' } });
    expect(ws.cellData[7][12].f).toBe('=C8/2');
    expect(ws.columnData[10]?.hd).toBeUndefined();
    expect(rf.stats.cells).toBeGreaterThan(5);
  });
  it('extracts question text without the markers', () => {
    expect(questionText({ cells: [
      { row: 0, col: 0, value: 'RF Brosius - 1' }, { row: 0, col: 3, value: 'Self-Rating:' }, { row: 0, col: 4, value: 'Medium' }, { row: 0, col: 10, value: 'Solution ->' },
      { row: 2, col: 1, value: 'Given this.' }, { row: 5, col: 12, value: 'solution text' }, { row: 18, col: 0, value: 'SHOW ALL WORK.' }, { row: 20, col: 1, value: 'work' },
    ] } as never, 10, 18)).toBe('Given this.');
  });
});
