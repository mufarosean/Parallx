// Worksheets: the OOXML reader. A workbook is built by hand here (the parts
// Excel writes, nothing more) so every mapping is checked against a known
// input: styles (font, fill, border, number format, alignment, theme colour
// with tint), rich shared strings, shared and array formulas, merges,
// column widths and hidden columns, row heights, text boxes, pictures, and
// the snapshot options the importer relies on (dropped cells, hidden
// solution columns).
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { openXlsx, sheetToSnapshot, shiftFormula, applyTint, columnWidthPx, parseXml, cellText, findCell } from '../../src/built-in/worksheet/ooxml.js';

const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

async function buildWorkbook(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('xl/workbook.xml', `<?xml version="1.0"?><workbook xmlns="x" xmlns:r="r"><sheets>
    <sheet name="Brosius.RF_01" sheetId="1" r:id="rId1"/>
    <sheet name="Hidden Machinery" sheetId="2" state="hidden" r:id="rId2"/></sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>`);
  zip.file('xl/sharedStrings.xml', `<sst><si><t>RF Brosius - 1</t></si><si><r><t>Solution </t></r><r><rPr><b/></rPr><t>-&gt;</t></r></si><si><t>Self-Rating:</t></si><si><t>Unrated</t></si></sst>`);
  zip.file('xl/theme/theme1.xml', `<a:theme xmlns:a="a"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="0E2841"/></a:dk2><a:lt2><a:srgbClr val="E8E8E8"/></a:lt2><a:accent1><a:srgbClr val="156082"/></a:accent1><a:accent2><a:srgbClr val="E97132"/></a:accent2><a:accent3><a:srgbClr val="196B24"/></a:accent3><a:accent4><a:srgbClr val="0F9ED5"/></a:accent4><a:accent5><a:srgbClr val="A02B93"/></a:accent5><a:accent6><a:srgbClr val="4EA72E"/></a:accent6><a:hlink><a:srgbClr val="467886"/></a:hlink><a:folHlink><a:srgbClr val="96607D"/></a:folHlink></a:clrScheme></a:themeElements></a:theme>`);
  zip.file('xl/styles.xml', `<styleSheet>
    <numFmts count="1"><numFmt numFmtId="164" formatCode="0.0%"/></numFmts>
    <fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><color rgb="FFFF0000"/><name val="Arial"/></font><font><i/><u/><sz val="10"/><color theme="4" tint="0.5"/><name val="Calibri"/></font></fonts>
    <fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor indexed="43"/></patternFill></fill></fills>
    <borders count="2"><border/><border><left style="thin"><color rgb="FF00FF00"/></left><right/><top style="medium"/><bottom style="double"><color auto="1"/></bottom></border></borders>
    <cellXfs count="5">
      <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
      <xf numFmtId="0" fontId="1" fillId="2" borderId="1"><alignment horizontal="center" vertical="top" wrapText="1"/></xf>
      <xf numFmtId="164" fontId="2" fillId="0" borderId="0"/>
      <xf numFmtId="4" fontId="0" fillId="0" borderId="0"><alignment horizontal="right"/></xf>
      <xf numFmtId="14" fontId="0" fillId="0" borderId="0"/>
    </cellXfs></styleSheet>`);
  zip.file('xl/worksheets/sheet1.xml', `<worksheet xmlns="x" xmlns:r="r"><dimension ref="A1:N20"/>
    <sheetFormatPr defaultRowHeight="15" defaultColWidth="12.42578125"/>
    <cols><col min="1" max="1" width="4" customWidth="1"/><col min="3" max="4" width="20.5" customWidth="1"/><col min="7" max="7" width="0" hidden="1" customWidth="1"/></cols>
    <sheetData>
      <row r="1"><c r="A1" t="s" s="1"><v>0</v></c><c r="D1" t="s"><v>2</v></c><c r="E1" t="s"><v>3</v></c><c r="K1" t="s"><v>1</v></c></row>
      <row r="2" ht="30" customHeight="1"><c r="B2" s="3"><v>1250.5</v></c><c r="C2" s="2"><v>0.125</v></c><c r="D2" t="b"><v>1</v></c><c r="E2" t="e"><v>#DIV/0!</v></c><c r="F2" s="4"><v>45108</v></c></row>
      <row r="3" hidden="1"><c r="B3"><f>B2*2</f><v>2501</v></c></row>
      <row r="8"><c r="M8"><f t="shared" ref="M8:M10" si="0">C8/$F8</f><v>0.1</v></c><c r="N8" t="str"><f>_xlfn.CONCAT("a","b")</f><v>ab</v></c></row>
      <row r="9"><c r="M9"><f t="shared" si="0"/><v>0.2</v></c></row>
      <row r="10"><c r="M10"><f t="shared" si="0"/><v>0.3</v></c><c r="L10" t="inlineStr"><is><t>inline text</t></is></c></row>
      <row r="12"><c r="L12"><f t="array" ref="L12:L13">SEQUENCE(2,1,1,1)</f><v>1</v></c></row>
      <row r="19"><c r="A19" t="str"><v>SHOW ALL WORK.</v></c></row>
    </sheetData>
    <mergeCells count="1"><mergeCell ref="B5:E5"/></mergeCells>
    <drawing r:id="rId1"/></worksheet>`);
  zip.file('xl/worksheets/_rels/sheet1.xml.rels', `<Relationships><Relationship Id="rId1" Target="../drawings/drawing1.xml"/></Relationships>`);
  zip.file('xl/drawings/drawing1.xml', `<xdr:wsDr xmlns:xdr="x" xmlns:a="a" xmlns:r="r">
    <xdr:twoCellAnchor><xdr:from><xdr:col>1</xdr:col><xdr:colOff>9525</xdr:colOff><xdr:row>14</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>3</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>16</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
      <xdr:pic><xdr:nvPicPr><xdr:cNvPr id="2" name="Picture 1"/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId1"/></xdr:blipFill></xdr:pic></xdr:twoCellAnchor>
    <xdr:twoCellAnchor><xdr:from><xdr:col>1</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>3</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>2</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>4</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
      <xdr:sp><xdr:txBody><a:p><a:r><a:t>y&#770; = a + b</a:t></a:r><a:r><a:t>x</a:t></a:r></a:p></xdr:txBody></xdr:sp></xdr:twoCellAnchor>
    <xdr:twoCellAnchor><xdr:from><xdr:col>1</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>2</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>2</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
      <mc:AlternateContent xmlns:mc="mc"><mc:Choice Requires="a14"><xdr:sp><xdr:txBody><a:p><a14:m><m:oMathPara><m:oMath><m:r><m:t>OMML</m:t></m:r></m:oMath></m:oMathPara></a14:m></a:p></xdr:txBody></xdr:sp></mc:Choice><mc:Fallback xmlns=""><xdr:sp><xdr:txBody><a:p><a:r><a:t>Link Ratio:</a:t></a:r></a:p><a:p><a:r><a:t>y = LDF x</a:t></a:r></a:p></xdr:txBody></xdr:sp></mc:Fallback></mc:AlternateContent></xdr:twoCellAnchor>
    <xdr:oneCellAnchor><xdr:from><xdr:col>5</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>5</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="952500" cy="476250"/>
      <xdr:pic><xdr:nvPicPr><xdr:cNvPr id="3" name="Meta"/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId2"/></xdr:blipFill></xdr:pic></xdr:oneCellAnchor>
  </xdr:wsDr>`);
  zip.file('xl/drawings/_rels/drawing1.xml.rels', `<Relationships><Relationship Id="rId1" Target="../media/image1.png"/><Relationship Id="rId2" Target="../media/image2.emf"/></Relationships>`);
  zip.file('xl/media/image1.png', PNG_1PX, { base64: true });
  zip.file('xl/media/image2.emf', 'not really an emf');
  zip.file('xl/worksheets/sheet2.xml', `<worksheet><sheetData><row r="1"><c r="A1" t="str"><v>machinery</v></c></row></sheetData></worksheet>`);
  return zip.generateAsync({ type: 'uint8array' });
}

