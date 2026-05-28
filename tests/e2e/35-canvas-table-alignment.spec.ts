/**
 * Canvas table-alignment diagnostic.
 *
 * Reproduces the user-reported bug (2026-05-27): inserting a `/table`
 * via slash menu renders the table visibly INDENTED from other blocks
 * (paragraphs, task items) in the same editor. The user expects
 * Notion-style left-alignment: every block's left edge sits on the
 * same vertical axis.
 *
 * This spec measures concrete viewport positions for a paragraph vs.
 * its sibling table, then asserts they share a left edge within 2px.
 */
import { sharedTest as test, expect, setupCanvasPage, waitForEditor } from './fixtures';

test.describe('Canvas table alignment', () => {

  test('placeholder still renders on empty paragraphs (regression check)', async ({
    window: page,
    electronApp,
    workspacePath,
  }) => {
    await setupCanvasPage(page, electronApp, workspacePath);
    await waitForEditor(page);
    await page.evaluate(() => {
      const ed = (window as any).__tiptapEditor;
      ed?.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }] });
    });
    await page.waitForTimeout(150);

    // The empty paragraph should have a ::before with placeholder content.
    const pseudo = await page.evaluate(() => {
      const p = document.querySelector<HTMLElement>('.tiptap > p.is-empty');
      if (!p) return null;
      const cs = window.getComputedStyle(p, '::before');
      return { content: cs.content, position: cs.position };
    });
    expect(pseudo).not.toBeNull();
    // Content should be the data-placeholder attribute value, non-empty.
    expect(pseudo!.content).not.toBe('none');
    expect(pseudo!.content).not.toBe('""');
    expect(pseudo!.position).toBe('absolute');
  });

  test('table is left-aligned with paragraphs in the same editor', async ({
    window: page,
    electronApp,
    workspacePath,
  }) => {
    await setupCanvasPage(page, electronApp, workspacePath);
    await waitForEditor(page);

    // Build a minimal doc: one paragraph + one table + one paragraph.
    // Programmatic content so we don't have to drive the slash menu.
    await page.evaluate(() => {
      const ed = (window as any).__tiptapEditor;
      if (!ed) throw new Error('No editor');
      ed.commands.setContent({
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'BEFORE' }] },
          {
            type: 'table',
            content: [
              { type: 'tableRow', content: [
                { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'h1' }] }] },
                { type: 'tableHeader', content: [{ type: 'paragraph' }] },
                { type: 'tableHeader', content: [{ type: 'paragraph' }] },
              ] },
              { type: 'tableRow', content: [
                { type: 'tableCell', content: [{ type: 'paragraph' }] },
                { type: 'tableCell', content: [{ type: 'paragraph' }] },
                { type: 'tableCell', content: [{ type: 'paragraph' }] },
              ] },
            ],
          },
          { type: 'paragraph', content: [{ type: 'text', text: 'AFTER' }] },
        ],
      });
    });
    await page.waitForTimeout(200);

    const probe = await page.evaluate(() => {
      const tiptap = document.querySelector<HTMLElement>('.tiptap');
      const rect = (el: Element | null | undefined) => el ? el.getBoundingClientRect() : null;
      const before = document.querySelector<HTMLElement>('.tiptap > p');
      const wrapper = document.querySelector<HTMLElement>('.tiptap .tableWrapper');
      const table = document.querySelector<HTMLElement>('.tiptap table');
      const headerCells = Array.from(document.querySelectorAll<HTMLElement>('.tiptap table th'));
      const bodyCells = Array.from(document.querySelectorAll<HTMLElement>('.tiptap table td'));
      return {
        tiptap: rect(tiptap),
        beforeP: rect(before),
        wrapper: rect(wrapper),
        table: rect(table),
        headerCellWidths: headerCells.map((c) => c.getBoundingClientRect().width),
        headerCellLefts: headerCells.map((c) => c.getBoundingClientRect().left),
        bodyCellWidths: bodyCells.map((c) => c.getBoundingClientRect().width),
        bodyCellLefts: bodyCells.map((c) => c.getBoundingClientRect().left),
        tableComputed: table ? (() => {
          const cs = window.getComputedStyle(table);
          return { tableLayout: cs.tableLayout, width: cs.width };
        })() : null,
        wrapperComputed: wrapper ? (() => {
          const cs = window.getComputedStyle(wrapper);
          return { width: cs.width, marginLeft: cs.marginLeft, marginRight: cs.marginRight, paddingLeft: cs.paddingLeft, display: cs.display };
        })() : null,
      };
    });
    console.log('alignment probe:', JSON.stringify(probe, null, 2));

    const rowDom = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll<HTMLElement>('.tiptap table tbody > tr'));
      return rows.map((tr, i) => {
        const cs = window.getComputedStyle(tr);
        return {
          rowIdx: i,
          rowClass: tr.className,
          rowRect: { left: tr.getBoundingClientRect().left, width: tr.getBoundingClientRect().width },
          rowComputed: {
            display: cs.display,
            transform: cs.transform,
            position: cs.position,
            left: cs.left,
            paddingLeft: cs.paddingLeft,
            marginLeft: cs.marginLeft,
          },
          firstChildTag: tr.firstElementChild?.tagName ?? null,
          firstChildOffsetParent: (tr.firstElementChild as HTMLElement)?.offsetParent?.tagName ?? null,
        };
      });
    });
    console.log('ROW META:', JSON.stringify(rowDom, null, 2));

    // Inspect ::before pseudo on the is-empty body row.
    const pseudoInfo = await page.evaluate(() => {
      const row = document.querySelector<HTMLElement>('.tiptap table tbody > tr.is-empty');
      if (!row) return null;
      const cs = window.getComputedStyle(row, '::before');
      return {
        content: cs.content,
        position: cs.position,
        display: cs.display,
        width: cs.width,
        height: cs.height,
      };
    });
    console.log('ROW ::before:', JSON.stringify(pseudoInfo));

    const colInfo = await page.evaluate(() => {
      const cols = Array.from(document.querySelectorAll<HTMLElement>('.tiptap table col'));
      return cols.map((c, i) => {
        const cs = window.getComputedStyle(c);
        return {
          idx: i,
          width: c.getBoundingClientRect().width,
          left: c.getBoundingClientRect().left,
          inlineStyle: c.getAttribute('style'),
          computedWidth: cs.width,
          computedMinWidth: cs.minWidth,
        };
      });
    });
    console.log('COL info:', JSON.stringify(colInfo, null, 2));

    const cellAttrs = await page.evaluate(() => {
      const cells = Array.from(document.querySelectorAll<HTMLElement>('.tiptap table th, .tiptap table td'));
      return cells.map((c, i) => ({
        idx: i,
        tag: c.tagName,
        colspan: c.getAttribute('colspan'),
        rowspan: c.getAttribute('rowspan'),
        inlineStyle: c.getAttribute('style'),
        computedMinWidth: window.getComputedStyle(c).minWidth,
        computedWidth: window.getComputedStyle(c).width,
      }));
    });
    console.log('CELL info:', JSON.stringify(cellAttrs, null, 2));

    // Save a small clipped screenshot focused on the table area.
    await page.setViewportSize({ width: 900, height: 700 });
    await page.waitForTimeout(200);
    const tableEl = page.locator('.tiptap table').first();
    const box = await tableEl.boundingBox();
    if (box) {
      const clipX = Math.max(0, box.x - 100);
      const clipY = Math.max(0, box.y - 80);
      const clipW = Math.min(900 - clipX, box.width + 200);
      const clipH = Math.min(700 - clipY, box.height + 200);
      await page.screenshot({
        path: 'test-results/canvas-diagnostic/table-alignment.png',
        clip: { x: clipX, y: clipY, width: clipW, height: clipH },
      });
    }

    // ASSERTIONS

    // 1. Table wrapper's left edge must equal the paragraph's left edge.
    expect(probe.wrapper).not.toBeNull();
    expect(probe.beforeP).not.toBeNull();
    expect(Math.abs((probe.wrapper!.left) - (probe.beforeP!.left))).toBeLessThanOrEqual(2);

    // 2. Every header cell must have the same width as the column below it
    // (header column i width === body column i width, ±1px for borders).
    expect(probe.headerCellWidths.length).toBe(3);
    expect(probe.bodyCellWidths.length).toBe(3);
    for (let i = 0; i < 3; i++) {
      expect(Math.abs(probe.headerCellWidths[i] - probe.bodyCellWidths[i])).toBeLessThanOrEqual(1);
    }

    // 3. With table-layout: fixed, all 3 columns should be ~equal width.
    const w = probe.headerCellWidths;
    const avg = (w[0] + w[1] + w[2]) / 3;
    for (const x of w) {
      expect(Math.abs(x - avg)).toBeLessThanOrEqual(2);
    }
  });
});