describe('ooxml helpers', () => {
  it('parses XML with prefixes, entities, self-closing tags and attributes', () => {
    const root = parseXml(`<?xml version="1.0"?><a:r x="1"><a:t>A &amp; B &#169;</a:t><b/><!-- c --></a:r>`);
    const r = root.children[0];
    expect(r.name).toBe('r');
    expect(r.attrs.x).toBe('1');
    expect(r.children[0].text).toBe('A & B ©');
    expect(r.children[1].name).toBe('b');
  });
  it('shifts relative references and leaves anchors, names and strings alone', () => {
    expect(shiftFormula('C8/$F8', 1, 0)).toBe('C9/$F9');
    expect(shiftFormula('C8/$F8', 0, 2)).toBe('E8/$F8');
    expect(shiftFormula('SUM(A1:B2)+LOG10(3)+"A1"+Name1', 2, 1)).toBe('SUM(B3:C4)+LOG10(3)+"A1"+Name1');
    expect(shiftFormula("'Other Sheet'!A1+$A$1", 1, 1)).toBe("'Other Sheet'!B2+$A$1"); // relative refs shift across sheets too, as in Excel
  });
  it('tints theme colours the way Excel does', () => {
    expect(applyTint('000000', 0.5)).toBe('808080');
    expect(applyTint('FFFFFF', -0.5)).toBe('808080');
    expect(applyTint('156082', 0)).toBe('156082');
  });
  it('converts character widths to Excel pixels', () => {
    expect(columnWidthPx(9.140625)).toBe(64); // Excel's default column as stored
    expect(columnWidthPx(12.42578125)).toBe(87);
  });
});

describe('openXlsx + sheetToSnapshot', () => {
  it('reads the workbook: names, states, cells, formulas, styles, layout, drawings', async () => {
    const book = await openXlsx(await buildWorkbook());
    expect(book.sheetNames).toEqual(['Brosius.RF_01', 'Hidden Machinery']);
    expect(book.sheetState('Hidden Machinery')).toBe('hidden');
    const sheet = await book.readSheet('Brosius.RF_01');
    expect(cellText(sheet, 0, 0)).toBe('RF Brosius - 1');
    expect(cellText(sheet, 0, 10)).toBe('Solution ->');            // rich shared string flattened
    expect(cellText(sheet, 9, 11)).toBe('inline text');
    expect(findCell(sheet, (t) => /^solution/i.test(t))).toEqual({ row: 0, col: 10 });
    expect(sheet.sharedFormulas).toBe(2);
    const m9 = sheet.cells.find((c) => c.row === 8 && c.col === 12);
    expect(m9?.formula).toBe('C9/$F9');                              // shared formula rebuilt for its row
    expect(sheet.cells.find((c) => c.row === 11 && c.col === 11)?.arrayRef).toBe('L12:L13');
    expect(sheet.columns.find((c) => c.min === 6)?.hidden).toBe(true);
    expect(sheet.rows.find((r) => r.index === 1)?.heightPx).toBe(40);
    expect(sheet.rows.find((r) => r.index === 2)?.hidden).toBe(true);
    expect(sheet.merges).toEqual([{ r0: 4, c0: 1, r1: 4, c1: 4 }]);
    expect(sheet.images).toHaveLength(1);
    expect(sheet.imagesSkipped).toBe(1);                              // the emf
    expect(sheet.images[0].mime).toBe('image/png');
    expect(sheet.textBoxes).toEqual([
      { from: { row: 3, col: 1, rowOffsetPx: 0, colOffsetPx: 0 }, text: 'y\u0302 = a + bx' },
      { from: { row: 1, col: 1, rowOffsetPx: 0, colOffsetPx: 0 }, text: 'Link Ratio:\ny = LDF x' }, // the Fallback's plain text, not the OMML
    ]);

    const { workbook, stats } = sheetToSnapshot(sheet, book, { unitId: 'u', sheetId: 's', dropCells: new Set(['0:3', '0:4']), hideFromColumn: 10 });
    const ws = workbook.sheets.s as unknown as { cellData: Record<number, Record<number, Record<string, unknown>>>; columnData: Record<number, { w?: number; hd?: number }>; rowData: Record<number, { h?: number; hd?: number }>; mergeData: unknown[]; defaultColumnWidth: number; defaultRowHeight: number };
    // Cells: values typed, formulas prefixed, _xlfn stripped, dropped cells gone.
    expect(ws.cellData[0][0]).toMatchObject({ v: 'RF Brosius - 1', t: 1, s: 'x1' });
    expect(ws.cellData[0][3]).toBeUndefined();
    expect(ws.cellData[0][4]).toBeUndefined();
    expect(ws.cellData[1][1]).toMatchObject({ v: 1250.5, t: 2, s: 'x3' });
    expect(ws.cellData[1][3]).toMatchObject({ v: 1, t: 3 });
    expect(ws.cellData[1][4]).toMatchObject({ v: '#DIV/0!', t: 1 });
    expect(ws.cellData[2][1]).toMatchObject({ f: '=B2*2', v: 2501 });
    expect(ws.cellData[7][13].f).toBe('=CONCAT("a","b")');
    expect(ws.cellData[11][11]).toMatchObject({ f: '=SEQUENCE(2,1,1,1)', ref: 'L12:L13' });
    // Text boxes: the free anchor (B4) takes its text; the taken anchor (B2, row full) falls to the first free cell below (C3).
    expect(ws.cellData[3][1]).toMatchObject({ v: 'y\u0302 = a + bx', t: 1 });
    expect(ws.cellData[1][1].v).toBe(1250.5);
    expect(ws.cellData[2][2]).toMatchObject({ v: 'Link Ratio:\ny = LDF x', t: 1 });
    expect(stats.textBoxes).toBe(2);
    expect(stats.textBoxesDropped).toBe(0);
    expect(stats.images).toBe(1);
    const resources = (workbook as unknown as { resources: { name: string; data: string }[] }).resources;
    expect(resources[0].name).toBe('SHEET_DRAWING_PLUGIN');
    const drawing = JSON.parse(resources[0].data).s.data.img0;
    expect(drawing.imageSourceType).toBe('BASE64');
    expect(drawing.source.startsWith('data:image/png;base64,')).toBe(true);
    expect(drawing.sheetTransform.from).toEqual({ row: 14, column: 1, rowOffset: 0, columnOffset: 1 });
    expect(drawing.transform.width).toBeGreaterThan(0);
    // Layout: widths, hidden columns (the sheet's own and the solution from K on), heights, merges.
    expect(ws.columnData[0].w).toBe(columnWidthPx(4));
    expect(ws.columnData[2].w).toBe(columnWidthPx(20.5));
    expect(ws.columnData[3].w).toBe(columnWidthPx(20.5));
    expect(ws.columnData[6].hd).toBe(1);
    expect(ws.columnData[10].hd).toBe(1);
    expect(ws.columnData[13].hd).toBe(1);
    expect(ws.columnData[9]?.hd).toBeUndefined();
    expect(ws.rowData[1].h).toBe(40);
    expect(ws.rowData[2].hd).toBe(1);
    expect(ws.mergeData).toEqual([{ startRow: 4, startColumn: 1, endRow: 4, endColumn: 4 }]);
    expect(ws.defaultColumnWidth).toBe(87);
    expect(ws.defaultRowHeight).toBe(20);
    // Styles: font, fill (indexed), border (rgb + auto), alignment, number formats, theme tint.
    const styles = workbook.styles as Record<string, Record<string, unknown>>;
    expect(styles.x1).toMatchObject({ ff: 'Arial', fs: 14, bl: 1, cl: { rgb: '#FF0000' }, bg: { rgb: '#FFFF99' }, ht: 2, vt: 1, tb: 3 });
    expect(styles.x1.bd).toMatchObject({ l: { s: 1, cl: { rgb: '#00FF00' } }, t: { s: 8 }, b: { s: 7, cl: { rgb: '#000000' } } });
    expect((styles.x1.bd as Record<string, unknown>).r).toBeUndefined();
    expect(styles.x2).toMatchObject({ it: 1, ul: { s: 1 }, n: { pattern: '0.0%' } });
    expect((styles.x2.cl as { rgb: string }).rgb).toBe(`#${applyTint('156082', 0.5)}`);
    expect(styles.x3).toMatchObject({ ht: 3, n: { pattern: '#,##0.00' } });
    expect(styles.x4).toMatchObject({ n: { pattern: 'm/d/yyyy' } });
    expect(stats.styles).toBe(4);
    expect(stats.styledCells).toBeGreaterThanOrEqual(4);
  });
});
